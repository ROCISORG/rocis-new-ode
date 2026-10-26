/* Data loading and analysis shared by the explorer designs.
   Cohort files are plain scripts (data/cohort-N.js) so the site also works when opened
   straight from disk. Times are the monitors' local clock and are handled as UTC
   throughout, so no daylight-saving shift is ever applied. */
(function () {
  const ROCIS = (window.ROCIS = window.ROCIS || {});
  const cache = {};
  const pending = {};
  let manifestData = null;
  const HOUR = 3600e3;
  const DAY = 24 * HOUR;
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  ROCIS.manifest = (m) => { manifestData = m; };
  ROCIS.getManifest = () => manifestData;

  ROCIS.register = (d) => {
    const c = prepare(d);
    cache[d.cohort] = c;
    (pending[d.cohort] || []).forEach((p) => p.resolve(c));
    delete pending[d.cohort];
  };

  ROCIS.load = (n, base = "data/") => new Promise((resolve, reject) => {
    if (cache[n]) return resolve(cache[n]);
    const queue = (pending[n] = pending[n] || []);
    queue.push({ resolve, reject });
    if (queue.length > 1) return;
    const s = document.createElement("script");
    s.src = `${base}cohort-${n}.js`;
    s.onerror = () => { queue.forEach((p) => p.reject(new Error(`Cohort ${n} could not be loaded.`))); delete pending[n]; };
    document.head.append(s);
  });

  function parseClock(text) {
    const [d, t] = text.split(" ");
    const [y, mo, da] = d.split("-").map(Number);
    const [h, mi, se] = t.split(":").map(Number);
    return Date.UTC(y, mo - 1, da, h, mi, se);
  }

  function prepare(d) {
    const t0 = parseClock(d.start);
    const step = d.stepMinutes * 60e3;
    const times = Array.from({ length: d.points }, (_, i) => t0 + i * step);
    d.monitors.forEach((m, i) => {
      m.idx = i;
      m.label = `${m.name} (${m.hashId})`;
    });
    return { ...d, t0, step, times };
  }

  // ---------- numbers ----------
  const asc = (a, b) => a - b;
  function quantile(sorted, p) {
    if (!sorted.length) return null;
    const i = (sorted.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
  }
  const median = (values) => quantile([...values].sort(asc), 0.5);

  function fmt(v) {
    if (v == null || Number.isNaN(v)) return "No reading";
    if (Math.abs(v) < 10) return v.toFixed(1);
    return Math.round(v).toLocaleString("en-US");
  }
  function compact(v) {
    if (v == null) return "";
    if (v >= 1e6) return `${+(v / 1e6).toFixed(1)}M`;
    if (v >= 1e3) return `${+(v / 1e3).toFixed(v >= 1e4 ? 0 : 1)}k`;
    return String(Math.round(v * 10) / 10);
  }

  // ---------- dates (UTC = monitor clock) ----------
  const d = (ms) => new Date(ms);
  const hour12 = (h) => (h === 0 ? "12 am" : h === 12 ? "noon" : h < 12 ? `${h} am` : `${h - 12} pm`);
  const dates = {
    day: (ms) => `${MONTHS[d(ms).getUTCMonth()]} ${d(ms).getUTCDate()}`,
    dayYear: (ms) => `${MONTHS[d(ms).getUTCMonth()]} ${d(ms).getUTCDate()}, ${d(ms).getUTCFullYear()}`,
    longDay: (ms) => `${MONTHS_LONG[d(ms).getUTCMonth()]} ${d(ms).getUTCDate()}, ${d(ms).getUTCFullYear()}`,
    monthYear: (ms) => `${MONTHS[d(ms).getUTCMonth()]} ${d(ms).getUTCFullYear()}`,
    hour: (ms) => `${MONTHS[d(ms).getUTCMonth()]} ${d(ms).getUTCDate()}, ${hour12(d(ms).getUTCHours())}`,
    time: (ms) => {
      const x = d(ms), h = x.getUTCHours(), m = String(x.getUTCMinutes()).padStart(2, "0");
      return `${MONTHS[x.getUTCMonth()]} ${x.getUTCDate()}, ${h % 12 || 12}:${m} ${h < 12 ? "am" : "pm"}`;
    },
    hour12,
    iso: (ms) => new Date(ms).toISOString().replace("T", " ").slice(0, 19),
    range(a, b) {
      const x = d(a), y = d(b);
      if (x.getUTCFullYear() !== y.getUTCFullYear()) return `${dates.dayYear(a)} to ${dates.dayYear(b)}`;
      if (x.getUTCMonth() === y.getUTCMonth()) return `${MONTHS_LONG[x.getUTCMonth()]} ${x.getUTCDate()} to ${y.getUTCDate()}, ${y.getUTCFullYear()}`;
      return `${dates.day(a)} to ${dates.day(b)}, ${y.getUTCFullYear()}`;
    },
  };

  // ---------- windows ----------
  function windowIdx(c, range) {
    const last = c.points - 1;
    // the cohort's last reading, not the end of the grid, anchors "last N days"
    let end = last;
    while (end > 0 && !c.monitors.some((m) => m.total[end] != null || m.large[end] != null)) end--;
    if (range === "all") return [0, last];
    const span = range === "7d" ? 7 * DAY : DAY;
    const startT = c.times[end] - span + c.step;
    let i0 = 0;
    while (i0 < end && c.times[i0] < startT) i0++;
    return [i0, end];
  }

  // ---------- analysis for one cohort, measure and window ----------
  function analyze(c, measure, i0, i1) {
    const M = c.monitors.length;
    const stats = c.monitors.map((m) => {
      const v = m[measure], vals = [];
      let first = null, last = null;
      for (let i = i0; i <= i1; i++) {
        if (v[i] != null) { vals.push(v[i]); if (first == null) first = i; last = i; }
      }
      vals.sort(asc);
      return {
        m, n: vals.length, first, last,
        p10: quantile(vals, 0.1), q1: quantile(vals, 0.25), med: quantile(vals, 0.5),
        q3: quantile(vals, 0.75), p90: quantile(vals, 0.9), max: vals.length ? vals[vals.length - 1] : null,
      };
    });
    const order = stats.filter((s) => s.n).sort((a, b) => b.med - a.med).map((s) => s.m.idx)
      .concat(stats.filter((s) => !s.n).map((s) => s.m.idx));
    const all = stats.flatMap((s) => (s.n ? s.m[measure].slice(i0, i1 + 1).filter((x) => x != null) : []));
    all.sort(asc);

    // hourly medians per monitor
    const hourStart = (t) => t - (t % HOUR);
    const hours = [];
    const hourIndex = new Map();
    for (let i = i0; i <= i1; i++) {
      const h = hourStart(c.times[i]);
      if (!hourIndex.has(h)) { hourIndex.set(h, hours.length); hours.push(h); }
    }
    const hourly = c.monitors.map((m) => {
      const buckets = hours.map(() => []);
      const v = m[measure];
      for (let i = i0; i <= i1; i++) if (v[i] != null) buckets[hourIndex.get(hourStart(c.times[i]))].push(v[i]);
      return buckets.map((b) => (b.length ? median(b) : null));
    });
    let busiest = { v: -1 };
    hourly.forEach((row, mi) => row.forEach((v, hi) => { if (v != null && v > busiest.v) busiest = { v, m: c.monitors[mi], t: hours[hi] }; }));

    // daily medians per monitor and across all monitors
    const dayStart = (t) => t - (t % DAY);
    const days = [];
    const dayIndex = new Map();
    for (let i = i0; i <= i1; i++) {
      const dd = dayStart(c.times[i]);
      if (!dayIndex.has(dd)) { dayIndex.set(dd, days.length); days.push(dd); }
    }
    const dailyBuckets = c.monitors.map(() => days.map(() => []));
    const dailyAll = days.map(() => []);
    c.monitors.forEach((m, mi) => {
      const v = m[measure];
      for (let i = i0; i <= i1; i++) if (v[i] != null) {
        const k = dayIndex.get(dayStart(c.times[i]));
        dailyBuckets[mi][k].push(v[i]);
        dailyAll[k].push(v[i]);
      }
    });
    const daily = dailyBuckets.map((row) => row.map((b) => (b.length ? median(b) : null)));
    const dailyOverall = dailyAll.map((b) => (b.length ? median(b) : null));

    // hour of day
    const hodMonitor = c.monitors.map((m) => {
      const b = Array.from({ length: 24 }, () => []);
      const v = m[measure];
      for (let i = i0; i <= i1; i++) if (v[i] != null) b[new Date(c.times[i]).getUTCHours()].push(v[i]);
      return b.map((x) => (x.length ? median(x) : null));
    });
    const hodAll = Array.from({ length: 24 }, () => []);
    c.monitors.forEach((m) => {
      const v = m[measure];
      for (let i = i0; i <= i1; i++) if (v[i] != null) hodAll[new Date(c.times[i]).getUTCHours()].push(v[i]);
    });
    hodAll.forEach((b) => b.sort(asc));
    const hod = {
      perMonitor: hodMonitor,
      q1: hodAll.map((b) => quantile(b, 0.25)),
      mid: hodAll.map((b) => quantile(b, 0.5)),
      q3: hodAll.map((b) => quantile(b, 0.75)),
    };

    // when each monitor reported
    const runs = c.monitors.map((m) => {
      const out = [];
      const v = m[measure];
      let start = null;
      for (let i = i0; i <= i1 + 1; i++) {
        const has = i <= i1 && v[i] != null;
        if (has && start == null) start = i;
        if (!has && start != null) { out.push([c.times[start], c.times[i - 1] + c.step]); start = null; }
      }
      return out;
    });

    return {
      i0, i1, measure, stats, order, hours, hourly, busiest, days, daily, dailyOverall, hod, runs,
      overallMedian: quantile(all, 0.5),
      reporting: stats.filter((s) => s.n).length,
      completeness: all.length / ((i1 - i0 + 1) * M),
      spanDays: Math.round(((c.times[i1] - c.times[i0] + c.step) / DAY) * 10) / 10,
    };
  }

  function toCsv(c, measure) {
    const lines = [["Date/Time", ...c.monitors.map((m) => m.column)].join(",")];
    c.times.forEach((t, i) => lines.push([dates.iso(t), ...c.monitors.map((m) => m[measure][i] ?? "")].join(",")));
    return lines.join("\n") + "\n";
  }

  function download(c, measure) {
    const url = URL.createObjectURL(new Blob([toCsv(c, measure)], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${measure === "total" ? "small" : "large"}_${c.cohort}.csv`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function sparkline(values, w = 120, h = 28) {
    const pts = values.map((v, i) => [i, v]).filter((p) => p[1] != null);
    if (pts.length < 2) return "";
    const max = Math.max(...pts.map((p) => p[1])), min = Math.min(...pts.map((p) => p[1]));
    const x = (i) => (i / (values.length - 1)) * (w - 4) + 2;
    const y = (v) => h - 3 - ((v - min) / (max - min || 1)) * (h - 6);
    return pts.map((p, k) => `${k ? "L" : "M"}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join("");
  }

  const words = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
    "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"];
  const say = (n) => words[n] || String(n);

  ROCIS.util = { quantile, median, fmt, compact, dates, windowIdx, analyze, toCsv, download, sparkline, say, HOUR, DAY };
})();
