import { useEffect, useMemo, useState } from "react";
import type { Integration, IntegrationCategory, ManualPickup, ProviderField, ProviderMeta, TestResult } from "../../../server/src/types";
import { api, type EntityOption } from "../api";
import { Icon } from "../Icon";

export const uid = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 8)}`;

export const PALETTE = ["#c79bff", "#5ab8ff", "#f5c84b", "#ff8fa3", "#34e0a1", "#ff9f5a", "#7dd3fc", "#a3e635"];

// ---------- Simple fields ----------

export function Text({
  label,
  value,
  onChange,
  help,
  placeholder,
  type = "text",
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  help?: string;
  placeholder?: string;
  type?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type={type} inputMode={inputMode} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} autoComplete="off" />
      {help && <small>{help}</small>}
    </label>
  );
}

export function Select({
  label,
  value,
  onChange,
  options,
  help,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  help?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {help && <small>{help}</small>}
    </label>
  );
}

export function Toggle({ label, checked, onChange, help }: { label: string; checked: boolean; onChange: (v: boolean) => void; help?: string }) {
  return (
    <div className="row gap" style={{ minHeight: 48 }}>
      <div className="grow">
        <div>{label}</div>
        {help && <small className="faint">{help}</small>}
      </div>
      <label className="switch">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-label={label} />
        <span />
      </label>
    </div>
  );
}

/** Comma-separated words ↔ string[] */
export function Words({ label, value, onChange, help, placeholder }: { label: string; value?: string[]; onChange: (v: string[]) => void; help?: string; placeholder?: string }) {
  const [text, setText] = useState((value ?? []).join(", "));
  return (
    <Text
      label={label}
      value={text}
      placeholder={placeholder}
      help={help}
      onChange={(t) => {
        setText(t);
        onChange(
          t
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        );
      }}
    />
  );
}

export function Result({ result, error }: { result?: TestResult | null; error?: string }) {
  if (error) return <div className="result bad" role="alert">{error}</div>;
  if (!result) return null;
  return (
    <div className="result" role="status">
      {result.message && <b>{result.message}</b>}
      {result.preview && result.preview.length > 0 && (
        <ul>
          {result.preview.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------- Entity picker ----------

const entityCache = new Map<string, Promise<EntityOption[]>>();
function loadEntities(domains: string[]) {
  const k = domains.join(",");
  if (!entityCache.has(k)) entityCache.set(k, api.entities(domains).catch((e) => {
    entityCache.delete(k);
    throw e;
  }));
  return entityCache.get(k)!;
}
export function clearEntityCache() {
  entityCache.clear();
}

export function EntityPicker({
  label,
  domains,
  value,
  onChange,
  help,
  optional = true,
  units,
}: {
  label: string;
  domains: string[];
  value?: string;
  onChange: (v: string | undefined, option?: EntityOption) => void;
  help?: string;
  optional?: boolean;
  /** Only sensors with these units (e.g. W/kW for power), the rest behind "Visa alla". */
  units?: RegExp;
}) {
  const [loaded, setAll] = useState<EntityOption[]>([]);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [every, setEvery] = useState(false);
  // Sensors that answer with a value first, those saying "unknown"/"unavailable" last.
  const all = useMemo(() => {
    const fits = units && !every ? loaded.filter((e) => units.test(e.unit ?? "") || e.entityId === value) : loaded;
    const live = (e: EntityOption) => (["unknown", "unavailable", ""].includes(e.state) ? 1 : 0);
    return [...fits].sort((a, b) => live(a) - live(b) || a.name.localeCompare(b.name, "sv"));
  }, [loaded, units, every, value]);
  useEffect(() => {
    loadEntities(domains)
      .then(setAll)
      .catch((e: Error) => setError(e.message));
  }, [domains.join(",")]);
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    const list = t ? all.filter((e) => `${e.name} ${e.entityId}`.toLowerCase().includes(t)) : all;
    const sel = all.find((e) => e.entityId === value);
    return sel && !list.includes(sel) ? [sel, ...list] : list;
  }, [all, q, value]);
  return (
    <div className="field entity-picker">
      <span>{label}</span>
      {(all.length > 12 || loaded.length > 12) && <input placeholder="Sök, t.ex. tibber eller solaredge…" value={q} onChange={(e) => setQ(e.target.value)} aria-label={`Sök ${label}`} />}
      <select
        value={value ?? ""}
        aria-label={label}
        onChange={(e) => {
          const o = all.find((x) => x.entityId === e.target.value);
          onChange(e.target.value || undefined, o);
        }}
      >
        {optional && <option value="">– Ingen –</option>}
        {shown.slice(0, 300).map((e) => (
          <option key={e.entityId} value={e.entityId}>
            {e.name} · {e.state}
            {e.unit ? ` ${e.unit}` : ""}
          </option>
        ))}
      </select>
      {units && loaded.length > all.length && (
        <button type="button" className="btn small ghost" style={{ alignSelf: "flex-start" }} onClick={() => setEvery(!every)}>
          {every ? "Visa bara de som passar" : `Visa alla (${loaded.length})`}
        </button>
      )}
      {error ? <small className="error-text">{error}</small> : help && <small>{help}</small>}
    </div>
  );
}

export function MultiEntityPicker({ label, domains, value, onChange, help }: { label: string; domains: string[]; value: string[]; onChange: (v: string[]) => void; help?: string }) {
  const [all, setAll] = useState<EntityOption[]>([]);
  useEffect(() => {
    loadEntities(domains).then(setAll).catch(() => {});
  }, [domains.join(",")]);
  const name = (id: string) => all.find((e) => e.entityId === id)?.name ?? id;
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row gap wrap">
        {value.map((id) => (
          <span className="chip" key={id}>
            {name(id)}
            <button className="btn small ghost" style={{ minHeight: 28, padding: "0 6px" }} aria-label={`Ta bort ${name(id)}`} onClick={() => onChange(value.filter((v) => v !== id))}>
              <Icon name="x" size={14} />
            </button>
          </span>
        ))}
      </div>
      <EntityPicker
        label={label}
        domains={domains}
        value={undefined}
        help={help}
        onChange={(v) => {
          if (v && !value.includes(v)) onChange([...value, v]);
        }}
      />
    </div>
  );
}

// ---------- Manual waste schedule ----------

export function ScheduleRows({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const rows: ManualPickup[] = useMemo(() => {
    try {
      return JSON.parse(value || "[]");
    } catch {
      return [];
    }
  }, [value]);
  const set = (next: ManualPickup[]) => onChange(JSON.stringify(next));
  const today = new Date().toISOString().slice(0, 10);
  const MONTHS = ["jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
  return (
    <div className="stack">
      {rows.map((r, i) => (
        <div className="card" key={i} style={{ padding: 16 }}>
          <div className="grid-3">
            <Select
              label="Kärl"
              value={r.type}
              onChange={(v) => set(rows.map((x, j) => (j === i ? { ...x, type: v } : x)))}
              options={["Restavfall", "Matavfall", "Mat- och restavfall", "Plast & papper", "Glas & metall", "Trädgårdsavfall", "Kärl 1", "Kärl 2", r.type]
                .filter((v, k, a) => v && a.indexOf(v) === k)
                .map((v) => ({ value: v, label: v }))}
            />
            <label className="field">
              <span>En hämtdag</span>
              <input type="date" value={r.firstDate} onChange={(e) => set(rows.map((x, j) => (j === i ? { ...x, firstDate: e.target.value } : x)))} />
            </label>
            <Select
              label="Hur ofta"
              value={String(r.everyWeeks)}
              onChange={(v) => set(rows.map((x, j) => (j === i ? { ...x, everyWeeks: Number(v) } : x)))}
              options={[1, 2, 3, 4, 6, 8, 12].map((n) => ({ value: String(n), label: n === 1 ? "Varje vecka" : n === 2 ? "Varannan vecka" : `Var ${n}:e vecka` }))}
            />
          </div>
          <div className="row gap wrap">
            <span className="faint" style={{ fontSize: 14 }}>
              Bara månader (inget valt = hela året):
            </span>
            {MONTHS.map((m, k) => {
              const on = r.months?.includes(k + 1) ?? false;
              return (
                <button
                  key={m}
                  className={`btn small ${on ? "selected" : ""}`}
                  style={{ minHeight: 34, padding: "0 10px" }}
                  aria-pressed={on}
                  onClick={() => {
                    const ms = new Set(r.months ?? []);
                    on ? ms.delete(k + 1) : ms.add(k + 1);
                    set(rows.map((x, j) => (j === i ? { ...x, months: [...ms].sort((a, b) => a - b) } : x)));
                  }}
                >
                  {m}
                </button>
              );
            })}
            <button className="btn small ghost" aria-label="Ta bort kärl" onClick={() => set(rows.filter((_, j) => j !== i))}>
              <Icon name="trashSmall" size={18} /> Ta bort
            </button>
          </div>
        </div>
      ))}
      <button className="btn" onClick={() => set([...rows, { type: "Restavfall", firstDate: today, everyWeeks: 2 }])}>
        <Icon name="plus" size={20} /> Lägg till kärl
      </button>
    </div>
  );
}

// ---------- Generic provider form ----------

export interface SecretDraft {
  [secretKey: string]: string | null;
}

function FieldInput({
  f,
  integ,
  setting,
  setSetting,
  secretSet,
  secretValue,
  setSecretValue,
  choices,
}: {
  f: ProviderField;
  integ: Integration;
  setting: string;
  setSetting: (v: string) => void;
  secretSet: boolean;
  secretValue?: string;
  setSecretValue: (v: string) => void;
  choices?: { value: string; label: string }[];
}) {
  if (f.secret) {
    return (
      <Text
        label={f.label}
        type={f.type === "password" ? "password" : "text"}
        value={secretValue ?? ""}
        placeholder={secretSet ? "•••••• sparat – skriv för att byta" : f.placeholder}
        help={f.help}
        onChange={setSecretValue}
      />
    );
  }
  if (f.type === "select") {
    const opts = choices ?? f.options ?? [];
    return (
      <Select
        label={f.label}
        value={setting}
        help={f.help}
        onChange={setSetting}
        options={[...(f.optional || !setting ? [{ value: "", label: "– Välj –" }] : []), ...opts]}
      />
    );
  }
  if (f.type === "entity") return <EntityPicker label={f.label} domains={f.domains ?? []} value={setting || undefined} help={f.help} onChange={(v) => setSetting(v ?? "")} />;
  if (f.type === "schedule") return <ScheduleRows value={setting} onChange={setSetting} />;
  if (f.type === "toggle") return <Toggle label={f.label} checked={setting === "true"} onChange={(v) => setSetting(String(v))} help={f.help} />;
  return <Text label={f.label} value={setting} placeholder={f.placeholder} help={f.help} type={f.type === "number" ? "number" : f.type === "url" ? "url" : "text"} onChange={setSetting} />;
}

/**
 * Draws a provider's form from its meta.fields, keeps typed secrets in `secrets` until save,
 * and runs the provider's own test. Results can feed choices back into a field (e.g. the
 * addresses found at the waste provider) and discovered names (children in Vklass).
 */
export function ProviderForm({
  meta,
  integ,
  onChange,
  secrets,
  setSecrets,
  secretsSet,
  extra,
  saveNow,
  verified,
}: {
  meta: ProviderMeta;
  integ: Integration;
  onChange: (i: Integration) => void;
  secrets: SecretDraft;
  setSecrets: (s: SecretDraft) => void;
  secretsSet: string[];
  extra?: (result: TestResult | null) => React.ReactNode;
  /** Saves the settings: a successful test saves by itself, and "Spara" next to Testa does it by hand. */
  saveNow?: () => Promise<void>;
  /** The saved details passed the last test. */
  verified?: boolean;
}) {
  const [saved, setSaved] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [choices, setChoices] = useState<Record<string, { value: string; label: string }[]>>({});
  const sk = (k: string) => `int.${integ.id}.${k}`;

  const test = async () => {
    setBusy(true);
    setError("");
    setResult(null);
    const typed: Record<string, string> = {};
    for (const f of meta.fields) if (f.secret && secrets[sk(f.key)]) typed[f.key] = secrets[sk(f.key)]!;
    try {
      const r = await api.testProvider(integ, typed);
      setResult(r);
      // A test that went well saves the settings at once (not while it still asks which building).
      if (r.ok && !r.choices && saveNow) {
        await saveNow();
        setSaved(true);
      }
      if (r.choices) {
        setChoices((c) => ({ ...c, [r.choices!.field]: r.choices!.options }));
        if (r.choices.options[0]) onChange({ ...integ, settings: { ...integ.settings, [r.choices.field]: r.choices.options[0].value } });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      {verified && (
        <div className="result connected-note" role="status">
          <b>✓ Inloggad hos {meta.name}.</b> Uppgifterna är sparade och fungerade vid senaste testet – ändra bara om du vill byta konto.
        </div>
      )}
      {meta.guide && (
        <ol className="guide">
          {meta.guide.map((g, i) => (
            <li key={i}>{g}</li>
          ))}
        </ol>
      )}
      {meta.fields.map((f) => {
        // EDP: the API URL field only matters for "Annan".
        if (f.key === "apiUrl" && integ.settings.municipality !== "custom") return null;
        if (f.key === "building" && !choices.building && !integ.settings.building) return null;
        if (meta.storePicker?.field === f.key)
          return (
            <StorePicker
              key={f.key}
              f={f}
              integ={integ}
              ready={!meta.storePicker.needsLogin || Boolean(verified)}
              typed={meta.fields.filter((x) => x.secret && secrets[sk(x.key)]).reduce<Record<string, string>>((o, x) => ({ ...o, [x.key]: secrets[sk(x.key)]! }), {})}
              value={String(integ.settings[f.key] ?? "")}
              onPick={(v) => onChange({ ...integ, settings: { ...integ.settings, [f.key]: v } })}
            />
          );
        return (
          <FieldInput
            key={f.key}
            f={f}
            integ={integ}
            setting={String(integ.settings[f.key] ?? f.default ?? "")}
            setSetting={(v) => {
              const settings = { ...integ.settings, [f.key]: v };
              // Changing the address invalidates the chosen building.
              if (f.key === "address" || f.key === "municipality") delete settings.building;
              onChange({ ...integ, settings });
            }}
            secretSet={secretsSet.includes(sk(f.key))}
            secretValue={secrets[sk(f.key)] ?? undefined}
            setSecretValue={(v) => setSecrets({ ...secrets, [sk(f.key)]: v })}
            choices={choices[f.key] ?? (f.key === "building" && integ.settings.building ? [{ value: String(integ.settings.building), label: String(integ.settings.building) }] : undefined)}
          />
        );
      })}
      <div className="row gap">
        <button className="btn" onClick={test} disabled={busy}>
          {busy ? "Testar…" : "Testa"}
        </button>
        {saveNow && (
          <button
            className="btn"
            disabled={busy}
            onClick={async () => {
              setError("");
              try {
                await saveNow();
                setSaved(true);
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            Spara
          </button>
        )}
        {saved && <span className="badge stable">Sparat ✓</span>}
        {busy && <small className="faint">Loggar in via en dold webbläsare – kan ta upp till en minut.</small>}
        {meta.status !== "stable" && <span className={`badge ${meta.status}`}>{meta.status === "beta" ? "Beta" : "Experimentell"}</span>}
      </div>
      <Result result={result} error={error} />
      {extra?.(result)}
    </div>
  );
}

/** Pick one provider per category (or several, for school) with tiles + the form. */
export function ProviderTiles({
  providers,
  category,
  selected,
  onSelect,
  allowNone,
  haAvailable,
  connected,
}: {
  providers: ProviderMeta[];
  category: IntegrationCategory;
  selected?: string;
  /** The provider whose sign-in details are saved: its tile says so. */
  connected?: string;
  onSelect: (id: string | null) => void;
  allowNone?: string;
  haAvailable: boolean;
}) {
  return (
    <div className="tiles">
      {allowNone && (
        <button className={`tile ${!selected ? "selected" : ""}`} onClick={() => onSelect(null)} aria-pressed={!selected}>
          <b>{allowNone}</b>
          <small>Hoppa över just nu</small>
        </button>
      )}
      {providers
        .filter((p) => p.category === category)
        .map((p) => (
          <button
            key={p.id}
            className={`tile ${selected === p.id ? "selected" : ""} ${connected === p.id ? "connected" : ""}`}
            aria-pressed={selected === p.id}
            disabled={p.needsHa && !haAvailable}
            onClick={() => onSelect(p.id)}
          >
            <b>{p.name}</b>
            <small>{p.needsHa && !haAvailable ? "Kräver Home Assistant" : p.description}</small>
            <span className="row gap" style={{ flexWrap: "wrap" }}>
              {connected === p.id && <span className="badge stable">✓ Inloggad</span>}
              {p.status !== "stable" && <span className={`badge ${p.status}`}>{p.status === "beta" ? "Beta" : "Experimentell"}</span>}
            </span>
          </button>
        ))}
    </div>
  );
}

/** Pick a shop from the ones the provider lists (several in every town). The list is fetched once the sign-in works. */
function StorePicker({ f, integ, ready, typed, value, onPick }: { f: ProviderField; integ: Integration; ready: boolean; typed: Record<string, string>; value: string; onPick: (v: string) => void }) {
  const [options, setOptions] = useState<{ value: string; label: string }[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    api
      .providerStores(integ, typed)
      .then((o) => alive && setOptions(o))
      .catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, integ.id, integ.provider]);
  if (!ready) return <p className="faint">{f.label}: logga in först (tryck Testa) – då kan du välja butik i en lista.</p>;
  if (error || !options) return error ? <Text label={f.label} value={value} placeholder={f.placeholder} help={`${error} – skriv orten i stället.`} onChange={onPick} /> : <p className="faint" role="status">Hämtar butiker…</p>;
  const known = options.some((o) => o.value === value);
  return (
    <Select
      label={f.label}
      value={value}
      onChange={onPick}
      help={f.help}
      options={[{ value: "", label: "Automatiskt – orten där ni bor" }, ...(value && !known ? [{ value, label: value }] : []), ...options]}
    />
  );
}
