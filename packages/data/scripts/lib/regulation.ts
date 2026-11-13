// Reader for Elden Ring's regulation.bin (build scripts only; the engine never reads game files).
// Layers: AES-256-CBC → DCX (ZSTD) → BND4 → PARAM. Field layouts come from paramdef XML files passed in by the caller.
// Format notes follow SoulsFormats (TKGP); the AES key is SoulsFormats' Elden Ring regulation key.
import { createDecipheriv } from "node:crypto";
import { zstdDecompressSync } from "node:zlib";

const ER_REGULATION_KEY = Buffer.from("99BFFC366A6BC8C6F5827D093602D676C42892A01C207FB024D3AF4E493FEF99", "hex");

/** AES-256-CBC with the IV in the first 16 bytes. The file is a whole number of blocks, so no padding is stripped. */
export function decryptRegulation(file: Buffer): Buffer {
  const decipher = createDecipheriv("aes-256-cbc", ER_REGULATION_KEY, file.subarray(0, 16));
  decipher.setAutoPadding(false);
  return Buffer.concat([decipher.update(file.subarray(16)), decipher.final()]);
}

/** DCX container with a ZSTD payload: uncompressed size at 0x1C (big-endian); the frame starts at the zstd magic. */
export function decompressDcx(dcx: Buffer): Buffer {
  if (dcx.toString("latin1", 0, 4) !== "DCX\0") throw new Error("not a DCX file");
  const uncompressedSize = dcx.readUInt32BE(0x1c);
  const frameStart = dcx.indexOf(Buffer.from([0x28, 0xb5, 0x2f, 0xfd]));
  if (frameStart < 0) throw new Error("DCX: no ZSTD frame found");
  const out = zstdDecompressSync(dcx.subarray(frameStart));
  if (out.length !== uncompressedSize) throw new Error(`DCX: decompressed ${out.length} bytes, header says ${uncompressedSize}`);
  return out;
}

export interface BndFile { id: number; name: string; data: Buffer }

/** BND4 archive with 0x24-byte file headers (csize @+8, usize q, dataOffset i, id i, nameOffset i) and UTF-16 names. */
export function readBnd4(bnd: Buffer): BndFile[] {
  if (bnd.toString("latin1", 0, 4) !== "BND4") throw new Error("not a BND4 archive");
  const fileCount = bnd.readInt32LE(0x0c);
  const headerSize = Number(bnd.readBigInt64LE(0x20));
  if (headerSize !== 0x24) throw new Error(`BND4: file header size ${headerSize}, expected 0x24`);
  const files: BndFile[] = [];
  for (let i = 0; i < fileCount; i++) {
    const h = 0x40 + i * headerSize;
    const compressedSize = Number(bnd.readBigInt64LE(h + 0x08));
    const dataOffset = bnd.readUInt32LE(h + 0x18);
    const id = bnd.readInt32LE(h + 0x1c);
    const nameOffset = bnd.readUInt32LE(h + 0x20);
    files.push({ id, name: readUtf16z(bnd, nameOffset), data: bnd.subarray(dataOffset, dataOffset + compressedSize) });
  }
  return files;
}

function readUtf16z(buf: Buffer, offset: number): string {
  let end = offset;
  while (buf.readUInt16LE(end) !== 0) end += 2;
  return buf.toString("utf16le", offset, end);
}

function readAsciiz(buf: Buffer, offset: number): string {
  return buf.toString("latin1", offset, buf.indexOf(0, offset));
}

// ---- paramdefs ----

export interface FieldDef {
  type: string;
  name: string;
  /** Array length (fixstr/fixstrW/dummy8[n]); 0 if not an array. */
  arrayLength: number;
  /** Bit width for bitfields; 0 if not a bitfield. */
  bits: number;
}
export interface ParamDef { paramType: string; fields: FieldDef[] }

/**
 * Parses a paramdef XML, keeping only the fields present in `regulationVersion`
 * (FirstVersion ≤ version < RemovedVersion, when those attributes are set).
 */
