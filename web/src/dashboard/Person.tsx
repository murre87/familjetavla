import { useEffect, useMemo, useState } from "react";
import type { DashEvent, Dashboard } from "../../../server/src/types";
import { Icon } from "../Icon";
import { navigate } from "../route";
import { Avatar } from "./bits";
import { PageBar, TaskSheet, rangeLabel, type Task } from "./Detail";
import { api } from "../api";
import { Fit } from "./Fit";
import { BOX_TITLE, BoxGear, BoxSheet } from "./BoxSheet";
import { boxClass, useBoxPrefs } from "../boxprefs";
import { useLongPress } from "../longpress";

// "Personvyn": tryck på ett namn i toppen och se allt som gäller just den personen de kommande sju dagarna –
// skolans start och sluttid, gympadagar, läxor och prov, träningar och matcher (med tider och skjuts) samt maten.

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Händelser som gäller personen (kalenderns "Gäller", ägare eller namn i titeln) – och de som gäller hela familjen. */
export function personEvents(events: DashEvent[], person: { name: string; initial: string }) {
  const own = (e: DashEvent) => (e.whoAll ? e.whoAll.includes(person.name) : e.who ? e.who === person.name : e.initial === person.initial);
  const family = (e: DashEvent) => !e.whoAll && !e.who && !e.initial && e.category === "family";
  const mine = events.filter((e) => e.category !== "waste" && own(e));
  return { mine, family: events.filter((e) => e.category !== "waste" && !own(e) && family(e)) };
}

/** Skoldagens start och slut ur lektionerna (första start, sista slut). */
export function schoolSpan(lessons: { start: string; end: string }[]) {
  if (!lessons.length) return null;
  const starts = lessons.map((l) => l.start).sort();
  const ends = lessons.map((l) => l.end).sort();
  return { start: starts[0]!, end: ends[ends.length - 1]! };
}

const KIND_LABEL: Record<string, string> = { läxa: "Läxa", prov: "Prov", inlämning: "Inlämning", uppgift: "Uppgift" };

