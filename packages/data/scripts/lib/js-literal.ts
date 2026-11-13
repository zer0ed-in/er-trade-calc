// Pull pure data literals out of Emilia's minified planner bundles WITHOUT running her app code.
// Each literal is evaluated in an empty vm context (no require, no process, no globals except JSON),
// so anything that isn't a plain literal throws instead of executing.
import vm from "node:vm";

const EVAL_TIMEOUT_MS = 5_000;

export function evalLiteral(source: string): unknown {
  return vm.runInNewContext(`(${source})`, Object.freeze({ JSON }), { timeout: EVAL_TIMEOUT_MS });
}

/** For small data-only chunks: `var e={...};export{e as default};` → the default export's value. */
export function evalDefaultExportModule(src: string): unknown {
  const exportMatch = src.match(/export\s*\{([^}]*)\}\s*;?\s*$/);
  if (!exportMatch) throw new Error("No trailing export block");
  const defaultIdent = exportMatch[1]!.split(",").map((s) => s.trim()).find((s) => /\bas default$/.test(s))?.split(/\s+/)[0];
  if (!defaultIdent) throw new Error("No default export");
  const body = src.slice(0, exportMatch.index);
  const ctx: Record<string, unknown> = { JSON };
  vm.runInNewContext(`${body};globalThis.__default=${defaultIdent};`, ctx, { timeout: EVAL_TIMEOUT_MS });
  return ctx.__default;
}

/** Index just past the literal starting at `open` ('{' or '['), skipping strings and template literals. */
export function matchLiteralEnd(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      i = skipString(src, i);
      continue;
    }
    if (ch === "{" || ch === "[" || ch === "(") depth++;
    else if (ch === "}" || ch === "]" || ch === ")") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  throw new Error(`Unterminated literal at ${open}`);
}

function skipString(src: string, start: number): number {
  const quote = src[start];
  for (let i = start + 1; i < src.length; i++) {
    const ch = src[i];
    if (ch === "\\") i++;
    else if (quote === "`" && ch === "$" && src[i + 1] === "{") i = matchLiteralEnd(src, i + 1) - 1;
    else if (ch === quote) return i;
  }
  throw new Error(`Unterminated string at ${start}`);
}

/** Value of `ident=<literal>` (first definition), e.g. ident "er" for `,er=[0,45,...]`. */
export function extractAssignedLiteral(src: string, ident: string): unknown {
  const re = new RegExp(`(?:^|[,;{}\\s])${ident.replace(/\$/g, "\\$")}=([{\\[])`, "g");
  for (const m of src.matchAll(re)) {
    const open = m.index! + m[0].length - 1;
    try {
      return evalLiteral(src.slice(open, matchLiteralEnd(src, open)));
    } catch {
      // not a pure literal at this site; keep looking
    }
  }
  throw new Error(`No pure literal assigned to ${ident}`);
}

/**
 * The innermost-assigned pure literal (`x={...}` / `x=[...]`) that contains `needle`.
 * Used when minified variable names are unstable but a data key (e.g. `"Ritual Sword Talisman":{`) is not.
 */
export function extractLiteralContaining(src: string, needle: string, maxCandidates = 5_000): { ident: string; value: unknown } {
  const at = src.indexOf(needle);
  if (at < 0) throw new Error(`Needle not found: ${needle}`);
  const candidates: { ident: string; open: number }[] = [];
  for (const m of src.slice(0, at).matchAll(/([\w$]+)=([{[])/g)) {
    candidates.push({ ident: m[1]!, open: m.index! + m[0].length - 1 });
  }
  for (const c of candidates.reverse().slice(0, maxCandidates)) {
    let end: number;
    try {
      end = matchLiteralEnd(src, c.open);
    } catch {
      continue;
    }
    if (end <= at) continue;
    try {
      return { ident: c.ident, value: evalLiteral(src.slice(c.open, end)) };
    } catch {
      // enclosing literal references code; widen
    }
  }
  throw new Error(`No pure literal contains ${needle}`);
}

/** Identifier name captured by `pattern`'s first group, e.g. /([\w$]+)\[this\.finalStats\.value\.vit\|0\]/. */
export function identFromUsage(src: string, pattern: RegExp): string {
  const m = src.match(pattern);
  if (!m?.[1]) throw new Error(`Usage pattern not found: ${pattern}`);
  return m[1];
}
