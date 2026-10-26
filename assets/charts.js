/* ECharts option builders shared by the designs. Each design supplies its own
   colors and fonts through CSS custom properties; these builders read them and return
   ECharts options, so one set of chart logic serves every look. */
(function () {
  const ROCIS = (window.ROCIS = window.ROCIS || {});
  const { fmt, compact, dates } = ROCIS.util;

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
    axisLabel: { color: t.muted, fontSize: 11, hideOverlap: true },
    splitLine: { lineStyle: { color: t.rule } },
  });
  const valueAxis = (t, scale, extra = {}) => ({
    type: scale === "log" ? "log" : "value",
    min: scale === "log" ? 1 : 0,
    ...axisStyle(t),
    axisLabel: { color: t.muted, fontSize: 11, formatter: (v) => compact(v) },
    ...extra,
  });
  const ok = (v, scale) => v != null && (scale !== "log" || v > 0);

  // y axis listing monitors; categories use the unique label so duplicate neighborhoods stay distinct
  function monitorAxis(t, c, rows, selected, narrow = false, extra = {}) {
    return {
      type: "category", data: rows.map((mi) => c.monitors[mi].label), ...axisStyle(t), splitLine: { show: false },
      axisLine: { show: false }, triggerEvent: true,
      axisLabel: {
        color: t.ink, fontSize: 12, margin: 10,
        formatter: (v, i) => {
          const m = c.monitors[rows[i]];
          const name = narrow && m.name.length > 13 ? `${m.name.slice(0, 12)}…` : m.name;
          const id = narrow ? "" : ` {id|${m.hashId}}`;
          return rows[i] === selected ? `{sel|${name}}${id}` : `${name}${id}`;
        },
        rich: { sel: { fontWeight: 700, color: t.ink, fontSize: 12 }, id: { color: t.muted, fontSize: 11 } },
      },
      ...extra,
    };
  }

  // ---------- main time series: highlighted monitor in color, the rest in gray ----------
  function timeSeries(c, an, o) {
    const t = theme();
    const { measure, selected, scale } = o;
    const series = [];
    const order = [...c.monitors].sort((a, b) => (a.idx === selected) - (b.idx === selected));
    order.forEach((m) => {
      const data = [];
      for (let i = an.i0; i <= an.i1; i++) {
        const v = m[measure][i];
        data.push([c.times[i], ok(v, scale) ? v : null]);
      }
      const sel = m.idx === selected;
      series.push({
        name: sel ? m.label : "Other monitors",
        type: "line", data, showSymbol: false, connectNulls: false, sampling: "lttb",
        silent: !sel, z: sel ? 5 : 2, animation: false,
        lineStyle: { width: sel ? 2 : 1, color: sel ? t.emph : t.context, opacity: sel ? 1 : 0.6, cap: "round", join: "round" },
        itemStyle: { color: sel ? t.emph : t.context },
        emphasis: { disabled: true },
      });
    });
    return {
      ...base(t),
      grid: { left: 48, right: 18, top: o.compactTop ? 28 : 40, bottom: o.zoom === false ? 28 : 72 },
      legend: {
        top: 0, left: 0, icon: "path://M0,4 L14,4 L14,6 L0,6 Z", itemWidth: 16, itemHeight: 6,
        textStyle: { color: t.ink2, fontSize: 13 }, selectedMode: false,
        data: [c.monitors[selected].label, "Other monitors"],
      },
      tooltip: {
        ...base(t).tooltip, trigger: "axis",
        axisPointer: { type: "line", lineStyle: { color: t.ink2, width: 1 } },
        formatter: (params) => {
          if (!params.length) return "";
          const i = an.i0 + params[0].dataIndex;
          const v = c.monitors[selected][measure][i];
          const others = c.monitors.map((m) => m[measure][i]).filter((x) => x != null).sort((a, b) => a - b);
          const mid = others.length ? others[Math.floor((others.length - 1) / 2)] : null;
          return tipBox(t, dates.time(c.times[i]), [
            { value: fmt(v), label: c.monitors[selected].name, color: t.emph },
            { value: others.length ? fmt(mid) : "No readings", label: "middle of all monitors", color: t.context },
          ]);
        },
      },
      xAxis: { type: "time", ...axisStyle(t), splitLine: { show: false },
        axisLabel: { color: t.muted, fontSize: 11, hideOverlap: true, formatter: (v) => dates.day(v) } },
      yAxis: valueAxis(t, scale, { name: o.unit || "", nameTextStyle: { color: t.muted, align: "left" } }),
      dataZoom: o.zoom === false ? [] : [
        { type: "inside", filterMode: "none" },
        { type: "slider", height: 26, bottom: 14, filterMode: "none", borderColor: t.rule, backgroundColor: "transparent",
          fillerColor: t.wash, handleStyle: { color: t.surface, borderColor: t.ink2 },
          moveHandleStyle: { color: t.rule }, textStyle: { color: t.muted, fontSize: 11 },
          labelFormatter: (v) => dates.day(v),
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
          color: t.muted, fontSize: 11,
          hideOverlap: true,
          interval: (i) => new Date(an.hours[i]).getUTCHours() === 0 && Math.round((an.hours[i] - an.hours[0]) / ROCIS.util.DAY) % dayEvery === 0,
          formatter: (v, i) => dates.day(an.hours[i]),
        },
      },
      yAxis: monitorAxis(t, c, rows, o.selected, o.narrow),
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
    const sel = o.selected;
    const hours = Array.from({ length: 24 }, (_, h) => dates.hour12(h));
    const keep = (v) => (ok(v, o.scale) ? v : null);
    const q1 = an.hod.q1.map(keep), q3 = an.hod.q3.map(keep);
    return {
      ...base(t),
      grid: { left: 46, right: 14, top: 36, bottom: 30 },
      legend: { top: 0, left: 0, icon: "path://M0,4 L14,4 L14,6 L0,6 Z", itemWidth: 16, itemHeight: 6, selectedMode: false,
        textStyle: { color: t.ink2, fontSize: 12 }, data: [c.monitors[sel].name, "All monitors"] },
      tooltip: {
        ...base(t).tooltip, trigger: "axis", axisPointer: { type: "line", lineStyle: { color: t.ink2 } },
        formatter: (ps) => {
          const h = ps[0].dataIndex;
          return tipBox(t, `${dates.hour12(h)} to ${dates.hour12((h + 1) % 24)}`, [
            { value: fmt(an.hod.perMonitor[sel][h]), label: c.monitors[sel].name, color: t.emph },
            { value: fmt(an.hod.mid[h]), label: "all monitors, middle", color: t.context },
            { value: `${fmt(an.hod.q1[h])} to ${fmt(an.hod.q3[h])}`, label: "middle half" },
          ]);
        },
      },
      xAxis: { type: "category", data: hours, boundaryGap: false, ...axisStyle(t), splitLine: { show: false },
        axisLabel: { color: t.muted, fontSize: 11, interval: 5 } },
      yAxis: valueAxis(t, o.scale),
      series: [
        { type: "line", data: q1, stack: "band", lineStyle: { opacity: 0 }, showSymbol: false, silent: true, areaStyle: { opacity: 0 } },
        { type: "line", data: q3.map((v, h) => (v != null && q1[h] != null ? v - q1[h] : null)), stack: "band",
          lineStyle: { opacity: 0 }, showSymbol: false, silent: true, areaStyle: { color: t.context, opacity: 0.22 } },
        { name: "All monitors", type: "line", data: an.hod.mid.map(keep), showSymbol: false, smooth: 0.2,
          lineStyle: { color: t.context, width: 2 }, itemStyle: { color: t.context } },
        { name: c.monitors[sel].name, type: "line", data: an.hod.perMonitor[sel].map(keep), smooth: 0.2, symbolSize: 6,
          showSymbol: false, lineStyle: { color: t.emph, width: 2 }, itemStyle: { color: t.emph } },
      ],
    };
  }

  // ---------- distribution per monitor ----------
  function boxplot(c, an, o) {
    const t = theme();
    const rows = [...an.order].reverse().filter((mi) => an.stats[mi].n);
    const floor = o.scale === "log" ? 1 : 0;
    const data = rows.map((mi) => {
      const s = an.stats[mi];
      const sel = mi === o.selected;
      return {
        value: [s.p10, s.q1, s.med, s.q3, s.p90].map((v) => Math.max(v, floor)),
        itemStyle: { color: sel ? alpha(t.emph, 0.22) : t.wash, borderColor: sel ? t.emph : t.dot, borderWidth: sel ? 2 : 1.5, opacity: 1 },
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
            { value: fmt(s.med), label: "middle reading" },
            { value: `${fmt(s.q1)} to ${fmt(s.q3)}`, label: "middle half" },
            { value: `${fmt(s.p10)} to ${fmt(s.p90)}`, label: "usual range" },
            { value: s.n.toLocaleString("en-US"), label: "15-minute values" },
          ]);
        },
      },
      xAxis: valueAxis(t, o.scale),
      yAxis: monitorAxis(t, c, rows, o.selected, o.narrow),
      series: [{ type: "boxplot", data, boxWidth: [6, 14] }],
      _rows: rows,
    };
  }

  // ---------- when each monitor reported ----------
  function coverage(c, an, o) {
    const t = theme();
    const rows = [...an.order].reverse();
    const data = [];
    rows.forEach((mi, y) => an.runs[mi].forEach(([a, b]) => data.push({ value: [y, a, b], sel: mi === o.selected })));
    return {
      ...base(t),
      grid: { left: o.labelWidth || 130, right: 18, top: 8, bottom: 30 },
      tooltip: { ...base(t).tooltip, trigger: "item",
        formatter: (p) => tipBox(t, c.monitors[rows[p.value[0]]].label, [{ value: `${dates.time(p.value[1])} to ${dates.time(p.value[2])}`, label: "" }]) },
      xAxis: { type: "time", min: c.times[an.i0], max: c.times[an.i1] + c.step, ...axisStyle(t),
        axisLabel: { color: t.muted, fontSize: 11, hideOverlap: true, formatter: (v) => dates.day(v) } },
      yAxis: monitorAxis(t, c, rows, o.selected, o.narrow),
      series: [{
        type: "custom", data, encode: { x: [1, 2], y: 0 },
        renderItem: (params, api) => {
          const y = api.value(0), start = api.coord([api.value(1), y]), end = api.coord([api.value(2), y]);
          const h = api.size([0, 1])[1] * 0.42;
          const item = data[params.dataIndex];
          return {
            type: "rect",
            shape: { x: start[0], y: start[1] - h / 2, width: Math.max(2, end[0] - start[0] - 1), height: h, r: 2 },
            style: { fill: item.sel ? t.emph : t.dot, opacity: item.sel ? 1 : 0.75 },
          };
        },
      }],
      _rows: rows,
    };
  }

  // ---------- calendar of daily middle values (all monitors) ----------
  function calendar(c, an, o) {
    const t = theme();
    const data = an.days.map((d, k) => [dates.iso(d).slice(0, 10), an.dailyOverall[k]]).filter((p) => p[1] != null);
    const vals = data.map((p) => p[1]).sort((a, b) => a - b);
    const first = dates.iso(an.days[0]).slice(0, 10), last = dates.iso(an.days[an.days.length - 1]).slice(0, 10);
    return {
      ...base(t),
      tooltip: { ...base(t).tooltip, trigger: "item",
        formatter: (p) => tipBox(t, p.value[0], [{ value: fmt(p.value[1]), label: "middle reading, all monitors" }]) },
      visualMap: { show: false, min: vals[0], max: vals[vals.length - 1], inRange: { color: t.ramp } },
      calendar: {
        range: [first, last], orient: "horizontal", top: 26, left: 34, cellSize: [o.cell || 30, o.cell || 30],
        splitLine: { lineStyle: { color: t.surface, width: 3 } }, itemStyle: { borderColor: t.surface, borderWidth: 3, color: t.wash },
        yearLabel: { show: false }, monthLabel: { color: t.ink2, fontSize: 12 }, dayLabel: { color: t.muted, fontSize: 11, firstDay: 0, nameMap: ["S", "M", "T", "W", "T", "F", "S"] },
      },
      series: [{ type: "heatmap", coordinateSystem: "calendar", data }],
    };
  }

  ROCIS.charts = { theme, timeSeries, heatmap, profile, boxplot, coverage, calendar };
})();
