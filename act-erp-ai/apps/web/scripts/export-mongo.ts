/**
 * Optional helper: dump every collection from the legacy MongoDB to CSV.
 *
 * Use only if you actually want the legacy data carried forward.
 * `pnpm seed:all` already populates a believable dataset from scratch —
 * this script is for the historical-migration path.
 *
 * Run:  LEGACY_MONGO_URI="mongodb+srv://…" pnpm export:mongo
 *
 * Output: data/raw/<collection>.csv
 */

import "dotenv/config";
import { MongoClient } from "mongodb";
import { mkdirSync, writeFileSync } from "fs";
import { join, resolve } from "path";

const MONGO_URI = process.env.LEGACY_MONGO_URI;
if (!MONGO_URI) {
  console.error("\n❌  Set LEGACY_MONGO_URI before running.\n");
  process.exit(1);
}

const OUT_DIR = resolve(process.cwd(), "data/raw");
mkdirSync(OUT_DIR, { recursive: true });

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return `"${JSON.stringify(value).replace(/"/g, '""')}"`;
  const s = String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

async function main() {
  const client = new MongoClient(MONGO_URI as string);
  await client.connect();
  console.log("Connected to legacy Mongo.");

  const db = client.db();
  const colls = await db.listCollections().toArray();
  console.log(`Found ${colls.length} collection(s).\n`);

  for (const c of colls) {
    const docs = await db.collection(c.name).find().toArray();
    if (docs.length === 0) {
      console.log(`  ${c.name}: empty, skipped.`);
      continue;
    }
    // Union of keys (Mongo schemas drift over time).
    const keys = Array.from(new Set(docs.flatMap((d) => Object.keys(d))));
    const lines = [
      keys.join(","),
      ...docs.map((d) => keys.map((k) => csvEscape((d as Record<string, unknown>)[k])).join(",")),
    ];
    const path = join(OUT_DIR, `${c.name}.csv`);
    writeFileSync(path, lines.join("\n"));
    console.log(`  ${c.name}: ${docs.length} rows → ${path}`);
  }

  await client.close();
  console.log("\n✅  Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
