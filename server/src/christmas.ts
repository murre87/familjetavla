/**
 * Julkortet (Nordpol): när det visas. Standard ("auto") är julsäsongen 21 november – 26 december varje år;
 * "on" visar det året runt och "off" aldrig. Kortet kan alltid stängas av.
 */
import type { Config } from "./types.js";

export type ChristmasMode = "auto" | "on" | "off";

/** Säsongen som MM-DD, båda dagarna inräknade. */
export const CHRISTMAS_FROM = "11-21";
export const CHRISTMAS_TO = "12-26";

export function isChristmasMode(v: unknown): v is ChristmasMode {
  return v === "auto" || v === "on" || v === "off";
}

/** Är datumet (lokal tid) inom julsäsongen? */
export function inChristmasSeason(now: Date): boolean {
  const md = `${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return md >= CHRISTMAS_FROM && md <= CHRISTMAS_TO;
}

export interface ChristmasView {
  /** Visa kortet (rutan på startsidan och fliken Jul) just nu. */
  show: boolean;
  mode: ChristmasMode;
  inSeason: boolean;
  /** Säsongen, MM-DD – så att inställningen kan säga när "auto" visar det. */
  from: string;
  to: string;
  /** Hemmets plats för släden; saknas den används Sveriges mitt (Stockholm). */
  lat: number;
  lon: number;
  place: string;
}

const STOCKHOLM = { lat: 59.33, lon: 18.07 };

export function christmasView(cfg: Pick<Config, "household" | "dashboard">, now: Date): ChristmasView {
  const mode: ChristmasMode = isChristmasMode(cfg.dashboard.christmas) ? cfg.dashboard.christmas : "auto";
  const inSeason = inChristmasSeason(now);
  const h = cfg.household;
  const ok = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
  return {
    show: mode === "on" || (mode === "auto" && inSeason),
    mode,
    inSeason,
    from: CHRISTMAS_FROM,
    to: CHRISTMAS_TO,
    lat: ok(h.lat) ? h.lat : STOCKHOLM.lat,
    lon: ok(h.lon) ? h.lon : STOCKHOLM.lon,
    place: (h.place || h.municipality || "").slice(0, 60),
  };
}

/** Texten i rutan på startsidan. Julafton räknas som kl. 18 (som kortets nedräkning); efter annandag jul pekar den på nästa år. */
export function christmasLine(now: Date): { big: string; small: string } {
  const y = now.getFullYear();
  const eve = (year: number) => new Date(year, 11, 24, 18, 0);
  const endOfBoxingDay = (year: number) => new Date(year, 11, 26, 23, 59, 59);
  if (now >= eve(y) && now <= endOfBoxingDay(y)) return { big: "God jul!", small: "Önskar tavlan" };
  const target = now > endOfBoxingDay(y) ? eve(y + 1) : eve(y);
  const day = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const days = Math.round((day(target) - day(now)) / 86_400_000);
  if (days === 0) return { big: "Julafton idag", small: "Tomten är på väg" };
  if (days === 1) return { big: "Imorgon är det julafton", small: "1 natt kvar" };
  return { big: `${days} dagar till jul`, small: "Tomtens verkstad" };
}
