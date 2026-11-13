// Test helper: load the committed gen data once. (Tests may read files; the engine may not.)
import { loadGameData } from "@ertc/data";
export const data = loadGameData("1.17");
