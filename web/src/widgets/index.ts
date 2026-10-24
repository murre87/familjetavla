import type { WidgetId, WidgetModule } from "./types";
import cars from "./cars";
import chores from "./chores";
import climates from "./climates";
import custody from "./custody";
import energy from "./energy";
import homestatus from "./homestatus";
import lights from "./lights";
import meals from "./meals";
import music from "./music";
import prices from "./prices";
import reminders from "./reminders";
import schoolday from "./schoolday";
import shopping from "./shopping";
import temps from "./temps";

/** All cards. To add one: make a file like the others and list it here (see README.md in this folder). */
export const WIDGETS: WidgetModule[] = [meals, schoolday, chores, reminders, custody, shopping, prices, cars, lights, homestatus, temps, energy, climates, music];

const byId = new Map(WIDGETS.map((w) => [w.id, w]));
export const widget = (id: WidgetId) => byId.get(id as WidgetModule["id"]);

/** Names in Startskärm, including the two the home screen lays out itself. */
export const WIDGET_LABELS: Record<string, string> = {
  now: "Nu – det närmaste, stort",
  week: "Kommande 7 dagar",
  ...Object.fromEntries(WIDGETS.map((w) => [w.id, w.label])),
};

export type { WidgetCtx, WidgetId, WidgetModule } from "./types";
