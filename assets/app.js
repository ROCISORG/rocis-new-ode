/* State and wiring shared by every design: which cohort, measure, monitor, time range
   and scale are chosen, loading cohorts, and keeping all charts in step. */
(function () {
  const ROCIS = (window.ROCIS = window.ROCIS || {});
  const U = ROCIS.util;

  ROCIS.createApp = function createApp(cfg) {
    const state = { cohort: null, measure: "total", monitor: 0, range: "all", scale: "value" };
    const charts = {};
    let c = null, an = null, renderToken = 0;
    const app = { state, get cohort() { return c; }, get analysis() { return an; }, charts, select, setCohort, rerender: render };

    function chartFor(key) {
      const el = cfg.els[key];
      if (!el) return null;
      if (!charts[key]) {
        charts[key] = echarts.init(el, null, { renderer: "canvas" });
        const pick = (p) => {
          const rows = charts[key].__rows;
          if (!rows) return;
          if (p.componentType === "yAxis" && p.targetType === "axisLabel") {
            const m = app.cohort && app.cohort.monitors.find((x) => x.label === p.value);
            if (m) select(m.idx);
          } else if (p.componentType === "series" && p.data) {
            const y = Array.isArray(p.data) ? p.data[1] : p.data.value ? (key === "coverage" ? p.data.value[0] : null) : null;
            if (key === "boxplot") select(rows[p.dataIndex]);
            else if (y != null) select(rows[y]);
          }
        };
        charts[key].on("click", pick);
        new ResizeObserver(() => charts[key] && charts[key].resize()).observe(el);
      }
      return charts[key];
    }

    function setOption(key, option) {
      const chart = chartFor(key);
      if (!chart) return;
      chart.__rows = option._rows;
      delete option._rows;
      chart.setOption(option, { notMerge: true, lazyUpdate: true });
    }

    function render() {
      if (!c) return;
      const [i0, i1] = U.windowIdx(c, state.range);
      an = U.analyze(c, state.measure, i0, i1);
      cfg.beforeRender && cfg.beforeRender(app);
      const opts = { ...state, selected: state.monitor, unit: "", unitShort: "per 0.01 ft³" };
      const B = ROCIS.charts;
      const base = cfg.chartOptions || {};
      const over = {};
      ["timeSeries", "heatmap", "profile", "boxplot", "coverage", "calendar"].forEach((key) => {
        const el = cfg.els[key];
        const narrow = !!el && el.clientWidth > 0 && el.clientWidth < 600;
        over[key] = narrow ? { ...(base[key] || {}), narrow, labelWidth: 112, maxDayLabels: 3, toolbox: false } : base[key] || {};
      });
      if (cfg.els.timeSeries) setOption("timeSeries", B.timeSeries(c, an, { ...opts, ...(over.timeSeries || {}) }));
      if (cfg.els.heatmap) setOption("heatmap", B.heatmap(c, an, { ...opts, ...(over.heatmap || {}) }));
      if (cfg.els.profile) setOption("profile", B.profile(c, an, { ...opts, ...(over.profile || {}) }));
      if (cfg.els.boxplot) setOption("boxplot", B.boxplot(c, an, { ...opts, ...(over.boxplot || {}) }));
      if (cfg.els.coverage) setOption("coverage", B.coverage(c, an, { ...opts, ...(over.coverage || {}) }));
      if (cfg.els.calendar) setOption("calendar", B.calendar(c, an, { ...opts, ...(over.calendar || {}) }));
      cfg.onRender && cfg.onRender(app);
    }

    function select(idx) {
      if (idx == null || idx === state.monitor) return;
      state.monitor = idx;
      if (cfg.controls.monitor) cfg.controls.monitor.value = String(idx);
      render();
    }

    async function setCohort(n) {
      const token = ++renderToken;
      Object.values(charts).forEach((ch) => ch.showLoading && ch.showLoading("default", { text: "", color: ROCIS.charts.theme().emph, maskColor: "rgba(0,0,0,0)" }));
      let loaded;
      try {
        loaded = await ROCIS.load(n, cfg.base || "data/");
      } catch (err) {
        Object.values(charts).forEach((ch) => ch.hideLoading());
        cfg.onError && cfg.onError(err);
        return;
      }
      if (token !== renderToken) return;
      const previousHash = c && c.monitors[state.monitor] ? c.monitors[state.monitor].hashId : null;
      c = loaded;
      state.cohort = n;
      const [i0, i1] = U.windowIdx(c, state.range);
      const first = U.analyze(c, state.measure, i0, i1);
      const same = previousHash && c.monitors.find((m) => m.hashId === previousHash);
      const mostData = first.stats.reduce((best, s) => (s.n > best.n ? s : best), first.stats[0]);
      state.monitor = same ? same.idx : mostData.m.idx;
      fillMonitorSelect();
      Object.values(charts).forEach((ch) => ch.hideLoading());
      render();
    }

    function fillMonitorSelect() {
      const sel = cfg.controls.monitor;
      if (!sel) return;
      sel.replaceChildren();
      [...c.monitors].sort((a, b) => a.name.localeCompare(b.name)).forEach((m) => {
        const o = document.createElement("option");
        o.value = String(m.idx);
        o.textContent = m.label;
        sel.append(o);
      });
      sel.value = String(state.monitor);
    }

    function wireButtons(nodes, key) {
      if (!nodes) return;
      nodes.forEach((b) => b.addEventListener("click", () => {
        state[key] = b.dataset[key];
        nodes.forEach((o) => o.setAttribute("aria-pressed", String(o === b)));
        render();
      }));
    }

    // controls
    const manifest = ROCIS.getManifest();
    if (cfg.controls.cohort) {
      const sel = cfg.controls.cohort;
      [...manifest.cohorts].reverse().forEach((e) => {
        const o = document.createElement("option");
        o.value = String(e.cohort);
        o.textContent = `Cohort ${e.cohort}, ${U.dates.monthYear(Date.parse(e.first.replace(" ", "T") + "Z"))}`;
        sel.append(o);
      });
      sel.addEventListener("change", () => setCohort(+sel.value));
    }
    if (cfg.controls.monitor) cfg.controls.monitor.addEventListener("change", () => select(+cfg.controls.monitor.value));
    wireButtons(cfg.controls.measure, "measure");
    wireButtons(cfg.controls.range, "range");
    wireButtons(cfg.controls.scale, "scale");

    const watchTheme = () => { if (c) render(); };
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", watchTheme);
    new MutationObserver(watchTheme).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    const latest = manifest.cohorts[manifest.cohorts.length - 1].cohort;
    if (cfg.controls.cohort) cfg.controls.cohort.value = String(cfg.startCohort || latest);
    setCohort(cfg.startCohort || latest);
    return app;
  };
})();
