import { useEffect, useState } from "react";
import { christmasLine } from "../../../server/src/christmas";
import { Icon } from "../Icon";
import type { WidgetModule } from "./types";

function JulTile() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  const line = christmasLine(now);
  return (
    <section className="card jul-tile">
      <span className="jul-icon" aria-hidden="true">
        <Icon name="snow" size={26} />
      </span>
      <div className="grow stack" style={{ gap: 2 }}>
        <span className="eyebrow">Jul</span>
        <b style={{ fontSize: 20, lineHeight: 1.2 }}>{line.big}</b>
        <span className="muted" style={{ fontSize: 14 }}>
          {line.small}
        </span>
      </div>
    </section>
  );
}

const widget: WidgetModule = {
  id: "jul",
  label: "Jul – nedräkning (se Julkort)",
  size: (data) => (data.jul?.show ? 1 : 0),
  render: () => <JulTile />,
  opens: { tab: "jul" },
};
export default widget;
