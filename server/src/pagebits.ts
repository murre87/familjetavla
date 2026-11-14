/** Small pure helpers for the board's pages, shared with the tests. */

/** "Spabad Economy Mode" on the card "Spabad: Heater" → "Economy Mode": the leading words that repeat the device's name go too. */
export function shortControl(name: string, device = ""): string {
  const n = name.includes(": ") ? name.slice(name.lastIndexOf(": ") + 2) : name;
  const words = n.split(/\s+/);
  const dev = (device.includes(":") ? device.slice(0, device.indexOf(":")) : device).toLowerCase().split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < words.length - 1 && i < dev.length && words[i]!.toLowerCase() === dev[i]) i++;
  const rest = words.slice(i).join(" ");
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}

/** The points (evenly spread from `from` to `to`) averaged per clock hour; the last hour is the one going on now. */
export function hourBuckets(data: { from: string; to: string; series: { points: (number | null)[] }[] }): { hours: number[]; series: (number | null)[][] } {
  const t0 = new Date(data.from).getTime();
  const t1 = new Date(data.to).getTime();
  const HOUR = 3_600_000;
  const first = Math.floor(t0 / HOUR) + (t0 % HOUR > HOUR / 2 ? 1 : 0);
  const last = Math.floor(t1 / HOUR);
  const hours: number[] = [];
  for (let h = first; h <= last; h++) hours.push(h);
  const series = data.series.map((s) => {
    const sum = new Array<number>(hours.length).fill(0);
    const cnt = new Array<number>(hours.length).fill(0);
    const n = s.points.length;
    s.points.forEach((v, i) => {
      if (v === null) return;
      const t = t0 + ((t1 - t0) * i) / Math.max(1, n - 1);
      const k = Math.floor(t / HOUR) - first;
      if (k < 0 || k >= hours.length) return;
      sum[k]! += v;
      cnt[k]! += 1;
    });
    return sum.map((v, k) => (cnt[k] ? v / cnt[k]! : null));
  });
  return { hours, series };
}

