import { QuickButtons, buttonsAt } from "../dashboard/QuickButtons";
import type { WidgetModule } from "./types";

/** Snabbknappar placed on the start page (#101), e.g. "Roger hem" for the robot vacuum. */
const widget: WidgetModule = {
  id: "buttons",
  label: "Snabbknappar",
  size: (data) => {
    const n = buttonsAt(data, "home").length;
    return n ? 1 + Math.ceil(n / 2) : 0;
  },
  render: ({ data, actions }) => <QuickButtons data={data} actions={actions} place="home" />,
};
export default widget;
