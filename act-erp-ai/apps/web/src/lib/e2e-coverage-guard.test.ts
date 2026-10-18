import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Traceability guard: every exported server action (and every page-level
 * route handler) must be mentioned in e2e/COVERAGE.md or e2e/coverage/*.md,
 * so a new feature cannot ship without someone deciding how it is tested.
 * A row may say `planned` or `not-testable` (with a reason); it just has to
 * exist. See e2e/AUTHORING.md for the row format.
 */
const WEB = path.resolve(__dirname, "../..");
const SRC = path.join(WEB, "src");

function walk(dir: string, match: (f: string) => boolean): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return walk(full, match);
    return match(full) ? [full] : [];
  });
}

function exportedActions(file: string): string[] {
  const text = readFileSync(file, "utf8");
  if (!/^\s*["']use server["']/m.test(text)) return [];
  return [...text.matchAll(/^export\s+(?:async\s+function|const)\s+([A-Za-z0-9_]+)/gm)].map(
    (m) => m[1]!,
  );
}

function coverageText(): string {
  const dir = path.join(WEB, "e2e");
  const files = [path.join(dir, "COVERAGE.md")];
  const frag = path.join(dir, "coverage");
  for (const f of readdirSync(frag)) if (f.endsWith(".md")) files.push(path.join(frag, f));
  return files.map((f) => readFileSync(f, "utf8")).join("\n");
}

describe("e2e coverage matrix", () => {
  const covered = coverageText();

  it("mentions every exported server action", () => {
    const actionFiles = walk(
      SRC,
      (f) =>
        /[\\/]server[\\/]actions[\\/][^\\/]+\.ts$/.test(f) ||
        /[\\/]app[\\/].*[\\/]actions\.ts$/.test(f),
    ).filter((f) => !/\.test\.ts$/.test(f));

    const missing: string[] = [];
    for (const file of actionFiles) {
      for (const name of exportedActions(file)) {
        if (!covered.includes(`\`${name}\``)) {
          missing.push(`${path.relative(SRC, file)}: ${name}`);
        }
      }
    }
    expect(
      missing,
      "Server actions with no row in e2e/COVERAGE.md or e2e/coverage/*.md. Add a row (covered / planned / not-testable) in the right area file:\n" +
        missing.join("\n"),
    ).toEqual([]);
  });

  it("mentions every API route", () => {
    const routes = walk(path.join(SRC, "app", "api"), (f) => /route\.ts$/.test(f)).map((f) =>
      path
        .relative(path.join(SRC, "app"), path.dirname(f))
        .split(path.sep)
        .join("/"),
    );
    const missing = routes.filter((r) => !covered.includes(r));
    expect(
      missing,
      "API routes with no mention in e2e/COVERAGE.md or e2e/coverage/*.md:\n" + missing.join("\n"),
    ).toEqual([]);
  });
});
