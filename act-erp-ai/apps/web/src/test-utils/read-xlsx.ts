import AdmZip from "adm-zip";

/** Test helper: one worksheet as rows of display strings (durations as h:mm). Only reads what buildWorkbookXlsx writes. */
export function readSheetRows(xlsx: Buffer, sheet = 1): string[][] {
  const zip = new AdmZip(xlsx);
  const durationStyles = new Set(
    [...(/<cellXfs[^>]*>(.*?)<\/cellXfs>/.exec(zip.readAsText("xl/styles.xml"))?.[1] ?? "").matchAll(/<xf [^>]*/g)]
      .map((m, i) => (m[0].includes('numFmtId="164"') ? i : -1))
      .filter((i) => i >= 0),
  );
  const decode = (v: string) =>
    v.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  const xml = zip.readAsText(`xl/worksheets/sheet${sheet}.xml`);
  return [...xml.matchAll(/<row[^>]*>(.*?)<\/row>/g)].map((row) => {
    const cells: string[] = [];
    for (const c of row[1]!.matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>(.*?)<\/c>)/g)) {
      const col = [...c[1]!].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
      const style = Number(/s="(\d+)"/.exec(c[2]!)?.[1] ?? 0);
      const text = /<t[^>]*>(.*?)<\/t>/.exec(c[3] ?? "")?.[1];
      const num = /<v>(.*?)<\/v>/.exec(c[3] ?? "")?.[1];
      let value = "";
      if (text !== undefined) value = decode(text);
      else if (num !== undefined && durationStyles.has(style)) {
        const min = Math.round(Number(num) * 1440);
        value = `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`;
      } else if (num !== undefined) value = num;
      while (cells.length < col) cells.push("");
      cells[col] = value;
    }
    while (cells.length && cells.at(-1) === "") cells.pop();
    return cells;
  });
}
