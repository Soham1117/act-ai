import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { TextItem } from "pdfjs-dist/types/src/display/api";

/** Extract plain text from a PDF bytes buffer (digital text layer). */
export async function extractPdfText(bytes: ArrayBuffer): Promise<string> {
  const pdf = await getDocument({ data: new Uint8Array(bytes) }).promise;
  const parts: string[] = [];
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const line = (content.items as TextItem[])
      .map((item) => item.str ?? "")
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (line) parts.push(line);
  }
  return parts.join("\n");
}
