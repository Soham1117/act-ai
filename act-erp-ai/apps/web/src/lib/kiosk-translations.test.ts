import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { kioskSpanish, translateKiosk } from "./kiosk-translations";

describe("kiosk language", () => {
  it("preserves English and unknown messages", () => {
    expect(translateKiosk("Clock in", "en")).toBe("Clock in");
    expect(translateKiosk("Unexpected message", "es")).toBe("Unexpected message");
  });

  it("translates actions, PIN errors, and variable lockout durations", () => {
    expect(translateKiosk("Clock in", "es")).toBe("Registrar entrada");
    expect(translateKiosk("Enter your 4-digit PIN", "es")).not.toBe(
      "Enter your 4-digit PIN",
    );
    expect(
      translateKiosk(
        "Too many incorrect PIN attempts. Try again in about 1 minute.",
        "es",
      ),
    ).toContain("1 minuto.");
    expect(
      translateKiosk(
        "Too many incorrect PIN attempts. Try again in about 5 minutes.",
        "es",
      ),
    ).toContain("5 minutos.");
  });

  it("normalizes multiline copy for translation", () => {
    expect(translateKiosk("  Clock\n in  ", "es")).toBe("Registrar entrada");
  });

  it("covers every literal used by kiosk translation calls", () => {
    const missing: string[] = [];
    for (const file of [
      "kiosk-screen",
      "kiosk-profile-photo-editor",
      "contract-crew-panel",
      "timings-list",
      "punch-camera",
      "version-watcher",
    ]) {
      const filename = path.resolve("src/app/(kiosk)/kiosk", `${file}.tsx`);
      const source = ts.createSourceFile(
        filename,
        readFileSync(filename, "utf8"),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      );
      function visit(node: ts.Node) {
        if (ts.isCallExpression(node) && node.expression.getText(source) === "t") {
          const arg = node.arguments[0];
          if (
            arg &&
            ts.isStringLiteral(arg) &&
            !Object.hasOwn(kioskSpanish, arg.text.replace(/\s+/g, " ").trim())
          ) {
            missing.push(`${file}: ${arg.text}`);
          }
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
    expect(missing).toEqual([]);
  });
});
