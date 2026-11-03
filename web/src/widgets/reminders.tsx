import { useState } from "react";
import type { Dashboard, Reminder } from "../../../server/src/types";
import { api } from "../api";
import type { Actions } from "../dashboard/Dashboard";
import { NewsSheet } from "../dashboard/Detail";
import { Icon, type IconName } from "../Icon";
import type { WidgetModule } from "./types";

const REMINDER_ICON: Record<Reminder["icon"], IconName> = {
  rain: "umbrella",
  bag: "bag",
  gym: "gym",
  trash: "trash",
  kids: "kids",
  info: "info",
  school: "school",
  food: "food",
};

export function Reminders({ items: all, food, limit, data, actions }: { items: Reminder[]; food: Dashboard["schoolFood"]; limit?: number; data?: Dashboard; actions?: Actions }) {
  const [reading, setReading] = useState<string | null>(null);
  if (!all.length && !food?.length) return null;
  const news = reading ? data?.schoolNews?.find((n) => n.id === reading) : undefined;
  const read = (id: string) => {
    setReading(id);
    const n = data?.schoolNews?.find((x) => x.id === id);
    if (n && !n.seen) api.newsSeen([id]).then(() => actions?.refresh()).catch(() => {});
  };
  // On the home screen: the most important few; the Kom ihåg page shows them all.
  // "Middag ikväll" without a warning is already in Maten and in the week: no third copy on the start page.
  const list = limit ? all.filter((r) => !(r.icon === "food" && r.tone === "neutral")) : all;
  const items = limit ? list.slice(0, limit) : list;
  const more = list.length - items.length;
  return (
    <section className="card strong">
      <h2>Kom ihåg</h2>
      {items.map((r, i) =>
        r.newsId && data?.schoolNews?.some((n) => n.id === r.newsId) && actions ? (
          <button
            type="button"
            className="reminder reminder-link"
            key={i}
            onClick={(e) => {
              // On the home card a tap would otherwise open the whole Kom ihåg page.
              e.stopPropagation();
              read(r.newsId!);
            }}
          >
            <div className={`ico tone-${r.tone}`}>
              <Icon name={REMINDER_ICON[r.icon]} />
            </div>
            <div>
              <b>{r.title}</b>
              <small>{r.sub}</small>
            </div>
            <Icon name="chevronRight" size={18} />
          </button>
        ) : (
          <div className="reminder" key={i}>
            <div className={`ico tone-${r.tone}`}>
              <Icon name={REMINDER_ICON[r.icon]} />
            </div>
            <div>
              <b>{r.title}</b>
              <small>{r.sub}</small>
            </div>
          </div>
        ),
      )}
      {more > 0 && <div className="more-hint">+{more} till – tryck för alla</div>}
      {food?.map((f, i) => (
        <div className="reminder" key={`f${i}`}>
          <div className="ico tone-green">
            <Icon name="food" />
          </div>
          <div>
            <b>Skolmat {f.day.toLowerCase()}</b>
            <small>{f.dishes.join(" · ")}</small>
          </div>
        </div>
      ))}
      {news && data && actions && <NewsSheet n={news} data={data} actions={actions} onClose={() => setReading(null)} />}
    </section>
  );
}

/** With the Maten card on, the school lunch lives there instead of here. */
const mealsOn = (data: Dashboard) => data.home.some((w) => w.id === "meals" && w.on);

const widget: WidgetModule = {
  id: "reminders",
  label: "Kom ihåg",
  size: (data) => {
    const food = mealsOn(data) ? 0 : (data.schoolFood?.length ?? 0);
    return data.reminders.length || food ? 1 + Math.min(4, data.reminders.length) + food : 0;
  },
  render: ({ data, full, actions }) => <Reminders items={data.reminders} food={mealsOn(data) ? undefined : data.schoolFood} limit={full ? undefined : 4} data={data} actions={actions} />,
  opens: { page: "komihag" },
};
export default widget;
