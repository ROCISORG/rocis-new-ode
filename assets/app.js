/* State and wiring shared by every design: which cohort, measure, monitors, time range
   and scale are chosen, loading cohorts, and keeping all charts in step. */
(function () {
  const ROCIS = (window.ROCIS = window.ROCIS || {});
  const U = ROCIS.util;
  const MAX_PICKS = 8; // one color each from the --pick palette; more would need repeated hues

  ROCIS.createApp = function createApp(cfg) {
    const state = {
      cohort: null, measure: "total", range: "all", scale: "value", region: "all", others: "show",
      picked: [], // monitor idx in the order they were added
      custom: { from: null, to: null }, // day starts (ms, monitor clock) when range is "custom"
    };
    // a picked monitor keeps its color slot until it is removed, so adding one never repaints the others
    const slots = new Map(); // hashId -> slot
    const charts = {};
    // full: the cohort as loaded; c: what is shown (only Pennsylvania monitors when region is "pa")
    let full = null, c = null, an = null, renderToken = 0, hidden = 0;
    const app = {
      state, get cohort() { return c; }, get analysis() { return an; }, get hidden() { return hidden; },
      charts, select, toggle, reset, setCohort, setCustom, show, colorOf, rerender: render, MAX_PICKS,
    };

    function palette() {
      return getComputedStyle(document.documentElement).getPropertyValue("--pick").split(",").map((s) => s.trim()).filter(Boolean);
    }
    function colorOf(idx) {
      const m = c && c.monitors[idx];
      const slot = m ? slots.get(m.hashId) : undefined;
      return slot == null ? null : palette()[slot];
    }
    const picks = () => state.picked.map((idx) => ({ idx, color: colorOf(idx) }));

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
            if (m) toggle(m.idx);
          } else if (p.componentType === "series" && p.data) {
            const y = Array.isArray(p.data) ? p.data[1] : p.data.value ? (key === "coverage" ? p.data.value[0] : null) : null;
            if (key === "boxplot") toggle(rows[p.dataIndex]);
            else if (y != null) toggle(rows[y]);
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
      const [i0, i1] = U.windowIdx(c, state.range, state.custom);
      an = U.analyze(c, state.measure, i0, i1);
      cfg.beforeRender && cfg.beforeRender(app);
      const opts = { ...state, picks: picks(), unit: "", unitShort: "per 0.01 ft³" };
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

    function freeSlot() {
      const used = new Set(state.picked.map((i) => slots.get(c.monitors[i].hashId)));
      for (let s = 0; s < MAX_PICKS; s++) if (!used.has(s)) return s;
      return null;
    }
    function add(idx) {
      if (state.picked.includes(idx)) return true;
      if (state.picked.length >= MAX_PICKS) return false;
      slots.set(c.monitors[idx].hashId, freeSlot());
      state.picked.push(idx);
      return true;
    }

    // make one monitor the only one picked
    function select(idx) {
      if (idx == null || !c) return;
      state.picked = [];
      slots.clear();
      add(idx);
      render();
    }

    // add a monitor to the comparison, or take it out; at least one stays picked
    function toggle(idx) {
      if (idx == null || !c) return;
      const at = state.picked.indexOf(idx);
      if (at >= 0) {
        if (state.picked.length === 1) return;
        state.picked.splice(at, 1);
        slots.delete(c.monitors[idx].hashId);
      } else if (!add(idx)) {
        cfg.onLimit && cfg.onLimit(MAX_PICKS);
        return;
      }
      render();
    }

    function reset() {
      if (!c) return;
      const [i0, i1] = U.windowIdx(c, state.range, state.custom);
      const stats = U.analyze(c, state.measure, i0, i1).stats;
      select(stats.reduce((best, s) => (s.n > best.n ? s : best), stats[0]).m.idx);
    }

    function setCustom(from, to) {
      state.range = "custom";
      state.custom = { from, to };
      (cfg.controls.range || []).forEach((o) => o.setAttribute("aria-pressed", String(o.dataset.range === "custom")));
      render();
    }

    const isPA = (m) => (m.state || "PA") === "PA";

    function viewOf(cohort) {
      if (state.region !== "pa") return cohort;
      const kept = cohort.monitors.filter(isPA);
      // a cohort with no Pennsylvania monitors is shown whole rather than empty
      if (!kept.length || kept.length === cohort.monitors.length) return cohort;
      return { ...cohort, monitors: kept.map((m, i) => ({ ...m, idx: i })) };
    }

    function applyView(prefer) {
      const keepHashes = c ? state.picked.map((i) => c.monitors[i] && c.monitors[i].hashId).filter(Boolean) : [];
      const sameCohort = c && full && c.cohort === full.cohort;
      c = viewOf(full);
      hidden = full.monitors.length - c.monitors.length;
      if (!sameCohort) state.custom = { from: null, to: null };
      if (state.range === "custom" && !sameCohort) {
        state.range = "all";
        (cfg.controls.range || []).forEach((o) => o.setAttribute("aria-pressed", String(o.dataset.range === "all")));
      }
      const wanted = prefer && c.monitors.find(prefer);
      // picks carry over when they are in the new view (another cohort, or switching PA only)
      const kept = wanted ? [] : keepHashes.map((h) => c.monitors.find((m) => m.hashId === h)).filter(Boolean);
      const oldSlots = new Map(slots);
      state.picked = [];
      slots.clear();
      kept.forEach((m) => { state.picked.push(m.idx); slots.set(m.hashId, oldSlots.get(m.hashId)); });
      if (wanted) add(wanted.idx);
      if (!state.picked.length) {
        const [i0, i1] = U.windowIdx(c, state.range, state.custom);
        const stats = U.analyze(c, state.measure, i0, i1).stats;
        add(stats.reduce((best, s) => (s.n > best.n ? s : best), stats[0]).m.idx);
      }
      cfg.onCohort && cfg.onCohort(app);
      render();
    }

    function setRegion(region) {
      state.region = region;
      (cfg.controls.region || []).forEach((o) => o.setAttribute("aria-pressed", String(o.dataset.region === region)));
    }

    // open cohort n with the monitor for a neighborhood code picked
    function show(n, code) {
      const base = (m) => m.code.split("_")[0] === code;
      if (cfg.controls.cohort) cfg.controls.cohort.value = String(n);
      if (n === state.cohort && full) {
        const target = full.monitors.find(base);
        if (target && !isPA(target)) setRegion("all");
        return applyView(base);
      }
      return setCohort(n, base, true);
    }

    async function setCohort(n, prefer, allowOutside) {
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
      full = loaded;
      state.cohort = n;
      const target = prefer && full.monitors.find(prefer);
      if (allowOutside && target && !isPA(target)) setRegion("all");
      Object.values(charts).forEach((ch) => ch.hideLoading());
      applyView(prefer);
    }

    function wireButtons(nodes, key, after) {
      if (!nodes) return;
      nodes.forEach((b) => b.addEventListener("click", () => {
        state[key] = b.dataset[key];
        nodes.forEach((o) => o.setAttribute("aria-pressed", String(o === b)));
        after && after(b.dataset[key]);
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
    wireButtons(cfg.controls.measure, "measure");
    wireButtons(cfg.controls.range, "range", cfg.onRange);
    wireButtons(cfg.controls.scale, "scale");
    wireButtons(cfg.controls.others, "others");
    (cfg.controls.region || []).forEach((b) => b.addEventListener("click", () => {
      setRegion(b.dataset.region);
      if (full) applyView();
    }));

    const watchTheme = () => { if (c) render(); };
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", watchTheme);
    new MutationObserver(watchTheme).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    const latest = manifest.cohorts[manifest.cohorts.length - 1].cohort;
    if (cfg.controls.cohort) cfg.controls.cohort.value = String(cfg.startCohort || latest);
    setCohort(cfg.startCohort || latest);
    return app;
  };
})();
