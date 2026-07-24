(() => {
  "use strict";

  /* ---------------------------------------------------------------------
   * Storage
   * ------------------------------------------------------------------- */
  const STORAGE_KEY = "pomodoro.v1";

  const DEFAULT_SETTINGS = {
    workMin: 25,
    shortBreakMin: 5,
    longBreakMin: 15,
    cycleLength: 4,
    dailyGoalMin: 120,
    autoStart: true,
    sound: true,
    notify: false,
  };

  function loadData() {
    let parsed = null;
    try {
      parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    } catch (e) {
      parsed = null;
    }
    const data = parsed && typeof parsed === "object" ? parsed : {};
    data.settings = Object.assign({}, DEFAULT_SETTINGS, data.settings || {});
    data.laps = Array.isArray(data.laps) ? data.laps : [];
    data.runtime = data.runtime && typeof data.runtime === "object" ? data.runtime : null;
    return data;
  }

  function saveData() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  }

  const db = loadData();

  /* ---------------------------------------------------------------------
   * Date / format helpers
   * ------------------------------------------------------------------- */
  const DAY_SHORT = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
  const DAY_LONG = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
  const MONTH_LONG = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
    "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

  function dateKey(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function startOfWeekMonday(d) {
    const clone = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const dow = clone.getDay(); // 0 Sun..6 Sat
    const diff = dow === 0 ? -6 : 1 - dow;
    clone.setDate(clone.getDate() + diff);
    return clone;
  }

  function addDays(d, n) {
    const clone = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    clone.setDate(clone.getDate() + n);
    return clone;
  }

  function pad2(n) { return String(n).padStart(2, "0"); }

  function formatMMSS(totalSeconds) {
    const s = Math.max(0, Math.round(totalSeconds));
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${pad2(m)}:${pad2(sec)}`;
  }

  function formatClock(iso) {
    const d = new Date(iso);
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }

  function formatMinutesLabel(mins) {
    const m = Math.round(mins);
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60);
    const rem = m % 60;
    return rem === 0 ? `${h}h` : `${h}h ${pad2(rem)}m`;
  }

  function uid() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  const PHASE_LABEL = { work: "Trabajo", short_break: "Descanso corto", long_break: "Descanso largo" };
  const PHASE_LABEL_SHORT = { work: "Trabajo", short_break: "Descanso", long_break: "Descanso largo" };

  /* ---------------------------------------------------------------------
   * DOM refs
   * ------------------------------------------------------------------- */
  const el = {
    sessionBadge: document.getElementById("sessionBadge"),
    sessionLabel: document.getElementById("sessionLabel"),
    ringProgress: document.getElementById("ringProgress"),
    timerDisplay: document.getElementById("timerDisplay"),
    timerSub: document.getElementById("timerSub"),
    startPauseBtn: document.getElementById("startPauseBtn"),
    skipBtn: document.getElementById("skipBtn"),
    resetBtn: document.getElementById("resetBtn"),
    autoStartToggle: document.getElementById("autoStartToggle"),
    dailyGoalText: document.getElementById("dailyGoalText"),
    dailyGoalFill: document.getElementById("dailyGoalFill"),
    dailyGoalMeter: document.getElementById("dailyGoalMeter"),
    statToday: document.getElementById("statToday"),
    statTodayCount: document.getElementById("statTodayCount"),
    statWeek: document.getElementById("statWeek"),
    statWeekCount: document.getElementById("statWeekCount"),
    statMonth: document.getElementById("statMonth"),
    statMonthCount: document.getElementById("statMonthCount"),
    statStreak: document.getElementById("statStreak"),
    statStreakSub: document.getElementById("statStreakSub"),
    lapsBody: document.getElementById("lapsBody"),
    clearTodayBtn: document.getElementById("clearTodayBtn"),
    clearAllBtn: document.getElementById("clearAllBtn"),
    settingsBtn: document.getElementById("settingsBtn"),
    closeSettingsBtn: document.getElementById("closeSettingsBtn"),
    settingsPanel: document.getElementById("settingsPanel"),
    overlay: document.getElementById("overlay"),
    settingsForm: document.getElementById("settingsForm"),
    workMin: document.getElementById("workMin"),
    shortBreakMin: document.getElementById("shortBreakMin"),
    longBreakMin: document.getElementById("longBreakMin"),
    cycleLength: document.getElementById("cycleLength"),
    dailyGoalMin: document.getElementById("dailyGoalMin"),
    soundToggle: document.getElementById("soundToggle"),
    notifyToggle: document.getElementById("notifyToggle"),
    themeToggle: document.getElementById("themeToggle"),
    toast: document.getElementById("toast"),
    weekChart: document.getElementById("weekChart"),
    monthChart: document.getElementById("monthChart"),
  };

  const RING_CIRC = 2 * Math.PI * 100;

  /* ---------------------------------------------------------------------
   * Timer state
   * ------------------------------------------------------------------- */
  function phaseDurationSec(phase, settings) {
    if (phase === "work") return settings.workMin * 60;
    if (phase === "long_break") return settings.longBreakMin * 60;
    return settings.shortBreakMin * 60;
  }

  function workLapsCountAllTime() {
    return db.laps.filter((l) => l.type === "work").length;
  }

  let state = initState();

  function initState() {
    const settings = db.settings;
    const rt = db.runtime;
    if (!rt) {
      const phase = "work";
      return {
        phase,
        isRunning: false,
        endAt: null,
        remainingSec: phaseDurationSec(phase, settings),
        phaseDurationSec: phaseDurationSec(phase, settings),
        phaseStartISO: null,
      };
    }

    let s = {
      phase: rt.phase || "work",
      isRunning: !!rt.isRunning,
      endAt: rt.endAt || null,
      remainingSec: typeof rt.remainingSec === "number" ? rt.remainingSec : phaseDurationSec(rt.phase || "work", settings),
      phaseDurationSec: typeof rt.phaseDurationSec === "number" ? rt.phaseDurationSec : phaseDurationSec(rt.phase || "work", settings),
      phaseStartISO: rt.phaseStartISO || null,
    };

    if (s.isRunning && s.endAt) {
      const now = Date.now();
      if (s.endAt <= now) {
        // Phase finished while the app was closed/backgrounded — settle it once,
        // then leave the following phase idle (or auto-started) from "now".
        finalizePhase(s, new Date(s.endAt));
        s = advancePhase(s, db.settings.autoStart);
      } else {
        s.remainingSec = Math.round((s.endAt - now) / 1000);
      }
    }
    return s;
  }

  function persistRuntime() {
    db.runtime = {
      phase: state.phase,
      isRunning: state.isRunning,
      endAt: state.endAt,
      remainingSec: state.remainingSec,
      phaseDurationSec: state.phaseDurationSec,
      phaseStartISO: state.phaseStartISO,
    };
    saveData();
  }

  // Logs a lap if the finishing phase was "work". Mutates nothing but `db.laps`.
  function finalizePhase(s, endDate) {
    if (s.phase === "work" && s.phaseStartISO) {
      const startDate = new Date(s.phaseStartISO);
      const durationSec = Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / 1000));
      db.laps.push({
        id: uid(),
        type: "work",
        dateKey: dateKey(startDate),
        startISO: startDate.toISOString(),
        endISO: endDate.toISOString(),
        durationSec,
      });
    }
    saveData();
  }

  // Returns a fresh state object for the phase that follows `s.phase`.
  function advancePhase(s, autoStart) {
    const settings = db.settings;
    let nextPhase;
    if (s.phase === "work") {
      const count = workLapsCountAllTime();
      nextPhase = count % settings.cycleLength === 0 ? "long_break" : "short_break";
    } else {
      nextPhase = "work";
    }
    const dur = phaseDurationSec(nextPhase, settings);
    return {
      phase: nextPhase,
      isRunning: !!autoStart,
      endAt: autoStart ? Date.now() + dur * 1000 : null,
      remainingSec: dur,
      phaseDurationSec: dur,
      phaseStartISO: autoStart ? new Date().toISOString() : null,
    };
  }

  /* ---------------------------------------------------------------------
   * Sound + notifications
   * ------------------------------------------------------------------- */
  let audioCtx = null;
  function playChime() {
    if (!db.settings.sound) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const now = audioCtx.currentTime;
      [523.25, 659.25, 783.99].forEach((freq, i) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0, now + i * 0.14);
        gain.gain.linearRampToValueAtTime(0.18, now + i * 0.14 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.14 + 0.32);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(now + i * 0.14);
        osc.stop(now + i * 0.14 + 0.34);
      });
    } catch (e) { /* audio unavailable — ignore */ }
  }

  function notify(title, body) {
    if (!db.settings.notify) return;
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    try { new Notification(title, { body, tag: "pomodoro" }); } catch (e) { /* ignore */ }
  }

  function showToast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.add("is-visible");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => el.toast.classList.remove("is-visible"), 2600);
  }

  /* ---------------------------------------------------------------------
   * Timer engine
   * ------------------------------------------------------------------- */
  function start() {
    if (state.isRunning) return;
    if (!state.phaseStartISO) state.phaseStartISO = new Date().toISOString();
    state.endAt = Date.now() + state.remainingSec * 1000;
    state.isRunning = true;
    persistRuntime();
    renderControls();
  }

  function pause() {
    if (!state.isRunning) return;
    state.remainingSec = Math.max(0, Math.round((state.endAt - Date.now()) / 1000));
    state.isRunning = false;
    state.endAt = null;
    persistRuntime();
    renderControls();
  }

  function resetPhase() {
    state.isRunning = false;
    state.endAt = null;
    state.phaseDurationSec = phaseDurationSec(state.phase, db.settings);
    state.remainingSec = state.phaseDurationSec;
    state.phaseStartISO = null;
    persistRuntime();
    renderAll();
  }

  function skipPhase() {
    // Manual skip never logs a lap (the pomodoro wasn't actually completed).
    state = advancePhase({ phase: state.phase }, db.settings.autoStart);
    persistRuntime();
    showToast(`Fase omitida → ${PHASE_LABEL[state.phase]}`);
    renderAll();
  }

  function completeCurrentPhase() {
    const endDate = new Date();
    const finishedPhase = state.phase;
    finalizePhase(state, endDate);
    playChime();
    if (finishedPhase === "work") {
      notify("¡Pomodoro completado!", "Hora de un descanso.");
    } else {
      notify("Descanso terminado", "Volvamos al trabajo.");
    }
    state = advancePhase({ phase: finishedPhase }, db.settings.autoStart);
    persistRuntime();
    showToast(
      finishedPhase === "work"
        ? "Pomodoro completado 🍅"
        : "Descanso completado"
    );
    renderAll();
  }

  function tick() {
    if (state.isRunning) {
      state.remainingSec = Math.round((state.endAt - Date.now()) / 1000);
      if (state.remainingSec <= 0) {
        completeCurrentPhase();
        return;
      }
    }
    renderTimerFace();
  }
  setInterval(tick, 250);

  /* ---------------------------------------------------------------------
   * Rendering — timer
   * ------------------------------------------------------------------- */
  function renderTimerFace() {
    el.timerDisplay.textContent = formatMMSS(state.remainingSec);
    const frac = state.phaseDurationSec > 0 ? state.remainingSec / state.phaseDurationSec : 0;
    el.ringProgress.style.strokeDashoffset = String(RING_CIRC * (1 - Math.min(1, Math.max(0, frac))));

    if (state.isRunning) {
      document.title = `${formatMMSS(state.remainingSec)} · ${PHASE_LABEL_SHORT[state.phase]}`;
    } else {
      document.title = "Pomodoro Tracker";
    }
  }

  function renderSessionBadge() {
    el.sessionBadge.dataset.phase = state.phase;
    el.sessionLabel.textContent = PHASE_LABEL[state.phase];
    if (state.phase === "work") {
      const posInCycle = (workLapsCountAllTime() % db.settings.cycleLength) + 1;
      el.timerSub.textContent = `Pomodoro ${posInCycle} de ${db.settings.cycleLength}`;
    } else {
      el.timerSub.textContent = state.phase === "long_break" ? "Descanso largo" : "Descanso corto";
    }
  }

  function renderControls() {
    el.startPauseBtn.textContent = state.isRunning ? "Pausar" : "Iniciar";
    el.startPauseBtn.dataset.running = state.isRunning ? "true" : "false";
  }

  function renderDailyGoal() {
    const goal = db.settings.dailyGoalMin;
    const todayMin = sumMinutes(db.laps.filter((l) => l.type === "work" && l.dateKey === dateKey(new Date())));
    const pct = goal > 0 ? Math.min(100, (todayMin / goal) * 100) : 0;
    el.dailyGoalText.textContent = `${Math.round(todayMin)} / ${goal} min`;
    el.dailyGoalFill.style.width = `${pct}%`;
    el.dailyGoalFill.dataset.complete = todayMin >= goal ? "true" : "false";
    el.dailyGoalMeter.setAttribute("aria-valuemax", String(goal));
    el.dailyGoalMeter.setAttribute("aria-valuenow", String(Math.round(todayMin)));
  }

  function sumMinutes(laps) {
    return laps.reduce((acc, l) => acc + l.durationSec, 0) / 60;
  }

  /* ---------------------------------------------------------------------
   * Rendering — stats
   * ------------------------------------------------------------------- */
  function renderStats() {
    const today = new Date();
    const todayK = dateKey(today);
    const weekStart = startOfWeekMonday(today);
    const weekStartK = dateKey(weekStart);
    const weekEndK = dateKey(addDays(weekStart, 6));
    const monthPrefix = `${today.getFullYear()}-${pad2(today.getMonth() + 1)}`;

    const workLaps = db.laps.filter((l) => l.type === "work");
    const todayLaps = workLaps.filter((l) => l.dateKey === todayK);
    const weekLaps = workLaps.filter((l) => l.dateKey >= weekStartK && l.dateKey <= weekEndK);
    const monthLaps = workLaps.filter((l) => l.dateKey.startsWith(monthPrefix));

    el.statToday.textContent = formatMinutesLabel(sumMinutes(todayLaps));
    el.statTodayCount.textContent = `${todayLaps.length} pomodoro${todayLaps.length === 1 ? "" : "s"}`;

    el.statWeek.textContent = formatMinutesLabel(sumMinutes(weekLaps));
    el.statWeekCount.textContent = `${weekLaps.length} pomodoro${weekLaps.length === 1 ? "" : "s"}`;

    el.statMonth.textContent = formatMinutesLabel(sumMinutes(monthLaps));
    el.statMonthCount.textContent = `${monthLaps.length} pomodoro${monthLaps.length === 1 ? "" : "s"}`;

    const streak = computeStreak(workLaps, today);
    el.statStreak.textContent = String(streak);
    el.statStreakSub.textContent = streak === 1 ? "día" : "días seguidos";
  }

  function computeStreak(workLaps, today) {
    const daysWithWork = new Set(workLaps.map((l) => l.dateKey));
    let streak = 0;
    let cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    // If nothing logged today yet, streak counting starts from yesterday.
    if (!daysWithWork.has(dateKey(cursor))) cursor = addDays(cursor, -1);
    while (daysWithWork.has(dateKey(cursor))) {
      streak++;
      cursor = addDays(cursor, -1);
    }
    return streak;
  }

  /* ---------------------------------------------------------------------
   * Rendering — laps table
   * ------------------------------------------------------------------- */
  function renderLaps() {
    const todayK = dateKey(new Date());
    const todayLaps = db.laps
      .filter((l) => l.dateKey === todayK)
      .sort((a, b) => a.startISO.localeCompare(b.startISO));

    el.lapsBody.innerHTML = "";
    if (todayLaps.length === 0) {
      const tr = document.createElement("tr");
      tr.className = "empty-row";
      const td = document.createElement("td");
      td.colSpan = 5;
      td.textContent = "Todavía no hay pomodoros hoy. ¡Presiona Iniciar!";
      tr.appendChild(td);
      el.lapsBody.appendChild(tr);
      return;
    }

    todayLaps.forEach((lap, idx) => {
      const tr = document.createElement("tr");

      const tdNum = document.createElement("td");
      tdNum.textContent = String(idx + 1);

      const tdType = document.createElement("td");
      const pill = document.createElement("span");
      pill.className = "type-pill";
      pill.dataset.type = lap.type;
      pill.textContent = PHASE_LABEL[lap.type] || lap.type;
      tdType.appendChild(pill);

      const tdStart = document.createElement("td");
      tdStart.textContent = formatClock(lap.startISO);

      const tdEnd = document.createElement("td");
      tdEnd.textContent = formatClock(lap.endISO);

      const tdDur = document.createElement("td");
      tdDur.textContent = formatMinutesLabel(lap.durationSec / 60);

      tr.append(tdNum, tdType, tdStart, tdEnd, tdDur);
      el.lapsBody.appendChild(tr);
    });
  }

  /* ---------------------------------------------------------------------
   * Charts (hand-rolled SVG bar charts)
   * ------------------------------------------------------------------- */
  function niceCeil(value) {
    if (value <= 0) return 10;
    const exp = Math.floor(Math.log10(value));
    const base = Math.pow(10, exp);
    const frac = value / base;
    let niceFrac;
    if (frac <= 1) niceFrac = 1;
    else if (frac <= 2) niceFrac = 2;
    else if (frac <= 5) niceFrac = 5;
    else niceFrac = 10;
    return niceFrac * base;
  }

  const SVG_NS = "http://www.w3.org/2000/svg";
  function svgEl(tag, attrs) {
    const node = document.createElementNS(SVG_NS, tag);
    if (attrs) for (const k in attrs) node.setAttribute(k, attrs[k]);
    return node;
  }

  /**
   * Renders a responsive single-series bar chart with hover tooltip and a
   * table-view fallback into `mount`.
   * items: [{ key, label, shortLabel, value, isToday }]
   */
  function renderBarChart(mount, items, opts) {
    mount.innerHTML = "";
    const holder = document.createElement("div");
    holder.className = "chart-svg-holder";
    mount.appendChild(holder);

    const H = opts.height || 200;
    const W = 700;
    const padLeft = 40, padRight = 6, padTop = 10, padBottom = 24;
    const plotW = W - padLeft - padRight;
    const plotH = H - padTop - padBottom;
    const n = items.length;

    const maxVal = Math.max(0, ...items.map((d) => d.value));
    const niceMax = niceCeil(maxVal || 1);
    const tickCount = 4;

    const svg = svgEl("svg", {
      class: "viz-svg",
      viewBox: `0 0 ${W} ${H}`,
      role: "img",
      "aria-label": opts.ariaLabel || "",
    });

    // Gridlines + y-axis ticks (rounded to clean numbers).
    for (let i = 0; i <= tickCount; i++) {
      const val = (niceMax / tickCount) * i;
      const y = padTop + plotH - (val / niceMax) * plotH;
      svg.appendChild(svgEl("line", {
        class: i === 0 ? "viz-baseline" : "viz-gridline",
        x1: padLeft, x2: W - padRight, y1: y, y2: y,
      }));
      const label = svgEl("text", {
        class: "viz-axis-label", x: padLeft - 8, y: y + 3, "text-anchor": "end",
      });
      label.textContent = Math.round(val);
      svg.appendChild(label);
    }

    const slotW = plotW / n;
    const barW = Math.max(3, Math.min(24, slotW * 0.6));

    items.forEach((d, i) => {
      const cx = padLeft + slotW * i + slotW / 2;
      const barH = niceMax > 0 ? (d.value / niceMax) * plotH : 0;
      const y = padTop + plotH - barH;

      const hit = svgEl("rect", {
        class: "viz-bar-hit",
        x: padLeft + slotW * i, y: padTop, width: slotW, height: plotH,
        tabindex: "0",
        "aria-label": `${d.label}: ${formatMinutesLabel(d.value)}`,
      });

      const bar = svgEl("rect", {
        class: "viz-bar",
        x: cx - barW / 2,
        y: barH > 0 ? y : padTop + plotH - 1,
        width: barW,
        height: Math.max(barH, 1),
        rx: 4,
        "data-today": d.isToday ? "true" : "false",
      });

      const labelStep = Math.max(1, Math.round(n / (opts.maxLabels || n)));
      const showLabel = i % labelStep === 0 || d.isToday || i === n - 1;
      if (showLabel) {
        const axisLabel = svgEl("text", {
          class: "viz-axis-label" + (d.isToday ? " is-today" : ""),
          x: cx, y: H - padBottom + 16, "text-anchor": "middle",
        });
        axisLabel.textContent = d.shortLabel;
        svg.appendChild(axisLabel);
      }

      svg.appendChild(hit);
      svg.appendChild(bar);

      const showTooltip = (evt) => {
        bar.classList.add("is-hovered");
        tooltip.classList.add("is-visible");
        tooltip.innerHTML = "";
        const strong = document.createElement("strong");
        strong.textContent = formatMinutesLabel(d.value);
        const small = document.createElement("span");
        small.className = "tt-label";
        small.textContent = d.label;
        tooltip.append(strong, small);
        const rectBounds = holder.getBoundingClientRect();
        const px = ((cx) / W) * rectBounds.width;
        const py = ((y) / H) * rectBounds.height;
        tooltip.style.left = `${px}px`;
        tooltip.style.top = `${Math.max(0, py - 8)}px`;
      };
      const hideTooltip = () => {
        bar.classList.remove("is-hovered");
        tooltip.classList.remove("is-visible");
      };
      hit.addEventListener("pointerenter", showTooltip);
      hit.addEventListener("pointermove", showTooltip);
      hit.addEventListener("pointerleave", hideTooltip);
      hit.addEventListener("focus", showTooltip);
      hit.addEventListener("blur", hideTooltip);
    });

    holder.appendChild(svg);

    const tooltip = document.createElement("div");
    tooltip.className = "viz-tooltip";
    holder.style.position = "relative";
    holder.appendChild(tooltip);

    // Table-view fallback (accessibility twin of the chart).
    const table = document.createElement("table");
    table.className = "chart-table";
    table.hidden = true;
    const thead = document.createElement("thead");
    thead.innerHTML = "";
    const trh = document.createElement("tr");
    ["Día", "Minutos"].forEach((h) => {
      const th = document.createElement("th");
      th.scope = "col";
      th.textContent = h;
      trh.appendChild(th);
    });
    thead.appendChild(trh);
    const tbody = document.createElement("tbody");
    items.forEach((d) => {
      const tr = document.createElement("tr");
      const tdL = document.createElement("td");
      tdL.textContent = d.label;
      const tdV = document.createElement("td");
      tdV.textContent = `${Math.round(d.value)} min`;
      tr.append(tdL, tdV);
      tbody.appendChild(tr);
    });
    table.append(thead, tbody);
    mount.appendChild(table);

    mount._table = table;
    mount._svgHolder = holder;
  }

  function toggleChartTable(mountId) {
    const mount = document.getElementById(mountId);
    if (!mount || !mount._table) return;
    const showingTable = !mount._table.hidden;
    mount._table.hidden = showingTable;
    mount._svgHolder.hidden = !showingTable;
    return !showingTable;
  }

  function renderWeekChart() {
    const today = new Date();
    const todayK = dateKey(today);
    const weekStart = startOfWeekMonday(today);
    const workLaps = db.laps.filter((l) => l.type === "work");
    const byDay = new Map();
    workLaps.forEach((l) => byDay.set(l.dateKey, (byDay.get(l.dateKey) || 0) + l.durationSec));

    const items = [];
    for (let i = 0; i < 7; i++) {
      const d = addDays(weekStart, i);
      const k = dateKey(d);
      items.push({
        key: k,
        label: `${DAY_LONG[d.getDay()]} ${d.getDate()} de ${MONTH_LONG[d.getMonth()]}`,
        shortLabel: DAY_SHORT[d.getDay()],
        value: (byDay.get(k) || 0) / 60,
        isToday: k === todayK,
      });
    }
    renderBarChart(el.weekChart, items, {
      height: 200,
      ariaLabel: "Minutos enfocados por día, semana actual",
    });
  }

  function renderMonthChart() {
    const today = new Date();
    const todayK = dateKey(today);
    const y = today.getFullYear(), m = today.getMonth();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const workLaps = db.laps.filter((l) => l.type === "work");
    const byDay = new Map();
    workLaps.forEach((l) => byDay.set(l.dateKey, (byDay.get(l.dateKey) || 0) + l.durationSec));

    const items = [];
    for (let day = 1; day <= daysInMonth; day++) {
      const d = new Date(y, m, day);
      const k = dateKey(d);
      items.push({
        key: k,
        label: `${day} de ${MONTH_LONG[m]}`,
        shortLabel: String(day),
        value: (byDay.get(k) || 0) / 60,
        isToday: k === todayK,
      });
    }
    renderBarChart(el.monthChart, items, {
      height: 180,
      maxLabels: 8,
      ariaLabel: `Minutos enfocados por día, ${MONTH_LONG[m]}`,
    });
  }

  /* ---------------------------------------------------------------------
   * Settings panel
   * ------------------------------------------------------------------- */
  function openSettings() {
    el.workMin.value = db.settings.workMin;
    el.shortBreakMin.value = db.settings.shortBreakMin;
    el.longBreakMin.value = db.settings.longBreakMin;
    el.cycleLength.value = db.settings.cycleLength;
    el.dailyGoalMin.value = db.settings.dailyGoalMin;
    el.soundToggle.checked = db.settings.sound;
    el.notifyToggle.checked = db.settings.notify;
    el.settingsPanel.hidden = false;
    el.overlay.hidden = false;
  }
  function closeSettings() {
    el.settingsPanel.hidden = true;
    el.overlay.hidden = true;
  }

  el.settingsBtn.addEventListener("click", openSettings);
  el.closeSettingsBtn.addEventListener("click", closeSettings);
  el.overlay.addEventListener("click", closeSettings);

  el.settingsForm.addEventListener("submit", (e) => {
    e.preventDefault();
    db.settings.workMin = clampInt(el.workMin.value, 1, 180, db.settings.workMin);
    db.settings.shortBreakMin = clampInt(el.shortBreakMin.value, 1, 60, db.settings.shortBreakMin);
    db.settings.longBreakMin = clampInt(el.longBreakMin.value, 1, 90, db.settings.longBreakMin);
    db.settings.cycleLength = clampInt(el.cycleLength.value, 2, 12, db.settings.cycleLength);
    db.settings.dailyGoalMin = clampInt(el.dailyGoalMin.value, 10, 960, db.settings.dailyGoalMin);
    db.settings.sound = el.soundToggle.checked;
    db.settings.notify = el.notifyToggle.checked;

    // If the current phase isn't running, resync its nominal duration to the
    // (possibly new) setting so the face reflects the edited value right away.
    const freshDur = phaseDurationSec(state.phase, db.settings);
    if (!state.isRunning) {
      state.phaseDurationSec = freshDur;
      state.remainingSec = freshDur;
    } else {
      // Keep remaining time proportionally, but cap it to the new duration.
      state.phaseDurationSec = freshDur;
      state.remainingSec = Math.min(state.remainingSec, freshDur);
      state.endAt = Date.now() + state.remainingSec * 1000;
    }
    saveData();
    persistRuntime();
    closeSettings();
    showToast("Ajustes guardados");
    renderAll();
  });

  function clampInt(val, min, max, fallback) {
    const n = parseInt(val, 10);
    if (Number.isNaN(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  el.notifyToggle.addEventListener("change", async () => {
    if (el.notifyToggle.checked && "Notification" in window && Notification.permission === "default") {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") el.notifyToggle.checked = false;
    }
  });

  /* ---------------------------------------------------------------------
   * Theme toggle
   * ------------------------------------------------------------------- */
  const THEME_KEY = "pomodoro.theme";
  function applyTheme(theme) {
    if (theme === "dark") {
      document.documentElement.setAttribute("data-theme", "dark");
      el.themeToggle.checked = true;
    } else if (theme === "light") {
      document.documentElement.setAttribute("data-theme", "light");
      el.themeToggle.checked = false;
    } else {
      document.documentElement.removeAttribute("data-theme");
      el.themeToggle.checked = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    }
  }
  applyTheme(localStorage.getItem(THEME_KEY));
  el.themeToggle.addEventListener("change", () => {
    const theme = el.themeToggle.checked ? "dark" : "light";
    localStorage.setItem(THEME_KEY, theme);
    applyTheme(theme);
  });

  /* ---------------------------------------------------------------------
   * Wire controls
   * ------------------------------------------------------------------- */
  el.startPauseBtn.addEventListener("click", () => {
    if (state.isRunning) pause(); else start();
  });
  el.skipBtn.addEventListener("click", skipPhase);
  el.resetBtn.addEventListener("click", resetPhase);

  el.autoStartToggle.checked = db.settings.autoStart;
  el.autoStartToggle.addEventListener("change", () => {
    db.settings.autoStart = el.autoStartToggle.checked;
    saveData();
  });

  el.clearTodayBtn.addEventListener("click", () => {
    const todayK = dateKey(new Date());
    const hasToday = db.laps.some((l) => l.dateKey === todayK);
    if (!hasToday) return;
    if (!confirm("¿Borrar todos los pomodoros registrados hoy?")) return;
    db.laps = db.laps.filter((l) => l.dateKey !== todayK);
    saveData();
    renderAll();
    showToast("Laps de hoy borrados");
  });

  el.clearAllBtn.addEventListener("click", () => {
    if (db.laps.length === 0) return;
    if (!confirm("Esto borrará TODO el historial de pomodoros de este navegador. ¿Continuar?")) return;
    db.laps = [];
    saveData();
    renderAll();
    showToast("Historial borrado");
  });

  document.querySelectorAll("[data-table-toggle]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const showingTable = toggleChartTable(btn.dataset.tableToggle);
      btn.textContent = showingTable ? "Ver gráfica" : "Ver tabla";
    });
  });

  /* ---------------------------------------------------------------------
   * Master render
   * ------------------------------------------------------------------- */
  function renderAll() {
    renderSessionBadge();
    renderTimerFace();
    renderControls();
    renderDailyGoal();
    renderStats();
    renderLaps();
    renderWeekChart();
    renderMonthChart();
  }

  // Re-render charts/stats at local midnight so "today" rolls over live.
  function scheduleMidnightRefresh() {
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
    setTimeout(() => { renderAll(); scheduleMidnightRefresh(); }, next.getTime() - now.getTime());
  }
  scheduleMidnightRefresh();

  renderAll();
})();
