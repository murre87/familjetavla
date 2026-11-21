import { useEffect, useState } from "react";
import { christmasLine } from "../../../server/src/christmas";
import { Icon } from "../Icon";

/** Liten markör i rubrikraden ("33 dagar till jul") som öppnar fliken Jul. Den platta designens startsida har inga fria rutor, så här syns julen där. */
export function JulChip({ onOpen }: { onOpen: () => void }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  return (
    <button className="btn small ghost jul-chip" onClick={onOpen} title="Öppna julkortet">
      <Icon name="snow" size={16} />
      <span>{christmasLine(now).big}</span>
    </button>
  );
}
