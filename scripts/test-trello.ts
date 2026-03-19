#!/usr/bin/env npx tsx
/**
 * Test Trello board connection.
 * Usage: npx tsx scripts/test-trello.ts [boardId]
 * Or: TRELLO_BOARD_ID=xxx npx tsx scripts/test-trello.ts
 */

import dotenv from "dotenv";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

dotenv.config();
dotenv.config({ path: ".env.local", override: true });

const TRELLO_API_KEY = process.env.TRELLO_API_KEY;
const TRELLO_API_TOKEN = process.env.TRELLO_API_TOKEN;

function getBoardId(): string {
  const arg = process.argv[2];
  if (arg) return arg;
  const env = process.env.TRELLO_BOARD_ID;
  if (env) return env;
  try {
    const workflow = readFileSync(resolve(process.cwd(), "WORKFLOW.md"), "utf-8");
    const match = workflow.match(/board_id:\s*["']?([a-zA-Z0-9]+)["']?/);
    if (match) return match[1];
  } catch {
    // ignore
  }
  throw new Error("Board ID required. Pass as arg: npx tsx scripts/test-trello.ts <boardId>");
}

async function trelloFetch(path: string): Promise<unknown> {
  const url = `https://api.trello.com/1${path}?key=${TRELLO_API_KEY}&token=${TRELLO_API_TOKEN}`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Trello API ${res.status}: ${text}`);
  }
  return res.json();
}

async function main(): Promise<void> {
  console.log("TGI — Trello connection test\n");

  if (!TRELLO_API_KEY || !TRELLO_API_TOKEN) {
    console.error("Missing TRELLO_API_KEY or TRELLO_API_TOKEN in .env.local");
    process.exit(1);
  }

  const boardId = getBoardId();
  console.log("Board ID:", boardId);

  try {
    console.log("\n1. Fetching board...");
    const board = (await trelloFetch(`/boards/${boardId}`)) as { name: string; url: string };
    console.log("   OK —", board.name);
    console.log("   URL:", board.url);

    console.log("\n2. Fetching lists...");
    const lists = (await trelloFetch(`/boards/${boardId}/lists`)) as Array<{ id: string; name: string }>;
    console.log("   OK —", lists.length, "lists");
    for (const list of lists) {
      console.log("   -", list.name, `(${list.id})`);
    }

    console.log("\n3. Fetching cards from all lists...");
    let totalCards = 0;
    for (const list of lists) {
      const cards = (await trelloFetch(`/lists/${list.id}/cards`)) as Array<{ name: string; shortLink: string }>;
      if (cards.length > 0) {
        console.log("\n   " + list.name + " (" + cards.length + "):");
        for (const card of cards) {
          console.log("   -", card.name, `(${card.shortLink})`);
          totalCards++;
        }
      }
    }
    if (totalCards === 0) {
      console.log("   No cards found on the board.");
    }

    console.log("\n✓ Trello connection OK");
  } catch (err) {
    console.error("\n✗ Error:", err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

main();
