/* ECharts option builders shared by the designs. Each design supplies its own
   colors and fonts through CSS custom properties; these builders read them and return
   ECharts options, so one set of chart logic serves every look. */
(function () {
  const ROCIS = (window.ROCIS = window.ROCIS || {});
  const U = ROCIS.util;
  const { fmt, compact, dates } = U;

  function theme(root = document.documentElement) {
    const cs = getComputedStyle(root);
    const v = (n) => cs.getPropertyValue(n).trim();
    return {
      ink: v("--ink"), ink2: v("--ink-2"), muted: v("--muted"), rule: v("--rule"), surface: v("--surface"),
      emph: v("--emph"), context: v("--context"), dot: v("--dot"), wash: v("--wash"),
      ramp: v("--ramp").split(",").map((s) => s.trim()).filter(Boolean),
      font: v("--font-ui") || v("--font") || "system-ui, sans-serif",
    };
  }

  function alpha(color, a) {
    const m = /^#([0-9a-f]{6})$/i.exec(color || "");
    if (!m) return color;
    const n = parseInt(m[1], 16);
    return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
  }

  function esc(text) {
    return String(text).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  }

  function tipBox(t, title, rows) {
    const lines = rows.map((r) => {
      const key = r.color ? `<span style="display:inline-block;width:14px;height:0;border-top:2px solid ${r.color};margin-right:8px;vertical-align:4px"></span>` : "";
      return `<div style="display:flex;align-items:center;gap:2px;margin-top:2px">${key}<b style="font-size:14px;color:${t.ink}">${esc(r.value)}</b><span style="color:${t.ink2};margin-left:6px">${esc(r.label)}</span></div>`;
    }).join("");
    return `<div style="font-family:${t.font};min-width:150px"><div style="color:${t.ink2};font-size:12px;margin-bottom:2px">${esc(title)}</div>${lines}</div>`;
  }

  function base(t) {
    return {
      useUTC: true,
      animationDuration: 350,
      textStyle: { fontFamily: t.font, color: t.ink2 },
      aria: { enabled: true },
      tooltip: {
        backgroundColor: t.surface, borderColor: t.rule, borderWidth: 1, padding: [8, 10],
        textStyle: { color: t.ink, fontFamily: t.font }, extraCssText: "box-shadow:0 6px 20px rgba(0,0,0,.14);border-radius:8px",
      },
    };
  }
  const axisStyle = (t) => ({
    axisLine: { lineStyle: { color: t.rule } },
    axisTick: { show: false },
    axisLabel: { color: t.muted, fontSize: 12, hideOverlap: true },
    splitLine: { lineStyle: { color: t.rule } },
  });
  const valueAxis = (t, scale, extra = {}) => ({
    type: scale === "log" ? "log" : "value",
    min: scale === "log" ? 1 : 0,
    ...axisStyle(t),
    axisLabel: { color: t.muted, fontSize: 12, formatter: (v) => compact(v) },
    ...extra,
  });
  const ok = (v, scale) => v != null && (scale !== "log" || v > 0);

  // picked monitors as idx -> { color, k } for the builders below
  const pickMap = (picks) => new Map((picks || []).map((p, k) => [p.idx, { color: p.color, k }]));

  // y axis listing monitors; categories use the unique label so duplicate neighborhoods stay distinct.
  // Picked monitors get a dot in their color and a bold name, so color never carries identity alone.
  function monitorAxis(t, c, rows, picks, narrow = false, extra = {}) {
    const picked = pickMap(picks);
    const rich = { sel: { fontWeight: 700, color: t.ink, fontSize: 12 }, id: { color: t.muted, fontSize: 12 } };
    picked.forEach(({ color, k }) => { rich[`c${k}`] = { color, fontSize: 13 }; });
    return {
      type: "category", data: rows.map((mi) => c.monitors[mi].label), ...axisStyle(t), splitLine: { show: false },
      axisLine: { show: false }, triggerEvent: true,
      axisLabel: {
        color: t.ink, fontSize: 12, margin: 10,
        formatter: (v, i) => {
          const m = c.monitors[rows[i]];
          const name = narrow && m.name.length > 13 ? `${m.name.slice(0, 12)}…` : m.name;
          const id = narrow ? "" : ` {id|${m.hashId}}`;
          const p = picked.get(rows[i]);
          return p ? `{c${p.k}|●} {sel|${name}}${id}` : `${name}${id}`;
        },
        rich,
      },
      ...extra,
    };
  }

  // date labels with the year under the first one and under any January 1. The first one is found by time, not
  // label index: ECharts can place two labels at the start of the axis and hide one of them.
  const dayLabel = (start) => (v) => {
    const x = new Date(v);
    const yearToo = v - start < U.DAY || (x.getUTCMonth() === 0 && x.getUTCDate() === 1);
    return yearToo ? `${dates.day(v)}\n${x.getUTCFullYear()}` : dates.day(v);
  };
  const legendBase = (t, data, size = 13) => ({
    type: "scroll", top: 0, left: 0, right: 40, icon: "path://M0,4 L14,4 L14,6 L0,6 Z", itemWidth: 16, itemHeight: 6,
    textStyle: { color: t.ink2, fontSize: size }, selectedMode: false, pageIconColor: t.ink2, pageTextStyle: { color: t.muted }, data,
  });

  // ---------- main time series: picked monitors in their colors, the rest in gray ----------
  function timeSeries(c, an, o) {
    const t = theme();
    const { measure, scale } = o;
    const picks = o.picks || [];
    const picked = pickMap(picks);
    const showOthers = o.others !== "hide";
    const line = (m) => {
      const data = [];
      for (let i = an.i0; i <= an.i1; i++) {
        const v = m[measure][i];
        data.push([c.times[i], ok(v, scale) ? v : null]);
      }
      return data;
    };
    const series = [];
    if (showOthers) c.monitors.filter((m) => !picked.has(m.idx)).forEach((m) => series.push({
      name: "Other monitors", type: "line", data: line(m), showSymbol: false, connectNulls: false, sampling: "lttb",
      silent: true, z: 2, animation: false,
      lineStyle: { width: 1, color: t.context, opacity: 0.6, cap: "round", join: "round" }, itemStyle: { color: t.context },
      emphasis: { disabled: true },
    }));
    picks.forEach((p, k) => series.push({
      name: c.monitors[p.idx].label, type: "line", data: line(c.monitors[p.idx]), showSymbol: false, connectNulls: false,
      sampling: "lttb", z: 10 - k, animation: false,
      lineStyle: { width: 2, color: p.color, cap: "round", join: "round" }, itemStyle: { color: p.color },
      emphasis: { disabled: true },
    }));
    const names = picks.map((p) => c.monitors[p.idx].label);
    return {
      ...base(t),
      grid: { left: 48, right: 18, top: o.compactTop ? 28 : 40, bottom: o.zoom === false ? 40 : 84 },
      legend: legendBase(t, showOthers ? [...names, "Other monitors"] : names),
      tooltip: {
        ...base(t).tooltip, trigger: "axis",
        axisPointer: { type: "line", lineStyle: { color: t.ink2, width: 1 } },
        formatter: (params) => {
          if (!params.length) return "";
          const i = an.i0 + params[0].dataIndex;
          const all = c.monitors.map((m) => m[measure][i]).filter((x) => x != null).sort((a, b) => a - b);
          const rows = picks.map((p) => ({ value: fmt(c.monitors[p.idx][measure][i]), label: c.monitors[p.idx].name, color: p.color }));
          rows.push({ value: all.length ? fmt(U.quantile(all, 0.5)) : "No readings", label: "median of all monitors", color: t.context });
          return tipBox(t, dates.time(c.times[i]), rows);
        },
      },
      xAxis: { type: "time", ...axisStyle(t), splitLine: { show: false },
        axisLabel: { color: t.muted, fontSize: 12, hideOverlap: true, lineHeight: 16, formatter: dayLabel(c.times[an.i0]) } },
      yAxis: valueAxis(t, scale, { name: o.unit || "", nameTextStyle: { color: t.muted, align: "left" } }),
      dataZoom: o.zoom === false ? [] : [
        { type: "inside", filterMode: "none" },
        { type: "slider", height: 26, bottom: 14, filterMode: "none", borderColor: t.rule, backgroundColor: "transparent",
          fillerColor: t.wash, handleStyle: { color: t.surface, borderColor: t.ink2 },
          moveHandleStyle: { color: t.rule }, textStyle: { color: t.muted, fontSize: 12 },
          labelFormatter: (v) => dates.dayYear(v),
          dataBackground: { lineStyle: { color: t.context, opacity: 0.7 }, areaStyle: { color: t.context, opacity: 0.15 } },
          selectedDataBackground: { lineStyle: { color: t.emph }, areaStyle: { color: t.emph, opacity: 0.12 } } },
      ],
      toolbox: o.toolbox === false ? undefined : {
        right: 4, top: -4, itemSize: 15, iconStyle: { borderColor: t.muted },
        feature: { saveAsImage: { title: "Save image", backgroundColor: t.surface, name: `rocis-cohort-${c.cohort}` },
          restore: { title: "Reset zoom" } },
      },
      series,
    };
  }

  // ---------- heatmap: monitors × hours, log color scale ----------
  function heatmap(c, an, o) {
    const t = theme();
    const rows = [...an.order].reverse(); // category axes run bottom to top
    const all = [];
    const data = [];
    rows.forEach((mi, y) => an.hourly[mi].forEach((v, x) => {
      if (v != null && v > 0) { data.push([x, y, Math.log10(v), v]); all.push(v); }
    }));
    all.sort((a, b) => a - b);
    const lo = Math.max(1, ROCIS.util.quantile(all, 0.02) || 1), hi = ROCIS.util.quantile(all, 0.98) || lo * 10;
    const labels = an.hours.map((h) => dates.hour(h));
    const dayEvery = Math.max(1, Math.ceil(an.hours.length / 24 / (o.maxDayLabels || 9)));
    return {
      ...base(t),
      grid: { left: o.labelWidth || 150, right: 12, top: 8, bottom: o.hideScale ? 28 : 64 },
      tooltip: {
        ...base(t).tooltip, trigger: "item",
        formatter: (p) => tipBox(t, c.monitors[rows[p.data[1]]].label, [{ value: fmt(p.data[3]), label: labels[p.data[0]] }]),
      },
      xAxis: {
        type: "category", data: labels, ...axisStyle(t), splitLine: { show: false }, axisLine: { show: false },
        axisLabel: {
          color: t.muted, fontSize: 12,
          hideOverlap: true,
          interval: (i) => new Date(an.hours[i]).getUTCHours() === 0 && Math.round((an.hours[i] - an.hours[0]) / ROCIS.util.DAY) % dayEvery === 0,
          formatter: (v, i) => dates.day(an.hours[i]),
        },
      },
      yAxis: monitorAxis(t, c, rows, o.picks, o.narrow),
      visualMap: o.hideScale ? { show: false, min: Math.log10(lo), max: Math.log10(hi), dimension: 2, inRange: { color: t.ramp } } : {
        type: "continuous", min: Math.log10(lo), max: Math.log10(hi), dimension: 2, orient: "horizontal",
        left: o.labelWidth || 150, bottom: 4, itemWidth: 12, itemHeight: o.narrow ? 110 : 200, calculable: false, realtime: false,
        inRange: { color: t.ramp }, textStyle: { color: t.ink2, fontSize: 12 },
        text: [`${fmt(hi)}+`, o.narrow ? fmt(lo) : `${fmt(lo)} or less ${o.unitShort || ""}`],
        formatter: (v) => fmt(10 ** v),
      },
      series: [{
        type: "heatmap", data, progressive: 6000, emphasis: { itemStyle: { borderColor: t.ink, borderWidth: 1 } },
        itemStyle: { borderWidth: 0 },
      }],
      _rows: rows,
    };
  }

  // ---------- hour-of-day profile ----------
  function profile(c, an, o) {
    const t = theme();
    const picks = o.picks || [];
    const hours = Array.from({ length: 24 }, (_, h) => dates.hour12(h));
    const keep = (v) => (ok(v, o.scale) ? v : null);
    const q1 = an.hod.q1.map(keep), q3 = an.hod.q3.map(keep);
    const label = (idx) => c.monitors[idx].label;
    return {
      ...base(t),
      grid: { left: 46, right: 14, top: 36, bottom: 30 },
      legend: legendBase(t, [...picks.map((p) => label(p.idx)), "All monitors, median"], 12),
      tooltip: {
        ...base(t).tooltip, trigger: "axis", axisPointer: { type: "line", lineStyle: { color: t.ink2 } },
        formatter: (ps) => {
          const h = ps[0].dataIndex;
          return tipBox(t, `${dates.hour12(h)} to ${dates.hour12((h + 1) % 24)}`, [
            ...picks.map((p) => ({ value: fmt(an.hod.perMonitor[p.idx][h]), label: c.monitors[p.idx].name, color: p.color })),
            { value: fmt(an.hod.mid[h]), label: "all monitors, median", color: t.context },
            { value: `${fmt(an.hod.q1[h])} to ${fmt(an.hod.q3[h])}`, label: "middle 50% of readings" },
          ]);
        },
      },
      xAxis: { type: "category", data: hours, boundaryGap: false, ...axisStyle(t), splitLine: { show: false },
        axisLabel: { color: t.muted, fontSize: 12, interval: 5 } },
      yAxis: valueAxis(t, o.scale),
      series: [
        { type: "line", data: q1, stack: "band", lineStyle: { opacity: 0 }, showSymbol: false, silent: true, areaStyle: { opacity: 0 } },
        { type: "line", data: q3.map((v, h) => (v != null && q1[h] != null ? v - q1[h] : null)), stack: "band",
          lineStyle: { opacity: 0 }, showSymbol: false, silent: true, areaStyle: { color: t.context, opacity: 0.22 } },
        { name: "All monitors, median", type: "line", data: an.hod.mid.map(keep), showSymbol: false, smooth: 0.2,
          lineStyle: { color: t.context, width: 2 }, itemStyle: { color: t.context } },
        ...picks.map((p) => ({ name: label(p.idx), type: "line", data: an.hod.perMonitor[p.idx].map(keep), smooth: 0.2,
          symbolSize: 6, showSymbol: false, lineStyle: { color: p.color, width: 2 }, itemStyle: { color: p.color } })),
      ],
    };
  }

  // ---------- distribution per monitor ----------
  function boxplot(c, an, o) {
    const t = theme();
    const rows = [...an.order].reverse().filter((mi) => an.stats[mi].n);
    const floor = o.scale === "log" ? 1 : 0;
    const picked = pickMap(o.picks);
    const data = rows.map((mi) => {
      const s = an.stats[mi];
      const p = picked.get(mi);
      return {
        value: [s.p10, s.q1, s.med, s.q3, s.p90].map((v) => Math.max(v, floor)),
        // monitors not picked are gray, as in the time series, so a blue pick never blends in with them
        itemStyle: { color: p ? alpha(p.color, 0.22) : alpha(t.context, 0.14), borderColor: p ? p.color : t.context, borderWidth: p ? 2 : 1.5, opacity: 1 },
      };
    });
    return {
      ...base(t),
      grid: { left: o.labelWidth || 130, right: 18, top: 8, bottom: 30 },
      tooltip: {
        ...base(t).tooltip, trigger: "item",
        formatter: (p) => {
          const s = an.stats[rows[p.dataIndex]];
          return tipBox(t, s.m.label, [
            { value: fmt(s.med), label: "median" },
            { value: `${fmt(s.q1)} to ${fmt(s.q3)}`, label: "middle 50% (25th to 75th percentile)" },
            { value: `${fmt(s.p10)} to ${fmt(s.p90)}`, label: "usual range (10th to 90th percentile)" },
            { value: s.n.toLocaleString("en-US"), label: "15-minute values" },
          ]);
        },
      },
      xAxis: valueAxis(t, o.scale),
      yAxis: monitorAxis(t, c, rows, o.picks, o.narrow),
      series: [{ type: "boxplot", data, boxWidth: [6, 14] }],
      _rows: rows,
    };
  }

  // ---------- when each monitor reported ----------
  function coverage(c, an, o) {
    const t = theme();
    const rows = [...an.order].reverse();
    const picked = pickMap(o.picks);
    const data = [];
    rows.forEach((mi, y) => an.runs[mi].forEach(([a, b]) => data.push({ value: [y, a, b], color: picked.has(mi) ? picked.get(mi).color : null })));
    return {
      ...base(t),
      grid: { left: o.labelWidth || 130, right: 18, top: 8, bottom: 42 },
      tooltip: { ...base(t).tooltip, trigger: "item",
        formatter: (p) => tipBox(t, c.monitors[rows[p.value[0]]].label, [{ value: `${dates.time(p.value[1])} to ${dates.time(p.value[2])}`, label: "" }]) },
      xAxis: { type: "time", min: c.times[an.i0], max: c.times[an.i1] + c.step, ...axisStyle(t),
        axisLabel: { color: t.muted, fontSize: 12, hideOverlap: true, lineHeight: 16, formatter: dayLabel(c.times[an.i0]) } },
      yAxis: monitorAxis(t, c, rows, o.picks, o.narrow),
      series: [{
        type: "custom", data, encode: { x: [1, 2], y: 0 },
        renderItem: (params, api) => {
          const y = api.value(0), start = api.coord([api.value(1), y]), end = api.coord([api.value(2), y]);
          const h = api.size([0, 1])[1] * 0.42;
          const item = data[params.dataIndex];
          return {
            type: "rect",
            shape: { x: start[0], y: start[1] - h / 2, width: Math.max(2, end[0] - start[0] - 1), height: h, r: 2 },
            style: { fill: item.color || t.context, opacity: item.color ? 1 : 0.75 },
          };
        },
      }],
      _rows: rows,
    };
  }

  // ---------- calendar of daily medians (all monitors) ----------
  function calendar(c, an, o) {
    const t = theme();
    const data = an.days.map((d, k) => [dates.iso(d).slice(0, 10), an.dailyOverall[k]]).filter((p) => p[1] != null);
    const vals = data.map((p) => p[1]).sort((a, b) => a - b);
    const first = dates.iso(an.days[0]).slice(0, 10), last = dates.iso(an.days[an.days.length - 1]).slice(0, 10);
    return {
      ...base(t),
      tooltip: { ...base(t).tooltip, trigger: "item",
        formatter: (p) => tipBox(t, p.value[0], [{ value: fmt(p.value[1]), label: "median, all monitors" }]) },
      visualMap: { show: false, min: vals[0], max: vals[vals.length - 1], inRange: { color: t.ramp } },
      calendar: {
        range: [first, last], orient: "horizontal", top: 26, left: 34, cellSize: [o.cell || 30, o.cell || 30],
        splitLine: { lineStyle: { color: t.surface, width: 3 } }, itemStyle: { borderColor: t.surface, borderWidth: 3, color: t.wash },
        yearLabel: { show: false }, monthLabel: { color: t.ink2, fontSize: 12 }, dayLabel: { color: t.muted, fontSize: 12, firstDay: 0, nameMap: ["S", "M", "T", "W", "T", "F", "S"] },
      },
      series: [{ type: "heatmap", coordinateSystem: "calendar", data }],
    };
  }

  ROCIS.charts = { theme, timeSeries, heatmap, profile, boxplot, coverage, calendar };
})();
