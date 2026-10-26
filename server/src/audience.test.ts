import { describe, expect, it } from "vitest";
import { audience } from "./audience.js";

const people = new Map([
  ["p1", { id: "p1", name: "Emil" }],
  ["p2", { id: "p2", name: "Elin" }],
  ["p3", { id: "p3", name: "Alicia" }],
  ["p4", { id: "p4", name: "Al" }],
]);

describe("audience: vem en händelse gäller", () => {
  it("kalenderns ägare och flera valda personer", () => {
    expect(audience({ personId: "p3", title: "Fotboll" }, people)).toEqual(["Alicia"]);
    expect(audience({ personIds: ["p1", "p2"], title: "Middag hos Alicia" }, people)).toEqual(["Emil", "Elin"]); // namn i titeln ändrar inget när kalendern har valda personer
  });
  it("delad kalender: förnamn i titeln eller beskrivningen, hela ord", () => {
    expect(audience({ title: "Elin tandläkare" }, people)).toEqual(["Elin"]);
    expect(audience({ title: "Alicia och Emil kommer" }, people)).toEqual(["Emil", "Alicia"]);
    expect(audience({ title: "Besök", description: "Emil hämtar" }, people)).toEqual(["Emil"]);
    expect(audience({ title: "Elinas födelsedag" }, people)).toEqual([]); // inte ett helt ord
    expect(audience({ title: "Al fresco" }, people)).toEqual([]); // för kort namn (under 3 tecken) matchas inte
  });
  it("ingen träff = hela familjen (tom lista)", () => {
    expect(audience({ title: "Norrköping" }, people)).toEqual([]);
  });
});
