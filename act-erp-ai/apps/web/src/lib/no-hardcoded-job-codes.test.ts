import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guard against a bug class that reached production: the schedule shift dialog
 * pre-filled a hard-coded job code ("ACT001") that did not exist in the
 * database. Job codes are admin-managed data, so UI code must read them from
 * the database (e.g. the `jobCodes` prop) and never embed a literal one.
 *
 * Scope: everything under src/app. Server-side fallbacks (src/server) are a
 * separate, known follow-up and are not scanned here.
 */
const APP_DIR = path.resolve(__dirname, "../app");
// Codes in the company style: ACT + digits (ACT001, ACT-001, ACT_100 ...).
const HARD_CODED_JOB_CODE = /\bACT[-_]?\d{2,}\b/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

describe("no hard-coded job codes in UI code", () => {
  it("matches the codes we want to forbid", () => {
    expect(HARD_CODED_JOB_CODE.test('const code = "ACT001"')).toBe(true);
    expect(HARD_CODED_JOB_CODE.test("useState('ACT-100')")).toBe(true);
    expect(HARD_CODED_JOB_CODE.test("ACTION_LABEL")).toBe(false);
    expect(HARD_CODED_JOB_CODE.test("const code = jobCodes[0]?.code")).toBe(false);
  });

  it("finds no literal job code like ACT001 anywhere in src/app", () => {
    const hits: string[] = [];
    for (const file of sourceFiles(APP_DIR)) {
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (HARD_CODED_JOB_CODE.test(line)) {
            hits.push(`${path.relative(APP_DIR, file)}:${i + 1}  ${line.trim()}`);
          }
        });
    }
    expect(
      hits,
      "Hard-coded job code in UI code. Load real job codes from the database instead:\n" +
        hits.join("\n"),
    ).toEqual([]);
  });
});
