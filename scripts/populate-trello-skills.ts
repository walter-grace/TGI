#!/usr/bin/env npx tsx
/**
 * Populate a Trello list with cards for each Symphony skill.
 *
 * What it does:
 * - Reads `.symphony/skills/*.md`
 * - Creates a Trello list named `Skills` if it doesn't exist
 * - For each skill file, creates a card titled `<skillName>` (no `.md`)
 *   with a short description extracted from the first paragraph in the file
 * - If a card with that title already exists in the list, it is skipped
 *
 * Usage:
 *   npx tsx scripts/populate-trello-skills.ts
 *   npx tsx scripts/populate-trello-skills.ts --dry-run
 *   npx tsx scripts/populate-trello-skills.ts --list "Skills"
 *
 * Requires `.env.local` with:
 * - TRELLO_API_KEY
 * - TRELLO_API_TOKEN
 * - TRELLO_BOARD_ID (or it will be parsed from WORKFLOW.md)
 */

import dotenv from "dotenv";
import { readFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { resolve, basename, extname } from "node:path";

dotenv.config();
dotenv.config({ path: ".env.local", override: true });

const apiKey = process.env.TRELLO_API_KEY;
const apiToken = process.env.TRELLO_API_TOKEN;

if (!apiKey || !apiToken) {
  console.error("Missing TRELLO_API_KEY and/or TRELLO_API_TOKEN in .env.local");
  process.exit(1);
}

const listNameArg = process.argv.includes("--list")
  ? process.argv[process.argv.indexOf("--list") + 1]
  : undefined;
const listName = (listNameArg && listNameArg.trim()) || "Skills";

const dryRun = process.argv.includes("--dry-run");

function getBoardIdFromEnvOrWorkflow(): string {
  const fromEnv = process.env.TRELLO_BOARD_ID?.trim();
  if (fromEnv) return fromEnv;

  // Parse board_id out of WORKFLOW.md frontmatter.
  try {
    const wf = readFileSync(resolve(process.cwd(), "WORKFLOW.md"), "utf-8");
    const match = wf.match(/board_id:\s*["']?([a-zA-Z0-9]+)["']?/);
    if (match) return match[1];
  } catch {
    // ignore
  }
  throw new Error("TRELLO_BOARD_ID not set and could not be parsed from WORKFLOW.md");
}

const boardId = getBoardIdFromEnvOrWorkflow();

async function trelloFetch<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const base = "https://api.trello.com/1";
  const sep = path.includes("?") ? "&" : "?";
  const url = `${base}${path}${sep}key=${encodeURIComponent(apiKey)}&token=${encodeURIComponent(apiToken)}`;

  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Trello API ${res.status}: ${text}`);
  }
  return (await res.json()) as T;
}

function extractFirstParagraph(markdown: string): string {
  const lines = markdown.split(/\r?\n/).map((l) => l.trimEnd());
  // Drop leading empty lines
  while (lines.length > 0 && lines[0].trim() === "") lines.shift();
  if (lines.length === 0) return "";

  // Skip top-level header if present
  if (lines[0].startsWith("#")) {
    lines.shift();
    while (lines.length > 0 && lines[0].trim() === "") lines.shift();
  }

  const paragraph: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (t === "") break;
    paragraph.push(t);
  }

  const joined = paragraph.join(" ").replace(/\s+/g, " ").trim();
  return joined;
}

async function main(): Promise<void> {
  console.log(`Trello board: ${boardId}`);
  console.log(`Skills list: ${listName}`);
  console.log(`Mode: ${dryRun ? "dry-run" : "apply"}`);

  const listResponse = await trelloFetch<Array<{ id: string; name: string }>>(
    `/boards/${boardId}/lists`
  );
  const existingList = listResponse.find((l) => l.name === listName);
  const listId = existingList?.id ?? null;

  let idList: string;
  if (!listId) {
    if (dryRun) {
      console.log(`Would create list: ${listName}`);
      idList = "dry-run";
    } else {
      console.log(`Creating list: ${listName}`);
      const created = await trelloFetch<{ id: string; name: string }>(
        `/lists?name=${encodeURIComponent(listName)}&idBoard=${boardId}`,
        { method: "POST" }
      );
      idList = created.id;
    }
  } else {
    idList = listId;
  }

  const cards =
    idList === "dry-run"
      ? []
      : await trelloFetch<Array<{ id: string; name: string }>>(
          `/lists/${idList}/cards?fields=id,name`
        );
  const existingTitles = new Set(cards.map((c) => c.name));

  const skillsDir = resolve(process.cwd(), ".symphony", "skills");
  const entries = await readdir(skillsDir);
  const skillFiles = entries.filter((f) => extname(f) === ".md").sort();

  console.log(`Found ${skillFiles.length} skill files.`);

  let createdCount = 0;
  let skippedCount = 0;

  for (const file of skillFiles) {
    const skillName = basename(file, extname(file));
    const already = existingTitles.has(skillName);
    if (already) {
      skippedCount++;
      continue;
    }

    const fullPath = resolve(skillsDir, file);
    const markdown = await readFile(fullPath, "utf-8");
    const summary = extractFirstParagraph(markdown);
    const description = summary || "Skill (no summary found).";

    if (dryRun) {
      console.log(`[dry-run] Would create: ${skillName}`);
      continue;
    }

    console.log(`Creating card: ${skillName}`);
    await trelloFetch(
      `/cards?idList=${encodeURIComponent(idList)}`,
      {
        method: "POST",
        body: JSON.stringify({
          name: skillName,
          desc: description,
        }),
      }
    );
    createdCount++;
  }

  console.log(
    dryRun
      ? `Dry-run complete. Skipped(existing): ${skippedCount}.`
      : `Done. Created: ${createdCount}. Skipped(existing): ${skippedCount}.`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

