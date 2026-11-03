import type { Dashboard } from "../../../server/src/types";
import type { WidgetModule } from "./types";

/** Värmefärg: blått under 18 °, grönt 18–24 °, orange över. Ute (under 10) ser blått ut, vilket är rimligt. */
function tone(value: string): string {
  const n = Number.parseFloat(value.replace(",", "."));
  if (!Number.isFinite(n)) return "";
  return n < 10 ? "cold" : n < 18 ? "cool" : n <= 24 ? "ok" : "warm";
}

export function Temps({ temps }: { temps: Dashboard["temps"] }) {
  if (!temps.length) return null;
  return (
    <section className="card">
      <h2>Temperaturer</h2>
      <div className="temp-grid">
        {temps.map((t) => (
          <div key={t.name} className={`temp-tile ${tone(t.value)}`}>
            <small>{t.name}</small>
            <b>{t.value}</b>
          </div>
        ))}
      </div>
    </section>
  );
}

const widget: WidgetModule = {
  id: "temps",
  label: "Temperaturer",
  size: (data) => (data.temps.length ? 1 + Math.ceil(data.temps.length / 2) : 0),
  render: ({ data }) => <Temps temps={data.temps} />,
  opens: { tab: "house" },
};
export default widget;
