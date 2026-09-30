import { describe, expect, it } from "vitest";
import { downloadHeaders, sanitizeBaseName, validateUpload } from "./upload-validation";

const pdf = new TextEncoder().encode("%PDF-1.7\n1 0 obj\n");
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const html = new TextEncoder().encode("<html><script>alert(1)</script></html>");

describe("validateUpload", () => {
  it("accepts a real PDF and returns a safe name + hash", () => {
    const r = validateUpload("paystub", { name: "Pay Stub — 2026-05-16.pdf", bytes: pdf });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.safeFileName.endsWith(".pdf")).toBe(true);
      expect(r.contentType).toBe("application/pdf");
      expect(r.sha256).toHaveLength(64);
    }
  });

  it("rejects HTML renamed to .pdf", () => {
    expect(validateUpload("paystub", { name: "x.pdf", bytes: html }).ok).toBe(false);
  });

  it("rejects disallowed extensions", () => {
    expect(validateUpload("document", { name: "x.html", bytes: html }).ok).toBe(false);
    expect(validateUpload("document", { name: "x.svg", bytes: html }).ok).toBe(false);
    expect(validateUpload("paystub", { name: "x.png", bytes: png }).ok).toBe(false);
  });

  it("rejects empty and oversize files", () => {
    expect(validateUpload("receipt", { name: "x.pdf", bytes: new Uint8Array() }).ok).toBe(false);
    const big = new Uint8Array(9 * 1024 * 1024);
    big.set(pdf);
    expect(validateUpload("receipt", { name: "x.pdf", bytes: big }).ok).toBe(false);
  });

  it("rejects mismatched magic bytes", () => {
    expect(validateUpload("image", { name: "x.png", bytes: pdf }).ok).toBe(false);
    expect(validateUpload("image", { name: "x.png", bytes: png }).ok).toBe(true);
  });

  it("rejects txt containing HTML", () => {
    expect(validateUpload("document", { name: "n.txt", bytes: html }).ok).toBe(false);
  });
});

describe("sanitizeBaseName", () => {
  it("strips path tricks and odd characters", () => {
    expect(sanitizeBaseName("../../etc/passwd.pdf")).not.toContain("/");
    expect(sanitizeBaseName("Pay Stub — 2026-05-16.pdf")).toBe("Pay Stub _ 2026-05-16".replace("_ ", "_ "));
  });
  it("falls back when nothing is left", () => {
    expect(sanitizeBaseName("....pdf")).toBe("file");
  });
});

describe("downloadHeaders", () => {
  it("never serves HTML and always sets nosniff + attachment for unknown types", () => {
    const h = downloadHeaders({ fileName: "evil.html", fileType: "text/html", inline: true });
    expect(h["Content-Type"]).toBe("application/octet-stream");
    expect(h["Content-Disposition"].startsWith("attachment")).toBe(true);
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
  });
  it("keeps the real extension and allows inline pdf", () => {
    const h = downloadHeaders({ fileName: "Pay Stub 1.pdf", inline: true });
    expect(h["Content-Type"]).toBe("application/pdf");
    expect(h["Content-Disposition"]).toContain(".pdf");
    expect(h["Content-Disposition"].startsWith("inline")).toBe(true);
  });
});
