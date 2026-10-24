import { useEffect, useRef, useState } from "react";
import type { Config, ConfigResponse } from "../../../server/src/types";
import { api, setPin, type PostcodeInfo } from "../api";
import { Icon } from "../Icon";
import { clearEntityCache, type SecretDraft } from "./parts";
import {
  CalendarsStep,
  DiscoverStep,
  DisplayStep,
  ElectricityStep,
  FamilyStep,
  HaStep,
  HomeStep,
  HouseStep,
  NotifyStep,
  DoneStep,
  SchoolStep,
  ShoppingStep,
  WasteStep,
} from "./steps";

export interface StepProps {
  cfg: Config;
  /** Pass a function when the change lands after an await, so it builds on the latest config. */
  set: (c: Config | ((prev: Config) => Config)) => void;
  secrets: SecretDraft;
  setSecrets: (s: SecretDraft) => void;
  resp: ConfigResponse;
  haOk: boolean;
  setHaOk: (v: boolean) => void;
  postcode: PostcodeInfo | null;
  setPostcode: (p: PostcodeInfo | null) => void;
  /** Save now (used before tests that read stored config, e.g. after connecting HA). */
  saveNow: () => Promise<void>;
  /** Last step: add optional steps (first start) and jump to the first of them. */
  addSteps: (ids: string[]) => void;
}

/**
 * First start shows only the core (core: true) – home, family, calendars, school/förskola, done.
 * Everything else is added from the last step ("Lägg till mer") or later under settings.
 */
const STEPS: { id: string; label: string; title: string; lead: string; C: (p: StepProps) => React.ReactNode; needsHa?: boolean; optional?: boolean; core?: boolean }[] = [
  { id: "hem", label: "Hem", title: "Välkommen till Familjetavlan", lead: "Vi börjar med var ni bor – det ger väder och rätt dag för sopor och elpris. Fem korta steg, sedan är tavlan igång.", C: HomeStep, core: true },
  { id: "familj", label: "Familjen", title: "Vilka bor här?", lead: "Lägg till vuxna och barn. Bor ett barn växelvis i två hem väljer du det på barnet – annars behöver du inte tänka på det.", C: FamilyStep, core: true },
  { id: "kalendrar", label: "Kalendrar", title: "Kalendrar", lead: "Lägg till familjens kalendrar och barnens aktiviteter – en kalender per lag eller aktivitet.", C: CalendarsStep, core: true },
  { id: "skola", label: "Skola", title: "Skola och förskola", lead: "Skola och förskola: schema, idrott, omsorgstid och matsedel. Tavlan påminner om gympapåsen.", C: SchoolStep, optional: true, core: true },
  { id: "ha", label: "Home Assistant", title: "Home Assistant", lead: "Behövs för påminnelser till telefonen och för bil, ljus, värme och energi.", C: HaStep },
  { id: "paminnelser", label: "Påminnelser", title: "Påminnelser till telefonen", lead: "Den som ska lämna, hämta eller skjutsa får en notis i tid, och alla får dagens kom ihåg på morgonen – via Home Assistant-appen. Eller prenumerera på en egen kalender.", C: NotifyStep, needsHa: true, optional: true },
  { id: "hamta", label: "Hämta", title: "Hämta från Home Assistant", lead: "Vi letar upp det du redan har integrerat – bilar, växelriktare, värmepump, spabad, lampor och mer. Bocka ur det du inte vill ha.", C: DiscoverStep, needsHa: true, optional: true },
  { id: "huset", label: "Huset", title: "Huset", lead: "Finjustera bilar, energi, ljus, musik, värme och grafer.", C: HouseStep, needsHa: true, optional: true },
  { id: "sopor", label: "Sopor", title: "Sophämtning", lead: "Få en påminnelse kvällen innan kärlen töms.", C: WasteStep, optional: true },
  { id: "inkop", label: "Inköp", title: "Mat & inköp", lead: "Inköpslistan på tavlan – och skicka den till butikens varukorg.", C: ShoppingStep, optional: true },
  { id: "el", label: "El", title: "Elpris", lead: "Se timpriset och de billigaste timmarna. Lägg till ditt elbolags påslag för verkligt pris.", C: ElectricityStep, optional: true },
  { id: "visning", label: "Startskärm", title: "Startskärm och utseende", lead: "Välj vad som ska synas och i vilken ordning.", C: DisplayStep, optional: true },
  { id: "klart", label: "Klart", title: "Klart!", lead: "Tavlan är redo. Lägg till mer nu eller när som helst under Inställningar.", C: DoneStep, core: true },
];

