import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Dashboard } from "../../../server/src/types";
import { api } from "../api";
import { Icon } from "../Icon";
import { goBack, goHome } from "../route";
import type { Actions } from "./Dashboard";
import { Week, renderWidget } from "./Home";
import { Custody } from "../widgets/custody";
import { Reminders } from "../widgets/reminders";
import { Shopping } from "../widgets/shopping";
import { Fit } from "./Fit";

export type PageId = "maten" | "skolan" | "komihag" | "inkop" | "hososs" | "veckan" | "kort";

export const PAGE_TITLES: Record<PageId, string> = {
  maten: "Veckans mat",
  skolan: "Skolan",
  komihag: "Kom ihåg",
  inkop: "Inköpslista",
  hososs: "Hos oss",
  veckan: "Kommande 7 dagar",
  kort: "Alla kort",
};

/** Every page and tab: back, the title, and home – always in the same place. */
export function PageBar({ title }: { title: string }) {
  return (
    <div className="page-bar">
      <button className="btn" onClick={goBack} aria-label="Tillbaka">
        <Icon name="chevronLeft" size={22} /> Tillbaka
      </button>
      <h1 className="grow">{title}</h1>
      <button className="btn" onClick={goHome} aria-label="Till startsidan">
        <Icon name="home" size={22} /> Hem
      </button>
    </div>
  );
}

export function DetailPage({ page, data, actions }: { page: PageId; data: Dashboard; actions: Actions }) {
  return (
    <main className="detail-page">
      <PageBar title={PAGE_TITLES[page]} />
      <Fit className="detail-body" deps={[data, page]}>
        {page === "maten" && <MealsPage data={data} actions={actions} />}
        {page === "skolan" && <SchoolPage data={data} actions={actions} />}
        {page === "komihag" && <Reminders items={data.reminders} food={data.schoolFood} data={data} actions={actions} />}
        {page === "inkop" && <Shopping data={data} actions={actions} />}
        {page === "hososs" && <CustodyPage data={data} />}
        {page === "veckan" && <Week data={data} actions={actions} full />}
        {page === "kort" && (
          <div className="cards-grid">
            {data.home.filter((w) => w.on && w.id !== "now" && w.id !== "week").map((w) => renderWidget(w.id, data, actions, true))}
          </div>
        )}
      </Fit>
    </main>
  );
}

export function MealsPage({ data, actions }: { data: Dashboard; actions: Actions }) {
  return (
    <div className="stack">
      <div className="meals-grid">
      {data.meals.map((m) => (
        <section className="card meal-day-card" key={m.dayKey}>
          <h2>{m.dayLabel.charAt(0).toUpperCase() + m.dayLabel.slice(1)}</h2>
          {m.lunch.length ? (
            m.lunch.map((l) => (
              <div className="meal-line" key={l.child + l.dishes.join()}>
                <Icon name="school" size={20} />
                <span>
                  <b>{l.child ? `${l.child}: ` : "Lunch: "}</b>
                  {l.dishes.join(" · ")}
                </span>
              </div>
            ))
          ) : (
            <small className="muted">Ingen skollunch</small>
          )}
          <div className="meal-line">
            <Icon name="food" size={20} />
            <span>
              <b>Middag: </b>
              {m.dinner ?? <span className="muted">inte bestämt</span>}
            </span>
          </div>
        </section>
      ))}
      </div>
      <button className="btn primary" style={{ alignSelf: "flex-start" }} onClick={() => actions.openPlan("food")}>
        <Icon name="food" size={20} /> Planera veckans middagar
      </button>
    </div>
  );
}

const KIND_LABEL = { läxa: "Läxa", prov: "Prov", inlämning: "Inlämning", uppgift: "Uppgift" } as const;

type Task = NonNullable<Dashboard["school"]>[number]["tasks"][number];

/** Everything about one homework/test: when, the teacher's text, and a link to the school platform. */
function TaskSheet({ task, child, onClose }: { task: Task; child: string; onClose: () => void }) {
  return (
    <OnTop>
    <div className="overlay" onClick={onClose}>
      <div className="sheet task-sheet" role="dialog" aria-modal="true" aria-label={task.title} onClick={(e) => e.stopPropagation()} style={{ maxWidth: 680 }}>
        <div className="row gap">
          <span className={`task-kind kind-${task.kind}`}>{KIND_LABEL[task.kind]}</span>
          <h2 className="grow" style={{ fontSize: 24 }}>
            {task.title}
          </h2>
          <button className="btn icon" aria-label="Stäng" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
        <div className="row gap" style={{ fontSize: 17 }}>
          <Icon name="event" size={20} />
          <span>
            {child} · {task.label[0].toUpperCase() + task.label.slice(1)}
            {task.time ? ` ${task.time}` : ""}
          </span>
        </div>
        {task.detail ? <div className="task-detail">{task.detail}</div> : <p className="muted">Ingen beskrivning från skolan.</p>}
        {task.url && (
          <a className="btn" href={task.url} target="_blank" rel="noreferrer" style={{ alignSelf: "flex-start" }}>
            Öppna i Vklass <Icon name="chevronRight" size={18} />
          </a>
        )}
      </div>
    </div>
    </OnTop>
  );
}

