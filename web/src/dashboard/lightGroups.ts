import type { Dashboard } from "../../../server/src/types";
import { api } from "../api";
import type { Actions } from "./Dashboard";

type Group = Dashboard["lightGroups"][number];

/** Groups that light the outside: "Ute", "Utomhusbelysning", "Carport", "Trädgård", "Uteplats" … */
const OUTSIDE = /^ute\b|utom|carport|trädgård|uteplats|altan|fasad|garage|infart/i;

export const isOutside = (g: Group) => OUTSIDE.test(g.name.trim());
export const insideGroups = (d: Dashboard) => d.lightGroups.filter((g) => !isOutside(g));
export const outsideGroups = (d: Dashboard) => d.lightGroups.filter(isOutside);

/** Switch every group in `groups` on or off with one tap, and confirm when the board has seen it. */
export function setGroups(actions: Actions, groups: Group[], on: boolean, label: string) {
  const idx = new Set(groups.map((g) => g.index));
  return actions.run(label, () => Promise.all(groups.map((g) => api.lightGroup(g.index, on))), {
    done: `${label}: klart`,
    check: (d) => d.lightGroups.filter((g) => idx.has(g.index)).every((g) => (on ? g.on >= g.total - g.offline.length : g.on === 0)),
  });
}
