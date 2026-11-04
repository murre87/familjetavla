import { useMemo, useState } from "react";
import type { DashEvent, Dashboard } from "../../../server/src/types";
import { Icon } from "../Icon";
import { navigate } from "../route";
import { Avatar } from "./bits";
import { PageBar, TaskSheet, type Task } from "./Detail";
import { Fit } from "./Fit";

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
  const person = data.people.find((p) => p.id === personId);
  const kid = (data.school ?? []).find((k) => k.personId === personId);
  const days = data.days;
  const shown = useMemo(() => new Set(days.map((d) => d.key)), [days]);
  if (!person) {
    return (
      <main className="detail-page">
        <PageBar title="Personen hittades inte" />
        <p className="muted">Välj en person i toppen.</p>
      </main>
    );
  }
  const later = (kid?.tasks ?? []).filter((t) => !shown.has(t.dayKey)).slice(0, 6);
  return (
    <main className="detail-page person-page">
      <PageBar title={`${person.name}s vecka`} />
      <div className="person-switch" role="tablist" aria-label="Vem">
        {data.people.map((p) => (
          <button key={p.id} role="tab" aria-selected={p.id === personId} className={`seg-btn ${p.id === personId ? "on" : ""}`} onClick={() => navigate(`/person/${p.id}`)}>
            <Avatar initial={p.initial} color={p.color} name={p.name} /> {p.name}
          </button>
        ))}
      </div>
      <Fit className="detail-body person-fit" deps={[data, personId]} min={0.55}>
      <div className="person-days">
        {days.map((d) => {
          const { mine: allEvents, family: famEvents } = personEvents(d.events, person);
          const sd = kid?.days.find((x) => x.dayKey === d.key);
          const span = sd ? schoolSpan(sd.lessons) : null;
          const gym = sd?.lessons.some((l) => l.gym);
          const tasks = (kid?.tasks ?? []).filter((t) => t.dayKey === d.key);
          // A homework that is also an all-day item in the calendar is shown once (as the homework).
          const events = allEvents.filter((e) => !tasks.some((t) => t.title === e.title));
          const meal = (data.meals ?? []).find((m) => m.dayKey === d.key);
          const lunch = meal?.lunch.filter((l) => !l.child || l.child === person.name) ?? [];
          const dinnerTwice = Boolean(meal?.dinner && famEvents.some((e) => e.title === `Middag: ${meal.dinner}`));
          const empty = !span && !events.length && !famEvents.length && !tasks.length && !lunch.length;
          return (
            <section className={`card person-day ${d.isToday ? "today" : ""}`} key={d.key}>
              <h2>
                {cap(d.name)} <small className="muted">{d.date}</small>
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
                    {t.detail && <small className="p-more">{t.detail.replace(/\s*\n\s*/g, " ").slice(0, 240)}</small>}
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
      {openTask && <TaskSheet task={openTask} child={person.name} onClose={() => setOpenTask(null)} />}
    </main>
  );
}
