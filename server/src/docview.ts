/** Turns a Word file (.docx) into a readable page for the board; the page is shown in a sandboxed frame (no scripts). */
export function isDocx(name: string, type = ""): boolean {
  return /\.docx$/i.test(name) || /wordprocessingml\.document/i.test(type);
}

/** A file name that is safe in a Content-Disposition header. */
export function safeFileName(name: string | undefined, fallback = "bilaga"): string {
  const n = (name ?? "").replace(/[\\/:*?"<>|\r\n\t]/g, "_").trim().slice(0, 120);
  return n || fallback;
}

export function downloadHeader(name: string): string {
  return `attachment; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/** The converted body wrapped as a complete, plain page. */
export function docPage(body: string): string {
  return `<!doctype html><html lang="sv"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
body{font:17px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:14px;color:#161a22;background:#fff;overflow-wrap:anywhere}
h1,h2,h3{line-height:1.2}table{border-collapse:collapse;max-width:100%}td,th{border:1px solid #8a92a0;padding:5px 8px;vertical-align:top}img{max-width:100%;height:auto}p{margin:.5em 0}
</style></head><body>${body}</body></html>`;
}

export async function docxToHtml(buf: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  const { value } = await mammoth.convertToHtml({ buffer: buf });
  return docPage(value || "<p>Dokumentet är tomt.</p>");
}