type News = Dashboard["schoolNews"][number];

/** Sheets open on top of everything – not inside the page, which may be scaled to fit. */
const OnTop = ({ children }: { children: ReactNode }) => createPortal(children, document.body);
const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const PICTURE = /\.(jpe?g|png|gif|webp|heic|svg)$/i;
/** A picture is shown in the news; a PDF, a document or a web link is a button to open it. */
const isPicture = (f: { name: string; url: string }) => PICTURE.test(f.name.trim()) || /^bild$/i.test(f.name.trim()) || f.url.startsWith("data:image/") || PICTURE.test(safeDecode(f.url).split(/[?#]/)[0]!);
const safeDecode = (u: string) => {
  try {
    return decodeURIComponent(u);
  } catch {
    return u;
  }
};

/** A news item from the school: all the text, pictures shown right in the sheet, and "Lägg i veckan". */
export function NewsSheet({ n, data, actions, onClose }: { n: News; data: Dashboard; actions: Actions; onClose: () => void }) {
  const [adding, setAdding] = useState(false);
  const kids = data.people.filter((p) => p.kind === "child");
  const [form, setForm] = useState({ date: todayKey(), time: "", end: "", title: n.title.slice(0, 80), who: n.who ?? "" });
  const [broken, setBroken] = useState<string[]>([]);
  const set = (k: keyof typeof form, v: string) => setForm({ ...form, [k]: v });
  const save = () =>
    actions.run("Lägg i veckan", async () => {
      await api.addOwnEvent({
        date: form.date,
        ...(form.time ? { time: form.time } : {}),
        ...(form.time && form.end ? { end: form.end } : {}),
        title: form.title.trim() || n.title.slice(0, 80),
        ...(personIdOf(data, form.who) ? { personId: personIdOf(data, form.who) } : {}),
        note: `Från skolan: ${n.title}`.slice(0, 500),
      });
      setAdding(false);
    }, { done: `${form.title.trim() || n.title} ligger i veckan`, check: () => true });
  return (
    <OnTop>
    <div className="overlay" onClick={onClose}>
      <div className="sheet news-sheet" role="dialog" aria-modal="true" aria-label={n.title} onClick={(e) => e.stopPropagation()} style={{ maxWidth: 720 }}>
        <div className="row gap" style={{ alignItems: "flex-start" }}>
          <h2 className="grow" style={{ fontSize: 24 }}>
            {n.title}
          </h2>
          <button className="btn icon" aria-label="Stäng" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
        <div className="row gap wrap muted" style={{ fontSize: 16 }}>
          {n.who && (
            <span className="row gap" style={{ gap: 6 }}>
              <span className="dot" style={{ background: n.color }} /> {n.who}
            </span>
          )}
          {n.date && <span>{n.date}</span>}
        </div>
        {n.text ? <div className="news-text">{n.text}</div> : <p className="muted">Ingen text – se bilagan.</p>}
        {n.files.map((f) =>
          // PDFs, documents and web links are buttons; pictures show right here.
          broken.includes(f.url) || !isPicture(f) ? (
            <a key={f.url} className="btn" href={f.url} target="_blank" rel="noreferrer" style={{ alignSelf: "flex-start" }}>
              <Icon name={/\.pdf$/i.test(f.name) ? "event" : "link"} size={18} /> Öppna {f.name}
            </a>
          ) : (
            <a key={f.url} href={f.url} target="_blank" rel="noreferrer" className="news-image">
              <img src={f.url} alt={f.name} loading="lazy" onError={() => setBroken((b) => [...b, f.url])} />
            </a>
          ),
        )}
        {!adding ? (
          <button className="btn primary" style={{ alignSelf: "flex-start" }} onClick={() => setAdding(true)}>
            <Icon name="plus" size={18} /> Lägg i veckan
          </button>
        ) : (
          <div className="news-add stack" style={{ gap: 10 }}>
            <label className="field">
              <span>Vad</span>
              <input value={form.title} maxLength={80} onChange={(e) => set("title", e.target.value)} />
            </label>
            <div className="grid-2">
              <label className="field">
                <span>Dag</span>
                <input type="date" value={form.date} onChange={(e) => e.target.value && set("date", e.target.value)} />
              </label>
              <label className="field">
                <span>Vem</span>
                <select aria-label="Vem" value={form.who} onChange={(e) => set("who", e.target.value)}>
                  <option value="">Hela familjen</option>
                  {kids.map((k) => (
                    <option key={k.name} value={k.name}>
                      {k.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Från (valfritt)</span>
                <input type="time" value={form.time} onChange={(e) => set("time", e.target.value)} />
              </label>
              <label className="field">
                <span>Till</span>
                <input type="time" value={form.end} disabled={!form.time} onChange={(e) => set("end", e.target.value)} />
              </label>
            </div>
            <div className="row gap">
              <button className="btn primary" onClick={save}>
                Spara i veckan
              </button>
              <button className="btn ghost" onClick={() => setAdding(false)}>
                Avbryt
              </button>
            </div>
            <small className="faint">Med en tid och ett barn kommer den med i Planera veckan, så ni kan välja vem som skjutsar.</small>
          </div>
        )}
      </div>
    </div>
    </OnTop>
  );
}

const personIdOf = (data: Dashboard, name: string) => data.people.find((p) => p.name === name)?.id;

/** "Från skolan": one compact row (the newest, unread first); tap for the list and each news item. */
function SchoolNewsCard({ data, actions }: { data: Dashboard; actions: Actions }) {
  const [open, setOpen] = useState<News | null>(null);
  const [list, setList] = useState(false);
  const news = data.schoolNews ?? [];
  if (!news.length) return null;
  const unread = news.filter((n) => !n.seen);
  const top = unread[0] ?? news[0];
  const show = (n: News) => {
    setOpen(n);
    setList(false);
    if (!n.seen) api.newsSeen([n.id]).then(() => actions.refresh()).catch(() => {});
  };
  const row = (n: News) => (
    <button className="task-row news-row" key={n.id} onClick={() => show(n)}>
      {!n.seen && <span className="news-new" aria-label="oläst" />}
      <span className="grow task-title">{n.title}</span>
      <small className="muted news-meta">{[n.who, n.date].filter(Boolean).join(" · ")}</small>
      <Icon name="chevronRight" size={18} />
    </button>
  );
  return (
    <section className="card news-card">
      <button className="news-strip" onClick={() => (news.length > 1 ? setList(true) : show(top))} aria-label={`Från skolan: ${news.length} nyheter, ${unread.length} olästa`}>
        <b className="news-label">Från skolan</b>
        {!top.seen && <span className="news-new" aria-hidden="true" />}
        <span className="grow task-title">{top.title}</span>
        {news.length > 1 && <span className="plan-count">{unread.length || news.length}</span>}
        <Icon name="chevronRight" size={18} />
      </button>
      {list && (
        <OnTop>
          <div className="overlay" onClick={() => setList(false)}>
            <div className="sheet" role="dialog" aria-modal="true" aria-label="Nyheter från skolan" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 720 }}>
              <div className="row gap">
                <h2 className="grow" style={{ fontSize: 24 }}>
                  Från skolan
                </h2>
                <button className="btn icon" aria-label="Stäng" onClick={() => setList(false)}>
                  <Icon name="x" />
                </button>
              </div>
              {news.map(row)}
            </div>
          </div>
        </OnTop>
      )}
      {open && <NewsSheet n={open} data={data} actions={actions} onClose={() => setOpen(null)} />}
    </section>
  );
}

function SchoolPage({ data, actions }: { data: Dashboard; actions: Actions }) {
  const kids = data.school ?? [];
  const [who, setWho] = useState(kids[0]?.personId ?? "");
  const [open, setOpen] = useState<Task | null>(null);
  if (!kids.length) {
    return (
      <div className="stack">
      <SchoolNewsCard data={data} actions={actions} />
      <section className="card">
        <p className="muted">
          Inget skolschema hittades. Lägg till skolan under Inställningar → Skola (Vklass, SchoolSoft eller kalenderlänk), så visas dagens schema,
          veckan och läxorna här.
        </p>
      </section>
      </div>
    );
  }
  const kid = kids.find((k) => k.personId === who) ?? kids[0];
  const today = kid.days.find((d) => d.today);
  return (
    <div className="stack">
      <div className="school-top">
      {kids.length > 1 && (
        <div className="seg" role="tablist" aria-label="Barn">
          {kids.map((k) => (
            <button key={k.personId} role="tab" aria-selected={k.personId === kid.personId} className={`seg-btn ${k.personId === kid.personId ? "on" : ""}`} onClick={() => setWho(k.personId)}>
              <span className="dot" style={{ background: k.color }} /> {k.name}
            </button>
          ))}
        </div>
      )}
      <SchoolNewsCard data={data} actions={actions} />
      </div>
      <div className="school-grid">
        <section className="card">
          <h2>{today ? "Idag" : "Nästa skoldag"}</h2>
          {data.lessonView === "span" ? <DaySpan lessons={(today ?? kid.days.find((d) => d.lessons.length))?.lessons ?? []} /> : <Lessons lessons={(today ?? kid.days.find((d) => d.lessons.length))?.lessons ?? []} />}
        </section>
        <section className="card">
          <h2>Läxor och uppgifter</h2>
          {kid.tasks.length ? (
            kid.tasks.map((t, i) => (
              <button className="task-row" key={i} onClick={() => setOpen(t)}>
                <span className={`task-kind kind-${t.kind}`}>{KIND_LABEL[t.kind]}</span>
                <span className="grow task-title">{t.title}</span>
                <small className="muted">{t.label}</small>
                <Icon name="chevronRight" size={18} />
              </button>
            ))
          ) : (
            <small className="muted">Inget de närmaste två veckorna – eller så lägger skolan inte ut läxor i kalendern.</small>
          )}
        </section>
      </div>
      <section className="card">
        <h2>Veckan</h2>
        <div className="school-week">
          {kid.days.map((d) => (
            <div className={`school-day ${d.today ? "today" : ""}`} key={d.dayKey}>
              <b>{d.label}</b>
              {d.lessons.length ? (
                <>
                  <small className="muted">
                    {d.lessons[0].start}–{d.lessons[d.lessons.length - 1].end}
                    {d.lessons.some((l) => l.gym) ? " · Idrott" : ""}
                  </small>
                  {data.lessonView !== "span" && <Lessons lessons={d.lessons} compact />}
                </>
              ) : (
                <small className="muted">Ingen skola</small>
              )}
            </div>
          ))}
        </div>
      </section>
      {open && <TaskSheet task={open} child={kid.name} onClose={() => setOpen(null)} />}
    </div>
  );
}

/** Only when the school day starts and ends – for families who don't need every lesson. */
function DaySpan({ lessons }: { lessons: NonNullable<Dashboard["school"]>[number]["days"][number]["lessons"] }) {
  if (!lessons.length) return <small className="muted">Ingen skola</small>;
  const gym = lessons.some((l) => l.gym);
  return (
    <div className="day-span">
      <div>
        <small className="muted">Börjar</small>
        <b>{lessons[0]!.start}</b>
      </div>
      <div>
        <small className="muted">Slutar</small>
        <b>{lessons[lessons.length - 1]!.end}</b>
      </div>
      {gym && <span className="chip">Idrott – gympapåse</span>}
    </div>
  );
}

function Lessons({ lessons, compact = false }: { lessons: NonNullable<Dashboard["school"]>[number]["days"][number]["lessons"]; compact?: boolean }) {
  if (!lessons.length) return <small className="muted">Inga lektioner</small>;
  return (
    <div className={`lessons ${compact ? "compact" : ""}`}>
      {lessons.map((l, i) => (
        <div className="lesson" key={i}>
          <span className="lesson-time">
            {l.start}
            {!compact && `–${l.end}`}
          </span>
          <span className="grow">
            {l.title}
            {l.gym && !/idrott/i.test(l.title) && <span className="gym"> Idrott</span>}
          </span>
          {!compact && l.location && <small className="muted">{l.location}</small>}
        </div>
      ))}
    </div>
  );
}

function CustodyPage({ data }: { data: Dashboard }) {
  const c = data.custody;
  if (!c) return <p className="muted">Inga barn bor växelvis.</p>;
  const start = new Date();
  const label = (i: number) => {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    return { wd: ["S", "M", "T", "O", "T", "F", "L"][d.getDay()], date: d.getDate(), monday: d.getDay() === 1 };
  };
  return (
    <div className="stack">
      <Custody c={c} />
      <div className="custody-cals">
      {c.calendar?.map((k) => (
        <section className="card" key={k.name}>
          <h2>
            <span className="dot" style={{ background: k.color }} /> {k.name} – kommande fyra veckor
          </h2>
          <div className="custody-strip" role="list">
            <span className="cday-head">M</span>
            <span className="cday-head">T</span>
            <span className="cday-head">O</span>
            <span className="cday-head">T</span>
            <span className="cday-head">F</span>
            <span className="cday-head">L</span>
            <span className="cday-head">S</span>
            {/* Start the grid on Monday so each row is a week. */}
            {Array.from({ length: (start.getDay() + 6) % 7 }, (_, i) => (
              <span key={`pad${i}`} aria-hidden="true" />
            ))}
            {k.days.map((home, i) => {
              const l = label(i);
              return (
                <div key={i} role="listitem" className={`cday ${home ? "home" : "away"} ${l.monday ? "monday" : ""}`} title={home ? "Hos oss" : "I andra hemmet"}>
                  <b>{l.date}</b>
                </div>
              );
            })}
          </div>
          <small className="muted">Färgad = hos oss · ljus = i andra hemmet</small>
        </section>
      ))}
      </div>
    </div>
  );
}
