/**
 * Snällistan i julkortet (Nordpol). Kortet är gjort för Home Assistants att-göra-listor och anropar tjänsterna
 * add_item, update_item och remove_item; här sparas listan i tavlans egen lokala fil i stället, så att kortet fungerar
 * utan Home Assistant. Objekten har samma form som Home Assistants: { uid, summary, status, description }.
 */
import { randomUUID } from "node:crypto";
import { loadLocal, saveLocal } from "./store.js";

export interface JulNiceItem {
  uid: string;
  summary: string;
  status: "needs_action" | "completed";
  description?: string;
}

const MAX_ITEMS = 60;
const MAX_SUMMARY = 60;
const MAX_DESCRIPTION = 4000;

export const loadJulNice = (): JulNiceItem[] => loadLocal().julNice ?? [];

const text = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

export type JulNiceService = "add_item" | "update_item" | "remove_item";
export const JUL_NICE_SERVICES: readonly JulNiceService[] = ["add_item", "update_item", "remove_item"];

/** Utför ett tjänsteanrop från kortet. Returnerar den nya listan, eller ett felmeddelande. */
export function applyJulNice(service: JulNiceService, data: Record<string, unknown>): { items: JulNiceItem[] } | { error: string } {
  const list = loadJulNice().map((i) => ({ ...i }));
  const find = (ref: unknown) => {
    const r = String(ref ?? "");
    return list.find((i) => i.uid === r) ?? list.find((i) => i.summary === r);
  };
  if (service === "add_item") {
    const summary = text(data.item, MAX_SUMMARY);
    if (!summary) return { error: "Namn saknas." };
    if (list.some((i) => i.summary === summary)) return { error: "Finns redan." };
    if (list.length >= MAX_ITEMS) return { error: "Listan är full." };
    list.push({ uid: randomUUID(), summary, status: "needs_action", ...(data.description != null ? { description: text(data.description, MAX_DESCRIPTION) } : {}) });
  } else if (service === "update_item") {
    const it = find(data.item);
    if (!it) return { error: "Hittar inte posten." };
    if (data.rename != null) {
      const name = text(data.rename, MAX_SUMMARY);
      if (!name) return { error: "Namn saknas." };
      it.summary = name;
    }
    if (data.description != null) it.description = text(data.description, MAX_DESCRIPTION);
    if (data.status === "completed" || data.status === "needs_action") it.status = data.status;
  } else {
    const refs = Array.isArray(data.item) ? data.item : [data.item];
    const drop = new Set(refs.map((r) => find(r)?.uid).filter((u): u is string => Boolean(u)));
    const keep = list.filter((i) => !drop.has(i.uid));
    saveLocal({ julNice: keep });
    return { items: keep };
  }
  saveLocal({ julNice: list });
  return { items: list };
}
