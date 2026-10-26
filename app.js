/* Curve Lab — a dependency-free three-factor yield-curve toy. */
(() => {
  "use strict";

  const D = window.CURVE_DATA;
  if (!D) return;

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const NS = "http://www.w3.org/2000/svg";

  const COLORS = ["#2f6fed", "#d97a35", "#7c3aed"];
  const INK = "#14213d";
  const MUTED = "#69707f";
  const GRID = "#e4ded2";
  const BASE_LINE = "#8e99ad";
  const GREEN = "#1f8a70";
  const RED = "#c94c4c";
  const PC_NAMES = ["PC1 · Level", "PC2 · Slope", "PC3 · Curvature"];
  const SD = D.meta.sdBp.map(v => v / 100);

  const state = {
    sigma: [0, 0, 0],
    solo: null,
    showEvent: false,
    display: D.base.slice(),
    target: D.base.slice(),
    animId: 0,
    replayIndex: D.eventDates.length - 1,
    playing: false,
    playTimer: null,
    preset: null,
  };

  const el = (tag, attrs = {}, parent = null) => {
    const node = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined) continue;
      node.setAttribute(k, String(v));
    }
    if (parent) parent.appendChild(node);
    return node;
  };
  const text = (tag, attrs, content, parent) => {
    const node = el(tag, attrs, parent);
    node.textContent = content;
    return node;
  };
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const fmt = (v, d = 0) => {
    if (Math.abs(v) < 0.05) return (0).toFixed(d);
    return Math.abs(v).toFixed(d);
  };
  const signed = (v, d = 0, unit = "") => {
    if (Math.abs(v) < 0.05) return "0" + unit;
    return (v > 0 ? "+" : "−") + Math.abs(v).toFixed(d) + unit;
  };
  const signedBp = (v, d = 0) => signed(v, d, " bp");
  const pct = (v) => v.toFixed(2) + "%";
  const sigmaText = (v) => (Math.abs(v) < 0.05 ? "0.0" : (v > 0 ? "+" : "−") + Math.abs(v).toFixed(1)) + "σ";

  function scoreFromSigma(sigma) {
    return sigma.map((v, j) => v * SD[j]);
  }

  function curveFromSigma(sigma, solo = null) {
    const y = D.base.slice();
    const score = scoreFromSigma(sigma);
    for (let j = 0; j < 3; j++) {
      if (solo !== null && solo !== j) continue;
      for (let i = 0; i < y.length; i++) y[i] += D.loadings[j][i] * score[j];
    }
    return y;
  }

  function metrics(y) {
    const y2 = y[3], y5 = y[5], y10 = y[7], y30 = y[9];
    const slope = (y10 - y2) * 100;
    const fly = (2 * y5 - y2 - y10) * 100;
    return {
      y2, y5, y10, y30, slope, fly,
      d2: (y2 - D.base[3]) * 100,
      d10: (y10 - D.base[7]) * 100,
      d30: (y30 - D.base[9]) * 100,
      dSlope: slope - D.baseMetrics.slope,
      dFly: fly - D.baseMetrics.fly,
    };
  }

  // ---------- SVG geometry ----------
  const W = 760, H = 420, ML = 48, MR = 18, MT = 28, MB = 46;
  const xMin = Math.log10(D.tenors[0] + 1);
  const xMax = Math.log10(D.tenors[D.tenors.length - 1] + 1);
  const yMin = 2.6, yMax = 5.85;

  const xAt = (i) => ML + ((Math.log10(D.tenors[i] + 1) - xMin) / (xMax - xMin)) * (W - ML - MR);
  const yAt = (v, h = H, top = MT, bottom = MB, lo = yMin, hi = yMax) => top + ((hi - v) / (hi - lo)) * (h - top - bottom);

  function linePath(values, h = H, top = MT, bottom = MB, lo = yMin, hi = yMax) {
    return values.map((v, i) => `${i ? "L" : "M"}${xAt(i).toFixed(2)},${yAt(v, h, top, bottom, lo, hi).toFixed(2)}`).join(" ");
  }

  function drawAxes(svg, opts = {}) {
    const h = opts.h || H, top = opts.top || MT, bottom = opts.bottom || MB;
    const lo = opts.lo || yMin, hi = opts.hi || yMax;
    const gridColor = opts.gridColor || GRID;
    const labelColor = opts.labelColor || MUTED;
    const yStep = opts.yStep || 0.5;
    const yStart = Math.ceil(lo / yStep) * yStep;
    for (let v = yStart; v <= hi + 0.001; v += yStep) {
      const y = yAt(v, h, top, bottom, lo, hi);
      el("line", { x1: ML, x2: W - MR, y1: y, y2: y, stroke: gridColor, "stroke-width": 1 }, svg);
      text("text", { x: ML - 9, y: y + 3, "text-anchor": "end", fill: labelColor, "font-size": 9, "font-family": "SFMono-Regular, ui-monospace, Menlo, monospace" }, v.toFixed(1) + "%", svg);
    }
    for (let i = 0; i < D.labels.length; i++) {
      const x = xAt(i);
      el("line", { x1: x, x2: x, y1: h - bottom, y2: h - bottom + 4, stroke: gridColor }, svg);
      text("text", { x, y: h - bottom + 18, "text-anchor": "middle", fill: labelColor, "font-size": 9.5, "font-family": "Avenir Next, Helvetica Neue, Arial, sans-serif" }, D.labels[i], svg);
    }
    text("text", { x: ML - 2, y: top - 9, fill: labelColor, "font-size": 8, "letter-spacing": 1.1, "font-family": "Avenir Next, Helvetica Neue, Arial, sans-serif" }, "PAR YIELD", svg);
  }

  function reveal(svg) {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
  }

  // ---------- Hero chart ----------
  function drawHero() {
    const svg = $("#heroChart");
    if (!svg) return;
    reveal(svg);
    const h = 390, top = 22, bottom = 34;
    const lo = 3.25, hi = 5.55;
    const gridColor = "rgba(255,255,255,.11)";
    const labelColor = "#7383a1";

    for (let v = 3.5; v <= 5.5; v += 0.5) {
      const y = yAt(v, h, top, bottom, lo, hi);
      el("line", { x1: 20, x2: W - 20, y1: y, y2: y, stroke: gridColor }, svg);
      text("text", { x: 22, y: y - 5, fill: labelColor, "font-size": 8, "font-family": "SFMono-Regular, ui-monospace, Menlo, monospace" }, v.toFixed(1) + "%", svg);
    }

    const defs = el("defs", {}, svg);
    const grad = el("linearGradient", { id: "heroFill", x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    el("stop", { offset: "0%", "stop-color": "#5a8fff", "stop-opacity": .28 }, grad);
    el("stop", { offset: "100%", "stop-color": "#5a8fff", "stop-opacity": 0 }, grad);

    const basePath = D.base.map((v, i) => `${i ? "L" : "M"}${xAt(i).toFixed(1)},${yAt(v, h, top, bottom, lo, hi).toFixed(1)}`).join(" ");
    const eventPath = D.event.map((v, i) => `${i ? "L" : "M"}${xAt(i).toFixed(1)},${yAt(v, h, top, bottom, lo, hi).toFixed(1)}`).join(" ");
    const areaPath = `${eventPath} L${xAt(D.event.length - 1).toFixed(1)},${yAt(lo, h, top, bottom, lo, hi).toFixed(1)} L${xAt(0).toFixed(1)},${yAt(lo, h, top, bottom, lo, hi).toFixed(1)} Z`;
    el("path", { d: areaPath, fill: "url(#heroFill)" }, svg);
    el("path", { d: basePath, fill: "none", stroke: "#9aa6bb", "stroke-width": 1.6, "stroke-dasharray": "5 4", "stroke-linecap": "round" }, svg);
    el("path", { d: eventPath, fill: "none", stroke: "#5a8fff", "stroke-width": 2.8, "stroke-linecap": "round", "stroke-linejoin": "round" }, svg);

    D.base.forEach((v, i) => {
      el("circle", { cx: xAt(i), cy: yAt(v, h, top, bottom, lo, hi), r: 2.2, fill: "#9aa6bb" }, svg);
    });
    D.event.forEach((v, i) => {
      el("circle", { cx: xAt(i), cy: yAt(v, h, top, bottom, lo, hi), r: 3.2, fill: "#101a30", stroke: "#7ea6ff", "stroke-width": 1.7 }, svg);
    });

    [0, 3, 5, 7, 9].forEach(i => {
      text("text", { x: xAt(i), y: h - 12, "text-anchor": "middle", fill: labelColor, "font-size": 9, "font-family": "Avenir Next, Helvetica Neue, Arial, sans-serif" }, D.labels[i], svg);
    });

    const y2 = yAt(D.event[3], h, top, bottom, lo, hi);
    text("text", { x: xAt(3) + 8, y: y2 - 10, fill: "#b9d0ff", "font-size": 9, "font-weight": 700, "font-family": "SFMono-Regular, ui-monospace, Menlo, monospace" }, "−109 bp", svg);
    const y10 = yAt(D.event[7], h, top, bottom, lo, hi);
    text("text", { x: xAt(7) + 8, y: y10 - 10, fill: "#b9d0ff", "font-size": 9, "font-weight": 700, "font-family": "SFMono-Regular, ui-monospace, Menlo, monospace" }, "−54 bp", svg);
  }

  // ---------- Live curve ----------
  function drawCurve(y) {
    const svg = $("#curveChart");
    if (!svg) return;
    reveal(svg);
    drawAxes(svg);

    const defs = el("defs", {}, svg);
    const grad = el("linearGradient", { id: "curveFill", x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    const fillColor = state.solo === null ? COLORS[0] : COLORS[state.solo];
    el("stop", { offset: "0%", "stop-color": fillColor, "stop-opacity": .16 }, grad);
    el("stop", { offset: "100%", "stop-color": fillColor, "stop-opacity": 0 }, grad);

    const area = `${linePath(y)} L${xAt(y.length - 1).toFixed(1)},${(H - MB).toFixed(1)} L${xAt(0).toFixed(1)},${(H - MB).toFixed(1)} Z`;
    el("path", { d: area, fill: "url(#curveFill)" }, svg);

    el("path", { d: linePath(D.base), fill: "none", stroke: BASE_LINE, "stroke-width": 1.5, "stroke-dasharray": "5 4", "stroke-linecap": "round" }, svg);

    if (state.showEvent) {
      el("path", { d: linePath(D.event), fill: "none", stroke: COLORS[2], "stroke-width": 1.6, "stroke-dasharray": "2 4", "stroke-linecap": "round", opacity: .75 }, svg);
    }

    el("path", { d: linePath(y), fill: "none", stroke: fillColor, "stroke-width": 2.8, "stroke-linecap": "round", "stroke-linejoin": "round" }, svg);

    y.forEach((v, i) => {
      const cx = xAt(i), cy = yAt(v);
      el("circle", { cx, cy, r: 4.3, fill: "#fffdf8", stroke: fillColor, "stroke-width": 2 }, svg);
      if (state.showEvent) {
        const cy2 = yAt(D.event[i]);
        el("circle", { cx, cy: cy2, r: 3.3, fill: COLORS[2], opacity: .9 }, svg);
      }
      const hit = el("circle", { cx, cy, r: 16, fill: "transparent", style: "cursor:crosshair" }, svg);
      hit.addEventListener("mouseenter", (ev) => showTooltip(ev, i, v));
      hit.addEventListener("mousemove", (ev) => moveTooltip(ev));
      hit.addEventListener("mouseleave", hideTooltip);
    });

    const last = y.length - 1;
    text("text", { x: xAt(last) - 4, y: yAt(y[last]) - 11, "text-anchor": "end", fill: fillColor, "font-size": 10, "font-weight": 700, "font-family": "SFMono-Regular, ui-monospace, Menlo, monospace" }, pct(y[last]), svg);
  }

  function drawChange(y) {
    const svg = $("#changeChart");
    if (!svg) return;
    reveal(svg);
    const h = 150, top = 14, bottom = 26, left = ML, right = MR;
    const changes = y.map((v, i) => (v - D.base[i]) * 100);
    const maxAbs = Math.max(20, ...changes.map(v => Math.abs(v)), ...(state.showEvent ? D.eventActual.map(v => Math.abs(v)) : [0]));
    const dom = Math.ceil(maxAbs / 20) * 20;
    const zero = top + (h - top - bottom) / 2;
    const scale = (h - top - bottom) / (2 * dom);
    const width = W - left - right;
    const slot = width / D.labels.length;
    const bw = Math.min(34, slot * .52);

    [dom, 0, -dom].forEach(v => {
      const yy = zero - v * scale;
      el("line", { x1: left, x2: W - right, y1: yy, y2: yy, stroke: v === 0 ? "#b8b0a2" : GRID, "stroke-width": 1 }, svg);
      text("text", { x: left - 9, y: yy + 3, "text-anchor": "end", fill: "#8b93a1", "font-size": 8, "font-family": "SFMono-Regular, ui-monospace, Menlo, monospace" }, (v > 0 ? "+" : "") + v, svg);
    });

    changes.forEach((v, i) => {
      const cx = left + slot * (i + .5);
      const yy = zero - v * scale;
      const color = state.solo === null ? (v <= 0 ? COLORS[0] : COLORS[1]) : COLORS[state.solo];
      el("rect", { x: cx - bw / 2, y: Math.min(zero, yy), width: bw, height: Math.max(1.2, Math.abs(yy - zero)), rx: 2.5, fill: color, opacity: .9 }, svg);
      text("text", { x: cx, y: h - 8, "text-anchor": "middle", fill: "#69707f", "font-size": 8.5, "font-family": "Avenir Next, Helvetica Neue, Arial, sans-serif" }, D.labels[i], svg);
    });

    if (state.showEvent) {
      D.eventActual.forEach((v, i) => {
        const cx = left + slot * (i + .5);
        const yy = zero - v * scale;
        el("rect", { x: cx - 2.6, y: yy - 2.6, width: 5.2, height: 5.2, transform: `rotate(45 ${cx} ${yy})`, fill: INK }, svg);
      });
    }
  }

  function showTooltip(ev, i, value) {
    const tip = $("#chartTooltip");
    const wrap = $("#curveWrap");
    if (!tip || !wrap) return;
    const d = value - D.base[i];
    tip.innerHTML = `<b>${D.labels[i]}</b> &nbsp;${pct(value)} <span>${signedBp(d * 100)}</span>`;
    tip.classList.add("is-on");
    const rect = wrap.getBoundingClientRect();
    tip.style.left = clamp(ev.clientX - rect.left + 14, 8, rect.width - 130) + "px";
    tip.style.top = clamp(ev.clientY - rect.top - 42, 4, rect.height - 40) + "px";
  }
  function moveTooltip(ev) {
    const tip = $("#chartTooltip"), wrap = $("#curveWrap");
    if (!tip || !wrap) return;
    const rect = wrap.getBoundingClientRect();
    tip.style.left = clamp(ev.clientX - rect.left + 14, 8, rect.width - 130) + "px";
    tip.style.top = clamp(ev.clientY - rect.top - 42, 4, rect.height - 40) + "px";
  }
  function hideTooltip() {
    const tip = $("#chartTooltip");
    if (tip) tip.classList.remove("is-on");
  }

  // ---------- Factor UI ----------
  function setRangeFill(input, value, min, max, color) {
    const p = ((value - min) / (max - min)) * 100;
    const c = 50;
    let bg;
    if (p >= c) {
      bg = `linear-gradient(to right, #e4dfd4 0%, #e4dfd4 ${c}%, ${color} ${c}%, ${color} ${p}%, #e4dfd4 ${p}%, #e4dfd4 100%)`;
    } else {
      bg = `linear-gradient(to right, #e4dfd4 0%, #e4dfd4 ${p}%, ${color} ${p}%, ${color} ${c}%, #e4dfd4 ${c}%, #e4dfd4 100%)`;
    }
    input.style.background = bg;
  }

  function impactForFactor(j, score) {
    if (j === 0) return D.loadings[0][7] * score * 100; // 10Y
    if (j === 1) return (D.loadings[1][7] - D.loadings[1][3]) * score * 100; // 2s10s
    return (2 * D.loadings[2][5] - D.loadings[2][3] - D.loadings[2][7]) * score * 100; // fly
  }

  function updateFactors() {
    const score = scoreFromSigma(state.sigma);
    const ranges = [$("#pc1"), $("#pc2"), $("#pc3")];
    const vals = [$("#pc1val"), $("#pc2val"), $("#pc3val")];
    const impacts = [$("#pc1impact"), $("#pc2impact"), $("#pc3impact")];
    const units = ["10Y", "2s10s", "5Y fly"];
    for (let j = 0; j < 3; j++) {
      ranges[j].value = state.sigma[j];
      setRangeFill(ranges[j], state.sigma[j], -16, 16, COLORS[j]);
      vals[j].textContent = sigmaText(state.sigma[j]);
      const imp = impactForFactor(j, score[j]);
      impacts[j].textContent = `${units[j]} ${signedBp(imp)}`;
      ranges[j].setAttribute("aria-valuetext", `${sigmaText(state.sigma[j])}, ${units[j]} ${signedBp(imp)}`);
    }

    $$(".factor-card").forEach((card, j) => {
      card.classList.toggle("is-solo", state.solo === j);
      card.classList.toggle("is-dim", state.solo !== null && state.solo !== j);
    });
    $$(".solo-btn").forEach((btn, j) => {
      btn.setAttribute("aria-pressed", String(state.solo === j));
      btn.textContent = state.solo === j ? "All" : "Solo";
    });
    const badge = $("#soloBadge");
    if (badge) {
      badge.hidden = state.solo === null;
      badge.textContent = state.solo === null ? "" : `Solo · PC${state.solo + 1}`;
    }
  }

  // ---------- Readout ----------
  function shapeFor(m) {
    const level = m.d10 < -3 ? "bull" : m.d10 > 3 ? "bear" : "flat";
    const slope = m.dSlope > 3 ? "steepener" : m.dSlope < -3 ? "flattener" : "parallel";
    const curve = m.dFly > 3 ? "belly cheapening" : m.dFly < -3 ? "belly richening" : "butterfly neutral";
    let title = cap(level) + " " + slope;
    if (level === "flat" && slope === "parallel") title = Math.abs(m.dFly) > 3 ? "A pure twist" : "Base curve";
    return { level, slope, curve, title };
  }

  function whyFor(m, s) {
    const nearZero = s.every(v => Math.abs(v) < .05);
    if (nearZero) {
      return "Start from 9 March 2023. Drag a dial to build a move. PC1 moves the whole curve; PC2 changes the 2s10s slope; PC3 twists the wings against the belly.";
    }
    const score = scoreFromSigma(s);
    const c1 = impactForFactor(0, score[0]);
    const c2 = impactForFactor(1, score[1]);
    const c3 = impactForFactor(2, score[2]);
    const bits = [];
    if (Math.abs(c1) > 1) bits.push(`PC1 does ${signedBp(c1)} at the 10Y`);
    if (Math.abs(c2) > 1) bits.push(`PC2 adds ${signedBp(c2)} to 2s10s`);
    if (Math.abs(c3) > 1) bits.push(`PC3 adds ${signedBp(c3)} to the 5Y fly`);
    let lead = bits.length ? bits.join(", ") + "." : "The factors are close to cancelling out.";
    let story = "";
    if (m.d10 < -2 && m.dSlope > 2) {
      story = "Lower yields with a much lower front end is the classic flight-to-quality / rate-cut signature — the shape of March 2023.";
    } else if (m.d10 > 2 && m.dSlope < -2) {
      story = "Higher yields with a flatter curve is the classic hawkish / term-premium signature — the market is pricing a tougher Fed.";
    } else if (Math.abs(m.dFly) > 2 && Math.abs(m.d10) < 5) {
      story = "The long end is not moving much; this is a relative-value move in the belly, the kind of twist that hurts bullet-versus-barbell positions.";
    } else if (Math.abs(m.d10) > 8) {
      story = "This is a large level shock. It swamps the other factors and is the main driver of duration P&L.";
    } else {
      story = "The shape is mixed: level, slope and curvature are all contributing, so no single narrative dominates.";
    }
    return `${lead} ${story}`;
  }

  function renderReadout(m) {
    $("#m10y").textContent = pct(m.y10);
    $("#d10y").textContent = signedBp(m.d10);
    $("#m2s10s").textContent = signedBp(m.slope);
    $("#d2s10s").textContent = signedBp(m.dSlope);
    $("#mfly").textContent = signedBp(m.fly);
    $("#dfly").textContent = signedBp(m.dFly);
    $("#m30").textContent = pct(m.y30);
    $("#d30").textContent = signedBp(m.d30);

    ["#d10y", "#d2s10s", "#dfly", "#d30"].forEach((sel) => {
      const node = $(sel);
      node.classList.remove("up", "down");
      const v = parseFloat(node.textContent.replace("−", "-"));
      if (v > 0.4) node.classList.add("up");
      if (v < -0.4) node.classList.add("down");
    });

    const shape = shapeFor(m);
    $("#shapeTitle").textContent = shape.title;
    $("#shapeSentence").textContent = `${shape.title === "Base curve" ? "The 9 March 2023 curve, before any factor is applied." : `${cap(shape.level)} ${shape.slope}: 10Y ${signedBp(m.d10)}, 2s10s ${signedBp(m.dSlope)}.`} ${shape.title === "Base curve" ? "Drag a dial to build a move." : `${cap(shape.curve)}: 5Y fly ${signedBp(m.dFly)}.`}`;
    $("#whyText").textContent = whyFor(m, state.sigma);

    setWinner("#winBond", "#winBondText", "#winBondTag", m.d10 < -1, m.d10 > 1,
      m.d10 < -1 ? "Duration wins as yields fall." : m.d10 > 1 ? "Duration loses as yields rise." : "Little duration impact.",
      m.d10 < -1 ? "Wins" : m.d10 > 1 ? "Loses" : "Flat");
    setWinner("#winSlope", "#winSlopeText", "#winSlopeTag", m.dSlope > 1, m.dSlope < -1,
      m.dSlope > 1 ? "Steepener gains as 2s10s widens." : m.dSlope < -1 ? "Steepener loses as 2s10s flattens." : "Slope barely moves.",
      m.dSlope > 1 ? "Wins" : m.dSlope < -1 ? "Loses" : "Flat");
    setWinner("#winFly", "#winFlyText", "#winFlyTag", m.dFly < -1, m.dFly > 1,
      m.dFly < -1 ? "Belly richens; the 5Y bullet wins." : m.dFly > 1 ? "Belly cheapens; the barbell wins." : "Butterfly barely moves.",
      m.dFly < -1 ? "Bullet" : m.dFly > 1 ? "Barbell" : "Flat");
  }

  function setWinner(rowSel, textSel, tagSel, good, bad, copy, tag) {
    const row = $(rowSel), txt = $(textSel), tg = $(tagSel);
    txt.textContent = copy;
    tg.textContent = tag;
    tg.classList.remove("good", "bad");
    if (good) tg.classList.add("good");
    if (bad) tg.classList.add("bad");
  }

  // ---------- Animation ----------
  function animateTo(target, instant = false) {
    cancelAnimationFrame(state.animId);
    state.target = target.slice();
    if (instant) {
      state.display = target.slice();
      drawCurve(state.display);
      drawChange(state.display);
      return;
    }
    const start = state.display.slice();
    const t0 = performance.now();
    const dur = 260;
    const tick = (now) => {
      const t = clamp((now - t0) / dur, 0, 1);
      const e = 1 - Math.pow(1 - t, 3);
      state.display = start.map((v, i) => v + (target[i] - v) * e);
      drawCurve(state.display);
      drawChange(state.display);
      if (t < 1) state.animId = requestAnimationFrame(tick);
    };
    state.animId = requestAnimationFrame(tick);
  }

  function updateAll({ instant = false, animate = true } = {}) {
    const target = curveFromSigma(state.sigma, state.solo);
    updateFactors();
    renderReadout(metrics(target));
    if (animate) animateTo(target, instant);
    else { state.display = target; drawCurve(target); drawChange(target); }
    $$(".chip[data-preset]").forEach(b => b.classList.toggle("is-active", b.dataset.preset === state.preset));
  }

  // ---------- Presets ----------
  function applyPreset(name) {
    state.preset = name;
    if (name === "reset") {
      state.sigma = [0, 0, 0];
      state.solo = null;
      state.showEvent = false;
      const cb = $("#showEvent"); if (cb) cb.checked = false;
    } else if (name === "svb") {
      state.sigma = D.meta.eventScoresSigma.slice();
      state.solo = null;
      state.showEvent = true;
      const cb = $("#showEvent"); if (cb) cb.checked = true;
    } else if (name === "bull") {
      state.sigma = [-7, 5, 0];
      state.solo = null;
    } else if (name === "bear") {
      state.sigma = [7, -5, 0];
      state.solo = null;
    } else if (name === "twist") {
      state.sigma = [0, 0, 10];
      state.solo = null;
    }
    updateAll();
  }

  // ---------- Replay ----------
  function drawReplay() {
    const svg = $("#replayChart");
    if (!svg) return;
    reveal(svg);
    const h = 390, top = 24, bottom = 40;
    const lo = 3.2, hi = 5.5;
    drawAxes(svg, { h, top, bottom, lo, hi, yStep: .5 });

    const idx = state.replayIndex;
    D.eventCurves.forEach((curve, k) => {
      const alpha = k === idx ? 1 : .16 + k * .045;
      const color = k === idx ? COLORS[0] : "#2f6fed";
      el("path", {
        d: linePath(curve, h, top, bottom, lo, hi),
        fill: "none", stroke: color, "stroke-width": k === idx ? 3 : 1.2,
        opacity: k === idx ? 1 : alpha, "stroke-linecap": "round",
      }, svg);
    });
    el("path", { d: linePath(D.base, h, top, bottom, lo, hi), fill: "none", stroke: BASE_LINE, "stroke-width": 1.5, "stroke-dasharray": "5 4" }, svg);

    const current = D.eventCurves[idx];
    current.forEach((v, i) => {
      el("circle", { cx: xAt(i), cy: yAt(v, h, top, bottom, lo, hi), r: 3.8, fill: "#fffdf8", stroke: COLORS[0], "stroke-width": 2 }, svg);
    });

    [3, 7].forEach(i => {
      const x = xAt(i) + 7;
      const y = yAt(current[i], h, top, bottom, lo, hi) - 9;
      text("text", { x, y, fill: COLORS[0], "font-size": 9, "font-weight": 700, "font-family": "SFMono-Regular, ui-monospace, Menlo, monospace" }, `${D.labels[i]} ${current[i].toFixed(2)}%`, svg);
    });

    text("text", { x: W - MR, y: 18, "text-anchor": "end", fill: MUTED, "font-size": 10, "font-family": "SFMono-Regular, ui-monospace, Menlo, monospace" }, D.eventLabels[idx], svg);
  }

  function updateReplayUI() {
    const idx = state.replayIndex;
    const curve = D.eventCurves[idx];
    $("#replayTitle").textContent = `${D.eventLabels[idx]} 2023`;
    $("#replayMetrics").textContent = `2Y ${curve[3].toFixed(2)}% · 10Y ${curve[7].toFixed(2)}% · 2s10s ${signedBp((curve[7] - curve[3]) * 100)}`;
    $("#replayDayCount").textContent = `Day ${idx + 1} / 7`;
    $("#replayRange").value = idx;
    $$(".tl-item").forEach((item, i) => item.classList.toggle("is-active", i === idx));
    drawReplay();
  }

  function setReplayIndex(idx) {
    state.replayIndex = clamp(idx, 0, D.eventDates.length - 1);
    updateReplayUI();
  }

  function stopPlay() {
    state.playing = false;
    if (state.playTimer) clearInterval(state.playTimer);
    state.playTimer = null;
    const label = $("#playLabel");
    if (label) label.textContent = "Play the week";
    const icon = $("#replayPlay .play-icon");
    if (icon) icon.textContent = "▶";
  }

  function togglePlay() {
    if (state.playing) { stopPlay(); return; }
    state.playing = true;
    const label = $("#playLabel");
    if (label) label.textContent = "Pause";
    const icon = $("#replayPlay .play-icon");
    if (icon) icon.textContent = "❚❚";
    if (state.replayIndex >= D.eventDates.length - 1) setReplayIndex(0);
    state.playTimer = setInterval(() => {
      if (state.replayIndex >= D.eventDates.length - 1) { stopPlay(); return; }
      setReplayIndex(state.replayIndex + 1);
    }, 900);
  }

  // ---------- Static analytical charts ----------
  function drawDecomp() {
    const svg = $("#decompChart");
    if (!svg) return;
    reveal(svg);
    const h = 360, top = 26, bottom = 44, lo = -130, hi = 55;
    const left = ML, right = MR;
    const y = (v) => top + ((hi - v) / (hi - lo)) * (h - top - bottom);
    const width = W - left - right;
    const slot = width / D.labels.length;
    const bw = Math.min(36, slot * .56);

    for (let v = 40; v >= -120; v -= 40) {
      el("line", { x1: left, x2: W - right, y1: y(v), y2: y(v), stroke: v === 0 ? "#b8b0a2" : GRID }, svg);
      text("text", { x: left - 9, y: y(v) + 3, "text-anchor": "end", fill: "#8b93a1", "font-size": 8, "font-family": "SFMono-Regular, ui-monospace, Menlo, monospace" }, (v > 0 ? "+" : "") + v, svg);
    }
    text("text", { x: 12, y: top - 10, fill: MUTED, "font-size": 8, "letter-spacing": 1, "font-family": "Avenir Next, Helvetica Neue, Arial, sans-serif" }, "BP", svg);

    D.labels.forEach((label, i) => {
      let pos = 0, neg = 0;
      for (let j = 0; j < 3; j++) {
        const v = D.eventContrib[j][i];
        const y0 = y(v >= 0 ? pos : neg);
        const y1 = y(v >= 0 ? pos + v : neg + v);
        el("rect", { x: left + slot * (i + .5) - bw / 2, y: Math.min(y0, y1), width: bw, height: Math.max(1, Math.abs(y1 - y0)), fill: COLORS[j], opacity: .94 }, svg);
        if (v >= 0) pos += v; else neg += v;
      }
      const cx = left + slot * (i + .5), cy = y(D.eventActual[i]);
      el("rect", { x: cx - 4, y: cy - 4, width: 8, height: 8, transform: `rotate(45 ${cx} ${cy})`, fill: INK }, svg);
      text("text", { x: cx, y: h - 12, "text-anchor": "middle", fill: MUTED, "font-size": 8.5, "font-family": "Avenir Next, Helvetica Neue, Arial, sans-serif" }, label, svg);
    });

    // call out the 2Y residual, the worst fit
    const cx2 = left + slot * 3.5;
    text("text", { x: cx2 + 20, y: y(D.eventActual[3]) + 16, fill: RED, "font-size": 8.5, "font-family": "Avenir Next, Helvetica Neue, Arial, sans-serif" }, "2Y residual 9.5 bp", svg);
  }

  function drawScores() {
    const svg = $("#scoreChart");
    if (!svg) return;
    reveal(svg);
    const h = 360, top = 26, bottom = 44, lo = -16, hi = 12;
    const left = ML, right = MR;
    const y = (v) => top + ((hi - v) / (hi - lo)) * (h - top - bottom);
    const width = W - left - right;
    const step = width / (D.eventScoresSigma.length - 1);
    const x = (i) => left + i * step;

    for (let v = 10; v >= -15; v -= 5) {
      el("line", { x1: left, x2: W - right, y1: y(v), y2: y(v), stroke: v === 0 ? "#b8b0a2" : GRID }, svg);
      text("text", { x: left - 9, y: y(v) + 3, "text-anchor": "end", fill: "#8b93a1", "font-size": 8, "font-family": "SFMono-Regular, ui-monospace, Menlo, monospace" }, (v > 0 ? "+" : "") + v, svg);
    }
    text("text", { x: 12, y: top - 10, fill: MUTED, "font-size": 8, "letter-spacing": 1, "font-family": "Avenir Next, Helvetica Neue, Arial, sans-serif" }, "DAILY σ", svg);

    for (let j = 0; j < 3; j++) {
      const pts = D.eventScoresSigma.map((row, i) => [x(i), y(row[j])]);
      const path = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
      el("path", { d: path, fill: "none", stroke: COLORS[j], "stroke-width": 2.3, "stroke-linecap": "round", "stroke-linejoin": "round" }, svg);
      pts.forEach((p, i) => {
        el("circle", { cx: p[0], cy: p[1], r: 3.6, fill: "#fffdf8", stroke: COLORS[j], "stroke-width": 2 }, svg);
      });
      const last = pts[pts.length - 1];
      text("text", { x: last[0] - 6, y: last[1] - 9, "text-anchor": "end", fill: COLORS[j], "font-size": 9, "font-weight": 700, "font-family": "SFMono-Regular, ui-monospace, Menlo, monospace" }, sigmaText(D.eventScoresSigma[6][j]), svg);
    }

    D.eventLabels.forEach((label, i) => {
      text("text", { x: x(i), y: h - 13, "text-anchor": "middle", fill: MUTED, "font-size": 8.5, "font-family": "Avenir Next, Helvetica Neue, Arial, sans-serif" }, label, svg);
    });
  }

  function drawFingerprints() {
    $$("[data-fingerprint]").forEach((svg) => {
      const j = Number(svg.dataset.fingerprint);
      reveal(svg);
      const vals = D.loadings[j];
      const w = 170, h = 34, pad = 6;
      const min = Math.min(...vals), max = Math.max(...vals);
      const span = Math.max(0.1, max - min);
      const x = (i) => pad + (i / (vals.length - 1)) * (w - 2 * pad);
      const y = (v) => 4 + ((max - v) / span) * (h - 8);
      el("line", { x1: pad, x2: w - pad, y1: y(0), y2: y(0), stroke: "#e1dbcf", "stroke-width": 1 }, svg);
      const path = vals.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
      el("path", { d: path, fill: "none", stroke: COLORS[j], "stroke-width": 1.7, "stroke-linecap": "round", "stroke-linejoin": "round" }, svg);
      vals.forEach((v, i) => {
        if (i === 7 || i === 0 || i === vals.length - 1) {
          el("circle", { cx: x(i), cy: y(v), r: i === 7 ? 2.8 : 1.8, fill: COLORS[j], stroke: "#fffdf8", "stroke-width": i === 7 ? 1.2 : .7 }, svg);
        }
      });
    });
  }

  // ---------- Bind ----------
  function bind() {
    [0, 1, 2].forEach((j) => {
      const input = [$("#pc1"), $("#pc2"), $("#pc3")][j];
      input.addEventListener("input", () => {
        state.sigma[j] = Number(input.value);
        state.preset = null;
        updateAll({ animate: false });
      });
      input.addEventListener("change", () => {
        state.preset = null;
        updateAll();
      });
    });

    $$(".solo-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const j = Number(btn.dataset.solo);
        state.solo = state.solo === j ? null : j;
        updateAll();
      });
    });

    $("#resetBtn").addEventListener("click", () => applyPreset("reset"));
    $$(".chip[data-preset]").forEach((btn) => {
      btn.addEventListener("click", () => applyPreset(btn.dataset.preset));
    });

    $("#showEvent").addEventListener("change", (e) => {
      state.showEvent = e.target.checked;
      drawCurve(state.display);
      drawChange(state.display);
    });

    $("#replayRange").addEventListener("input", (e) => {
      stopPlay();
      setReplayIndex(Number(e.target.value));
    });
    $("#replayPlay").addEventListener("click", togglePlay);
    $("#replayPrev").addEventListener("click", () => { stopPlay(); setReplayIndex(state.replayIndex - 1); });
    $("#replayNext").addEventListener("click", () => { stopPlay(); setReplayIndex(state.replayIndex + 1); });
    $$(".tl-item").forEach((item) => {
      item.addEventListener("click", () => { stopPlay(); setReplayIndex(Number(item.dataset.index)); });
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { stopPlay(); hideTooltip(); }
    });
  }

  function init() {
    drawHero();
    drawFingerprints();
    drawDecomp();
    drawScores();
    bind();
    updateAll({ instant: true, animate: false });
    updateReplayUI();
    const preset = new URLSearchParams(window.location.search).get("preset");
    if (preset && ["svb", "bull", "bear", "twist", "reset"].includes(preset)) applyPreset(preset);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