export function PersonPage({ data, personId, onOpenEvent }: { data: Dashboard; personId: string; onOpenEvent?: (e: DashEvent & { dayLabel?: string }) => void }) {
  const [openTask, setOpenTask] = useState<Task | null>(null);
  const [sheet, setSheet] = useState(false);
  // Hold the week for its own settings (text size, days, only homework / activities, density) on this screen.
  const { prefs } = useBoxPrefs();
  const pref = prefs.person;
  const hold = useLongPress(() => setSheet(true));
  const person = data.people.find((p) => p.id === personId);
  const kid = (data.school ?? []).find((k) => k.personId === personId);
  const show = pref?.show;
  // Every day of theirs (default, also at the other home) or only the days with us; a week at a time up to eight ahead.
  const everyDay = pref?.scope !== "home";
  const [page, setPage] = useState(0);
  const [fetched, setFetched] = useState<Record<string, Dashboard["days"]>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const fetchKey = `${personId}:${everyDay ? "all" : "home"}:${page}`;
  const needsFetch = everyDay || page > 0;
  useEffect(() => {
    if (!needsFetch || fetched[fetchKey]) return;
    let alive = true;
    setLoadError(null);
    (everyDay ? api.personDays(personId, page) : api.calendar(page))
      .then((r) => alive && setFetched((f) => ({ ...f, [fetchKey]: r.days })))
      .catch((e) => alive && setLoadError((e as Error).message || "Kunde inte hämta dagarna."));
    return () => {
      alive = false;
    };
  }, [fetchKey, needsFetch, everyDay, personId, page, fetched]);
  // While the first fetch of every day is on its way the board's own days show (so the page is never empty).
  const pageDays = needsFetch ? fetched[fetchKey] ?? (page === 0 ? data.days : undefined) : data.days;
  const chosen = useMemo(() => (pageDays && pref?.days ? pageDays.slice(0, pref.days) : pageDays ?? []), [pageDays, pref?.days]);
  const shown = useMemo(() => new Set(chosen.map((d) => d.key)), [chosen]);
  if (!person) {
    return (
      <main className="detail-page">
        <PageBar title="Personen hittades inte" />
        <p className="muted">Välj en person i toppen.</p>
      </main>
    );
  }
  // Homework on days that are not shown (fewer days chosen) moves to "Längre fram" instead of vanishing.
  // "Show only …": days with nothing of that kind give their room to the others (today always stays).
  const hasHit = (d: (typeof chosen)[number]) =>
    show === "tasks" ? (kid?.tasks ?? []).some((t) => t.dayKey === d.key) : personEvents(d.events, person).mine.some((e) => e.category === "sport");
  const days = show ? chosen.filter((d) => d.isToday || hasHit(d)) : chosen;
  const later = show === "activities" || page > 0 ? [] : (kid?.tasks ?? []).filter((t) => !shown.has(t.dayKey)).slice(0, 6);
  return (
    <main className="detail-page person-page">
      <PageBar title={`${person.name}s vecka`} />
      <div className="person-switch" role="tablist" aria-label="Vem">
        {data.people.map((p) => (
          <button key={p.id} role="tab" aria-selected={p.id === personId} className={`seg-btn ${p.id === personId ? "on" : ""}`} onClick={() => navigate(`/person/${p.id}`)}>
            <Avatar initial={p.initial} color={p.color} name={p.name} /> {p.name}
          </button>
        ))}
        <span className="grow" />
        <BoxGear title={BOX_TITLE.person} onOpen={() => setSheet(true)} inline />
      </div>
      <div className="cal-nav" role="group" aria-label={`Bläddra i ${person.name}s veckor`}>
        <button className="btn" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} aria-label="Tidigare vecka">
          <Icon name="chevronLeft" size={22} /> Tidigare
        </button>
        <b className="grow cal-range" aria-live="polite">
          {page === 0 ? "Kommande 7 dagar" : pageDays ? rangeLabel(pageDays) : "Hämtar …"}
          {everyDay ? "" : " · bara dagar hos oss"}
        </b>
        {page > 0 && (
          <button className="btn" onClick={() => setPage(0)} aria-label="Tillbaka till den här veckan">
            Nu
          </button>
        )}
        <button className="btn" onClick={() => setPage((p) => Math.min(8, p + 1))} disabled={page === 8} aria-label="Senare vecka">
          Senare <Icon name="chevronRight" size={22} />
        </button>
      </div>
      {loadError && !pageDays && <p className="muted">{loadError}</p>}
      <Fit className="detail-body person-fit" deps={[data, personId, pref]} min={0.55} base={pref?.size} noShrink>
      <div className={`person-days ${boxClass(pref)}`} {...hold}>
        {days.map((d) => {
          const { mine: allEvents, family: allFam } = personEvents(d.events, person);
          const sd = kid?.days.find((x) => x.dayKey === d.key);
          // "Bara läxor" shows only the school's tasks, "Bara träningar och matcher" only sport: nothing else that day.
          // When school ends: from the day itself (every day, also further on and at the other home), as the box setting says.
          const end = show || pref?.schoolEnd === "off" ? undefined : d.schoolEnds?.find((x) => x.name === person.name);
          const endShown = end && !(pref?.schoolEnd === "home" && !end.home) ? end : undefined;
          const span = endShown ? { end: endShown.end } : !d.schoolEnds && sd && !show && pref?.schoolEnd !== "off" ? schoolSpan(sd.lessons) : null;
          const gym = endShown ? endShown.gym : sd?.lessons.some((l) => l.gym);
          // A child's day at the other home is shown too (setting "Dagar"), marked so.
          const away = person.kind === "child" && !d.childrenHome.includes(person.name);
          const tasks = show === "activities" ? [] : (kid?.tasks ?? []).filter((t) => t.dayKey === d.key);
          // A homework that is also an all-day item in the calendar is shown once (as the homework).
          const events = show === "tasks" ? [] : allEvents.filter((e) => !tasks.some((t) => t.title === e.title) && (show !== "activities" || e.category === "sport"));
          const famEvents = show ? [] : allFam;
          const meal = show ? undefined : (data.meals ?? []).find((m) => m.dayKey === d.key);
          const lunch = meal?.lunch.filter((l) => !l.child || l.child === person.name) ?? [];
          const dinnerTwice = Boolean(meal?.dinner && famEvents.some((e) => e.title === `Middag: ${meal.dinner}`));
          const empty = !span && !events.length && !famEvents.length && !tasks.length && !lunch.length;
          return (
            <section className={`card person-day ${d.isToday ? "today" : ""}`} key={d.key}>
              <h2>
                {cap(d.name)} <small className="muted">{d.date}</small>
                {away && <small className="p-away">hos den andra föräldern</small>}
              </h2>
              {span && (
                <div className="p-line">
                  <Icon name="school" size={20} />
                  <span>
                    <b>Skolan slutar {span.end}</b>
                    {gym && <span className="p-badge gym"> <Icon name="gym" size={14} /> Gympa – ta med gymkläder</span>}
                  </span>
                </div>
              )}
              {tasks.map((t, i) => (
                <button className={`p-line task ${t.kind} p-click`} key={i} onClick={() => setOpenTask(t)} aria-label={`${KIND_LABEL[t.kind] ?? "Uppgift"}: ${t.title} – visa mer`}>
                  <Icon name={t.kind === "prov" ? "alert" : "check"} size={20} />
                  <span>
                    <b>{KIND_LABEL[t.kind] ?? "Uppgift"}:</b> {t.title}
                    {t.time ? ` · ${t.time}` : ""}
                    {t.files?.length ? <small className="p-more p-file">📎 {t.files.map((f) => f.name).join(", ")}</small> : null}
                    {t.detail && <small className="p-more">{t.detail.split("\n").map((l) => l.trim().replace(/ \| /g, " – ")).filter(Boolean).join(" · ").slice(0, 240)}</small>}
                  </span>
                  <Icon name="chevronRight" size={18} />
                </button>
              ))}
              {events.map((e, i) => (
                <div className={`p-line ${onOpenEvent ? "p-click" : ""}`} key={i} role={onOpenEvent ? "button" : undefined} tabIndex={onOpenEvent ? 0 : undefined} onClick={() => onOpenEvent?.({ ...e, dayLabel: d.name.toLowerCase() })} onKeyDown={(ev) => ev.key === "Enter" && onOpenEvent?.({ ...e, dayLabel: d.name.toLowerCase() })}>
                  <Icon name={e.icon === "event" ? "calendar" : e.icon} size={20} />
                  <span>
                    <b>{e.time ? `${e.time}${e.end ? `–${e.end}` : ""}` : "Heldag"}</b> {e.title}
                    {e.location ? <small className="muted"> · {e.location}</small> : null}
                    {e.travel && (e.travel.to || e.travel.home) ? (
                      <small className="muted">
                        {" "}
                        · {[e.travel.to ? `dit: ${e.travel.to.label}` : "", e.travel.home ? `hem: ${e.travel.home.label}` : ""].filter(Boolean).join(", ")}
                      </small>
                    ) : null}
                  </span>
                </div>
              ))}
              {famEvents.map((e, i) => (
                <div className="p-line fam" key={`f${i}`}>
                  <Icon name={e.icon === "event" ? "calendar" : e.icon} size={20} />
                  <span>
                    <small className="muted">Familjen:</small> <b>{e.time ? `${e.time}${e.end ? `–${e.end}` : ""}` : ""}</b> {e.title}
                  </span>
                </div>
              ))}
              {lunch.map((l, i) => (
                <div className="p-line meal" key={i}>
                  <Icon name="food" size={20} />
                  <span>
                    <b>Lunch:</b> {l.dishes.join(" · ")}
                  </span>
                </div>
              ))}
              {meal?.dinner && !dinnerTwice && (
                <div className="p-line meal">
                  <Icon name="food" size={20} />
                  <span>
                    <b>Middag:</b> {meal.dinner}
                  </span>
                </div>
              )}
              {empty && !meal?.dinner && <small className="muted">Inget inplanerat</small>}
            </section>
          );
        })}
      </div>
      </Fit>
      {later.length > 0 && (
        <section className="card person-later">
          <h2>Längre fram</h2>
          {later.map((t, i) => (
            <button className={`p-line task ${t.kind} p-click`} key={i} onClick={() => setOpenTask(t)}>
              <Icon name={t.kind === "prov" ? "alert" : "check"} size={20} />
              <span>
                <b>{KIND_LABEL[t.kind] ?? "Uppgift"} {t.label}:</b> {t.title}
              </span>
              <Icon name="chevronRight" size={18} />
            </button>
          ))}
        </section>
      )}
      {sheet && <BoxSheet id="person" onClose={() => setSheet(false)} />}
      {openTask && <TaskSheet task={openTask} child={person.name} onClose={() => setOpenTask(null)} />}
    </main>
  );
}
