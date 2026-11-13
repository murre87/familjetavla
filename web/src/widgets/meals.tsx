import type { Dashboard } from "../../../server/src/types";
import { Icon } from "../Icon";
import { Fit } from "../dashboard/Fit";
import type { BoxProps } from "../boxprefs";
import type { WidgetModule } from "./types";

/** Today's school lunch per child (tomorrow's after 14) and tonight's dinner – big enough for the kids. */
/** `fit`: the new start page lets the content shrink to the card instead of overflowing it. */
export function Meals({ data, fit = false, box }: { data: Dashboard; fit?: boolean; box?: BoxProps }) {
  const h = new Date().getHours();
  const start = h >= 14 ? 1 : 0;
  // The next school day with a menu: after Friday lunch that is Monday.
  const lunch = data.meals.slice(start, start + 4).find((d) => d.lunch.length);
  const dinnerDay = h < 20 ? data.meals[0] : data.meals[1];
  const dinner = dinnerDay?.dinner;
  if (!lunch && !dinner) return null;
  const wrap = (body: React.ReactNode) => (fit ? <Fit className="hf-fit" deps={[data]} base={box?.base} floor={0.85}>{body}</Fit> : body);
  const when = (label: string) => (label === "idag" || label === "imorgon" ? label : `på ${label.split(" ")[0]}`);
  return (
    <section className={`card meals-card ${box?.className ?? ""}`} style={box?.style} {...box?.handlers}>
      {box?.gear}
      <h2>Maten</h2>
      {wrap(<>
      {lunch && (
        <div className="meal-block">
          <span className="eyebrow">Lunch {when(lunch.dayLabel)}</span>
          {lunch.lunch.map((l) => (
            <div className="meal-line" key={l.child + l.dishes.join()}>
              <Icon name="school" size={20} />
              <span>
                {l.child && <b>{l.child}: </b>}
                {l.dishes.join(" · ")}
              </span>
            </div>
          ))}
        </div>
      )}
      {dinner && (
        <div className="meal-block">
          <span className="eyebrow">Middag {dinnerDay === data.meals[0] ? "ikväll" : "imorgon"}</span>
          <div className="meal-line">
            <Icon name="food" size={20} />
            <span>{dinner}</span>
          </div>
        </div>
      )}
      </>)}
    </section>
  );
}

const widget: WidgetModule = {
  id: "meals",
  label: "Maten – skollunch och kvällens middag",
  size: (data) => {
    const lunchRows = data.meals.slice(0, 5).find((d) => d.lunch.length)?.lunch.length ?? 0;
    const dinner = data.meals[0]?.dinner || data.meals[1]?.dinner ? 1 : 0;
    return lunchRows || dinner ? 1 + lunchRows + dinner : 0;
  },
  render: ({ data }) => <Meals data={data} />,
  opens: { page: "maten" },
};
export default widget;