export function Wizard({ initial, startStep, onDone }: { initial: ConfigResponse; startStep?: string; onDone: (r: ConfigResponse) => void }) {
  const [resp, setResp] = useState(initial);
  const [cfg, setCfg] = useState<Config>(initial.config);
  const [secrets, setSecrets] = useState<SecretDraft>({});
  const [haOk, setHaOk] = useState(initial.config.ha.mode !== "none");
  const [postcode, setPostcode] = useState<PostcodeInfo | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  // First start: only the core steps, plus what the user adds from "Lägg till mer".
  const [firstRun] = useState(!initial.config.setupComplete);
  const [extras, setExtras] = useState<string[]>([]);
  const [jumpTo, setJumpTo] = useState("");
  const visible = STEPS.filter((s) => (!firstRun || s.core || extras.includes(s.id)) && (!s.needsHa || haOk));
  const startIdx = Math.max(0, visible.findIndex((s) => s.id === startStep));
  const [idx, setIdx] = useState(initial.config.setupComplete && !startStep ? visible.length - 1 : startIdx);
  useEffect(() => {
    if (!jumpTo) return;
    const i = visible.findIndex((s) => s.id === jumpTo);
    if (i >= 0) {
      setIdx(i);
      setJumpTo("");
      window.scrollTo({ top: 0 });
    }
  }, [jumpTo, visible]);
  const step = visible[Math.min(idx, visible.length - 1)];

  const save = async (next: Config = cfg) => {
    setSaving(true);
    setError("");
    // A person or calendar that was added but never named is an unfinished row – leave it out.
    const named = next.people.filter((p) => p.name.trim());
    const cals = next.calendars.filter((c) => c.name.trim());
    if (named.length !== next.people.length || cals.length !== next.calendars.length) {
      next = { ...next, people: named, calendars: cals };
    }
    try {
      const r = await api.saveConfig(next, secrets);
      // A new PIN unlocks this screen at once (the server pairs it), and later saves send it along.
      if (secrets["admin.pin"]) setPin(secrets["admin.pin"]);
      setResp(r);
      setCfg(r.config);
      setSecrets({});
      clearEntityCache();
      return r;
    } catch (e) {
      setError((e as Error).message);
      throw e;
    } finally {
      setSaving(false);
    }
  };

  const go = async (to: number) => {
    try {
      await save();
      setIdx(to);
      window.scrollTo({ top: 0 });
    } catch {
      /* error shown */
    }
  };

  const finish = async () => {
    try {
      const r = await save({ ...cfg, setupComplete: true });
      onDone(r);
    } catch {
      /* error shown */
    }
  };

  const props: StepProps = {
    cfg,
    set: setCfg,
    secrets,
    setSecrets,
    resp,
    haOk,
    setHaOk,
    postcode,
    setPostcode,
    saveNow: async () => {
      await save();
    },
    addSteps: (ids) => {
      void save()
        .then(() => {
          setExtras((x) => [...new Set([...x, ...ids])]);
          setJumpTo(ids[0]);
        })
        .catch(() => {});
    },
  };
  const last = idx >= visible.length - 1;
  const at = Math.min(idx, visible.length - 1);

  // Keep the current step's pill in view – with eleven steps the row scrolls sideways.
  const navRef = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  // A new step starts at the top of the form.
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [at]);
  useEffect(() => {
    navRef.current?.querySelector('[aria-current="step"]')?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [at]);

  return (
    <div className="app-bg">
      <div className="sky" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <div className="wizard">
        <div className="row gap">
          <nav className="steps grow" aria-label="Steg" ref={navRef}>
            {visible.map((s, i) => (
              <button key={s.id} aria-current={i === idx ? "step" : undefined} className={i < idx ? "done" : ""} onClick={() => go(i)}>
                {i < idx && <Icon name="check" size={16} />}
                {s.label}
              </button>
            ))}
          </nav>
          <button className="btn small icon" aria-label="Ladda om sidan" title="Ladda om (hämtar också senaste versionen)" style={{ flex: "none" }} onClick={() => window.location.reload()}>
            <Icon name="refresh" size={18} />
          </button>
          {cfg.setupComplete && (
            <a className="btn small" href="#/" style={{ flex: "none", whiteSpace: "nowrap" }}>
              Till tavlan
            </a>
          )}
        </div>
        <div className="wizard-progress" role="progressbar" aria-valuemin={1} aria-valuemax={visible.length} aria-valuenow={at + 1} aria-label="Hur långt du kommit">
          <span>
            Steg {at + 1} av {visible.length}
            {step.optional && <em> · valfritt, hoppa över om du vill</em>}
          </span>
          <i style={{ width: `${((at + 1) / visible.length) * 100}%` }} />
        </div>
        {/* Only the form scrolls – the steps above and Tillbaka/Nästa below stay put, so nothing hides behind them. */}
        <div className="wizard-body" ref={bodyRef}>
        <div className="stack" style={{ gap: 8 }}>
          {/* The welcome text is for the first start; in settings the step is just "Hem". */}
          <h1>{!firstRun && step.id === "hem" ? "Hem" : step.title}</h1>
          <p className="lead">{!firstRun && step.id === "hem" ? "Hushållets namn och var ni bor – det styr väder, sopor och elområde." : step.lead}</p>
        </div>
        <step.C {...props} />
        {error && (
          <div className="result bad" role="alert">
            {error}
          </div>
        )}
        </div>
        <div className="wizard-nav">
          <button className="btn" disabled={idx === 0 || saving} onClick={() => go(idx - 1)}>
            <Icon name="chevronLeft" size={20} /> Tillbaka
          </button>
          {last ? (
            <button className="btn primary" disabled={saving} onClick={finish}>
              {saving ? "Sparar…" : "Spara och visa tavlan"}
            </button>
          ) : (
            <button className="btn primary" disabled={saving} onClick={() => go(idx + 1)}>
              {saving ? "Sparar…" : step.optional && !stepHasData(cfg, step.id) ? "Hoppa över" : "Nästa"} <Icon name="chevronRight" size={20} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Has the user set anything up in this optional step? Decides "Nästa" vs "Hoppa över". */
function stepHasData(cfg: Config, id: string): boolean {
  const e = cfg.entities;
  const has = (cat: string) => cfg.integrations.some((i) => i.category === cat);
  switch (id) {
    case "hamta":
    case "huset":
      return e.cars.length + e.lights.length + e.climates.length + e.deviceCards.length + e.lightGroups.length + e.temps.length + (e.speakers ?? []).length > 0 || Object.values(e.energy).some(Boolean);
    case "skola":
      return has("school");
    case "sopor":
      return has("waste");
    case "inkop":
      return has("grocery") || cfg.shopping.source === "ha";
    case "el":
      return has("price");
    case "paminnelser":
      return cfg.people.some((p) => p.notify?.service);
    default:
      return true;
  }
}
