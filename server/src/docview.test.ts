import { describe, expect, it } from "vitest";
import { docPage, downloadHeader, isDocx, safeFileName } from "./docview.js";
import { parseAssignmentKind } from "./connectors/vklass.js";

describe("bilagor: Word, nedladdning och typ", () => {
  it("känner igen Word-filer", () => {
    expect(isDocx("Stavning v 46.docx")).toBe(true);
    expect(isDocx("läxa", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe(true);
    expect(isDocx("Läxa v 45.pdf", "application/pdf")).toBe(false);
  });
  it("gör ett säkert filnamn och en nedladdningsrubrik", () => {
    expect(safeFileName('a/b:c*"d".pdf')).toBe("a_b_c__d_.pdf");
    expect(safeFileName(undefined)).toBe("bilaga");
    expect(downloadHeader("Läxa v 45.pdf")).toBe("attachment; filename*=UTF-8''L%C3%A4xa%20v%2045.pdf");
  });
  it("lägger sidan i en enkel sida", () => {
    expect(docPage("<p>hej</p>")).toContain("<body><p>hej</p></body>");
  });
  it("läser typen som Vklass själv skriver den", () => {
    const page = (t: string) => `<header><div class="text-tags">${t}</div><h1>X</h1></header>`;
    expect(parseAssignmentKind(page("Läxa, Svenska"))).toBe("läxa");
    expect(parseAssignmentKind(page("Prov, Matematik"))).toBe("prov");
    expect(parseAssignmentKind(page("Uppgift, Engelska"))).toBe("uppgift");
    expect(parseAssignmentKind(page("Inlämning, SO"))).toBe("inlämning");
    expect(parseAssignmentKind(page("Något annat, SO"))).toBeUndefined();
    expect(parseAssignmentKind("<p>ingen typ</p>")).toBeUndefined();
  });
});
