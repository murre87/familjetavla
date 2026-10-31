import { useEffect, useMemo, useState } from "react";
import { InstallHelp, quickAddUrl } from "../InstallHelp";
import { WIDGET_LABELS } from "../widgets";
import { CUSTODY_PRESETS, isHome } from "../../../server/src/custody";
import type {
  CalendarCategory,
  CalendarProvider,
  CalendarSource,
  Config,
  Custody,
  Integration,
  IntegrationCategory,
  Person,
  TestResult,
  TravelChoice,
} from "../../../server/src/types";
import { api, type CalendarTest, type Discovery } from "../api";
import { Icon } from "../Icon";
import { MusicCard } from "./music";
import { SecurityCard } from "./security";
import { EntityPicker, MultiEntityPicker, PALETTE, ProviderForm, ProviderTiles, Result, Select, Text, Toggle, Words, uid } from "./parts";
import type { StepProps } from "./Wizard";

const WEEKDAYS = ["måndag", "tisdag", "onsdag", "torsdag", "fredag", "lördag", "söndag"];

// ======================= Hem =======================

export function HomeStep({ cfg, set, postcode, setPostcode }: StepProps) {
  const [pnr, setPnr] = useState(cfg.household.postcode ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const lookup = async () => {
    setBusy(true);
    setError("");
    try {
      const p = await api.postcode(pnr);
      setPostcode(p);
      // The answer can come after the user has moved on – build on the latest config, not this render's.
      set((c) => ({
        ...c,
        integrations: c.integrations.map((i) => (i.category === "price" && i.provider === "spot" ? { ...i, settings: { ...i.settings, area: p.area } } : i)),
        household: { ...c.household, postcode: p.postcode, place: p.place, municipality: p.municipality, lat: p.lat, lon: p.lon },
      }));
    } catch (e) {
      setError(`${(e as Error).message} Postnumret sparas ändå – väder och elområde kan fyllas i senare under Inställningar.`);
    } finally {
      setBusy(false);
    }
  };
  // Look up by itself once five digits are in – a "Hämta" button is easy to miss.
  const digits = pnr.replace(/\s/g, "");
  useEffect(() => {
    if (digits.length !== 5 || (cfg.household.postcode?.replace(/\s/g, "") === digits && cfg.household.place)) return;
    const t = setTimeout(() => void lookup(), 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [digits]);
  const typePnr = (v: string) => {
    setPnr(v);
    // Keep what was typed even if the lookup fails; a new number clears the old place.
    const d = v.replace(/\s/g, "");
    if (d !== (cfg.household.postcode ?? "").replace(/\s/g, "")) set({ ...cfg, household: { ...cfg.household, postcode: d || undefined, place: undefined, municipality: undefined, lat: undefined, lon: undefined } });
  };
  return (
    <section className="card">
      <Text label="Vad heter hushållet?" value={cfg.household.name} onChange={(v) => set({ ...cfg, household: { ...cfg.household, name: v } })} placeholder="Familjen Svensson" />
      <div className="row gap" style={{ alignItems: "flex-end" }}>
        <div className="grow">
          <Text label="Postnummer" inputMode="numeric" value={pnr} onChange={typePnr} placeholder="123 45" />
        </div>
        <button className="btn" onClick={lookup} disabled={busy || pnr.replace(/\s/g, "").length !== 5}>
          {busy ? "Söker…" : "Hämta"}
        </button>
      </div>
      {error && <Result error={error} />}
      {cfg.household.place && (
        <div className="result">
          <b>
            {cfg.household.place}
            {cfg.household.municipality ? ` · ${cfg.household.municipality}` : ""}
          </b>
          {postcode && (
            <span className="muted">
              Förslag: elområde <b>{postcode.area}</b>
              {postcode.wasteProvider ? " · sophämtning kan hämtas på adress" : ""}. Du kan ändra senare.
            </span>
          )}
        </div>
      )}
    </section>
  );
}

// ======================= Familjen =======================

function WeekPreview({ custody }: { custody: Custody }) {
  const weeks = useMemo(() => {
    const out: { label: string; home: boolean }[] = [];
    const today = new Date();
    const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - ((today.getDay() + 6) % 7));
    for (let i = 0; i < 8; i++) {
      const d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i * 7 + ((custody.handoverDay ?? 1) - 1));
      const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
      const day = t.getUTCDay() || 7;
      t.setUTCDate(t.getUTCDate() + 4 - day);
      const w = Math.ceil(((t.getTime() - Date.UTC(t.getUTCFullYear(), 0, 1)) / 86_400_000 + 1) / 7);
      out.push({ label: `v${w}`, home: isHome(custody, d) });
    }
    return out;
  }, [custody.mode, custody.anchorDate, custody.handoverDay]);
  return (
    <div className="weeks" aria-label="Kommande veckor">
      {weeks.map((w, i) => (
        <div key={i} className={w.home ? "home" : ""} title={w.home ? "Hemma" : "I andra hemmet"}>
          {w.label}
        </div>
      ))}
    </div>
  );
}

const DAY_LETTERS = ["M", "T", "O", "T", "F", "L", "S"];
const mondayOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** 14 day toggles (week A, week B) with ready-made patterns like 2-2-3 and every other weekend. */
function PatternEditor({ custody, name, setC }: { custody: Custody; name: string; setC: (c: Partial<Custody>) => void }) {
  const pattern = custody.pattern ?? CUSTODY_PRESETS.find((x) => x.id === "7-7")!.pattern;
  const anchor = custody.anchorDate ?? ymd(mondayOf(new Date()));
  const thisWeek = isHome({ mode: "pattern", pattern: Array(7).fill(true).concat(Array(7).fill(false)), anchorDate: anchor }, new Date()) ? "A" : "B";
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="row gap wrap">
        {CUSTODY_PRESETS.map((pr) => (
          <button key={pr.id} className={`btn small ${pr.pattern.join() === pattern.join() ? "primary" : ""}`} onClick={() => setC({ pattern: pr.pattern, anchorDate: anchor })}>
            {pr.label}
          </button>
        ))}
        <button className="btn small ghost" onClick={() => setC({ pattern: pattern.map((x) => !x), anchorDate: anchor })}>
          Vänd
        </button>
      </div>
      <div className="pattern-grid" role="group" aria-label={`Dagar då ${name || "barnet"} är hos er`}>
        {["A", "B"].map((w, wi) => (
          <div key={w} className="pattern-week">
            <span className="faint">Vecka {w}</span>
            {DAY_LETTERS.map((l, di) => {
              const i = wi * 7 + di;
              return (
                <button
                  key={i}
                  className={pattern[i] ? "on" : ""}
                  aria-pressed={pattern[i]}
                  aria-label={`Vecka ${w} ${WEEKDAYS[di]}`}
                  onClick={() => setC({ pattern: pattern.map((x, j) => (j === i ? !x : x)), anchorDate: anchor })}
                >
                  {l}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <label className="field">
        <span>En dag i vecka A</span>
        <input type="date" value={anchor} onChange={(e) => e.target.value && setC({ anchorDate: e.target.value, pattern })} />
      </label>
      <small className="faint">
        Ifyllda dagar = {name || "barnet"} är hos er. Den här veckan är vecka {thisWeek}.
      </small>
    </div>
  );
}

const CARE_DAYS = ["1", "2", "3", "4", "5"];
const POWER = /^(W|kW|MW)$/;
const ENERGY = /^(Wh|kWh|MWh)$/;

/** This week's Monday as YYYY-MM-DD. */
function mondayKey(d = new Date()): string {
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
  return `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}-${String(m.getDate()).padStart(2, "0")}`;
}
/** Which week (1…n) of a rolling schedule today is in – same counting as the server. */
function currentCareWeek(anchor: string | undefined, n: number): number {
  if (!anchor) return 1;
  const [y, mo, da] = anchor.split("-").map(Number);
  const a = new Date(mondayKey(new Date(y, mo - 1, da)) + "T12:00");
  const t = new Date(mondayKey() + "T12:00");
  const w = Math.round((t.getTime() - a.getTime()) / (7 * 86_400_000));
  return (((w % n) + n) % n) + 1;
}

/** Förskola/fritids: weekly times and who usually drops off and picks up. */
function CareEditor({ p, adults, onChange }: { p: Person; adults: Person[]; onChange: (p: Person) => void }) {
  const care = p.care;
  const [week, setWeek] = useState(0);
  if (!care) {
    return (
      <button className="btn small" style={{ alignSelf: "flex-start" }} onClick={() => onChange({ ...p, care: { name: "Förskola", days: Object.fromEntries(CARE_DAYS.map((d) => [d, "07:30-16:00"])) } })}>
        <Icon name="plus" size={18} /> Förskola eller fritids
      </button>
    );
  }
  const setCare = (patch: Partial<NonNullable<Person["care"]>>) => onChange({ ...p, care: { ...care, ...patch } });
  // Rolling schedule (shift work): week 1 is care.days, weeks 2…n are care.weeks.
  const cycle = 1 + (care.weeks?.length ?? 0);
  const wk = Math.min(week, cycle - 1);
  const cur = wk === 0 ? care.days : (care.weeks?.[wk - 1] ?? {});
  const times = (d: string) => (cur[d] ?? "").split("-");
  const setDay = (d: string, v: string | null) => {
    const days = { ...cur };
    if (v) days[d] = v;
    else delete days[d];
    if (wk === 0) setCare({ days });
    else setCare({ weeks: (care.weeks ?? []).map((w, i) => (i === wk - 1 ? days : w)) });
  };
  const setCycle = (n: number) => {
    const weeks = Array.from({ length: n - 1 }, (_, i) => care.weeks?.[i] ?? { ...care.days });
    setCare({ weeks: weeks.length ? weeks : undefined, anchorDate: weeks.length ? (care.anchorDate ?? mondayKey()) : undefined });
    setWeek(0);
  };
  const who = (leg?: TravelChoice["to"]) => (leg?.mode?.startsWith("adult:") || leg?.mode === "ride" || leg?.mode === "self" ? leg.mode : "");
  const setWho = (k: "to" | "home", v: string) =>
    setCare({ travel: { ...care.travel, [k]: v ? { mode: v as NonNullable<TravelChoice["to"]>["mode"] } : undefined } });
  const whoOptions = (k: "to" | "home") => [
    { value: "", label: "Varierar" },
    ...adults.map((a) => ({ value: `adult:${a.id}`, label: a.name || "(namnlös)" })),
    { value: "ride", label: "Någon annan" },
    // Older kids walk or cycle on their own: nobody has to pick up, and nobody gets a reminder.
    { value: "self", label: k === "home" ? "Går/cyklar hem själv" : "Går/cyklar dit själv" },
  ];
  return (
    <div className="care-box stack">
      <div className="row gap" style={{ alignItems: "flex-end" }}>
        <div className="grow">
          <Select label="Går på" value={care.name ?? "Förskola"} onChange={(v) => setCare({ name: v })} options={["Förskola", "Fritids", "Dagbarnvårdare"].map((x) => ({ value: x, label: x }))} />
        </div>
        <button className="btn ghost" aria-label="Ta bort förskola" onClick={() => onChange({ ...p, care: undefined })}>
          <Icon name="trashSmall" size={20} />
        </button>
      </div>
      <Select
        label="Schema"
        value={String(cycle)}
        onChange={(v) => setCycle(Number(v))}
        options={[
          { value: "1", label: "Samma tider varje vecka" },
          { value: "2", label: "Rullande 2 veckor" },
          { value: "4", label: "Rullande 4 veckor" },
        ]}
      />
      {cycle > 1 && (
        <>
          <div className="seg small" role="tablist" aria-label="Vecka i schemat">
            {Array.from({ length: cycle }, (_, i) => (
              <button key={i} role="tab" aria-selected={wk === i} className={`seg-btn ${wk === i ? "on" : ""}`} onClick={() => setWeek(i)}>
                Vecka {i + 1}
              </button>
            ))}
          </div>
          <Text label="Vecka 1 är veckan med datumet" type="date" value={care.anchorDate ?? ""} onChange={(v) => v && setCare({ anchorDate: v })} />
          <small className="faint">Just nu är det vecka {currentCareWeek(care.anchorDate, cycle)} i schemat.</small>
        </>
      )}
      <div className="care-days">
        {CARE_DAYS.map((d, i) => {
          const [from, to] = times(d);
          const on = Boolean(cur[d]);
          return (
            <div key={d} className={`care-day ${on ? "" : "off"}`}>
              <label className="check">
                <input type="checkbox" checked={on} onChange={(e) => setDay(d, e.target.checked ? (cur["1"] ?? care.days["1"] ?? "07:30-16:00") : null)} />
                <span>{WEEKDAYS[i].slice(0, 3)}</span>
              </label>
              <input type="time" aria-label={`${WEEKDAYS[i]} lämning`} disabled={!on} value={from ?? ""} onChange={(e) => e.target.value && setDay(d, `${e.target.value}-${to || "16:00"}`)} />
              <span className="faint">–</span>
              <input type="time" aria-label={`${WEEKDAYS[i]} hämtning`} disabled={!on} value={to ?? ""} onChange={(e) => e.target.value && setDay(d, `${from || "07:30"}-${e.target.value}`)} />
            </div>
          );
        })}
      </div>
      <details>
        <summary className="muted" style={{ cursor: "pointer", minHeight: 44, display: "flex", alignItems: "center" }}>
          Återkommande att komma ihåg ({Object.keys(care.notes ?? {}).length})
        </summary>
        <div className="stack" style={{ marginTop: 8, gap: 8 }}>
          {CARE_DAYS.filter((d) => care.days[d] || care.weeks?.some((w) => w[d])).map((d) => (
            <Text
              key={d}
              label={WEEKDAYS[Number(d) - 1][0].toUpperCase() + WEEKDAYS[Number(d) - 1].slice(1)}
              value={care.notes?.[d] ?? ""}
              placeholder={d === "2" ? "T.ex. Utflykt – packa ryggsäck och frukt" : ""}
              onChange={(v) => {
                const notes = { ...care.notes };
                if (v.trim()) notes[d] = v.slice(0, 60);
                else delete notes[d];
                setCare({ notes: Object.keys(notes).length ? notes : undefined });
              }}
            />
          ))}
          <small className="faint">Visas i Kom ihåg kvällen innan och samma morgon.</small>
        </div>
      </details>
      <div className="grid-2">
        <Select label="Brukar lämna" value={who(care.travel?.to)} onChange={(v) => setWho("to", v)} options={whoOptions("to")} />
        <Select label="Brukar hämta" value={who(care.travel?.home)} onChange={(v) => setWho("home", v)} options={whoOptions("home")} />
      </div>
      <small className="faint">
        Tavlan visar lämning och hämtning i Nu, varnar en vecka i förväg för stängda dagar och planeringsdagar, och med Vklass används dagens tider därifrån. Vem som lämnar och hämtar kan ändras per dag på tavlan.
      </small>
    </div>
  );
}

function PersonEditor({ p, adults, onChange, onRemove }: { p: Person; adults: Person[]; onChange: (p: Person) => void; onRemove: () => void }) {
  const custody = p.custody ?? { mode: "always" as const, handoverDay: 1 as const };
  const setC = (c: Partial<Custody>) => onChange({ ...p, custody: { ...custody, ...c } as Custody });
  return (
    <div className="card" style={{ padding: 18 }}>
      <div className="row gap" style={{ alignItems: "flex-end" }}>
        <div className="grow">
          <Text label={p.kind === "child" ? "Barnets namn" : "Namn"} value={p.name} onChange={(v) => onChange({ ...p, name: v })} />
        </div>
        <button className="btn ghost" aria-label={`Ta bort ${p.name || "person"}`} onClick={onRemove}>
          <Icon name="trashSmall" size={20} />
        </button>
      </div>
      <div className="row gap wrap" role="radiogroup" aria-label="Färg">
        {PALETTE.map((c) => (
          <button
            key={c}
            role="radio"
            aria-checked={p.color === c}
            aria-label={`Färg ${c}`}
            onClick={() => onChange({ ...p, color: c })}
            style={{ width: 40, height: 40, borderRadius: 20, background: c, border: p.color === c ? "3px solid var(--text)" : "2px solid transparent" }}
          />
        ))}
      </div>
      {p.kind === "child" && (
        <>
          <div className="grid-2">
            <Select
              label="Bor här"
              value={custody.mode}
              onChange={(v) =>
                setC({
                  mode: v as Custody["mode"],
                  anchorDate: v === "alternating" || v === "pattern" ? custody.anchorDate ?? ymd(new Date()) : custody.anchorDate,
                  pattern: v === "pattern" ? custody.pattern ?? CUSTODY_PRESETS.find((x) => x.id === "223")!.pattern : custody.pattern,
                })
              }
              options={[
                { value: "always", label: "Hela tiden" },
                { value: "alternating", label: "Växelvis – varannan vecka" },
                { value: "pattern", label: "Växelvis – eget schema (2-2-3, varannan helg …)" },
                { value: "oddWeeks", label: "Växelvis – udda veckor" },
                { value: "evenWeeks", label: "Växelvis – jämna veckor" },
              ]}
              help={
                custody.mode === "oddWeeks" || custody.mode === "evenWeeks"
                  ? "OBS: 2026 har vecka 53, då blir det två udda veckor i rad. ”Varannan vecka” följer er rytm i stället."
                  : custody.mode === "always"
                    ? "Bor barnet växelvis i två hem? Välj det här, så visar tavlan barnveckor och nedräkning till bytet."
                    : undefined
              }
            />
            {custody.mode !== "always" && custody.mode !== "pattern" && (
              <Select
                label="Bytesdag"
                value={String(custody.handoverDay ?? 1)}
                onChange={(v) => setC({ handoverDay: Number(v) as Custody["handoverDay"] })}
                options={WEEKDAYS.map((d, i) => ({ value: String(i + 1), label: d[0].toUpperCase() + d.slice(1) }))}
              />
            )}
          </div>
          {custody.mode === "alternating" && (
            <label className="field">
              <span>En dag då {p.name || "barnet"} är hos er</span>
              <input type="date" value={custody.anchorDate ?? ""} onChange={(e) => setC({ anchorDate: e.target.value })} />
            </label>
          )}
          {custody.mode === "pattern" && <PatternEditor custody={custody} name={p.name} setC={setC} />}
          {custody.mode !== "always" && custody.mode !== "pattern" && <WeekPreview custody={custody} />}
          <details>
            <summary className="muted" style={{ cursor: "pointer", minHeight: 44, display: "flex", alignItems: "center" }}>
              Undantag ({custody.overrides?.length ?? 0}) – bytt helg, lov, klämdag
            </summary>
            <div className="stack" style={{ marginTop: 8 }}>
              {(custody.overrides ?? []).map((o, i) => {
                const setO = (patch: Partial<typeof o>) => setC({ overrides: custody.overrides!.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
                return (
                  <div className="row gap wrap" key={i}>
                    <label className="field">
                      <span>Från</span>
                      <input type="date" value={o.from} onChange={(e) => setO({ from: e.target.value, to: o.to < e.target.value ? e.target.value : o.to })} />
                    </label>
                    <label className="field">
                      <span>Till</span>
                      <input type="date" value={o.to} min={o.from} onChange={(e) => setO({ to: e.target.value })} />
                    </label>
                    <Select label="Då är barnet" value={o.home ? "home" : "away"} onChange={(v) => setO({ home: v === "home" })} options={[{ value: "home", label: "Hemma" }, { value: "away", label: "I andra hemmet" }]} />
                    <button className="btn small ghost" style={{ alignSelf: "flex-end" }} aria-label="Ta bort undantag" onClick={() => setC({ overrides: custody.overrides!.filter((_, j) => j !== i) })}>
                      <Icon name="x" size={18} />
                    </button>
                  </div>
                );
              })}
              <button
                className="btn small"
                style={{ alignSelf: "flex-start" }}
                onClick={() => {
                  const d = ymd(new Date());
                  setC({ overrides: [...(custody.overrides ?? []), { from: d, to: d, home: true }] });
                }}
              >
                <Icon name="plus" size={18} /> Lägg till undantag
              </button>
              <small className="faint">Tips: en byteskalender (steget Kalendrar) gör samma sak automatiskt.</small>
            </div>
          </details>
          <CareEditor p={p} adults={adults} onChange={onChange} />
        </>
      )}
    </div>
  );
}

export function FamilyStep({ cfg, set }: StepProps) {
  const add = (kind: Person["kind"]) =>
    set({
      ...cfg,
      people: [
        ...cfg.people,
        { id: uid("p"), name: "", kind, color: PALETTE[cfg.people.length % PALETTE.length], custody: kind === "child" ? { mode: "always", handoverDay: 1 } : undefined },
      ],
    });
  return (
    <div className="stack">
      {cfg.people.map((p, i) => (
        <PersonEditor
          key={p.id}
          p={p}
          adults={cfg.people.filter((x) => x.kind === "adult")}
          onChange={(np) => set({ ...cfg, people: cfg.people.map((x, j) => (j === i ? np : x)) })}
          onRemove={() => set({ ...cfg, people: cfg.people.filter((_, j) => j !== i) })}
        />
      ))}
      <div className="row gap wrap">
        <button className="btn" onClick={() => add("adult")}>
          <Icon name="plus" size={20} /> Vuxen
        </button>
        <button className="btn" onClick={() => add("child")}>
          <Icon name="plus" size={20} /> Barn
        </button>
      </div>
      {cfg.people.some((p) => p.kind === "child" && p.name.trim()) && (
        <section className="card">
          <Toggle
            label="Sysslor för barnen"
            help="En ruta på startsidan där barnen bockar av vad de ska göra innan de får sätta sig vid tv:n eller datorn. Du lägger in sysslorna på tavlan efteråt (knappen Lägg till i rutan)."
            checked={cfg.dashboard.home.some((w) => w.id === "chores" && w.on)}
            onChange={(on) => set({ ...cfg, dashboard: { ...cfg.dashboard, home: cfg.dashboard.home.map((w) => (w.id === "chores" ? { ...w, on } : w)) } })}
          />
        </section>
      )}
    </div>
  );
}

// ======================= Home Assistant =======================

export function HaStep({ cfg, set, secrets, setSecrets, resp, setHaOk, saveNow }: StepProps) {
  const [result, setResult] = useState<TestResult | null>(null);
  const [error, setError] = useState("");
  const tokenSet = resp.secretsSet.includes("ha.token");
  const test = async () => {
    setError("");
    setResult(null);
    try {
      const r = cfg.ha.mode === "supervisor" ? await api.testHa() : await api.testHa(cfg.ha.url, secrets["ha.token"] ?? undefined);
      setResult(r);
      setHaOk(true);
      await saveNow();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  if (resp.runtime.supervisor) {
    return (
      <section className="card">
        <div className="result">
          <b>Körs som tillägg i Home Assistant – anslutet automatiskt.</b>
        </div>
        <button className="btn" onClick={test}>
          Testa anslutningen
        </button>
        <Result result={result} error={error} />
      </section>
    );
  }
  return (
    <section className="card">
      <div className="tiles">
        <button
          className={`tile ${cfg.ha.mode === "manual" ? "selected" : ""}`}
          onClick={() => set({ ...cfg, ha: { ...cfg.ha, mode: "manual" } })}
          aria-pressed={cfg.ha.mode === "manual"}
        >
          <b>Ja, anslut</b>
          <small>Adress och långlivad token</small>
        </button>
        <button
          className={`tile ${cfg.ha.mode === "none" ? "selected" : ""}`}
          onClick={() => {
            set({ ...cfg, ha: { mode: "none" } });
            setHaOk(false);
          }}
          aria-pressed={cfg.ha.mode === "none"}
        >
          <b>Jag har inte Home Assistant</b>
          <small>Kalendrar, skola, sopor, inköp och elpris fungerar ändå</small>
        </button>
      </div>
      {cfg.ha.mode === "manual" && (
        <>
          <Text label="Adress till Home Assistant" type="url" value={cfg.ha.url ?? ""} placeholder="http://homeassistant.local:8123" onChange={(v) => set({ ...cfg, ha: { ...cfg.ha, url: v } })} />
          <Text
            label="Långlivad token"
            type="password"
            value={secrets["ha.token"] ?? ""}
            placeholder={tokenSet ? "•••••• sparad – skriv för att byta" : "eyJ…"}
            help="I Home Assistant: klicka på ditt namn nere till vänster → Säkerhet → Långlivade åtkomsttoken → Skapa. Använd en administratör så att automatisk hämtning fungerar."
            onChange={(v) => setSecrets({ ...secrets, "ha.token": v })}
          />
          <button className="btn" onClick={test} disabled={!cfg.ha.url}>
            Testa
          </button>
          <Result result={result} error={error} />
        </>
      )}
    </section>
  );
}

// ======================= Hämta från HA =======================

export function DiscoverStep({ cfg, set }: StepProps) {
  const [d, setD] = useState<Discovery | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState<Record<string, boolean>>({});
  const [applied, setApplied] = useState(false);

  const scan = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await api.discover();
      setD(r);
      const p: Record<string, boolean> = {};
      r.cars.forEach((_, i) => (p[`car${i}`] = true));
      (["solar", "grid", "house", "battery", "gridExport"] as const).forEach((k) => (p[`en.${k}`] = Boolean(r.energy[k])));
      p["en.counters"] = Boolean(r.energy.solarEnergy || r.energy.importEnergy || r.energy.exportEnergy);
      r.climates.forEach((_, i) => (p[`cl${i}`] = true));
      r.deviceCards.forEach((_, i) => (p[`dc${i}`] = true));
      r.lightGroups.forEach((_, i) => (p[`lg${i}`] = true));
      r.temps.slice(0, 3).forEach((_, i) => (p[`t${i}`] = true));
      (r.speakers ?? []).slice(0, 4).forEach((_, i) => (p[`sp${i}`] = true));
      // Säkerhet and Hushåll are tabs the family chooses: found things start unticked.
      p.todo = r.todo.length > 0;
      p.waste = r.calendars.some((c) => c.waste);
      p.price = false;
      setPick(p);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const apply = () => {
    if (!d) return;
    const on = (k: string) => pick[k];
    const next: Config = structuredClone(cfg);
    // Same limits as the server, so a big Home Assistant never makes saving fail.
    next.entities.cars = d.cars.filter((_, i) => on(`car${i}`)).map(({ deviceName: _d, maker: _m, ...c }) => c).slice(0, 6);
    next.entities.energy = {
      ...Object.fromEntries((["solar", "grid", "house", "battery", "gridExport"] as const).filter((k) => on(`en.${k}`)).map((k) => [k, d.energy[k]])),
      ...(on("en.counters") ? { solarEnergy: d.energy.solarEnergy, importEnergy: d.energy.importEnergy, exportEnergy: d.energy.exportEnergy } : {}),
    };
    next.entities.climates = d.climates.filter((_, i) => on(`cl${i}`)).slice(0, 8);
    next.entities.deviceCards = d.deviceCards.filter((_, i) => on(`dc${i}`)).slice(0, 8);
    next.entities.lightGroups = d.lightGroups.filter((_, i) => on(`lg${i}`)).slice(0, 12).map((g) => ({ ...g, entities: g.entities.slice(0, 40) }));
    next.entities.temps = d.temps.filter((_, i) => on(`t${i}`)).slice(0, 8);
    const speakers = (d.speakers ?? []).filter((_, i) => on(`sp${i}`)).slice(0, 12);
    if (speakers.length) {
      // Found speakers turn the Musik card on; channels are added under Huset → Musik.
      if (!(cfg.entities.speakers ?? []).length) next.dashboard.home = next.dashboard.home.map((w) => (w.id === "music" ? { ...w, on: true } : w));
      next.entities.speakers = speakers;
    }
    if (d.security) {
      const sec = d.security;
      const picked = {
        cameras: sec.cameras.filter((_, i) => on(`cam${i}`)).slice(0, 16),
        locks: sec.locks.filter((_, i) => on(`lock${i}`)).slice(0, 12),
        alarms: sec.alarms.filter((_, i) => on(`alarm${i}`)).slice(0, 4),
        covers: sec.covers.filter((_, i) => on(`cover${i}`)).slice(0, 8),
        openings: on("openings") ? sec.openings.slice(0, 40) : [],
      };
      if (Object.values(picked).some((x) => x.length)) next.entities.security = { ...picked, allowUnlock: cfg.entities.security?.allowUnlock ?? false };
    }
    const robots = (d.robots ?? []).filter((_, i) => on(`rob${i}`)).slice(0, 8);
    if (robots.length) next.entities.robots = robots;
    const appliances = (d.appliances ?? []).filter((_, i) => on(`app${i}`)).slice(0, 10);
    if (appliances.length) next.entities.appliances = appliances;
    if (on("todo") && d.todo[0]) next.shopping = { ...next.shopping, source: "ha", entityId: d.todo.find((t) => /shop|inköp|handla/i.test(t.entityId + t.name))?.entityId ?? d.todo[0].entityId };
    const wasteCal = d.calendars.find((c) => c.waste);
    if (on("waste") && wasteCal) {
      next.integrations = [...next.integrations.filter((i) => i.category !== "waste"), { id: "waste", category: "waste", provider: "waste-ha", settings: { entityId: wasteCal.entityId } }];
    }
    if (on("price") && d.priceSensors[0]) {
      next.integrations = [...next.integrations.filter((i) => i.category !== "price"), { id: "price", category: "price", provider: "ha-price", settings: { entityId: d.priceSensors[0].entityId } }];
    }
    // Sensible graphs from what was found.
    const series = [
      next.entities.energy.house && { name: "Hus", entityId: next.entities.energy.house, color: "#f1f2fa" },
      next.entities.energy.solar && { name: "Sol", entityId: next.entities.energy.solar, color: "#f5c84b" },
      next.entities.energy.grid && { name: "Nät", entityId: next.entities.energy.grid, color: "#34e0a1" },
    ].filter(Boolean) as { name: string; entityId: string; color: string }[];
    const tempSeries = next.entities.temps.slice(0, 2).map((t, i) => ({ name: t.name, entityId: t.entityId, color: i ? "#8f93b3" : "#f5c84b" }));
    next.entities.graphs = [...(series.length ? [{ title: "Effekt", series }] : []), ...(tempSeries.length ? [{ title: "Temperatur", series: tempSeries }] : [])];
    if (!next.entities.lights.length) {
      next.entities.lights = d.lightGroups.flatMap((g) => g.entities.slice(0, 1).map((e) => ({ name: g.name, entityId: e }))).slice(0, 4);
    }
    set(next);
    setApplied(true);
  };

  // Search as soon as the step opens – one less button to find.
  useEffect(() => {
    void scan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // First setup (nothing from HA on the board yet): use what was found right away, and keep
  // following the checkboxes – so "Nästa" never loses the choices. When re-running the guide,
  // existing settings are only replaced after "Använd det valda".
  const [fresh] = useState(() => {
    const e = cfg.entities;
    return e.cars.length + e.climates.length + e.deviceCards.length + e.lightGroups.length + e.temps.length + (e.speakers ?? []).length === 0 && !Object.values(e.energy).some(Boolean);
  });
  useEffect(() => {
    if (d && (fresh || applied)) apply();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d, pick]);

  const Box = ({ k, label, sub }: { k: string; label: string; sub?: string }) => (
    <label className="check item-row">
      <input type="checkbox" checked={Boolean(pick[k])} onChange={(e) => setPick({ ...pick, [k]: e.target.checked })} />
      <span className="grow">
        {label}
        {sub && <small className="faint" style={{ display: "block" }}>{sub}</small>}
      </span>
    </label>
  );

  return (
    <div className="stack">
      <button className={d ? "btn" : "btn primary"} onClick={scan} disabled={busy}>
        {busy ? "Söker i Home Assistant…" : d ? "Sök igen" : "Hämta från Home Assistant"}
      </button>
      <Result error={error} />
      {d && (
        <>
          <div className="result">
            <b>Hittade:</b>
            <ul>
              {d.summary.length ? d.summary.map((s) => <li key={s}>{s}</li>) : <li>Inget som passar – du kan lägga till manuellt i steget Huset.</li>}
            </ul>
          </div>
          {d.cars.length > 0 && (
            <section className="card">
              <h2>Bilar</h2>
              {d.cars.map((c, i) => (
                <Box key={i} k={`car${i}`} label={c.name} sub={[c.maker, c.range && "räckvidd", c.location && "position", c.climate && "värmestart"].filter(Boolean).join(" · ")} />
              ))}
            </section>
          )}
          {Object.values(d.energy).some(Boolean) && (
            <section className="card">
              <h2>Energi</h2>
              {d.energy.solar && <Box k="en.solar" label="Solel / växelriktare" sub={d.energy.solar} />}
              {d.energy.grid && <Box k="en.grid" label="Elnät (köp/sälj)" sub={d.energy.grid} />}
              {d.energy.house && <Box k="en.house" label="Husets effekt" sub={d.energy.house} />}
              {d.energy.battery && <Box k="en.battery" label="Hembatteri" sub={d.energy.battery} />}
              {d.energy.gridExport && <Box k="en.gridExport" label="Elnät – sålt" sub={d.energy.gridExport} />}
              {(d.energy.solarEnergy || d.energy.importEnergy) && <Box k="en.counters" label="Dagens kWh (mätarställningar)" sub={[d.energy.solarEnergy, d.energy.importEnergy, d.energy.exportEnergy].filter(Boolean).join(", ")} />}
            </section>
          )}
          {(d.climates.length > 0 || d.deviceCards.length > 0) && (
            <section className="card">
              <h2>Värme, varmvatten och spabad</h2>
              {d.climates.map((c, i) => (
                <Box key={c.entityId} k={`cl${i}`} label={c.name} sub={c.controls?.length ? `${c.controls.length} reglage (pumpar, ljus …)` : c.entityId} />
              ))}
              {d.deviceCards.map((c, i) => (
                <Box key={i} k={`dc${i}`} label={c.title} sub={`${c.sensors.length} värden · ${c.controls.length} reglage`} />
              ))}
            </section>
          )}
          {d.lightGroups.length > 0 && (
            <section className="card">
              <h2>Lampor per rum</h2>
              {d.lightGroups.map((g, i) => (
                <Box key={g.name} k={`lg${i}`} label={g.name} sub={`${g.entities.length} lampor`} />
              ))}
            </section>
          )}
          {d.temps.length > 0 && (
            <section className="card">
              <h2>Temperaturer</h2>
              {d.temps.map((t, i) => (
                <Box key={t.entityId} k={`t${i}`} label={t.name} />
              ))}
            </section>
          )}
          {(d.speakers ?? []).length > 0 && (
            <section className="card">
              <h2>Högtalare för musik</h2>
              {d.speakers!.map((x, i) => (
                <Box key={x.entityId} k={`sp${i}`} label={x.name} sub={x.entityId} />
              ))}
            </section>
          )}
          {d.security && d.security.cameras.length + d.security.locks.length + d.security.alarms.length + d.security.covers.length + d.security.openings.length > 0 && (
            <section className="card">
              <h2>Säkerhet</h2>
              <p className="muted" style={{ margin: "0 0 8px" }}>
                Kryssa i det som ska synas under fliken Säkerhet.
              </p>
              {d.security.cameras.map((x, i) => (
                <Box key={x.entityId} k={`cam${i}`} label={`Kamera: ${x.name}`} sub={x.entityId} />
              ))}
              {d.security.locks.map((x, i) => (
                <Box key={x.entityId} k={`lock${i}`} label={`Lås: ${x.name}`} sub={x.entityId} />
              ))}
              {d.security.alarms.map((x, i) => (
                <Box key={x.entityId} k={`alarm${i}`} label={`Larm: ${x.name}`} sub={x.entityId} />
              ))}
              {d.security.covers.map((x, i) => (
                <Box key={x.entityId} k={`cover${i}`} label={`Port: ${x.name}`} sub={x.entityId} />
              ))}
              {d.security.openings.length > 0 && <Box k="openings" label={`Dörrar och fönster (${d.security.openings.length} st)`} sub={d.security.openings.slice(0, 5).map((x) => x.name).join(", ")} />}
            </section>
          )}
          {(d.robots ?? []).length + (d.appliances ?? []).length > 0 && (
            <section className="card">
              <h2>Hushåll</h2>
              <p className="muted" style={{ margin: "0 0 8px" }}>
                Kryssa i det som ska synas under fliken Hushåll.
              </p>
              {(d.appliances ?? []).map((x, i) => (
                <Box key={`${x.name}${i}`} k={`app${i}`} label={x.name} sub={[x.status, x.power].filter(Boolean).join(" · ")} />
              ))}
              {(d.robots ?? []).map((x, i) => (
                <Box key={x.entityId} k={`rob${i}`} label={x.name} sub={x.entityId} />
              ))}
            </section>
          )}
          <section className="card">
            <h2>Övrigt</h2>
            {d.todo.length > 0 && <Box k="todo" label="Använd Home Assistants inköpslista" sub={d.todo.map((t) => t.name).join(", ")} />}
            {d.calendars.some((c) => c.waste) && <Box k="waste" label="Sophämtning från Home Assistant" sub={d.calendars.filter((c) => c.waste).map((c) => c.name).join(", ")} />}
            {d.priceSensors.length > 0 && <Box k="price" label="Elpris från Home Assistant i stället för spotpris" sub={d.priceSensors[0].name} />}
          </section>
          {applied ? (
            <div className="result" role="status">
              <b>Klart – det du bockat i följer med. Allt kan finjusteras i steget Huset.</b>
            </div>
          ) : (
            <button className="btn primary" onClick={apply}>
              Använd det valda
            </button>
          )}
        </>
      )}
    </div>
  );
}

// ======================= Kalendrar =======================

const CAL_PROVIDERS: { id: CalendarProvider; name: string; desc: string; guide: string[]; category: CalendarCategory }[] = [
  {
    id: "google",
    name: "Google Kalender",
    desc: "Familjens eller egen kalender",
    category: "family",
    guide: [
      "Öppna calendar.google.com på datorn → kugghjulet → Inställningar.",
      "Välj kalendern till vänster → Integrera kalender.",
      "Kopiera Hemlig adress i iCal-format och klistra in här.",
    ],
  },
  {
    id: "icloud",
    name: "iCloud / Apple",
    desc: "Delad kalender från iPhone",
    category: "family",
    guide: ["På iPhone: Kalender → Kalendrar → (i) vid kalendern → slå på Offentlig kalender.", "Tryck Dela länk → Kopiera och klistra in här."],
  },
  {
    id: "laget",
    name: "laget.se",
    desc: "Ett lag per länk",
    category: "sport",
    guide: ["Gå till lagets sida på laget.se → Kalender → Prenumerera.", "Kopiera webcal-adressen och klistra in här. Lägg till en länk per lag du vill se."],
  },
  {
    id: "sportadmin",
    name: "SportAdmin",
    desc: "Barnets aktiviteter",
    category: "sport",
    guide: [
      "Öppna SportAdmin-appen → Aktiviteter → Prenumerera på kalendern.",
      "Kopiera länken och klistra in här.",
      "Har barnet flera lag? Tryck Testa och bocka bara i laget du vill se.",
    ],
  },
  {
    id: "svenskalag",
    name: "Svenska lag",
    desc: "Lagets aktiviteter",
    category: "sport",
    guide: [
      "Logga in på svenskalag.se och gå till lagets sida → Kalender → Prenumerera.",
      "Kopiera länken (iCal/webcal) och klistra in här. Gör det från lagsidan, inte klubbens, så kommer bara ert lag med.",
    ],
  },
  {
    id: "infomentor",
    name: "InfoMentor",
    desc: "Skolans kalender",
    category: "school",
    guide: [
      "Logga in i InfoMentor Hub på webben (inte appen) → Kalender → Prenumerera.",
      "Kopiera länken och klistra in här. Ser du ingen Prenumerera har kommunen stängt av det – fråga skolan.",
      "Skolmaten läggs in under Skola med skolmaten.se.",
    ],
  },
  { id: "outlook", name: "Outlook / jobbet", desc: "Publicerad kalender", category: "work", guide: ["Outlook på webben → Inställningar → Kalender → Delade kalendrar → Publicera en kalender → kopiera ICS-länken."] },
  { id: "ics", name: "Annan länk", desc: "Valfri ICS/webcal-adress", category: "other", guide: ["Klistra in en adress som börjar med webcal:// eller https:// och slutar på .ics."] },
  { id: "ha", name: "Kalender i Home Assistant", desc: "Använd en kalender du redan har i HA", category: "family", guide: [] },
];

/**
 * How the child usually gets to and from this calendar's activities. A default counts as planned,
 * so "Planera veckan" only lights up what really has no one – e.g. older kids who cycle never nag.
 */
function TravelDefault({ cal, cfg, name, onChange }: { cal: CalendarSource; cfg: Config; name: string; onChange: (c: CalendarSource) => void }) {
  const opts = [
    { value: "", label: "Varierar – välj per gång" },
    ...cfg.people.filter((x) => x.kind === "adult").map((a) => ({ value: `adult:${a.id}`, label: `${a.name} skjutsar` })),
    { value: "ride", label: "Annan skjutsar" },
    { value: "bus", label: "Buss" },
    { value: "self", label: "Cyklar/går själv" },
  ];
  const set = (k: "to" | "home", v: string) => {
    const travel = { ...cal.travel, [k]: v ? { mode: v as NonNullable<TravelChoice["to"]>["mode"] } : undefined };
    onChange({ ...cal, travel: travel.to || travel.home ? travel : undefined });
  };
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="grid-2">
        <Select label={`${name} brukar ta sig dit`} value={cal.travel?.to?.mode ?? ""} onChange={(v) => set("to", v)} options={opts} />
        <Select label="… och hem" value={cal.travel?.home?.mode ?? ""} onChange={(v) => set("home", v)} options={opts} />
      </div>
      <small className="faint">Ett standardval räknas som planerat – Planera veckan visar bara det som avviker eller saknas. Kan ändras per gång på tavlan.</small>
    </div>
  );
}

function CalendarEditor({
  cal,
  cfg,
  onChange,
  onDone,
  onRemove,
  secrets,
  setSecrets,
  urlSaved,
}: {
  cal: CalendarSource;
  cfg: Config;
  onChange: (c: CalendarSource) => void;
  onDone: () => void;
  onRemove: () => void;
  secrets: StepProps["secrets"];
  setSecrets: StepProps["setSecrets"];
  urlSaved: boolean;
}) {
  const p = CAL_PROVIDERS.find((x) => x.id === cal.provider)!;
  const key = `calendar.${cal.id}.url`;
  const [test, setTest] = useState<CalendarTest | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const person = cfg.people.find((x) => x.id === cal.personId);
  const isChild = person?.kind === "child" && person.custody?.mode !== "always";

  const runTest = async (include = cal.include, exclude = cal.exclude) => {
    setBusy(true);
    setError("");
    try {
      const body =
        cal.kind === "ha" ? { entityId: cal.entityId } : secrets[key] ? { url: secrets[key]! } : { sourceId: cal.id };
      setTest(await api.testCalendar({ ...body, include, exclude }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <div className="card-head">
        <h2>{p.name}</h2>
        <button className="btn small ghost" onClick={onRemove}>
          <Icon name="trashSmall" size={18} /> Ta bort
        </button>
      </div>
      {p.guide.length > 0 && (
        <ol className="guide">
          {p.guide.map((g) => (
            <li key={g}>{g}</li>
          ))}
        </ol>
      )}
      {cal.kind === "ha" ? (
        <EntityPicker label="Kalender" domains={["calendar"]} value={cal.entityId} onChange={(v, o) => onChange({ ...cal, entityId: v, name: cal.name || o?.name || "" })} optional={false} />
      ) : (
        <Text
          label="Kalenderlänk"
          type="url"
          value={secrets[key] ?? ""}
          placeholder={urlSaved ? "•••••• sparad – klistra in för att byta" : "webcal://… eller https://….ics"}
          onChange={(v) => setSecrets({ ...secrets, [key]: v })}
        />
      )}
      <div className="grid-3">
        <Text label="Namn på tavlan" value={cal.name} onChange={(v) => onChange({ ...cal, name: v })} placeholder={p.category === "sport" ? "Fotboll P14" : "Familjen"} />
        <div className="field">
          <span className="label">Gäller</span>
          <div className="chips" role="group" aria-label="Vem kalendern gäller">
            {(() => {
              const ids = cal.personIds?.length ? cal.personIds : cal.personId ? [cal.personId] : [];
              const set = (next: string[]) => onChange({ ...cal, personIds: next.length > 1 ? next : undefined, personId: next.length === 1 ? next[0] : undefined });
              return (
                <>
                  <button type="button" className={`chip ${ids.length === 0 ? "on" : ""}`} aria-pressed={ids.length === 0} onClick={() => set([])}>
                    Hela familjen
                  </button>
                  {cfg.people.map((x) => {
                    const on = ids.includes(x.id);
                    return (
                      <button key={x.id} type="button" className={`chip ${on ? "on" : ""}`} aria-pressed={on} onClick={() => set(on ? ids.filter((i) => i !== x.id) : [...ids, x.id])}>
                        {x.name || "(namnlös)"}
                      </button>
                    );
                  })}
                </>
              );
            })()}
          </div>
          <small className="muted">Välj en eller flera. Delade kalendrar utan val känner också igen namn i rubriken ("Elin tandläkare").</small>
        </div>
        <Select
          label="Typ"
          value={cal.category}
          onChange={(v) => onChange({ ...cal, category: v as CalendarCategory })}
          options={[
            { value: "family", label: "Familj" },
            { value: "sport", label: "Sport/aktivitet" },
            { value: "school", label: "Skola" },
            { value: "work", label: "Jobb" },
            { value: "other", label: "Övrigt" },
          ]}
        />
      </div>
      <div className="row gap">
        <button className="btn" onClick={() => runTest()} disabled={busy}>
          {busy ? "Testar…" : "Testa"}
        </button>
      </div>
      <Result result={test} error={error} />
      {test && test.groups.length > 0 && (
        <div className="stack" style={{ gap: 4 }}>
          <b>Vilka lag/grupper ska visas?</b>
          <small className="faint">Inget ikryssat = alla.</small>
          {test.groups.map((g) => {
            const on = (cal.include ?? []).some((x) => x.toLowerCase() === g.name.toLowerCase());
            return (
              <label key={g.name} className="check">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={(e) => {
                    const include = e.target.checked ? [...(cal.include ?? []), g.name] : (cal.include ?? []).filter((x) => x.toLowerCase() !== g.name.toLowerCase());
                    onChange({ ...cal, include });
                    runTest(include);
                  }}
                />
                {g.name} <span className="faint">({g.count} händelser)</span>
              </label>
            );
          })}
        </div>
      )}
      {isChild && (
        <Select
          label="Visa"
          value={cal.visibility === "always" ? "always" : cal.alwaysShow?.length ? "matches" : "custody"}
          onChange={(v) =>
            onChange({
              ...cal,
              visibility: v === "always" ? "always" : "custody",
              alwaysShow: v === "matches" ? (cal.alwaysShow?.length ? cal.alwaysShow : ["match", "cup"]) : v === "custody" ? undefined : cal.alwaysShow,
            })
          }
          options={[
            { value: "matches", label: `Matcher och cuper alla veckor – träningar när ${person!.name} är här` },
            { value: "custody", label: `Allt bara när ${person!.name} är här` },
            { value: "always", label: "Allt, alla veckor" },
          ]}
          help={cal.visibility !== "always" && cal.alwaysShow?.length ? `Räknas som match: ${cal.alwaysShow.join(", ")} (ändra under Filtrera nedan).` : undefined}
        />
      )}
      {person?.kind === "child" && <TravelDefault cal={cal} cfg={cfg} name={person.name} onChange={onChange} />}
      <details>
        <summary className="muted" style={{ cursor: "pointer", minHeight: 44, display: "flex", alignItems: "center" }}>
          Filtrera
        </summary>
        <div className="stack" style={{ marginTop: 8 }}>
          <Words label="Visa bara om titeln innehåller" value={cal.include} onChange={(v) => onChange({ ...cal, include: v })} placeholder="P14, Blå" help="Kommaseparerat. Tomt = allt." />
          <Words label="Dölj om titeln innehåller" value={cal.exclude} onChange={(v) => onChange({ ...cal, exclude: v })} placeholder="Föräldramöte, Inställd" />
          {isChild && (
            <>
              {cal.visibility !== "always" && (
                <Words
                  label="Visas alla veckor om titeln innehåller"
                  value={cal.alwaysShow}
                  onChange={(v) => onChange({ ...cal, alwaysShow: v })}
                  placeholder="match, cup"
                  help="T.ex. matcher varje vecka men träningar bara barnveckor."
                />
              )}
            </>
          )}
        </div>
      </details>
      <button className="btn primary" onClick={onDone} disabled={!cal.name || (cal.kind === "ha" ? !cal.entityId : !secrets[key] && !urlSaved)}>
        Klar
      </button>
    </section>
  );
}

export function CalendarsStep({ cfg, set, secrets, setSecrets, resp, haOk }: StepProps) {
  const [editing, setEditing] = useState<string | null>(null);
  const update = (c: CalendarSource) => set({ ...cfg, calendars: cfg.calendars.map((x) => (x.id === c.id ? c : x)) });
  const add = (pid: CalendarProvider) => {
    const p = CAL_PROVIDERS.find((x) => x.id === pid)!;
    const c: CalendarSource = {
      id: uid("c"),
      name: "",
      provider: pid,
      kind: pid === "ha" ? "ha" : "ics",
      category: p.category,
      alwaysShow: p.category === "sport" ? ["match", "cup"] : undefined,
      visibility: "custody",
    };
    set({ ...cfg, calendars: [...cfg.calendars, c] });
    setEditing(c.id);
  };
  const editingCal = cfg.calendars.find((c) => c.id === editing);
  if (editingCal) {
    return (
      <CalendarEditor
        cal={editingCal}
        cfg={cfg}
        onChange={update}
        onDone={() => setEditing(null)}
        onRemove={() => {
          set({ ...cfg, calendars: cfg.calendars.filter((c) => c.id !== editingCal.id) });
          setEditing(null);
        }}
        secrets={secrets}
        setSecrets={setSecrets}
        urlSaved={resp.secretsSet.includes(`calendar.${editingCal.id}.url`)}
      />
    );
  }
  const hasShared = cfg.people.some((p) => p.kind === "child" && p.custody?.mode !== "always");
  return (
    <div className="stack">
      {hasShared && cfg.calendars.length > 0 && (
        <section className="card">
          <Select
            label="Byteskalender (valfri)"
            value={cfg.household.custodyCalendarId ?? ""}
            onChange={(v) => set({ ...cfg, household: { ...cfg.household, custodyCalendarId: v || undefined } })}
            options={[{ value: "", label: "Ingen – använd bara barnens schema" }, ...cfg.calendars.map((c) => ({ value: c.id, label: c.name || "(namnlös)" }))]}
            help='En delad kalender där en heldagshändelse med barnets namn betyder "hemma" och namnet + "borta" betyder i andra hemmet. Går före schemat. Visas inte i veckovyn.'
          />
        </section>
      )}
      {cfg.calendars.map((c) => {
        const who = cfg.people.find((p) => p.id === c.personId);
        return (
          <div className="item-row" key={c.id}>
            <span className="dot" style={{ background: who?.color ?? "var(--accent)" }} />
            <span className="grow">
              <b>{c.name || "(namnlös)"}</b>
              <small className="faint" style={{ display: "block" }}>
                {CAL_PROVIDERS.find((p) => p.id === c.provider)?.name} · {who?.name ?? "Hela familjen"}
                {c.include?.length ? ` · bara ${c.include.join(", ")}` : ""}
              </small>
            </span>
            <button className="btn small" onClick={() => setEditing(c.id)}>
              Ändra
            </button>
          </div>
        );
      })}
      <h2 style={{ fontSize: 18, marginTop: 8 }}>Lägg till</h2>
      <div className="tiles">
        {CAL_PROVIDERS.filter((p) => p.id !== "ha" || haOk).map((p) => (
          <button key={p.id} className="tile" onClick={() => add(p.id)}>
            <b>{p.name}</b>
            <small>{p.desc}</small>
          </button>
        ))}
      </div>
    </div>
  );
}

// ======================= Leverantörssteg (skola, sopor, inköp, el) =======================

function useIntegration(cfg: Config, set: (c: Config) => void, category: IntegrationCategory) {
  const integ = cfg.integrations.find((i) => i.category === category);
  const put = (i: Integration | null) => set({ ...cfg, integrations: [...cfg.integrations.filter((x) => x.category !== category), ...(i ? [i] : [])] });
  return [integ, put] as const;
}

export function SchoolStep({ cfg, set, secrets, setSecrets, resp, haOk, saveNow }: StepProps) {
  const schools = cfg.integrations.filter((i) => i.category === "school");
  const children = cfg.people.filter((p) => p.kind === "child");
  const [discovered, setDiscovered] = useState<Record<string, string[]>>({});
  const update = (i: Integration) => set({ ...cfg, integrations: cfg.integrations.map((x) => (x.id === i.id ? i : x)) });
  const add = (provider: string) => set({ ...cfg, integrations: [...cfg.integrations, { id: uid("s"), category: "school", provider, settings: {} }] });
  return (
    <div className="stack">
      {schools.length > 0 && (
        <section className="card">
          <h2>Vad tavlan visar</h2>
          <Select
            label="Lektioner på sidan Skolan"
            value={cfg.dashboard.lessons ?? "all"}
            onChange={(v) => set({ ...cfg, dashboard: { ...cfg.dashboard, lessons: v === "span" ? "span" : "all" } })}
            options={[
              { value: "all", label: "Alla lektioner" },
              { value: "span", label: "Bara när skoldagen börjar och slutar" },
            ]}
          />
          <small className="muted">Idrott (gympapåse), läxor, prov och nyheter visas alltid.</small>
        </section>
      )}
      {schools.map((integ) => {
        const meta = resp.providers.find((p) => p.id === integ.provider && p.category === "school")!;
        const names = discovered[integ.id] ?? Object.keys(integ.personMap ?? {});
        return (
          <section className="card" key={integ.id}>
            <div className="card-head">
              <h2>{meta.name}</h2>
              <button className="btn small ghost" onClick={() => set({ ...cfg, integrations: cfg.integrations.filter((x) => x.id !== integ.id) })}>
                <Icon name="trashSmall" size={18} /> Ta bort
              </button>
            </div>
            {!meta.discoversChildren && (
              <Select
                label="Vilket barn?"
                value={integ.personId ?? ""}
                onChange={(v) => update({ ...integ, personId: v || undefined })}
                options={[{ value: "", label: "– Välj –" }, ...children.map((c) => ({ value: c.id, label: c.name }))]}
              />
            )}
            <ProviderForm
              meta={meta}
              integ={integ}
              onChange={update}
              secrets={secrets}
              setSecrets={setSecrets}
              secretsSet={resp.secretsSet}
              saveNow={saveNow}
              extra={(r) => {
                if (r?.discovered && r.discovered.join() !== (discovered[integ.id] ?? []).join()) {
                  const found = r.discovered;
                  setTimeout(() => {
                    setDiscovered((d) => ({ ...d, [integ.id]: found }));
                    // "Leo Andersson" in Vklass → Leo on the board, unless already chosen.
                    const map = { ...(integ.personMap ?? {}) };
                    let changed = false;
                    for (const n of found) {
                      if (map[n] !== undefined) continue;
                      // Any name in "Karl Leo Andersson" may be the one used at home ("Leo").
                      const tokens = n.toLowerCase().split(/[\s-]+/).filter(Boolean);
                      const hits = children.filter((c) => {
                        const k = c.name.trim().toLowerCase();
                        return k && (k === n.trim().toLowerCase() || tokens.includes(k));
                      });
                      const match = hits.length === 1 ? hits[0] : undefined;
                      if (match) {
                        map[n] = match.id;
                        changed = true;
                      }
                    }
                    if (changed) update({ ...integ, personMap: map });
                  });
                }
                if (!meta.discoversChildren) return null;
                if (!names.length) return <small className="faint">Tryck på Testa – då hämtas barnen på kontot och kopplas till familjen.</small>;
                return (
                  <div className="stack">
                    <b>Koppla barnen</b>
                    {names.map((n) => (
                      <Select
                        key={n}
                        label={n}
                        value={integ.personMap?.[n] ?? ""}
                        onChange={(v) => update({ ...integ, personMap: { ...(integ.personMap ?? {}), [n]: v } })}
                        options={[{ value: "", label: "– Visa inte –" }, ...children.map((c) => ({ value: c.id, label: c.name }))]}
                      />
                    ))}
                  </div>
                );
              }}
            />
          </section>
        );
      })}
      <h2 style={{ fontSize: 18 }}>Lägg till skola</h2>
      <ProviderTiles providers={resp.providers} category="school" onSelect={(id) => id && add(id)} haAvailable={haOk} />
      <EdlevoHelp
        hasMenu={schools.some((s) => s.provider === "skolmaten")}
        hasLink={schools.some((s) => s.provider === "school-ics" && s.settings.platform === "Edlevo")}
        onMenu={() => add("skolmaten")}
        onLink={() => set({ ...cfg, integrations: [...cfg.integrations, { id: uid("s"), category: "school", provider: "school-ics", settings: { platform: "Edlevo" } }] })}
      />
      <small className="faint">
        Saknas er skolplattform?{" "}
        <a href="https://github.com/murre87/familjetavla/issues/new?template=skolplattform.yml" target="_blank" rel="noreferrer">
          Berätta vilken
        </a>{" "}
        – då vet vi vad som ska byggas härnäst. Under tiden fungerar ofta en kalenderlänk.
      </small>
    </div>
  );
}

/**
 * Edlevo (Tieto) has no login a board can use: guardians sign in with BankID/Freja only, and
 * Tieto's API needs a licence and an agreement with the municipality. This shows what works instead.
 */
function EdlevoHelp({ hasMenu, hasLink, onMenu, onLink }: { hasMenu: boolean; hasLink: boolean; onMenu: () => void; onLink: () => void }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button className="btn" style={{ alignSelf: "flex-start" }} onClick={() => setOpen(true)}>
        Har ni Edlevo? <Icon name="chevronRight" size={18} />
      </button>
    );
  }
  return (
    <section className="card edlevo-help">
      <div className="card-head">
        <h2>Edlevo</h2>
        <button className="btn small ghost" onClick={() => setOpen(false)}>
          Stäng
        </button>
      </div>
      <p className="muted">
        Edlevo går inte att hämta automatiskt: vårdnadshavare loggar bara in med BankID eller Freja, och det kan ingen app göra på egen hand. Så här får ni ändå in det viktigaste:
      </p>
      <ol className="edlevo-steps">
        <li>
          <b>Skolmaten</b> – de flesta Edlevo-kommuner lägger ut matsedeln på skolmaten.se. Sök upp skolan där och klistra in adressen.
          <div className="row gap wrap">
            {hasMenu ? (
              <span className="chip">✓ Tillagd ovan</span>
            ) : (
              <button className="btn small" onClick={onMenu}>
                <Icon name="plus" size={18} /> Lägg till skolmaten.se
              </button>
            )}
            <a className="btn small ghost" href="https://skolmaten.se" target="_blank" rel="noreferrer">
              Sök skola på skolmaten.se
            </a>
          </div>
        </li>
        <li>
          <b>Omsorgstider</b> (förskola och fritids) – lägg in dem en gång per termin under barnet i steget Familj, "Förskola eller fritids". Då vet tavlan när barnet ska lämnas och hämtas.
          <div className="row gap wrap">
            <a className="btn small ghost" href="#/setup/familj">
              Till steget Familj
            </a>
          </div>
        </li>
        <li>
          <b>Skolschemat</b> – fråga skolan om schemat finns som kalenderlänk (ICS). Då visas lektioner, "Skolan idag" och idrott med gympapåse.
          <div className="row gap wrap">
            {hasLink ? (
              <span className="chip">✓ Tillagd ovan</span>
            ) : (
              <button className="btn small" onClick={onLink}>
                <Icon name="plus" size={18} /> Lägg till kalenderlänk
              </button>
            )}
          </div>
        </li>
      </ol>
    </section>
  );
}

/** SRV Återvinning is owned by these five municipalities. */
const SRV_TOWNS = /botkyrka|haninge|huddinge|nynäshamn|salem/i;

export function WasteStep({ cfg, set, secrets, setSecrets, resp, haOk, postcode, saveNow }: StepProps) {
  const [integ, put] = useIntegration(cfg, set, "waste");
  const meta = integ && resp.providers.find((p) => p.id === integ.provider && p.category === "waste");
  const srvTown = SRV_TOWNS.test(cfg.household.municipality ?? "") && resp.providers.some((p) => p.id === "srv");
  return (
    <div className="stack">
      {srvTown && integ?.provider !== "srv" && (
        <button className="btn" style={{ alignSelf: "flex-start", whiteSpace: "normal", textAlign: "left", height: "auto" }} onClick={() => put({ id: "waste", category: "waste", provider: "srv", settings: {} })}>
          {cfg.household.municipality} hämtas av SRV Återvinning – välj SRV
        </button>
      )}
      <ProviderTiles
        providers={resp.providers}
        category="waste"
        selected={integ?.provider}
        allowNone="Ingen sophämtning"
        haAvailable={haOk}
        onSelect={(id) =>
          put(id ? { id: "waste", category: "waste", provider: id, settings: id === "edp" && postcode?.wasteProvider ? { municipality: postcode.wasteProvider } : {} } : null)
        }
      />
      {integ && meta && (
        <section className="card">
          <h2>{meta.name}</h2>
          {integ.provider === "edp" && !postcode?.wasteProvider && cfg.household.municipality && !integ.settings.municipality && (
            <p className="muted">
              {cfg.household.municipality} finns inte i listan. Prova <b>Eget schema</b> eller Waste Collection Schedule i Home Assistant.
            </p>
          )}
          <ProviderForm key={`${integ.id}-${integ.provider}`} meta={meta} integ={integ} onChange={put} secrets={secrets} setSecrets={setSecrets} secretsSet={resp.secretsSet} saveNow={saveNow} verified={resp.verified.includes(integ.id)} />
        </section>
      )}
    </div>
  );
}

export function ShoppingStep({ cfg, set, secrets, setSecrets, resp, haOk, saveNow }: StepProps) {
  const stores = cfg.integrations.filter((i) => i.category === "grocery");
  const [activeId, setActive] = useState<string | null>(stores[0]?.id ?? null);
  const integ = stores.find((i) => i.id === activeId) ?? stores[0];
  const meta = integ && resp.providers.find((p) => p.id === integ.provider && p.category === "grocery");
  const put = (i: Integration | null) =>
    set({ ...cfg, integrations: i ? cfg.integrations.map((x) => (x.id === i.id ? i : x)) : cfg.integrations.filter((x) => x.id !== integ?.id) });
  const choose = (provider: string) => {
    // The shop you pick is the one the shopping list goes to (the "Skicka inköpslistan till" list can change that).
    const have = stores.find((x) => x.provider === provider);
    if (have) {
      setActive(have.id);
      set({ ...cfg, shopping: { ...cfg.shopping, sendTo: have.id } });
      return;
    }
    const id = stores.some((x) => x.id === "grocery") ? `g-${provider}` : "grocery";
    set({ ...cfg, integrations: [...cfg.integrations, { id, category: "grocery", provider, settings: {} }], shopping: { ...cfg.shopping, sendTo: id } });
    setActive(id);
  };
  return (
    <div className="stack">
      <section className="card">
        <h2>Inköpslistan</h2>
        <div className="tiles">
          <button className={`tile ${cfg.shopping.source === "local" ? "selected" : ""}`} onClick={() => set({ ...cfg, shopping: { ...cfg.shopping, source: "local" } })}>
            <b>På tavlan</b>
            <small>Enkel lista som bara finns här</small>
          </button>
          <button
            className={`tile ${cfg.shopping.source === "ha" ? "selected" : ""}`}
            disabled={!haOk}
            onClick={() => set({ ...cfg, shopping: { ...cfg.shopping, source: "ha" } })}
          >
            <b>Home Assistants lista</b>
            <small>{haOk ? "Synkas med HA-appen och röst: \"lägg till mjölk\"" : "Kräver Home Assistant"}</small>
          </button>
        </div>
        {cfg.shopping.source === "ha" && haOk && (
          <EntityPicker label="Lista" domains={["todo"]} value={cfg.shopping.entityId} onChange={(v) => set({ ...cfg, shopping: { ...cfg.shopping, entityId: v } })} optional={false} />
        )}
      </section>
      <h2 style={{ fontSize: 18 }}>Butiker</h2>
      <p className="muted" style={{ margin: 0 }}>Välj en eller flera. Varje butik får egna erbjudanden, vanliga varor och recept under fliken Mat.</p>
      <div className="tiles">
        {resp.providers
          .filter((p) => p.category === "grocery")
          .map((p) => {
            const mine = stores.find((x) => x.provider === p.id);
            const ok = mine && resp.verified.includes(mine.id);
            return (
              <button key={p.id} className={`tile ${integ && mine && integ.id === mine.id ? "selected" : ""} ${ok ? "connected" : ""}`} aria-pressed={Boolean(mine)} onClick={() => choose(p.id)}>
                <b>{p.name}</b>
                <small>{p.description}</small>
                <span className="row gap" style={{ flexWrap: "wrap" }}>
                  {ok ? <span className="badge stable">✓ Inloggad</span> : mine ? <span className="badge">Inte provad</span> : null}
                  {p.status !== "stable" && <span className={`badge ${p.status}`}>{p.status === "beta" ? "Beta" : "Experimentell"}</span>}
                </span>
              </button>
            );
          })}
      </div>
      {stores.length > 1 && (
        <section className="card">
          <Select
            label="Skicka inköpslistan till"
            value={cfg.shopping.sendTo && stores.some((x) => x.id === cfg.shopping.sendTo) ? cfg.shopping.sendTo : stores[0]!.id}
            onChange={(v) => set({ ...cfg, shopping: { ...cfg.shopping, sendTo: v } })}
            options={stores.map((x) => ({ value: x.id, label: resp.providers.find((p) => p.id === x.provider)?.name ?? x.provider }))}
          />
        </section>
      )}
      {integ && meta && (
        <section className="card">
          <h2>{meta.name}</h2>
          <ProviderForm key={`${integ.id}-${integ.provider}`} meta={meta} integ={integ} onChange={put} secrets={secrets} setSecrets={setSecrets} secretsSet={resp.secretsSet} saveNow={saveNow} verified={resp.verified.includes(integ.id)} />
          <button className="btn small" style={{ alignSelf: "flex-start", marginTop: 10 }} onClick={() => { put(null); setActive(null); }}>
            Ta bort {meta.name}
          </button>
        </section>
      )}
    </div>
  );
}

/** Number field that accepts "12,5" from a Swedish keyboard and keeps what is typed while typing. */
function DecimalField({ label, value, help, onChange }: { label: string; value: number; help: string; onChange: (n: number) => void }) {
  const [text, setText] = useState(String(value).replace(".", ","));
  return (
    <Text
      label={label}
      inputMode="decimal"
      value={text}
      help={help}
      onChange={(v) => {
        setText(v);
        const n = Number(v.replace(/\s/g, "").replace(",", "."));
        if (Number.isFinite(n) && n >= 0) onChange(n);
        else if (v.trim() === "") onChange(0);
      }}
    />
  );
}

export function ElectricityStep({ cfg, set, secrets, setSecrets, resp, haOk, postcode, saveNow }: StepProps) {
  const [integ, put] = useIntegration(cfg, set, "price");
  const meta = integ && resp.providers.find((p) => p.id === integ.provider && p.category === "price");
  const e = cfg.electricity;
  const setE = (patch: Partial<Config["electricity"]>) => set({ ...cfg, electricity: { ...e, ...patch } });
  const ore = (label: string, k: "markupOre" | "gridOre" | "taxOre", help: string) => (
    <DecimalField key={k} label={label} value={e[k]} help={help} onChange={(n) => setE({ [k]: n })} />
  );
  return (
    <div className="stack">
      <ProviderTiles
        providers={resp.providers}
        category="price"
        selected={integ?.provider}
        allowNone="Visa inte elpris"
        haAvailable={haOk}
        onSelect={(id) => put(id ? { id: "price", category: "price", provider: id, settings: id === "spot" ? { area: postcode?.area ?? "SE3", ...(integ?.provider === "spot" ? integ.settings : {}) } : {} } : null)}
      />
      {integ && meta && (
        <section className="card">
          <h2>{meta.name}</h2>
          <ProviderForm key={`${integ.id}-${integ.provider}`} meta={meta} integ={integ} onChange={put} secrets={secrets} setSecrets={setSecrets} secretsSet={resp.secretsSet} saveNow={saveNow} verified={resp.verified.includes(integ.id)} />
        </section>
      )}
      {integ && (
        <section className="card">
          <h2>Ditt verkliga pris</h2>
          <p className="muted">Fyll i från elräkningen (öre/kWh exkl. moms) så visar tavlan vad en kWh faktiskt kostar. Lämna 0 för bara spotpris.</p>
          <div className="grid-3">
            {ore("Elbolagets påslag", "markupOre", "Påslag + elcertifikat")}
            {ore("Elöverföring", "gridOre", "Nätbolagets rörliga avgift")}
            {ore("Energiskatt", "taxOre", "Står på nätfakturan")}
          </div>
          <Toggle label="Lägg på moms 25 %" checked={e.vat} onChange={(v) => setE({ vat: v })} />
          <Select
            label="Markera billigaste"
            value={String(e.cheapHours)}
            onChange={(v) => setE({ cheapHours: Number(v) })}
            options={[1, 2, 3, 4, 5, 6, 8].map((n) => ({ value: String(n), label: `${n} ${n === 1 ? "timme" : "timmar"} i följd` }))}
            help="Bra för att ladda bilen eller köra disk/tvätt."
          />
        </section>
      )}
    </div>
  );
}

// ======================= Huset (finjustering) =======================

function ListCard<T>({
  title,
  help,
  items,
  onChange,
  make,
  render,
  addLabel,
}: {
  title: string;
  help?: string;
  items: T[];
  onChange: (items: T[]) => void;
  make: () => T;
  render: (item: T, set: (t: T) => void) => React.ReactNode;
  addLabel: string;
}) {
  return (
    <section className="card">
      <h2>{title}</h2>
      {help && <p className="muted">{help}</p>}
      {items.map((it, i) => (
        <div key={i} className="card" style={{ padding: 16 }}>
          {render(it, (t) => onChange(items.map((x, j) => (j === i ? t : x))))}
          <button className="btn small ghost" style={{ alignSelf: "flex-start" }} onClick={() => onChange(items.filter((_, j) => j !== i))}>
            <Icon name="trashSmall" size={18} /> Ta bort
          </button>
        </div>
      ))}
      <button className="btn" onClick={() => onChange([...items, make()])}>
        <Icon name="plus" size={20} /> {addLabel}
      </button>
    </section>
  );
}

export function HouseStep({ cfg, set, saveNow }: StepProps) {
  const en = cfg.entities;
  const setEn = (patch: Partial<Config["entities"]>) => set({ ...cfg, entities: { ...en, ...patch } });
  return (
    <div className="stack">
      <ListCard
        title="Bilar"
        help="Fungerar med alla bilmärken som finns i Home Assistant."
        items={en.cars}
        onChange={(cars) => setEn({ cars })}
        make={(): Config["entities"]["cars"][number] => ({ name: "", battery: "" })}
        addLabel="Lägg till bil"
        render={(c, s) => (
          <div className="grid-2">
            <Text label="Namn" value={c.name} onChange={(v) => s({ ...c, name: v })} />
            <EntityPicker label="Batteri (%)" domains={["sensor"]} value={c.battery} onChange={(v) => s({ ...c, battery: v ?? "" })} optional={false} />
            <EntityPicker label="Räckvidd" domains={["sensor"]} value={c.range} onChange={(v) => s({ ...c, range: v })} />
            <EntityPicker label="Position / hemma" domains={["device_tracker", "binary_sensor", "sensor"]} value={c.location} onChange={(v) => s({ ...c, location: v })} />
            <EntityPicker label="Laddar" domains={["binary_sensor", "sensor", "switch"]} value={c.charging} onChange={(v) => s({ ...c, charging: v })} />
            <EntityPicker label="Värmestart" domains={["climate", "switch", "button"]} value={c.climate} onChange={(v) => s({ ...c, climate: v })} help="Gör att du kan starta värmen och schemalägga den." />
          </div>
        )}
      />
      <section className="card">
        <h2>Energi</h2>
        <p className="muted">
          Välj själv vilken växelriktare och elmätare tavlan ska använda, t.ex. SolarEdge för solel och Tibber Pulse för elnätet. Listorna visar bara effekt (W eller kW) med aktuellt värde – sök på märket.
        </p>
        <div className="grid-2">
          <EntityPicker label="Solproduktion (växelriktare)" domains={["sensor"]} units={POWER} value={en.energy.solar} onChange={(v) => setEn({ energy: { ...en.energy, solar: v } })} />
          <EntityPicker label="Elnät – köp positivt (elmätare)" domains={["sensor"]} units={POWER} value={en.energy.grid} onChange={(v) => setEn({ energy: { ...en.energy, grid: v } })} help="T.ex. Tibber Pulse, P1/HAN-mätare eller Shelly EM." />
          <EntityPicker label="Husets förbrukning" domains={["sensor"]} units={POWER} value={en.energy.house} onChange={(v) => setEn({ energy: { ...en.energy, house: v } })} help="Behövs bara om du saknar solel eller elmätare. Annars räknar tavlan själv: solel + köpt − såld." />
          <EntityPicker label="Elnät – sålt (om mätaren har det separat)" domains={["sensor"]} units={POWER} value={en.energy.gridExport} onChange={(v) => setEn({ energy: { ...en.energy, gridExport: v } })} help="T.ex. Tibber Pulse Elproduktion. Visar mätaren köp som plus och sälj som minus behövs den inte." />
          <EntityPicker label="Hembatteri (%)" domains={["sensor"]} units={/^%$/} value={en.energy.battery} onChange={(v) => setEn({ energy: { ...en.energy, battery: v } })} />
          <EntityPicker
            label="Hembatteri – effekt"
            domains={["sensor"]}
            units={POWER}
            value={en.energy.batteryPower}
            onChange={(v) => setEn({ energy: { ...en.energy, batteryPower: v } })}
            help="Med den räknar tavlan in batteriet i husets förbrukning och visar om det laddar eller laddar ur."
          />
        </div>
        {en.energy.batteryPower && (
          <Toggle
            label="Batteriets effekt är plus när det laddar"
            help="T.ex. Sigenergy. Home Assistants energipanel räknar urladdning som plus – stämmer det för ditt batteri ska den vara av."
            checked={Boolean(en.energy.batteryChargePositive)}
            onChange={(v) => setEn({ energy: { ...en.energy, batteryChargePositive: v } })}
          />
        )}
        <h3 style={{ marginTop: 8 }}>Dagens kWh</h3>
        <p className="muted">Mätarställningar (kWh) – tavlan räknar själv hur mycket som gått sedan midnatt: förbrukning, egen solel, självförsörjning och vad den köpta elen kostat.</p>
        <div className="grid-2">
          <EntityPicker label="Solproduktion totalt (kWh)" domains={["sensor"]} units={ENERGY} value={en.energy.solarEnergy} onChange={(v) => setEn({ energy: { ...en.energy, solarEnergy: v } })} />
          <EntityPicker label="Köpt el, mätarställning (kWh)" domains={["sensor"]} units={ENERGY} value={en.energy.importEnergy} onChange={(v) => setEn({ energy: { ...en.energy, importEnergy: v } })} />
          <EntityPicker label="Såld el, mätarställning (kWh)" domains={["sensor"]} units={ENERGY} value={en.energy.exportEnergy} onChange={(v) => setEn({ energy: { ...en.energy, exportEnergy: v } })} />
          <EntityPicker label="Laddat i hembatteriet (kWh)" domains={["sensor"]} units={ENERGY} value={en.energy.batteryChargeEnergy} onChange={(v) => setEn({ energy: { ...en.energy, batteryChargeEnergy: v } })} />
          <EntityPicker label="Urladdat ur hembatteriet (kWh)" domains={["sensor"]} units={ENERGY} value={en.energy.batteryDischargeEnergy} onChange={(v) => setEn({ energy: { ...en.energy, batteryDischargeEnergy: v } })} />
        </div>
      </section>
      <section className="card">
        <h2>Lampor på startskärmen</h2>
        {en.lights.map((l, i) => (
          <div className="row gap" key={l.entityId}>
            <div className="grow">
              <Text label={l.entityId} value={l.name} onChange={(v) => setEn({ lights: en.lights.map((x, j) => (j === i ? { ...x, name: v } : x)) })} />
            </div>
            <button className="btn small ghost" aria-label="Ta bort" onClick={() => setEn({ lights: en.lights.filter((_, j) => j !== i) })}>
              <Icon name="x" size={18} />
            </button>
          </div>
        ))}
        <EntityPicker
          label="Lägg till lampa"
          domains={["light", "switch"]}
          value={undefined}
          onChange={(v, o) => v && !en.lights.some((l) => l.entityId === v) && setEn({ lights: [...en.lights, { entityId: v, name: o?.name ?? v }] })}
        />
      </section>
      <MusicCard cfg={cfg} set={set} saveNow={saveNow} />
      <SecurityCard cfg={cfg} set={set} />
      <ListCard
        title="Ljusgrupper"
        help="Visas på fliken Ljus med Tänd alla / Släck alla."
        items={en.lightGroups}
        onChange={(lightGroups) => setEn({ lightGroups })}
        make={() => ({ name: "", entities: [] })}
        addLabel="Lägg till grupp"
        render={(g, s) => (
          <>
            <Text label="Namn" value={g.name} onChange={(v) => s({ ...g, name: v })} placeholder="Fönsterlampor" />
            <MultiEntityPicker label="Lägg till lampa" domains={["light", "switch"]} value={g.entities} onChange={(v) => s({ ...g, entities: v })} />
          </>
        )}
      />
      <ListCard
        title="Snabbknappar"
        help="Scener och skript, t.ex. Godnatt – släck uppe."
        items={en.buttons}
        onChange={(buttons) => setEn({ buttons })}
        make={() => ({ name: "", entityId: "", style: "blue" as const })}
        addLabel="Lägg till knapp"
        render={(b, s) => (
          <div className="grid-3">
            <Text label="Text på knappen" value={b.name} onChange={(v) => s({ ...b, name: v })} />
            <EntityPicker label="Scen/skript" domains={["scene", "script", "button", "input_button", "automation"]} value={b.entityId || undefined} onChange={(v, o) => s({ ...b, entityId: v ?? "", name: b.name || o?.name || "" })} optional={false} />
            <Select
              label="Färg"
              value={b.style}
              onChange={(v) => s({ ...b, style: v as typeof b.style })}
              options={[
                { value: "blue", label: "Blå" },
                { value: "amber", label: "Gul" },
                { value: "accent", label: "Grön" },
                { value: "plain", label: "Neutral" },
              ]}
            />
          </div>
        )}
      />
      <ListCard
        title="Värme, varmvatten och spabad"
        items={en.climates}
        onChange={(climates) => setEn({ climates })}
        make={(): Config["entities"]["climates"][number] => ({ name: "", entityId: "" })}
        addLabel="Lägg till"
        render={(c, s) => (
          <>
            <div className="grid-2">
              <Text label="Namn" value={c.name} onChange={(v) => s({ ...c, name: v })} placeholder="Värme inne" />
              <EntityPicker label="Termostat / varmvatten" domains={["climate", "water_heater"]} value={c.entityId || undefined} onChange={(v, o) => s({ ...c, entityId: v ?? "", name: c.name || o?.name || "" })} optional={false} />
            </div>
            <MultiEntityPicker label="Extra reglage (pumpar, ljus, blåsare)" domains={["switch", "fan", "light", "select", "number", "button"]} value={c.controls ?? []} onChange={(v) => s({ ...c, controls: v })} />
          </>
        )}
      />
      <ListCard
        title="Enhetskort"
        help="För t.ex. värmepump via Husdata: välj ett huvudvärde, rader och reglage."
        items={en.deviceCards}
        onChange={(deviceCards) => setEn({ deviceCards })}
        make={() => ({ title: "", sensors: [], controls: [] })}
        addLabel="Lägg till kort"
        render={(d, s) => (
          <>
            <div className="grid-2">
              <Text label="Rubrik" value={d.title} onChange={(v) => s({ ...d, title: v })} placeholder="Värmepump" />
              <EntityPicker label="Huvudvärde" domains={["sensor"]} value={d.primary} onChange={(v) => s({ ...d, primary: v })} />
            </div>
            <MultiEntityPicker label="Lägg till rad" domains={["sensor", "binary_sensor"]} value={d.sensors} onChange={(v) => s({ ...d, sensors: v })} />
            <MultiEntityPicker label="Lägg till reglage" domains={["switch", "select", "number", "button", "input_number", "input_select", "input_boolean"]} value={d.controls} onChange={(v) => s({ ...d, controls: v })} />
          </>
        )}
      />
      <ListCard
        title="Temperaturer"
        items={en.temps}
        onChange={(temps) => setEn({ temps })}
        make={() => ({ name: "", entityId: "" })}
        addLabel="Lägg till"
        render={(t, s) => (
          <div className="grid-2">
            <Text label="Namn" value={t.name} onChange={(v) => s({ ...t, name: v })} placeholder="Ute" />
            <EntityPicker label="Sensor" domains={["sensor"]} value={t.entityId || undefined} onChange={(v, o) => s({ ...t, entityId: v ?? "", name: t.name || o?.name || "" })} optional={false} />
          </div>
        )}
      />
      <ListCard
        title="Grafer"
        items={en.graphs}
        onChange={(graphs) => setEn({ graphs })}
        make={() => ({ title: "", series: [] })}
        addLabel="Lägg till graf"
        render={(g, s) => (
          <>
            <Text label="Rubrik" value={g.title} onChange={(v) => s({ ...g, title: v })} placeholder="Effekt hus" />
            {g.series.map((se, i) => (
              <div className="row gap" key={i}>
                <input
                  type="color"
                  className="color-input"
                  aria-label="Färg"
                  value={se.color}
                  onChange={(e) => s({ ...g, series: g.series.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)) })}
                />
                <span className="grow">{se.name}</span>
                <button className="btn small ghost" aria-label="Ta bort serie" onClick={() => s({ ...g, series: g.series.filter((_, j) => j !== i) })}>
                  <Icon name="x" size={18} />
                </button>
              </div>
            ))}
            <EntityPicker
              label="Lägg till sensor"
              domains={["sensor"]}
              value={undefined}
              onChange={(v, o) => v && s({ ...g, series: [...g.series, { entityId: v, name: o?.name ?? v, color: PALETTE[g.series.length % PALETTE.length] }] })}
            />
          </>
        )}
      />
    </div>
  );
}

// ======================= Fotoram =======================

/** Shrink a photo in the browser before upload (max 1920 px, JPEG) – keeps /data small. */
async function downscale(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, bad) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => bad(new Error("Kunde inte läsa bilden"));
      i.src = url;
    });
    const scale = Math.min(1, 1920 / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function PhotoFrame({ cfg, set }: { cfg: Config; set: (c: Config) => void }) {
  const [photos, setPhotos] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    api.photos().then(setPhotos).catch(() => setPhotos([]));
  }, []);
  const d = cfg.dashboard;
  return (
    <section className="card">
      <h2>Fotoram i viloläge</h2>
      <p className="muted">När ingen rört tavlan på en stund visas familjens bilder med klocka och nästa händelse. Utan bilder visas en lugn himmel.</p>
      <Select
        label="Visa efter"
        value={String(d.idleMinutes ?? 10)}
        onChange={(v) => set({ ...cfg, dashboard: { ...d, idleMinutes: Number(v) } })}
        options={[0, 2, 5, 10, 20, 30, 60].map((n) => ({ value: String(n), label: n === 0 ? "Aldrig" : `${n} minuter` }))}
      />
      <div className="photos">
        {(photos ?? []).map((p) => (
          <figure key={p}>
            <img src={`api/photos/${encodeURIComponent(p)}`} alt="" />
            <button className="btn small" aria-label="Ta bort bild" onClick={() => api.deletePhoto(p).then((r) => setPhotos(r.photos))}>
              <Icon name="x" size={16} />
            </button>
          </figure>
        ))}
      </div>
      <label className="btn" style={{ alignSelf: "flex-start" }}>
        <Icon name="image" size={20} /> {busy ? "Laddar upp…" : "Lägg till bilder"}
        <input
          type="file"
          accept="image/*"
          multiple
          className="sr-only"
          onChange={async (e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = "";
            setBusy(true);
            setError("");
            try {
              for (const f of files) {
                const r = await api.uploadPhoto(await downscale(f), "image/jpeg");
                setPhotos(r.photos);
              }
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        />
      </label>
      {error && <Result error={error} />}
    </section>
  );
}

// ======================= Startskärm =======================

const TAB_LABELS: Record<string, string> = { food: "Mat", security: "Säkerhet", household: "Hushåll", cars: "Bil", lights: "Ljus", house: "Hus", energy: "Energi", graphs: "Grafer", music: "Musik" };

const SIZE_OPTIONS = [
  { value: "auto", label: "Auto" },
  { value: "s", label: "Liten" },
  { value: "m", label: "Normal" },
  { value: "l", label: "Stor" },
];
/** Cards that always fill their own area and have no size choice. */
const FIXED_SIZE = new Set(["now", "week"]);

function OrderList<T extends { id: string; on: boolean; size?: string }>({
  items,
  labels,
  onChange,
  sizes = false,
}: {
  items: T[];
  labels: Record<string, string>;
  onChange: (v: T[]) => void;
  sizes?: boolean;
}) {
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  return (
    <div className="stack" style={{ gap: 8 }}>
      {items.map((w, i) => (
        <div className="item-row order-row" key={w.id}>
          <label className="switch">
            <input type="checkbox" checked={w.on} aria-label={`Visa ${labels[w.id]}`} onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)))} />
            <span />
          </label>
          <span className="order-label" style={{ opacity: w.on ? 1 : 0.55 }}>
            {labels[w.id] ?? w.id}
          </span>
          {sizes && !FIXED_SIZE.has(w.id) && (
            <select
              className="size-select"
              aria-label={`Storlek på ${labels[w.id]}`}
              value={w.size ?? "auto"}
              disabled={!w.on}
              onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, size: e.target.value } : x)))}
            >
              {SIZE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          )}
          <button className="btn small" aria-label={`Flytta upp ${labels[w.id]}`} disabled={i === 0} onClick={() => move(i, -1)}>
            ↑
          </button>
          <button className="btn small" aria-label={`Flytta ner ${labels[w.id]}`} disabled={i === items.length - 1} onClick={() => move(i, 1)}>
            ↓
          </button>
        </div>
      ))}
    </div>
  );
}

export function DisplayStep({ cfg, set }: StepProps) {
  const d = cfg.dashboard;
  const setD = (patch: Partial<Config["dashboard"]>) => set({ ...cfg, dashboard: { ...d, ...patch } });
  return (
    <div className="stack">
      <section className="card">
        <h2>Startskärmen</h2>
        <p className="muted">
          Slå på det du vill se och flytta i den ordning du vill. Rutor utan data döljs automatiskt. Storlek <b>Auto</b> gör rutorna större när
          ni visar få och mer kompakta när ni visar många.
        </p>
        <OrderList items={d.home} labels={WIDGET_LABELS} onChange={(home) => setD({ home })} sizes />
        <p className="muted" style={{ margin: "8px 0 0" }}>Tips: håll inne en ruta på tavlan för att flytta eller dölja den direkt.</p>
        <Toggle label="Solbåge vid vädret" help="Soluppgång och solnedgång som en båge under temperaturen i Nu-rutan." checked={Boolean(d.sunArc)} onChange={(v) => setD({ sunArc: v })} />
      </section>
      <section className="card">
        <h2>Flikar</h2>
        <OrderList items={d.tabs} labels={TAB_LABELS} onChange={(tabs) => setD({ tabs })} />
      </section>
      <section className="card">
        <h2>Utseende</h2>
        <Select
          label="Tema"
          value={d.theme}
          onChange={(v) => setD({ theme: v as Config["dashboard"]["theme"] })}
          options={[
            { value: "auto", label: "Dygnsfärger (ljust dag, mörkt kväll)" },
            { value: "dark", label: "Alltid mörkt" },
            { value: "light", label: "Alltid ljust" },
            { value: "eink", label: "E-ink (svart på vitt, inga animationer)" },
            { value: "mirror", label: "Spegel (vitt på svart, för Magic Mirror bakom glas)" },
          ]}
        />
        <div className="grid-2">
          <label className="field">
            <span>Nattläge från</span>
            <input type="time" value={d.nightFrom} onChange={(e) => setD({ nightFrom: e.target.value })} />
          </label>
          <label className="field">
            <span>till</span>
            <input type="time" value={d.nightTo} onChange={(e) => setD({ nightTo: e.target.value })} />
          </label>
        </div>
        <small className="faint">Nattläge visar bara klockan på svart skärm. Tryck för att väcka.</small>
      </section>
      <PhotoFrame cfg={cfg} set={set} />
    </div>
  );
}

/** PIN + paired screens. Shown on the last step. */
function PinCard({ secrets, setSecrets, resp }: Pick<StepProps, "secrets" | "setSecrets" | "resp">) {
  const pinSet = resp.secretsSet.includes("admin.pin");
  return (
        <section className="card">
          <h2>PIN-kod och skärmar</h2>
          <p className="muted">
            {resp.runtime.supervisor
              ? "Behövs bara om du öppnat port 8099 för surfplattan. Via Home Assistant är tavlan redan skyddad av din inloggning."
              : "Rekommenderas. Med en PIN kommer bara skärmar som låsts upp en gång åt tavlan – inte gäster eller andra enheter på wifi:t. Den här skärmen låses upp direkt. Inställningarna kräver alltid PIN."}
          </p>
          <Text
            label="PIN-kod"
            type="password"
            inputMode="numeric"
            value={secrets["admin.pin"] ?? ""}
            placeholder={pinSet ? "•••• satt – skriv för att byta" : "Minst 4 siffror"}
            onChange={(v) => setSecrets({ ...secrets, "admin.pin": v })}
          />
          {pinSet && (
            <div className="row gap wrap">
              <button className="btn small" onClick={() => setSecrets({ ...secrets, "admin.pin": null })}>
                Ta bort PIN
              </button>
              <button
                className="btn small"
                onClick={async () => {
                  if (!confirm("Alla skärmar (även den här) måste låsas upp med PIN igen. Fortsätta?")) return;
                  await api.forgetDevices();
                  location.reload();
                }}
              >
                Glöm alla upplåsta skärmar
              </button>
            </div>
          )}
        </section>
  );
}

// ======================= Påminnelser =======================

const MORNING_TIMES = ["05:45", "06:00", "06:15", "06:30", "06:45", "07:00", "07:15", "07:30", "07:45", "08:00"];
const BEFORE = [0, 15, 30, 45, 60, 90];

export function NotifyStep({ cfg, set, resp }: StepProps) {
  const kidsForNotify = cfg.people.filter((p) => p.kind === "child");
  const [phones, setPhones] = useState<string[] | null>(null);
  const [error, setError] = useState("");
  const [results, setResults] = useState<Record<string, TestResult | string>>({});
  const [feeds, setFeeds] = useState<Record<string, string>>({});
  useEffect(() => {
    api
      .notifyServices()
      .then(setPhones)
      .catch((e: Error) => setError(e.message));
  }, []);
  const adults = cfg.people.filter((p) => p.kind === "adult");
  const setNotify = (id: string, patch: Partial<NonNullable<Person["notify"]>>) =>
    set({ ...cfg, people: cfg.people.map((p) => (p.id === id ? { ...p, notify: { before: 30, evening: true, weekly: true, ...p.notify, ...patch } } : p)) });
  const nice = (s: string) => s.replace(/^mobile_app_/, "").replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
  if (!adults.length) return <Result error="Lägg till de vuxna i steget Familjen först." />;
  return (
    <div className="stack">
      {error && <Result error={error} />}
      {adults.map((a) => {
        const n = a.notify ?? {};
        const r = results[a.id];
        return (
          <section className="card" key={a.id}>
            <h2>{a.name || "(namnlös)"}</h2>
            <div className="row gap" style={{ alignItems: "flex-end" }}>
              <div className="grow">
                <Select
                  label="Telefon"
                  value={n.service ?? ""}
                  onChange={(v) => setNotify(a.id, { service: v || undefined })}
                  options={[{ value: "", label: phones ? "Inga notiser" : "Hämtar telefoner…" }, ...(phones ?? []).map((p) => ({ value: p, label: nice(p) }))]}
                  help={phones && !phones.some((p) => p.startsWith("mobile_app_")) ? "Installera Home Assistant-appen på telefonen och logga in – då dyker den upp här." : undefined}
                />
              </div>
              <button
                className="btn"
                disabled={!n.service}
                onClick={async () => {
                  try {
                    setResults({ ...results, [a.id]: await api.notifyTest(n.service!) });
                  } catch (e) {
                    setResults({ ...results, [a.id]: (e as Error).message });
                  }
                }}
              >
                Testa
              </button>
            </div>
            {r && (typeof r === "string" ? <Result error={r} /> : <Result result={r} />)}
            {n.service && (
              <>
                <Select
                  label="Påminn före det jag lämnar, hämtar eller skjutsar"
                  value={String(n.before ?? 30)}
                  onChange={(v) => setNotify(a.id, { before: Number(v) })}
                  options={BEFORE.map((m) => ({ value: String(m), label: m ? `${m} minuter innan` : "Ingen påminnelse" }))}
                />
                <Select
                  label="Morgon – dagens kom ihåg (gympapåse, blöjor, regnkläder, soporna …)"
                  value={n.morning ?? "06:45"}
                  onChange={(v) => setNotify(a.id, { morning: v })}
                  options={[{ value: "", label: "Ingen morgonnotis" }, ...MORNING_TIMES.map((t) => ({ value: t, label: `Kl ${t}` }))]}
                />
                {kidsForNotify.length > 1 && (
                  <div className="field">
                    <span>Notiser om</span>
                    <div className="seg">
                      {kidsForNotify.map((k) => {
                        const chosen = n.children ?? kidsForNotify.map((x) => x.id);
                        const on = chosen.includes(k.id);
                        return (
                          <button
                            type="button"
                            key={k.id}
                            className={`seg-btn ${on ? "on" : ""}`}
                            aria-pressed={on}
                            onClick={() => {
                              const next = on ? chosen.filter((id) => id !== k.id) : [...chosen, k.id];
                              setNotify(a.id, { children: next.length === kidsForNotify.length ? undefined : next });
                            }}
                          >
                            {k.name}
                          </button>
                        );
                      })}
                    </div>
                    <small>Morgonens kom ihåg och sjuk-notiser gäller bara de barn du valt. Det du själv ska lämna, hämta eller skjutsa får du alltid.</small>
                  </div>
                )}
                <Toggle label="Kvällen innan kl 20 – vad jag ansvarar för imorgon" checked={n.evening ?? true} onChange={(v) => setNotify(a.id, { evening: v })} />
                <Toggle label="Söndag kl 19 – Planera veckan om något saknar ansvarig" checked={n.weekly ?? true} onChange={(v) => setNotify(a.id, { weekly: v })} />
                <Toggle label="Ny version av Familjetavlan – en notis när det finns en" checked={n.updates ?? true} onChange={(v) => setNotify(a.id, { updates: v })} />
                {(cfg.entities.security || (cfg.entities.appliances ?? []).length > 0 || (cfg.entities.robots ?? []).length > 0) && (
                  <Toggle
                    label="Hemmet – tvätten klar, roboten har fastnat, dörren olåst kl 22, porten öppen, larmet"
                    checked={n.home ?? true}
                    onChange={(v) => setNotify(a.id, { home: v })}
                    help="Går till den som är hemma (enligt Home Assistants personer), annars till alla. Larmet går alltid till alla."
                  />
                )}
              </>
            )}
            <details>
              <summary className="muted" style={{ cursor: "pointer", minHeight: 44, display: "flex", alignItems: "center" }}>
                Kalenderlänk (reserv – notiserna ovan är huvudspåret)
              </summary>
              <div className="stack" style={{ marginTop: 8 }}>
                <p className="muted">En privat kalenderlänk med det {a.name || "personen"} lämnar, hämtar och skjutsar de kommande 7 dagarna. Prenumerera på den i telefonens kalender. Den uppdateras av sig själv när någon ändrar på tavlan.</p>
                {feeds[a.id] ? (
                  <>
                    <input className="input" readOnly value={feeds[a.id]} onFocus={(e) => e.target.select()} />
                    <div className="row gap wrap">
                      <button className="btn small" onClick={() => navigator.clipboard?.writeText(feeds[a.id]).catch(() => {})}>
                        Kopiera
                      </button>
                      <a className="btn small" href={feeds[a.id].replace(/^https?:/, "webcal:")}>
                        Öppna i kalendern
                      </a>
                    </div>
                    <small className="faint">
                      Fungerar i iPhone/Mac-kalendern när telefonen är hemma på wifi:t (eller via VPN) – inte i Google Kalender, som hämtar från internet.
                      Vill du ha det i Home Assistant: lägg till integrationen <b>Remote Calendar</b> med den här adressen, så blir det en kalender per vuxen där.
                      {resp.runtime.supervisor ? " I Home Assistant-tillägget: öppna port 8099 och använd den adressen." : ""}
                    </small>
                  </>
                ) : (
                  <button
                    className="btn small"
                    style={{ alignSelf: "flex-start" }}
                    onClick={async () => {
                      try {
                        const r = await api.newFeed(a.id);
                        // Under ingress the page address needs a Home Assistant login, which calendar apps don't have:
                        // point at the add-on's own port 8099 instead.
                        const here = new URL(location.href.split("#")[0]);
                        const base = resp.runtime.supervisor && here.pathname.includes("/hassio_ingress/") ? `http://${here.hostname}:8099/` : here.toString();
                        setFeeds({ ...feeds, [a.id]: new URL(r.path, base).toString() });
                      } catch (e) {
                        setResults({ ...results, [a.id]: (e as Error).message });
                      }
                    }}
                  >
                    {resp.secretsSet.includes(`feed.${a.id}`) ? "Skapa ny länk (den gamla slutar fungera)" : "Skapa kalenderlänk"}
                  </button>
                )}
              </div>
            </details>
          </section>
        );
      })}
    </div>
  );
}

// ======================= Klart =======================

/** Save all settings to a file, and bring them back – e.g. after moving to a new computer. */
function BackupCard() {
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [file, setFile] = useState<unknown>(null);
  const [rpw, setRpw] = useState("");
  return (
    <section className="card stack">
      <h2>Säkerhetskopia</h2>
      <p className="muted" style={{ margin: 0 }}>
        Spara familjen, kalendrarna, omsorgstiderna och alla val i en fil. Kör du tavlan som tillägg i Home Assistant ingår den redan i Home Assistants egna
        säkerhetskopior.
      </p>
      <label className="field">
        <span>Lösenord för filen (valfritt)</span>
        <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Utan lösenord följer inga inloggningar med" autoComplete="new-password" />
        <small>Med lösenord sparas även inloggningar och länkar (Vklass, kalenderlänkar, Home Assistant), krypterade med lösenordet.</small>
      </label>
      <button
        className="btn"
        style={{ alignSelf: "flex-start" }}
        onClick={async () => {
          setMsg(null);
          try {
            const data = await api.backup(pw || undefined);
            const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
            const a = document.createElement("a");
            a.href = url;
            a.download = `familjetavla-${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 5000);
            setMsg({ ok: true, text: pw ? "Sparad – med inloggningar, krypterade med ditt lösenord." : "Sparad – utan inloggningar." });
          } catch (e) {
            setMsg({ ok: false, text: (e as Error).message });
          }
        }}
      >
        Ladda ner säkerhetskopia
      </button>
      <label className="field">
        <span>Återställ från en fil</span>
        <input
          type="file"
          accept="application/json,.json"
          onChange={async (e) => {
            setMsg(null);
            const f = e.target.files?.[0];
            if (!f) return;
            try {
              setFile(JSON.parse(await f.text()));
            } catch {
              setMsg({ ok: false, text: "Filen gick inte att läsa." });
            }
          }}
        />
      </label>
      {file !== null && (
        <>
          <label className="field">
            <span>Lösenord (om filen har ett)</span>
            <input type="password" value={rpw} onChange={(e) => setRpw(e.target.value)} autoComplete="off" />
          </label>
          <button
            className="btn primary"
            style={{ alignSelf: "flex-start" }}
            onClick={async () => {
              if (!confirm("Ersätta alla inställningar på den här tavlan med säkerhetskopian?")) return;
              try {
                const r = await api.restore(file, rpw || undefined);
                setMsg({ ok: true, text: r.secrets ? "Återställd, med inloggningar. Laddar om …" : "Återställd. Fyll i lösenorden igen där det behövs. Laddar om …" });
                setTimeout(() => location.reload(), 1500);
              } catch (err) {
                setMsg({ ok: false, text: (err as Error).message });
              }
            }}
          >
            Återställ
          </button>
        </>
      )}
      {msg && (msg.ok ? <Result result={{ ok: true, message: msg.text }} /> : <Result error={msg.text} />)}
    </section>
  );
}

export function DoneStep({ cfg, secrets, setSecrets, resp, haOk, addSteps }: StepProps) {
  const ha = (ids: string[]) => (haOk ? ids : ["ha", ...ids]);
  const adultsNotified = cfg.people.filter((p) => p.kind === "adult" && p.notify?.service).length;
  const e = cfg.entities;
  const tiles: { title: string; desc: string; ids: string[]; done: boolean }[] = [
    { title: "Påminnelser till telefonen", desc: "Den som ska lämna, hämta eller skjutsa får en notis i tid.", ids: ha(["paminnelser"]), done: adultsNotified > 0 },
    { title: "Hemmet", desc: "Bil, ljus, värme, energi och musik från Home Assistant.", ids: ha(["hamta", "huset"]), done: e.cars.length + e.lights.length + e.climates.length + (e.speakers ?? []).length > 0 },
    { title: "Sophämtning", desc: "Påminnelse kvällen innan kärlen töms.", ids: ["sopor"], done: cfg.integrations.some((i) => i.category === "waste") },
    { title: "Inköpslista", desc: "Lista på tavlan, och skicka till butikens varukorg.", ids: ["inkop"], done: cfg.shopping.source === "ha" || cfg.integrations.some((i) => i.category === "grocery") },
    { title: "Elpris", desc: "Timpris och billigaste timmarna.", ids: ["el"], done: cfg.integrations.some((i) => i.category === "price") },
    { title: "Startskärm och utseende", desc: "Vad som visas, tema, nattläge och fotoram.", ids: ["visning"], done: false },
  ];
  const kids = cfg.people.filter((p) => p.kind === "child").length;
  return (
    <div className="stack">
      <div className="result">
        <b>
          {cfg.people.length} {cfg.people.length === 1 ? "person" : "personer"} · {cfg.calendars.length} {cfg.calendars.length === 1 ? "kalender" : "kalendrar"}
          {kids ? ` · ${kids} barn` : ""}
        </b>
        <span className="muted">Tryck på Planera veckan på tavlan för att bestämma vem som lämnar, hämtar och skjutsar.</span>
      </div>
      <h2 style={{ fontSize: 18 }}>Lägg till mer (valfritt)</h2>
      <div className="tiles">
        {tiles.map((t) => (
          <button key={t.title} className={`tile ${t.done ? "selected" : ""}`} onClick={() => addSteps(t.ids)}>
            <b>
              {t.done && <Icon name="check" size={16} />} {t.title}
            </b>
            <small>{t.desc}</small>
          </button>
        ))}
      </div>
      <PinCard secrets={secrets} setSecrets={setSecrets} resp={resp} />
      <section className="card">
        <h2>Lägg tavlan på hemskärmen</h2>
        <p className="muted">Då startar den som en egen app bland de andra, i helskärm.</p>
        <InstallHelp />
      </section>
      <BackupCard />
      <section className="card">
        <h2>Lägg till från mobilen</h2>
        <p className="muted">Öppna adressen på telefonen och lägg den på hemskärmen. Där skriver ni in en händelse eller något att handla, och det syns på tavlan direkt.</p>
        <p>
          <b style={{ wordBreak: "break-all" }}>{quickAddUrl()}</b>
        </p>
      </section>
    </div>
  );
}
