import { QuickButtons, buttonsAt, groupsAt } from "../dashboard/QuickButtons";
import type { WidgetModule } from "./types";

/** Snabbknappar and light groups placed on the start page (#101), e.g. "Roger hem" or Tänd / Släck fönsterlampor. */
const widget: WidgetModule = {
  id: "buttons",
  label: "Snabbknappar",
  size: (data) => {
    const n = buttonsAt(data, "home").length;
    const g = groupsAt(data, "home").length;
    return n + g ? 1 + Math.ceil(n / 2) + g * 2 : 0;
  },
  render: ({ data, actions }) => <QuickButtons data={data} actions={actions} place="home" />,
};
export default widget;
