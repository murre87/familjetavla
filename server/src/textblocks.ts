// Shared by the server and the board (no Node imports here).
/** Text from the school: lines "a | b" in a row (a glossary) are shown as a table, the rest as text. */
export function textBlocks(text: string): ({ kind: "text"; text: string } | { kind: "table"; rows: string[][] })[] {
  const out: ({ kind: "text"; text: string } | { kind: "table"; rows: string[][] })[] = [];
  let rows: string[][] = [];
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) out.push({ kind: "text", text: para.join("\n") });
    para = [];
  };
  const flushRows = () => {
    // Two lines or more with the same idea make a table; a lone "a | b" is just text.
    if (rows.length >= 2) out.push({ kind: "table", rows });
    else if (rows.length === 1) para.push(rows[0]!.join(" | "));
    rows = [];
  };
  for (const line of text.split("\n")) {
    const cells = line.split(" | ").map((c) => c.trim());
    if (cells.length >= 2 && cells.every(Boolean)) {
      flushPara();
      rows.push(cells);
    } else {
      flushRows();
      para.push(line);
    }
  }
  flushRows();
  flushPara();
  return out.filter((b) => b.kind === "table" || b.text.trim());
}
