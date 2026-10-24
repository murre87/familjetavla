import type { Dashboard } from "../../../server/src/types";
import { Icon } from "../Icon";
import type { WidgetModule } from "./types";

/** Värmefärg: blått under 18 °, grönt 18–24 °, orange över. Ute (under 10) ser blått ut, vilket är rimligt. */
function tone(value: string): string {
  const n = Number.parseFloat(value.replace(",", "."));
  if (!Number.isFinite(n)) return "";
  return n < 10 ? "cold" : n < 18 ? "cool" : n <= 24 ? "ok" : "warm";
}

export function Temps({ temps }: { temps: Dashboard["temps"] }) {
  if (!temps.length) return null;
  const live = temps.filter((t) => !t.offline);
  const off = temps.filter((t) => t.offline);
  return (
    <section className="card">
      <h2>Temperaturer</h2>
      {live.length > 0 && (
        <div className="temp-grid">
          {live.map((t) => (
            <div key={t.name} className={`temp-tile ${tone(t.value)}`}>
              <small>{t.name}</small>
              <b>{t.value}</b>
            </div>
          ))}
        </div>
      )}
      {off.length > 0 && (
        <div className="temp-off" role="status">
          <Icon name="alert" size={18} />
          <span>
            {off.length === 1 ? "1 sensor svarar inte" : `${off.length} sensorer svarar inte`}
            <small>
              {" "}
              {off.map((t) => `${t.name}${t.days !== undefined && t.days >= 2 ? ` (${t.days} dagar)` : ""}`).join(", ")} – kolla batteriet
            </small>
          </span>
        </div>
      )}
    </section>
  );
}

const widget: WidgetModule = {
  id: "temps",
  label: "Temperaturer",
  size: (data) => (data.temps.length ? 1 + Math.ceil(data.temps.filter((t) => !t.offline).length / 2) + (data.temps.some((t) => t.offline) ? 1 : 0) : 0),
  render: ({ data }) => <Temps temps={data.temps} />,
  opens: { tab: "house" },
};
export default widget;