export function parseParamDef(xml: string, regulationVersion: number): ParamDef {
  const paramType = xml.match(/<ParamType>([^<]+)<\/ParamType>/)?.[1];
  if (!paramType) throw new Error("paramdef: no ParamType");
  const fields: FieldDef[] = [];
  for (const m of xml.matchAll(/<Field\s+([^>]*?)\/?>/g)) {
    const attrs = Object.fromEntries([...m[1]!.matchAll(/(\w+)="([^"]*)"/g)].map((a) => [a[1]!, a[2]!]));
    const first = attrs.FirstVersion ?? attrs.FirstRegulationVersion;
    const removed = attrs.RemovedVersion ?? attrs.RemovedRegulationVersion;
    if (first && regulationVersion < Number(first)) continue;
    if (removed && regulationVersion >= Number(removed)) continue;
    const def = attrs.Def?.match(/^(\w+)\s+(\w+)\s*(?:\[(\d+)\])?\s*(?::\s*(\d+))?/);
    if (!def) throw new Error(`paramdef ${paramType}: cannot parse Def="${attrs.Def}"`);
    fields.push({ type: def[1]!, name: def[2]!, arrayLength: Number(def[3] ?? 0), bits: Number(def[4] ?? 0) });
  }
  return { paramType, fields };
}

const STORAGE_BYTES: Record<string, number> = { s8: 1, u8: 1, dummy8: 1, s16: 2, u16: 2, s32: 4, u32: 4, b32: 4, f32: 4, angle32: 4, f64: 8 };

type Reader = (row: Buffer, offset: number) => number;
const READERS: Record<string, Reader> = {
  s8: (b, o) => b.readInt8(o), u8: (b, o) => b.readUInt8(o), dummy8: (b, o) => b.readUInt8(o),
  s16: (b, o) => b.readInt16LE(o), u16: (b, o) => b.readUInt16LE(o),
  s32: (b, o) => b.readInt32LE(o), u32: (b, o) => b.readUInt32LE(o), b32: (b, o) => b.readInt32LE(o),
  f32: (b, o) => b.readFloatLE(o), angle32: (b, o) => b.readFloatLE(o), f64: (b, o) => b.readDoubleLE(o),
};

export interface FieldLayout extends FieldDef { offset: number; bitOffset: number }

/**
 * Byte/bit position of every field. Bitfields pack by storage size, not type name: a bitfield continues the open bit
 * storage when its storage size matches and the bits still fit (so "dummy8 x:1" shares a byte with preceding u8 bitfields).
 */
export function layoutOf(def: ParamDef): { fields: FieldLayout[]; rowSize: number } {
  const fields: FieldLayout[] = [];
  let offset = 0;
  let open: { offset: number; size: number; used: number } | null = null;
  for (const f of def.fields) {
    const size = f.type === "fixstr" ? 1 : f.type === "fixstrW" ? 2 : STORAGE_BYTES[f.type];
    if (size === undefined) throw new Error(`paramdef ${def.paramType}: unknown type ${f.type}`);
    if (f.bits > 0) {
      if (!open || open.size !== size || open.used + f.bits > size * 8) {
        open = { offset, size, used: 0 };
        offset += size;
      }
      fields.push({ ...f, offset: open.offset, bitOffset: open.used });
      open.used += f.bits;
      continue;
    }
    open = null;
    fields.push({ ...f, offset, bitOffset: 0 });
    offset += size * Math.max(1, f.arrayLength);
  }
  return { fields, rowSize: offset };
}

export type ParamRow = Record<string, number | string> & { id: number };

/** A PARAM file: rows from 0x40, 24 bytes each (id i32, pad i32, dataOffset i64, nameOffset i64). Padding fields are skipped. */
export function readParam(param: Buffer, def: ParamDef): { paramType: string; rows: ParamRow[] } {
  const format2D = param.readUInt8(0x2d);
  if (!(format2D & 0x04)) throw new Error("PARAM: only the 64-bit-offset format (Elden Ring) is supported");
  const paramType = format2D & 0x80 ? readAsciiz(param, Number(param.readBigInt64LE(0x10))) : readAsciiz(param, 0x0c);
  if (paramType !== def.paramType) throw new Error(`PARAM type ${paramType} does not match paramdef ${def.paramType}`);
  const rowCount = param.readUInt16LE(0x0a);
  const { fields, rowSize } = layoutOf(def);
  const rows: ParamRow[] = [];
  for (let i = 0; i < rowCount; i++) {
    const h = 0x40 + i * 24;
    const id = param.readInt32LE(h);
    const dataOffset = Number(param.readBigInt64LE(h + 8));
    const data = param.subarray(dataOffset, dataOffset + rowSize);
    const row: ParamRow = { id };
    for (const f of fields) {
      if (f.type === "dummy8") continue;
      if (f.type === "fixstr") { row[f.name] = readFixed(data, f.offset, f.arrayLength, "latin1"); continue; }
      if (f.type === "fixstrW") { row[f.name] = readFixed(data, f.offset, f.arrayLength * 2, "utf16le"); continue; }
      const raw = READERS[f.type]!(data, f.offset);
      row[f.name] = f.bits > 0 ? ((raw >>> f.bitOffset) & ((1 << f.bits) - 1)) : raw;
    }
    rows.push(row);
  }
  return { paramType, rows };
}

function readFixed(data: Buffer, offset: number, bytes: number, encoding: "latin1" | "utf16le"): string {
  const s = data.toString(encoding, offset, offset + bytes);
  const nul = s.indexOf("\0");
  return nul < 0 ? s : s.slice(0, nul);
}

/** Decrypt, decompress and unpack a regulation.bin into its param files, by base name (e.g. "AtkParam_Pc"). */
export function openRegulation(file: Buffer): Map<string, Buffer> {
  const files = readBnd4(decompressDcx(decryptRegulation(file)));
  return new Map(files.map((f) => [f.name.replace(/^.*[\\/]/, "").replace(/\.param$/, ""), f.data]));
}

// ---- comparison with an existing JSON copy (Emilia's param exports: "Row ID", "Row Name", then fields) ----

export interface CopyComparison {
  rowsInCopy: number;
  rowsInGame: number;
  /** Copy rows whose id is not in the game file. */
  copyRowsMissing: number;
  /** Fields compared (present under the same name in both). */
  fieldsCompared: number;
  /** Copy fields with no same-named field in the paramdef (naming differs between def versions). */
  copyFieldsUnmatched: string[];
  mismatches: { id: number; field: string; game: number | string; copy: unknown }[];
}

/** Compares every copy row × same-named field with the game rows. f32 values match if the copy rounds to the same float. */
export function compareWithCopy(game: ParamRow[], copy: Record<string, unknown>[]): CopyComparison {
  const byId = new Map(game.map((r) => [r.id, r]));
  const gameFields = new Set(Object.keys(game[0] ?? {}));
  const copyFields = Object.keys(copy[0] ?? {}).filter((k) => k !== "Row ID" && k !== "Row Name");
  const shared = copyFields.filter((k) => gameFields.has(k));
  const mismatches: CopyComparison["mismatches"] = [];
  let copyRowsMissing = 0;
  for (const c of copy) {
    const id = c["Row ID"] as number;
    const g = byId.get(id);
    if (!g) { copyRowsMissing++; continue; }
    for (const field of shared) {
      const a = g[field]!, b = c[field];
      if (a === b || (typeof b === "number" && Math.fround(b) === a)) continue;
      mismatches.push({ id, field, game: a, copy: b });
    }
  }
  return { rowsInCopy: copy.length, rowsInGame: game.length, copyRowsMissing, fieldsCompared: shared.length,
    copyFieldsUnmatched: copyFields.filter((k) => !gameFields.has(k)), mismatches };
}
