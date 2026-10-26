import { useMemo } from "react";
import type { DashEvent, Dashboard } from "../../../server/src/types";
import { Icon } from "../Icon";
import { navigate } from "../route";
import { Avatar } from "./bits";
import { PageBar } from "./Detail";

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

export function PersonPage({ data, personId }: { data: Dashboard; personId: string }) {
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
      <div className="person-days">
        {days.map((d) => {
          const { mine: events, family: famEvents } = personEvents(d.events, person);
          const sd = kid?.days.find((x) => x.dayKey === d.key);
          const span = sd ? schoolSpan(sd.lessons) : null;
          const gym = sd?.lessons.some((l) => l.gym);
          const tasks = (kid?.tasks ?? []).filter((t) => t.dayKey === d.key);
          const meal = (data.meals ?? []).find((m) => m.dayKey === d.key);
          const lunch = meal?.lunch.filter((l) => !l.child || l.child === person.name) ?? [];
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
                    <b>Skola {span.start}–{span.end}</b>
                    {gym && <span className="p-badge gym"> <Icon name="gym" size={14} /> Gympa – ta med gymkläder</span>}
                  </span>
                </div>
              )}
              {tasks.map((t, i) => (
                <div className={`p-line task ${t.kind}`} key={i}>
                  <Icon name={t.kind === "prov" ? "alert" : "check"} size={20} />
                  <span>
                    <b>{KIND_LABEL[t.kind] ?? "Uppgift"}:</b> {t.title}
                    {t.time ? ` · ${t.time}` : ""}
                  </span>
                </div>
              ))}
              {events.map((e, i) => (
                <div className="p-line" key={i}>
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
              {meal?.dinner && (
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
      {later.length > 0 && (
        <section className="card person-later">
          <h2>Längre fram</h2>
          {later.map((t, i) => (
            <div className={`p-line task ${t.kind}`} key={i}>
              <Icon name={t.kind === "prov" ? "alert" : "check"} size={20} />
              <span>
                <b>{KIND_LABEL[t.kind] ?? "Uppgift"} {t.label}:</b> {t.title}
              </span>
            </div>
          ))}
        </section>
      )}
    </main>
  );
}
