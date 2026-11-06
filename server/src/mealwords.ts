import type { CalEvent } from "./connectors/ics.js";
// Shared by the server and the board (no Node imports here).

/** Side dishes and filler words – sharing these does not make it "the same food". */
export const MEAL_STOPWORDS = new Set(
  "potatis potatismos kokt kokta stekt stekta ugnsstekt ugnsrostad ugnsrostade pasta spagetti makaroner sallad salladen grönsaker rotfrukter tomatsås gräddsås sås såsen serveras serveras ekologisk ekologiska hemlagad hemlagade vegetarisk vegetariskt dagens kokosmjölk bröd smör knäckebröd mjölk lingon gurka tomat morötter ugnen pommes bulgur couscous nudlar ris".split(" "),
);

export function sameAsLunch(dinner: string | undefined, lunch: { dishes: string[] }[]): string | null {
  if (!dinner) return null;
  const words = (s: string) => new Set((s.toLowerCase().match(/[a-zåäöé]{5,}/g) ?? []).filter((w) => !MEAL_STOPWORDS.has(w)));
  const d = words(dinner);
  for (const l of lunch) for (const dish of l.dishes) for (const w of words(dish)) if (d.has(w)) return dish;
  return null;
}

/**
 * The dishes of one day from a calendar event (the Skolmat integration in Home Assistant): the title holds the
 * choices joined with " | ", the description the same ones as "[Lunch] • A • B". Use the description when it
 * has a list, drop tags like "[Lunch]", and show every dish once.
 */
export function menuDishes(title: string, description?: string): string[] {
  const split = (s: string) =>
    s
      .replace(/\[[^\]]*\]/g, " ")
      .split(/\s*[•|\n]\s*|\s+I\s+/)
      .map((x) => x.replace(/\s+/g, " ").replace(/^[,;·\s]+|[,;·\s]+$/g, "").trim())
      .filter(Boolean);
  const fromDescription = description ? split(description) : [];
  const dishes = fromDescription.length ? fromDescription : split(title);
  const seen = new Set<string>();
  return dishes.filter((d) => {
    const k = d.toLowerCase().replace(/[.!]+$/, "");
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}


/** An all-day calendar event that is really a menu: SchoolSoft's export has "Matsedel" with "Huvudrätt / Chili con carne …". */
const MENU_TITLE = /^\s*(matsedel|skollunch|lunchmeny|meny)\s*$/i;
/** The first line of such a description names the kind of dish, it is not a dish ("Huvudrätt", "Vegetariskt", "Lunch"). */
const MENU_LABEL = /^(huvudrätt|huvudrätten|vegetariskt|vegetarisk|vegetariskt alternativ|veg|lunch|dagens|dagens rätt|alternativ\s*\d*|alt\.?\s*\d*|meny)$/i;

export function isMenuEvent(e: Pick<CalEvent, "allDay" | "title">): boolean {
  return e.allDay && MENU_TITLE.test(e.title);
}

/** The dishes in one menu event's description; a vegetarian label is kept as a prefix so it is clear which is which. */
export function menuEventDishes(description: string | undefined): string[] {
  const lines = (description ?? "")
    .replace(/\\n/g, "\n")
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (!lines.length) return [];
  let prefix = "";
  if (lines.length > 1 && MENU_LABEL.test(lines[0]!.replace(/[:.]$/, ""))) {
    if (/^veg/i.test(lines[0]!)) prefix = "Vegetariskt: ";
    lines.shift();
  }
  return lines.map((l) => `${prefix}${l}`);
}

/** Splits a calendar into real events and menu days (all menu events of one day become one list of dishes). */
export function splitMenuEvents<T extends CalEvent>(evs: T[], dayLabel: (d: Date) => string): { events: T[]; food: { child: string; day: string; dishes: string[] }[] } {
  const events: T[] = [];
  const byDay = new Map<string, string[]>();
  for (const e of evs) {
    if (!isMenuEvent(e)) {
      events.push(e);
      continue;
    }
    const day = dayLabel(e.start);
    const list = byDay.get(day) ?? [];
    for (const d of menuEventDishes(e.description)) if (!list.some((x) => x.toLowerCase() === d.toLowerCase())) list.push(d);
    byDay.set(day, list);
  }
  const food = [...byDay.entries()].filter(([, dishes]) => dishes.length).map(([day, dishes]) => ({ child: "", day, dishes }));
  return { events, food };
}
