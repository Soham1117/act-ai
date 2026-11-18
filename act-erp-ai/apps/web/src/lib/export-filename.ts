export function exportFilenameName(name: string, fallback: string): string {
  return name.normalize("NFC")
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || fallback;
}
