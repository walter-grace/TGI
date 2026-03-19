/**
 * Resolve labels -> skill set via label_map config.
 * Returns skill names (for prompt) and optionally full content.
 */

import type { SkillsConfig } from "../config/types.js";
import { loadSkills } from "./loader.js";

export function resolveSkillsForLabels(
  config: SkillsConfig,
  labels: string[],
  skillsMap?: Map<string, string>
): string[] {
  const base = new Set(config.default);
  for (const label of labels) {
    const mapped = config.label_map[label.toLowerCase()];
    if (mapped) {
      for (const s of mapped) base.add(s);
    }
  }
  return Array.from(base);
}

export function getSkillContents(
  skillNames: string[],
  directory: string
): Map<string, string> {
  const loaded = loadSkills(directory);
  const result = new Map<string, string>();
  for (const name of skillNames) {
    const content = loaded.get(name);
    if (content) result.set(name, content);
  }
  return result;
}
