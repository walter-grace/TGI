/**
 * Load .md skill files from .symphony/skills directory.
 * Pattern: Symphony .codex, PicoClaw skills, autoresearch program.md
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export function loadSkills(directory: string): Map<string, string> {
  const map = new Map<string, string>();
  const resolved = join(process.cwd(), directory);
  try {
    const entries = readdirSync(resolved, { withFileTypes: true });
    for (const e of entries) {
      if (e.isFile() && e.name.endsWith(".md")) {
        const name = e.name.slice(0, -3);
        const path = join(resolved, e.name);
        const content = readFileSync(path, "utf-8");
        map.set(name, content);
      }
    }
  } catch {
    // directory may not exist yet
  }
  return map;
}
