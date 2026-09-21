/* =========================================================================
   app.js — 沙盒前端：Tab 路由 / 图表 / 交互 / 结果渲染
   ========================================================================= */
(function () {
  "use strict";

  /* ---------------- 基础工具 ---------------- */
  const SVGNS = "http://www.w3.org/2000/svg";
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));

  function S(tag, attrs, kids) {
    const n = document.createElementNS(SVGNS, tag);
    if (attrs) for (const k in attrs) if (attrs[k] !== null && attrs[k] !== undefined) n.setAttribute(k, attrs[k]);
    (kids || []).forEach(c => n.appendChild(typeof c === "string" ? document.createTextNode(c) : c));
    return n;
  }
  function H(tag, cls, html) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html !== undefined && html !== null) n.innerHTML = html;
    return n;
  }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function fmt(v, d) {
    if (v === null || v === undefined || Number.isNaN(v)) return "—";
    if (!isFinite(v)) return v > 0 ? "∞" : "-∞";
    return v.toLocaleString("zh-CN", { minimumFractionDigits: d || 0, maximumFractionDigits: d === undefined ? 2 : d });
  }
  const pct = (v, d) => (v === null || v === undefined || Number.isNaN(v)) ? "—" : (v * 100).toFixed(d === undefined ? 1 : d) + "%";
  function signPct(v, d) { return (v >= 0 ? "+" : "") + pct(v, d); }
  function money(v) {
    if (v >= 1e8) return "¥" + (v / 1e8).toFixed(2) + "亿";
    if (v >= 1e4) return "¥" + (v / 1e4).toFixed(1) + "万";
    return "¥" + Math.round(v);
  }
  function pFmt(p) {
    if (p === null || p === undefined || Number.isNaN(p)) return "—";
    if (p < 1e-4) return "<0.0001";
    return p.toFixed(4);
  }
  function sig(p, alpha) {
    if (p === null) return '<span class="pill gray">无数据</span>';
    return p < (alpha || 0.05) ? '<span class="pill ok">显著</span>' : '<span class="pill gray">不显著</span>';
  }

  /* ---------------- 通用绘图 ---------------- */
  function makePlot(host, o) {
    host.innerHTML = "";
    const w = o.w || host.clientWidth || 620;
    const h = o.h || 240;
    const pad = Object.assign({ l: 48, r: 16, t: 14, b: 30 }, o.pad || {});
    const svg = S("svg", { viewBox: `0 0 ${w} ${h}`, width: "100%", height: h, role: "img" });
    const pw = w - pad.l - pad.r, ph = h - pad.t - pad.b;
    const xd = o.xd, yd = o.yd;
    const X = v => pad.l + (v - xd[0]) / (xd[1] - xd[0] || 1) * pw;
    const Y = v => pad.t + ph - (v - yd[0]) / (yd[1] - yd[0] || 1) * ph;
    const g = S("g"); svg.appendChild(g);
    host.appendChild(svg);
    return { svg, g, X, Y, pad, pw, ph, w, h, xd, yd };
  }
  function niceTicks(a, b, n) {
    const span = b - a; if (!isFinite(span) || span <= 0) return [a];
    const step0 = span / n, mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const norm = step0 / mag;
    const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
    const out = []; let v = Math.ceil(a / step) * step;
    for (; v <= b + 1e-9; v += step) out.push(Math.round(v / step) * step);
    return out;
  }
  function axes(P, o) {
    const { g, X, Y, pad, pw, ph, xd, yd } = P;
    const xt = o.xticks || niceTicks(xd[0], xd[1], o.nx || 6);
    const yt = o.yticks || niceTicks(yd[0], yd[1], o.ny || 4);
    yt.forEach(t => {
      if (t < yd[0] - 1e-9 || t > yd[1] + 1e-9) return;
      const y = Y(t);
      g.appendChild(S("line", { x1: pad.l, x2: pad.l + pw, y1: y, y2: y, class: "gridline" }));
      g.appendChild(S("text", { x: pad.l - 7, y: y + 3.5, "text-anchor": "end", class: "lbl" },
        [(o.yfmt ? o.yfmt(t) : fmt(t, 0))]));
    });
    xt.forEach(t => {
      if (t < xd[0] - 1e-9 || t > xd[1] + 1e-9) return;
      const x = X(t);
      g.appendChild(S("text", { x: x, y: pad.t + ph + 15, "text-anchor": "middle", class: "lbl" },
        [(o.xfmt ? o.xfmt(t) : fmt(t, 0))]));
    });
    g.appendChild(S("line", { x1: pad.l, x2: pad.l + pw, y1: pad.t + ph, y2: pad.t + ph, class: "axis" }));
    if (o.xlabel) g.appendChild(S("text", { x: pad.l + pw / 2, y: pad.t + ph + 27, "text-anchor": "middle", class: "lbl-b" }, [o.xlabel]));
    if (o.ylabel) g.appendChild(S("text", {
      x: 11, y: pad.t + ph / 2, "text-anchor": "middle", class: "lbl-b",
      transform: `rotate(-90 11 ${pad.t + ph / 2})`
    }, [o.ylabel]));
  }
  function path(P, pts) {
    return pts.map((p, i) => (i ? "L" : "M") + P.X(p[0]).toFixed(2) + "," + P.Y(p[1]).toFixed(2)).join(" ");
  }
  const C_A = "#5c7fa3", C_B = "#0f8a72", C_BRAND = "#0d5a68", C_ACC = "#b9762a", C_MUTE = "#8695a4", C_DANGER = "#c0392b";

  /* =========================================================================
     状态
     ========================================================================= */
  const state = {
    rows: null,
    params: null,
    upto: 0,
    running: false,
    timer: null,
    analysis: null,
    baseline: window.BASELINE || null,
    aaDone: false,
    speed: 1,
  };

  const TABS = ["overview", "data", "design", "run", "diag", "decision"];
  function showTab(t) {
    TABS.forEach(x => {
      $("#p-" + x).classList.toggle("active", x === t);
      const btn = document.querySelector(`.tab[data-t="${x}"]`);
      if (btn) btn.classList.toggle("active", x === t);
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (t === "data") renderData();
    if (t === "design") renderDesign();
    if (t === "diag") renderDiag();
    if (t === "decision") renderDecision();
    if (t === "run") { if (!state.rows) initRunTab(); else renderRun(true); }
  }

  /* =========================================================================
     1. 数据源页
     ========================================================================= */
  function renderData() {
    const B = state.baseline;
    if (!B) return;

    /* 头部统计 */
    const totalAwards = (B.amountBands || []).reduce((s, b) => s + (b.count || 0), 0);
    $("#pillRows").textContent = `真实记录 ${totalAwards.toLocaleString("zh-CN")} 条合同`;

    /* 金额分布直方图（对数 x） */
    const bands = B.amountBands || [];
    if (bands.length) {
      const xs = bands.map(b => Math.log10(b.lo));
      const ys = bands.map(b => b.count);
      const xd = [Math.min(...xs) - 0.05, Math.max(...xs) + 0.3];
      const yd = [0, Math.max(...ys) * 1.15];
      const P = makePlot($("#chartAmt"), {
        h: 250, xd, yd, nx: 6,
        xfmt: v => {
          const a = Math.pow(10, v);
          if (a >= 1e9) return (a / 1e9).toFixed(0) + "B";
          if (a >= 1e6) return (a / 1e6).toFixed(0) + "M";
          if (a >= 1e3) return (a / 1e3).toFixed(0) + "K";
          return a.toFixed(0);
        },
        yfmt: v => v >= 1e6 ? (v / 1e6).toFixed(1) + "M" : v >= 1e3 ? (v / 1e3).toFixed(0) + "K" : v.toFixed(0),
        xlabel: "合同金额（美元，对数刻度）", ylabel: "合同数量",
      });
      axes(P, { xd, yd, xlabel: "合同金额（美元，对数刻度）", ylabel: "合同数量", nx: 6, yfmt: v => v >= 1e6 ? (v / 1e6).toFixed(1) + "M" : v >= 1e3 ? (v / 1e3).toFixed(0) + "K" : v.toFixed(0) });
      const w = P.pw / bands.length;
      bands.forEach((b, i) => {
        const x = P.X(xs[i]) - w / 2;
        const y = P.Y(b.count);
        P.g.appendChild(S("rect", {
          x: x + 0.5, y: y, width: Math.max(1, w - 1), height: P.Y(0) - y,
          fill: C_BRAND, opacity: 0.75
        }, [S("title", {}, [`${money(b.lo)} – ${money(b.hi)}\n${b.count.toLocaleString("zh-CN")} 条`])]));
      });
      // 对照：若强行用对数正态拟合（四分位距反推 σ）
      const E = B.empirical;
      if (E) {
        const muI = Math.log(E.median), sI = E.sigmaIqr;
        const pts = [];
        for (let i = 0; i <= 140; i++) {
          const lg = xd[0] + (xd[1] - xd[0]) * i / 140;
          const x = Math.pow(10, lg);
          const d = Math.exp(-Math.pow(Math.log(x) - muI, 2) / (2 * sI * sI)) / (x * sI * Math.sqrt(2 * Math.PI));
          pts.push([lg, d * totalAwards]);
        }
        P.g.appendChild(S("path", { d: path(P, pts), fill: "none", stroke: C_ACC, "stroke-width": 2, "stroke-dasharray": "6 3" }));
      }
      const lg = H("div", "legend");
      lg.appendChild(H("span", "", `<i style="background:${C_BRAND}"></i>实测分带计数`));
      lg.appendChild(H("span", "", `<i style="background:${C_ACC}"></i>若强行拟合对数正态`));
      $("#chartAmt").appendChild(lg);
      $("#amtSub").innerHTML =
        `实测 <b>${totalAwards.toLocaleString("zh-CN")}</b> 条合同（${(B.generatedFrom.periods || []).join(" + ")} 两个财年，
        逐带调用官方计数接口）· 覆盖 $${B.generatedFrom.bandRangeUSD[0].toLocaleString("en-US")} –
        $${(B.generatedFrom.bandRangeUSD[1] / 1e6).toFixed(1)}M 区间，
        占该期间全部合同动作的 <b>${pct(B.generatedFrom.coverage, 1)}</b>（其余为 $1,000 以下的微额采购）`;
    }

    /* 拟合对照表 */
    const E = B.empirical || {};
    const scaleF = B.scale ? B.scale.factor : 3.2;
    let html = `<table><thead><tr><th>分位数</th><th class="n">真实数据（美元）</th><th class="n">对数正态预测</th><th class="n">沙盒场景（元）</th></tr></thead><tbody>`;
    const qt = [["P25", E.p25], ["P50 中位数", E.median], ["P75", E.p75], ["P90", E.p90], ["P99", E.p99]];
    qt.forEach(r => {
      const z = { "P25": -0.6745, "P50 中位数": 0, "P75": 0.6745, "P90": 1.2816, "P99": 2.3263 }[r[0]];
      const pred = Math.exp(Math.log(E.median) + E.sigmaIqr * z);
      const ratio = r[1] / pred;
      html += `<tr><td>${r[0]}</td><td class="n">$${Math.round(r[1]).toLocaleString("en-US")}</td>
        <td class="n" style="color:${ratio > 2 || ratio < 0.5 ? "var(--danger)" : "var(--ink-2)"}">$${Math.round(pred).toLocaleString("en-US")}</td>
        <td class="n">${money(r[1] * scaleF)}</td></tr>`;
    });
    html += `</tbody></table>
      <div class="note bad" style="margin-top:12px"><b>实测结论：这个分布不是对数正态。</b>
      按四分位距反推 σ=<b>${fmt(E.sigmaIqr, 3)}</b>，它在分布主体上还算贴合，
      但预测的 P99 只有 <b>$${Math.round(E.p99PredIqr).toLocaleString("en-US")}</b>，实测是
      <b>$${Math.round(E.p99).toLocaleString("en-US")}</b> —— <b>低估 ${fmt(E.p99RatioIqr, 1)} 倍</b>；
      改用对数空间最小二乘拟合（σ=${fmt(E.fitLogStdLS, 2)}），尾部又虚高约 ${fmt(E.fitP99RatioLS, 0)} 倍。
      两个方向都失败。</div>
      <div class="note"><b>所以沙盒没有拟合任何分布。</b>金额直接<b>从实测的经验分布抽样</b>
      （43 个对数分带、共 ${(B.generatedFrom.nContractsCounted / 1e6).toFixed(2)} 百万条合同的计数），
      只做一次显式的尺度平移 ×${fmt(scaleF, 4)}（真实中位数 $${Math.round(E.median).toLocaleString("en-US")}
      → 沙盒中位数 ¥18,000），并在真实分布的 P99 处截断，避免把项目级/多年期合同带进单张采购申请。
      <b>形状全部来自真实数据，没有任何参数化假设。</b></div>`;
    $("#tblFit").innerHTML = html;

    /* 分带拟合偏差诊断图 */
    const bf = (E.bandFit || []).filter(r => r[2] > 0 && r[3] > 0);
    if (bf.length > 3) {
      const xs = bf.map(r => Math.log10(r[0]));
      const ratios = bf.map(r => r[2] / r[3]);
      const xd = [Math.min(...xs) - 0.05, Math.max(...xs) + 0.15];
      const yd = [0, Math.max(2.2, Math.min(4, Math.max(...ratios) * 1.1))];
      const P = makePlot($("#chartQQ"), {
        h: 190, xd, yd, nx: 6, ny: 4,
        xfmt: v => {
          const a = Math.pow(10, v);
          if (a >= 1e6) return (a / 1e6).toFixed(0) + "M";
          if (a >= 1e3) return (a / 1e3).toFixed(0) + "K";
          return a.toFixed(0);
        },
        yfmt: v => v.toFixed(1) + "×",
        xlabel: "金额分带（美元，对数）", ylabel: "实测 ÷ 预测"
      });
      axes(P, {
        xd, yd, nx: 6, ny: 4, xlabel: "金额分带（美元，对数）", ylabel: "实测 ÷ 预测",
        yfmt: v => v.toFixed(1) + "×",
        xfmt: v => {
          const a = Math.pow(10, v);
          return a >= 1e6 ? (a / 1e6).toFixed(0) + "M" : a >= 1e3 ? (a / 1e3).toFixed(0) + "K" : a.toFixed(0);
        }
      });
      P.g.appendChild(S("line", { x1: P.X(xd[0]), x2: P.X(xd[1]), y1: P.Y(1), y2: P.Y(1), stroke: C_MUTE, "stroke-dasharray": "4 4" }));
      const pts = bf.map((r, i) => [xs[i], Math.min(ratios[i], yd[1])]);
      P.g.appendChild(S("path", { d: path(P, pts), fill: "none", stroke: C_DANGER, "stroke-width": 2.2 }));
      bf.forEach((r, i) => {
        P.g.appendChild(S("circle", { cx: P.X(xs[i]), cy: P.Y(Math.min(ratios[i], yd[1])), r: 2.6, fill: C_DANGER },
          [S("title", {}, [`$${r[0].toLocaleString("en-US")}–$${r[1].toLocaleString("en-US")}\n实测 ${r[2].toLocaleString("en-US")} / 预测 ${r[3].toLocaleString("en-US")}`])]));
      });
      const cap = H("div", "tiny muted", "纵轴 = 实测计数 ÷ 对数正态预测计数。远离 1.0 即说明该区间无法被对数正态描述 —— 小额区间实测是预测的 2.5 倍以上，说明真实采购中「大量小额」的规模被严重低估。");
      $("#chartQQ").appendChild(cap);
    }

    /* 供应商集中度：Top-15 横向条形图 */
    const top = B.topSuppliers || [];
    if (top.length) {
      const n = Math.min(15, top.length);
      const items = top.slice(0, n);
      const rowH = 19, h = n * rowH + 34;
      const w = $("#chartTop").clientWidth || 620;
      const padL = 6, padR = 96, padT = 22;
      const pw = w - padL - padR;
      const mx = items[0][1];
      const svg = S("svg", { viewBox: `0 0 ${w} ${h}`, width: "100%", height: h });
      $("#chartTop").innerHTML = "";
      $("#chartTop").appendChild(svg);
      svg.appendChild(S("text", { x: 0, y: 12, class: "lbl-b" }, ["供应商"]));
      svg.appendChild(S("text", { x: w - padR + 6, y: 12, class: "lbl-b" }, ["合同金额"]));
      items.forEach((it, i) => {
        const y = padT + i * rowH;
        const bw = Math.max(1, it[1] / mx * pw);
        const t0 = S("text", { x: 0, y: y + 10, class: "lbl", fill: "#4a5c6e" },
          [it[0].length > 26 ? it[0].slice(0, 25) + "…" : it[0]]);
        t0.appendChild(S("title", {}, [`${it[0]}\n$${Math.round(it[1]).toLocaleString("en-US")}`]));
        svg.appendChild(t0);
        svg.appendChild(S("rect", { x: padL, y: y, width: bw, height: 13, rx: 2, fill: C_BRAND, opacity: 0.72 },
          [S("title", {}, [`${it[0]}\n$${Math.round(it[1]).toLocaleString("en-US")}`])]));
        svg.appendChild(S("text", { x: w - padR + 6, y: y + 10, class: "lbl" },
          ["$" + (it[1] >= 1e9 ? (it[1] / 1e9).toFixed(1) + "B" : (it[1] / 1e6).toFixed(0) + "M")]));
      });
      const tot = top.reduce((s, x) => s + x[1], 0);
      const t10 = top.slice(0, 10).reduce((s, x) => s + x[1], 0);
      $("#topStat").innerHTML =
        `<div class="note"><b>前 10 家供应商</b>合计 $${(t10 / 1e9).toFixed(1)}B，
          占已列示 <b>${top.length}</b> 家大额供应商合计（$${(tot / 1e9).toFixed(0)}B）的 <b>${pct(t10 / tot, 1)}</b>。<br>
          <span class="tiny">口径说明：这是按金额降序的前 N 家名单，不是全体供应商的整体分布，
            因此不能据此计算基尼系数 —— 全量分布需要逐条明细才能还原。</span></div>`;
    }

    /* 品类构成（PSC）横向条形图 */
    const psc = (B.topPSC || []).slice(0, 10);
    if (psc.length) {
      const rowH = 26, h = psc.length * rowH + 20;
      const w = $("#chartPsc").clientWidth || 620;
      const padL = 6, padR = 86;
      const pw = w - padL - padR;
      const mx = psc[0][1];
      const svg = S("svg", { viewBox: `0 0 ${w} ${h}`, width: "100%", height: h });
      $("#chartPsc").innerHTML = "";
      $("#chartPsc").appendChild(svg);
      psc.forEach((it, i) => {
        const y = 8 + i * rowH;
        const name = it[0].replace(/^(SUPPORT-|MEDICAL-|SOCIAL-)\s*/, "");
        const label = name.length > 22 ? name.slice(0, 21) + "…" : name;
        const t = S("text", { x: 0, y: y + 11, class: "lbl", fill: "#4a5c6e" }, [label]);
        t.appendChild(S("title", {}, [it[0] + "  ·  $" + it[1].toLocaleString("en-US")]));
        svg.appendChild(t);
        svg.appendChild(S("rect", { x: padL, y: y + 1, width: Math.max(1, it[1] / mx * pw), height: 14, rx: 2, fill: C_ACC, opacity: 0.75 },
          [S("title", {}, [`${it[0]}\n$${it[1].toLocaleString("en-US")}`])]));
        svg.appendChild(S("text", { x: w - padR + 6, y: y + 12, class: "lbl" },
          ["$" + (it[1] >= 1e9 ? (it[1] / 1e9).toFixed(1) + "B" : (it[1] / 1e6).toFixed(0) + "M")]));
      });
    }

    /* 映射表 */
    const map = B.paramMap || [];
    let m = `<table><thead><tr><th>沙盒参数</th><th class="n">取值</th><th>来源</th><th>依据</th></tr></thead><tbody>`;
    map.forEach(r => {
      const cls = r.src === "实测" ? "pill ok" : r.src === "推导" ? "pill" : "pill gray";
      m += `<tr><td>${r.k}</td><td class="n">${r.v}</td><td><span class="${cls}">${r.src}</span></td><td class="tiny muted">${r.note}</td></tr>`;
    });
    m += `</tbody></table>`;
    $("#tblMap").innerHTML = m;
  }

  /* =========================================================================
     3. 实验设计页
     ========================================================================= */
  function designFacts() {
    const items = [
      ["实验单元", "PR 单条记录", "而非采购员或部门 —— 避免同一人跨组污染"],
      ["分流比例", "1 : 1", "层内等概率随机，层间独立"],
      ["分层变量", "品类 × 金额档", "18 层，压制重尾带来的组间不平衡"],
      ["主指标", "PR→PO 周期", "对数尺度几何均值比"],
      ["分析口径", "ITT", "按初始分配分析，同时报告覆盖人群效应"],
      ["停止规则", "O'Brien-Fleming", "序贯边界，防止「偷看」抬假阳性"],
    ];
    $("#designFacts").innerHTML = items.map(x =>
      `<div class="kpi x"><div class="k">${x[0]}</div><div class="v" style="font-size:17px">${x[1]}</div>
       <div class="d tiny">${x[2]}</div></div>`).join("");
  }

  function renderDesign() {
    designFacts(); planRecalc(); guardPlanRecalc();
    if (!state.preCheckDrawn) { drawPreCheck(); state.preCheckDrawn = true; }
  }

  function guardPlanRecalc() {
    const gmde = +$("#s-gmde").value / 100;
    const gbase = +$("#s-gbase").value / 100;
    const gdelta = +$("#s-gdelta").value / 100;
    const gvol = +$("#s-gvol").value;
    $("#v-gmde").textContent = (gmde * 100).toFixed(0) + "%";
    $("#v-gbase").textContent = (gbase * 100).toFixed(2) + "%";
    $("#v-gdelta").textContent = (gdelta * 100).toFixed(2) + " pp";
    $("#v-gvol").textContent = gvol;

    const sd = +$("#s-sd").value || 0.78;
    const alpha = 0.05, power = 0.8;
    // 主指标（连续、对数尺度）
    const esMain = Math.abs(Math.log(1 - gmde)) / sd;
    const nMain = Stats.sampleSizeContinuous(esMain, alpha, power, 1);
    // 护栏（二值比例）
    const nGuard = Stats.sampleSizeProportion(gbase, gbase + gdelta, alpha, power);
    const daysMain = (nMain * 2) / gvol;
    const daysGuard = (nGuard * 2) / gvol;

    $("#guardPlanKpi").innerHTML = [
      ["主指标所需（每组）", nMain.toLocaleString("zh-CN"), "条", `${daysMain < 1 ? "<1" : daysMain.toFixed(1)} 天`],
      ["护栏指标所需（每组）", nGuard.toLocaleString("zh-CN"), "条", `${daysGuard.toFixed(0)} 天`],
    ].map(c => `<div class="kpi ${c[0].indexOf("护栏") >= 0 ? "x" : ""}">
        <div class="k">${c[0]}</div><div class="v">${c[1]}<span class="u">${c[2]}</span></div>
        <div class="d">${c[3]}（按 ${gvol} 条/日）</div></div>`).join("");

    const ratio = nGuard / Math.max(nMain, 1);
    $("#guardPlanNote").innerHTML =
      `<b>护栏需要主指标约 ${ratio.toFixed(0)} 倍的样本。</b>
       「${(gbase * 100).toFixed(2)}% → ${((gbase + gdelta) * 100).toFixed(2)}%」这种量级的变化，
       每组要到 <b>${nGuard.toLocaleString("zh-CN")}</b> 条才能有 80% 把握检出 —— 按当前流量是 <b>${daysGuard.toFixed(0)} 天</b>，
       而主指标 <b>${daysMain < 1 ? "<1" : daysMain.toFixed(1)} 天</b>就够了。<br>
       <b>所以护栏指标不能用"统计显著"当判据。</b>正确做法是：
       ① 护栏只看<b>方向与非劣界</b>（点估计不越界即可，不要求显著）；
       ② 用<b>持续监控 + 熔断</b>替代一次性的实验结论；
       ③ 一旦点估计越界，<b>宁可信其有</b>，不等样本量攒够。<br>
       <span class="tiny">顺便说：这也解释了为什么很多团队"上线了没出事"其实是"样本量根本不够看见出事"。</span>`;

    /* 曲线：所需天数 vs 可检出的绝对变化 */
    const xs = [], ysMain = [], ysGuard = [];
    for (let i = 0; i <= 40; i++) {
      const d = 0.0005 + (0.02 - 0.0005) * i / 40;
      xs.push(d);
      ysMain.push(0); // 占位
      ysGuard.push(Stats.sampleSizeProportion(gbase, gbase + d, alpha, power) * 2 / gvol);
    }
    const xd = [Math.min(...xs), Math.max(...xs)];
    const yd = [0, Math.max(...ysGuard.map(v => Math.min(v, 400)))];
    const P = makePlot($("#chartGuardPlan"), {
      h: 200, xd, yd, nx: 5, ny: 4,
      xfmt: v => (v * 100).toFixed(2) + "pp", yfmt: v => Math.round(v) + "d",
      xlabel: "护栏要检出的绝对变化", ylabel: "所需天数（上限 400 天）"
    });
    axes(P, {
      xd, yd, nx: 5, ny: 4, xlabel: "护栏要检出的绝对变化", ylabel: "所需天数（上限 400 天）",
      xfmt: v => (v * 100).toFixed(2) + "pp", yfmt: v => Math.round(v) + "d"
    });
    const pts = xs.map((x, i) => [x, Math.min(ysGuard[i], 400)]);
    P.g.appendChild(S("path", { d: path(P, pts), fill: "none", stroke: C_ACC, "stroke-width": 2.4 }));
    P.g.appendChild(S("line", { x1: P.X(gdelta), x2: P.X(gdelta), y1: P.Y(yd[0]), y2: P.Y(yd[1]), stroke: C_DANGER, "stroke-dasharray": "3 3" }));
    P.g.appendChild(S("line", { x1: P.X(xd[0]), x2: P.X(xd[1]), y1: P.Y(Math.min(daysMain, 400)), y2: P.Y(Math.min(daysMain, 400)), stroke: C_B, "stroke-dasharray": "4 4" }));
    P.g.appendChild(S("text", { x: P.X(xd[0]) + 6, y: P.Y(Math.min(daysMain, 400)) - 5, class: "lbl-b", fill: C_B }, [`主指标 ${daysMain < 1 ? "<1" : daysMain.toFixed(1)} 天`]));
    const lg = H("div", "legend");
    lg.appendChild(H("span", "", `<i style="background:${C_ACC}"></i>护栏指标所需天数`));
    lg.appendChild(H("span", "", `<i style="background:${C_B}"></i>主指标所需天数`));
    $("#chartGuardPlan").appendChild(lg);
  }

  function planRecalc() {
    const mde = +$("#s-mde").value / 100;
    const base = +$("#s-base").value;
    const sd = +$("#s-sd").value;
    const vol = +$("#s-vol").value;
    const alpha = +$("#s-alpha").value;
    const power = +$("#s-power").value;
    $("#v-mde").textContent = (mde * 100).toFixed(0) + "%";
    $("#v-base").textContent = base.toFixed(1) + " h";
    $("#v-sd").textContent = sd.toFixed(2);
    $("#v-vol").textContent = vol;
    $("#v-alpha").textContent = alpha.toFixed(2);
    $("#v-power").textContent = power.toFixed(2);

    const abs = mde * base;
    const es = abs / (sd * base);           // 对数尺度 / σ_log ≈ ln 相对效应 / sd
    const esLog = Math.log(1 - mde) / sd;   // 更严谨：对数尺度效应
    const perArm = Stats.sampleSizeContinuous(Math.abs(esLog), alpha, power, 1);
    const total = perArm * 2;
    const days = total / vol;

    const cards = [
      ["每组所需样本", perArm.toLocaleString("zh-CN"), "PR 数"],
      ["总样本量", total.toLocaleString("zh-CN"), "PR 数"],
      ["所需天数", days < 1 ? "<1" : days.toFixed(1), "天（按当前流量）"],
      ["预期检出效应", (mde * 100).toFixed(0) + "%", `即周期 ${base.toFixed(0)}h → ${(base * (1 - mde)).toFixed(0)}h`],
    ];
    $("#planKpi").innerHTML = cards.map(c =>
      `<div class="kpi"><div class="k">${c[0]}</div><div class="v">${c[1]}<span class="u">${c[2]}</span></div></div>`).join("");

    /* 功效曲线：不同样本量下的 MDE-功效关系 */
    const xd = [0.02, 0.40], yd = [0, 1];
    const P = makePlot($("#chartPower"), {
      h: 210, xd, yd, nx: 6, ny: 5,
      xfmt: v => (v * 100).toFixed(0) + "%", yfmt: v => (v * 100).toFixed(0) + "%",
      xlabel: "相对效应 MDE", ylabel: "统计功效"
    });
    axes(P, {
      xd, yd, nx: 6, ny: 5, xlabel: "相对效应 MDE", ylabel: "统计功效",
      xfmt: v => (v * 100).toFixed(0) + "%", yfmt: v => (v * 100).toFixed(0) + "%"
    });
    const variants = [
      { n: total, c: C_BRAND, label: "当前方案" },
      { n: total * 2, c: C_B, label: "样本量 ×2" },
      { n: total / 2, c: C_ACC, label: "样本量 ÷2" },
    ];
    variants.forEach(v => {
      const pts = [];
      for (let i = 0; i <= 80; i++) {
        const rel = xd[0] + (xd[1] - xd[0]) * i / 80;
        const e = Math.abs(Math.log(1 - rel)) / sd;
        const nA = v.n / 2;
        const se = Math.sqrt(2 / nA);
        const pw = Stats.powerContinuous(e, nA, alpha, 1);
        pts.push([rel, clamp(pw, 0, 1)]);
      }
      P.g.appendChild(S("path", { d: path(P, pts), fill: "none", stroke: v.c, "stroke-width": v === variants[0] ? 2.4 : 1.6, opacity: v === variants[0] ? 1 : .75 }));
    });
    P.g.appendChild(S("line", { x1: P.X(mde), x2: P.X(mde), y1: P.Y(0), y2: P.Y(1), stroke: C_DANGER, "stroke-dasharray": "3 3", "stroke-width": 1.4 }));
    P.g.appendChild(S("line", { x1: P.X(0.02), x2: P.X(0.40), y1: P.Y(power), y2: P.Y(power), stroke: C_MUTE, "stroke-dasharray": "3 3" }));
    const legend = H("div", "legend");
    variants.forEach(v => legend.appendChild(H("span", "", `<i style="background:${v.c}"></i>${v.label}（共 ${Math.round(v.n).toLocaleString("zh-CN")} 条）`)));
    $("#chartPower").appendChild(legend);

    const sigmaSens = Math.pow((sd + 0.1) / sd, 2) - 1;
    $("#planNote").innerHTML =
      `<b>结论：</b>按日均 ${vol} 条 PR、σ=${sd.toFixed(2)}，要检出 <b>${(mde * 100).toFixed(0)}%</b> 的相对改善，
       每组需要 <b>${perArm.toLocaleString("zh-CN")}</b> 条、合计 <b>${total.toLocaleString("zh-CN")}</b> 条，
       约 <b>${days < 1 ? "<1" : days.toFixed(1)} 天</b>。α=${alpha}，功效 ${(power * 100).toFixed(0)}%。<br>
       <b>注意：</b>样本量与 σ 的平方成正比 —— σ 从 ${sd.toFixed(2)} 升到 ${(sd + 0.1).toFixed(2)}，所需样本量要<b>增加约 ${pct(sigmaSens, 0)}</b>。
       重尾数据对 σ 极其敏感，这就是为什么必须先用 CUPED 压方差，而不是一味加流量。</div>`;
  }

  function drawPreCheck() {
    const items = [
      ["主指标唯一且事前冻结", "不允许看到数据后再换指标口径", true],
      ["MDE 与样本量在开跑前算好", "避免「跑了两周才发现不显著」", true],
      ["随机化单元已确定并写入代码", "本例为 PR 级别，层内随机", true],
      ["护栏指标已定义并设定非劣界", "审计异常 <1.0pp，价格偏差 <1.5pp", true],
      ["SRM 监控已埋点", "每日检查分流比，异常即停", true],
      ["停止规则已确定", "序贯边界 or 固定周期，不可中途改", true],
      ["A/A 验证已通过", "确认分析管线不会产生假阳性", state.aaDone],
      ["分析口径（ITT / CACE）已公告", "避免事后挑选有利口径", true],
    ];
    $("#preCheck").innerHTML = items.map((x, i) =>
      `<label class="chk"><input type="checkbox" checked disabled>
        <span><b>${x[0]}</b><br><span class="tiny muted">${x[1]}</span></span></label>`).join("");
  }

  /* -------- A/A 验证 -------- */
  function runAA() {
    $("#aaStatus").textContent = "运行中…";
    const alpha = +$("#s-alpha").value;
    const vol = 200, days = 28, ITER = 300;
    const perDayArm = Math.round(vol / 2);

    /* 从当前基线分布拟合对数正态，作为 A/A 的零假设分布 */
    const params = collectRunParams();
    const panel = ProcSim.generatePanel(Object.assign({}, params, { dailyVolume: 300, days: 6 }));
    const ctrl = panel.rows.filter(r => r.arm === "A").map(r => Math.log(r.yC));
    const mu = Stats.mean(ctrl), sg = Stats.sd(ctrl);

    const rng = new RNG(424242);
    const zEnd = Stats.normInv(1 - alpha / 2);
    const bounds = Stats.obfBoundary(days, alpha);

    let fpSingle = 0, fpPeek = 0, fpOBF = 0;
    const pvals = [];
    for (let it = 0; it < ITER; it++) {
      let sA = 0, sA2 = 0, nA = 0, sB = 0, sB2 = 0, nB = 0;
      let peek = false, obf = false, lastZ = 0, lastP = 1;
      for (let d = 0; d < days; d++) {
        for (let k = 0; k < perDayArm; k++) {
          const a = mu + sg * rng.norm(); sA += a; sA2 += a * a; nA++;
          const b = mu + sg * rng.norm(); sB += b; sB2 += b * b; nB++;
        }
        const vA = (sA2 - sA * sA / nA) / (nA - 1), vB = (sB2 - sB * sB / nB) / (nB - 1);
        const se = Math.sqrt(vA / nA + vB / nB);
        lastZ = se > 0 ? (sB / nB - sA / nA) / se : 0;
        if (Math.abs(lastZ) > zEnd) peek = true;
        if (Math.abs(lastZ) > bounds[d]) obf = true;
      }
      const df = 2 * perDayArm * days - 2;
      lastP = 2 * Stats.tSf(Math.abs(lastZ), df);
      pvals.push(lastP);
      if (lastP < alpha) fpSingle++;
      if (peek) fpPeek++;
      if (obf) fpOBF++;
    }
    state.aaDone = true;

    const bar = (label, v, note, ok) => `
      <div style="margin:10px 0 4px"><b style="font-size:12.5px">${label}</b>
        <span class="pill ${ok ? "ok" : "bad"}" style="margin-left:6px">${(v * 100).toFixed(1)}%</span></div>
      <div class="pbar"><i style="width:${clamp(v * 100 * 2, 0, 100)}%;background:${ok ? "linear-gradient(90deg,#0d5a68,#13a08a)" : "linear-gradient(90deg,#c0392b,#e07b6d)"}"></i></div>
      <div class="tiny muted" style="margin:2px 0 10px">${note}</div>`;

    const pv = Array.from(pvals).sort((a, b) => a - b);
    let hist = "";
    const bins = 10, cnt = new Array(bins).fill(0);
    pvals.forEach(p => cnt[Math.min(bins - 1, Math.floor(p * bins))]++);
    const mx = Math.max(...cnt);
    hist = `<div class="tiny muted" style="margin-top:8px">300 次 A/A 的 p 值分布（良性应接近均匀）：</div>
      <div style="display:flex;gap:3px;align-items:flex-end;height:52px;margin-top:4px">` +
      cnt.map((c, i) => `<div style="flex:1;background:var(--brand);opacity:.7;height:${(c / mx * 100).toFixed(0)}%;border-radius:2px 2px 0 0" title="p∈[${(i / bins).toFixed(1)},${((i + 1) / bins).toFixed(1)})：${c} 次"></div>`).join("") +
      `</div>`;

    $("#aaResult").innerHTML =
      `<div class="note ok" style="margin-top:14px"><b>结论：</b>"每天偷看"会把假阳性率从 ${(alpha * 100).toFixed(0)}% 推到约 ${(fpPeek / ITER * 100).toFixed(0)}%，
        而序贯边界把它压回 ${(fpOBF / ITER * 100).toFixed(1)}% —— 这就是为什么必须事前定停止规则。</div>` +
      bar("① 只做一次最终检验（正确做法）", fpSingle / ITER, `目标 ≈ ${(alpha * 100).toFixed(0)}%。接近目标 → 分析管线可信。`, Math.abs(fpSingle / ITER - alpha) < 0.04) +
      bar("② 每天偷看、无校正（常见错误）", fpPeek / ITER, `看似无害的"看一眼"，让假阳性膨胀约 ${(fpPeek / Math.max(fpSingle, 1)).toFixed(1)} 倍。`, fpPeek / ITER < alpha * 1.6) +
      bar("③ 每天检验 + O'Brien-Fleming 边界", fpOBF / ITER, `边界前期严、后期松，总量仍控制在 α 以内。`, fpOBF / ITER <= alpha * 1.4) +
      hist;
  }

  /* =========================================================================
     4. 沙盒运行页
     ========================================================================= */
  function collectRunParams() {
    const p = {
      dailyVolume: +$("#s-vol2").value,
      days: +$("#s-days").value,
      amountThreshold: +$("#s-thr").value,
      autoDelayHours: +$("#s-delay").value,
      autoPassRate: +$("#s-pass").value,
      spotCheckRate: +$("#s-spot").value,
      srmBias: +$("#s-bias").value,
      seed: +$("#s-seed").value,
    };
    const B = state.baseline;
    if (B && B.amountBands && B.scale) {
      p.amountBands = B.amountBands;
      p.amountScale = B.scale.factor;
      p.amountCutoff = B.scale.cutoffQuantile || 0.99;
    }
    return p;
  }
  function readRunLabels() {
    $("#v-thr").textContent = money(+$("#s-thr").value);
    $("#v-delay").textContent = (+$("#s-delay").value).toFixed(1) + " h";
    $("#v-pass").textContent = (+$("#s-pass").value * 100).toFixed(0) + "%";
    $("#v-spot").textContent = (+$("#s-spot").value * 100).toFixed(0) + "%";
    $("#v-vol2").textContent = $("#s-vol2").value;
    $("#v-days").textContent = $("#s-days").value;
    $("#v-seed").textContent = $("#s-seed").value;
    $("#v-bias").textContent = ((+$("#s-bias").value) * 100).toFixed(1) + "%";
    $("#v-speed").textContent = "×" + $("#s-speed").value;
  }

  function initRunTab() {
    readRunLabels();
    const params = collectRunParams();
    state.params = params;
    state.rows = ProcSim.generatePanel(params).rows;
    state.series = ProcSim.dailySeries(state.rows);
    state.upto = params.days;
    renderRun(true);
  }

  function runExperiment(instant) {
    if (state.running) return;
    readRunLabels();
    const params = collectRunParams();
    state.params = params;
    const panel = ProcSim.generatePanel(params);
    state.rows = panel.rows;
    state.series = ProcSim.dailySeries(state.rows);
    const K = params.days;

    if (instant) {
      state.upto = K; state.running = false;
      $("#runBar").style.width = "100%";
      $("#runStatus").textContent = `已完成 · 共 ${state.rows.length.toLocaleString("zh-CN")} 条 PR`;
      renderRun(true);
      return;
    }
    state.running = true;
    state.upto = 0;
    const speed = +$("#s-speed").value;
    const step = Math.max(1, Math.round(speed));
    $("#btnRun").disabled = true;
    clearInterval(state.timer);
    state.timer = setInterval(() => {
      state.upto = Math.min(K, state.upto + step);
      $("#runBar").style.width = (state.upto / K * 100).toFixed(1) + "%";
      $("#runStatus").textContent = `运行中 · 第 ${state.upto} / ${K} 天`;
      renderRun(false);
      if (state.upto >= K) {
        clearInterval(state.timer);
        state.running = false;
        $("#btnRun").disabled = false;
        $("#runStatus").textContent = `已完成 · 共 ${state.rows.length.toLocaleString("zh-CN")} 条 PR`;
        renderRun(true);
      }
    }, Math.max(45, 130 / speed));
  }

  function renderRun(full) {
    if (!state.rows) return;
    const params = state.params;
    const A = ProcSim.analyze(state.rows, state.upto, full ? { alpha: 0.05 } : { alpha: 0.05, bootstrap: false, cuped: false });
    if (full) state.analysis = A;
    else if (!state.analysis) state.analysis = A;
    const series = (state.series || ProcSim.dailySeries(state.rows)).filter(s => s.day <= state.upto);

    /* ---- KPI ---- */
    const sA = A.summaryA, sB = A.summaryB;
    const ratio = A.primary.ratio;
    const lift = ratio - 1;
    const uptoDays = state.upto;
    const nA = state.rows.filter(r => r.arm === "A" && r.day <= state.upto).length;
    const nB = state.rows.filter(r => r.arm === "B" && r.day <= state.upto).length;
    const targetShare = nB ? state.rows.filter(r => r.day <= state.upto && r.arm === "B" && r.targeted && r.autoPassed).length / nB : 0;

    const cards = [
      { cls: "a", k: "对照组 A · 几何均值周期", v: fmt(sA.geomean, 1), u: "h", d: `n=${nA.toLocaleString("zh-CN")} · 中位 ${fmt(sA.median, 1)}h` },
      { cls: "b", k: "实验组 B · 几何均值周期", v: fmt(sB.geomean, 1), u: "h", d: `n=${nB.toLocaleString("zh-CN")} · 中位 ${fmt(sB.median, 1)}h` },
      { cls: "x", k: "相对变化（几何均值比）", v: (lift >= 0 ? "+" : "") + pct(lift, 1), u: "", d: `比值 ${fmt(ratio, 3)} · 95%CI [${fmt(A.primary.ciGeo[0], 3)}, ${fmt(A.primary.ciGeo[1], 3)}]` },
      { cls: "", k: "p 值 / 显著性", v: pFmt(A.primary.logTest ? A.primary.logTest.p : null), u: "", d: (A.primary.logTest && A.primary.logTest.p < 0.05) ? "✓ 达到 0.05 显著水平" : "未达到显著水平" },
      { cls: "", k: "48h 完成率 A → B", v: pct(sA.onTime48, 1) + " → " + pct(sB.onTime48, 1), u: "", d: `绝对变化 ${signPct((sB.onTime48 - sA.onTime48), 1)}` },
      { cls: "", k: "策略实际覆盖率", v: pct(targetShare, 1), u: "", d: "实验组中真正走自动通道的 PR 占比" },
      { cls: "", k: "P90 周期 A → B", v: fmt(sA.p90, 1) + " → " + fmt(sB.p90, 1), u: "h", d: "尾部风险是否同步下降" },
      { cls: "", k: "累计样本", v: (nA + nB).toLocaleString("zh-CN"), u: "条", d: `第 ${uptoDays} / ${params.days} 天` },
    ];
    $("#runKpi").innerHTML = cards.map(c =>
      `<div class="kpi ${c.cls}"><div class="k">${c.k}</div><div class="v">${c.v}<span class="u">${c.u}</span></div><div class="d">${c.d}</div></div>`).join("");

    $("#primarySub").innerHTML =
      `对数尺度 Welch t 检验 · 差值（B−A）= <b>${fmt(A.primary.logTest ? A.primary.logTest.diff : 0, 4)}</b>（对数小时）·
       指数化为几何均值比 <b>${fmt(ratio, 3)}</b> ·
       Bootstrap 中位数差 95%CI [<b>${fmt(A.primary.medianCi[0], 2)}</b>, <b>${fmt(A.primary.medianCi[1], 2)}</b>] 小时`;

    /* ---- 累积效应图 ---- */
    drawEffectChart(series, params);
    /* ---- 序贯检验 ---- */
    drawSeqChart(series, params.days);
    if (full) {
      drawHist(A);
      drawSrm(series, A);
      renderDiag();
      renderDecision();
    }
  }

  function drawEffectChart(series, params) {
    const ys = series.map(s => s.ratio);
    const los = series.map(s => Math.exp(s.lo));
    const his = series.map(s => Math.exp(s.hi));
    const lo = Math.min(0.75, ...los), hi = Math.max(1.25, ...his);
    const xd = [1, Math.max(2, series.length)];
    const yd = [lo, hi];
    const P = makePlot($("#chartEffect"), {
      h: 250, xd, yd, nx: 7,
      xfmt: v => "D" + Math.round(v), yfmt: v => v.toFixed(2) + "×",
      xlabel: "实验天数", ylabel: "几何均值比（B/A，<1 为更快）"
    });
    axes(P, {
      xd, yd, nx: 7, xlabel: "实验天数", ylabel: "几何均值比（B/A，<1 为更快）",
      xfmt: v => "D" + Math.round(v), yfmt: v => v.toFixed(2) + "×"
    });
    P.g.appendChild(S("line", { x1: P.X(xd[0]), x2: P.X(xd[1]), y1: P.Y(1), y2: P.Y(1), stroke: C_MUTE, "stroke-dasharray": "4 4" }));
    // 置信带
    const up = series.map(s => [s.day, Math.exp(s.hi)]);
    const dn = series.map(s => [s.day, Math.exp(s.lo)]).reverse();
    P.g.appendChild(S("path", { d: path(P, up) + " " + path(P, dn).replace("M", "L"), fill: C_BRAND, opacity: 0.1, stroke: "none" }));
    P.g.appendChild(S("path", { d: path(P, series.map(s => [s.day, s.ratio])), fill: "none", stroke: C_BRAND, "stroke-width": 2.4 }));
    // 标注终点
    const last = series[series.length - 1];
    P.g.appendChild(S("circle", { cx: P.X(last.day), cy: P.Y(last.ratio), r: 4, fill: C_BRAND }));
    P.g.appendChild(S("text", { x: P.X(last.day) - 8, y: P.Y(last.ratio) - 10, "text-anchor": "end", class: "lbl-b" }, [`${last.ratio.toFixed(3)}×`]));
  }

  function drawSeqChart(series, K) {
    const bounds = Stats.obfBoundary(K, 0.05);
    const zs = series.map(s => Math.abs(s.z));
    const zmax = Math.max(3.2, ...zs, ...bounds) * 1.1;
    const xd = [1, K], yd = [0, zmax];
    const P = makePlot($("#chartSeq"), {
      h: 230, xd, yd, nx: 7, ny: 4,
      xfmt: v => "D" + Math.round(v), yfmt: v => v.toFixed(1),
      xlabel: "实验天数", ylabel: "|z|"
    });
    axes(P, {
      xd, yd, nx: 7, ny: 4, xlabel: "实验天数", ylabel: "|z|",
      xfmt: v => "D" + Math.round(v), yfmt: v => v.toFixed(1)
    });
    P.g.appendChild(S("line", { x1: P.X(xd[0]), x2: P.X(xd[1]), y1: P.Y(1.96), y2: P.Y(1.96), stroke: C_MUTE, "stroke-dasharray": "4 4" }));
    P.g.appendChild(S("path", { d: path(P, bounds.map((b, i) => [i + 1, b])), fill: "none", stroke: C_ACC, "stroke-width": 2, "stroke-dasharray": "6 3" }));
    P.g.appendChild(S("path", { d: path(P, series.map(s => [s.day, Math.abs(s.z)])), fill: "none", stroke: C_BRAND, "stroke-width": 2.4 }));
    const last = series[series.length - 1];
    P.g.appendChild(S("circle", { cx: P.X(last.day), cy: P.Y(Math.abs(last.z)), r: 4, fill: C_BRAND }));
    // 首个越界点
    let cross = series.find((s, i) => Math.abs(s.z) > bounds[i]);
    if (cross) {
      P.g.appendChild(S("line", { x1: P.X(cross.day), x2: P.X(cross.day), y1: P.Y(0), y2: P.Y(zmax), stroke: C_B, "stroke-dasharray": "2 3", opacity: .8 }));
      P.g.appendChild(S("text", { x: P.X(cross.day) + 4, y: P.Y(zmax * 0.94), class: "lbl-b", fill: C_B }, [`第 ${cross.day} 天首次越界`]));
    }
  }

  function drawHist(A) {
    const yA = A.raw.yA, yB = A.raw.yB;
    const lo = Math.max(1, Math.min(...yA, ...yB)), hi = Math.min(400, Stats.quantile([...yA, ...yB], 0.995));
    const BIN = 26;
    const llo = Math.log(lo), lhi = Math.log(hi);
    const binW = (lhi - llo) / BIN;
    const hA = new Array(BIN).fill(0), hB = new Array(BIN).fill(0);
    const push = (arr, h) => arr.forEach(v => {
      if (v < lo) { h[0]++; return; }
      if (v > hi) { h[BIN - 1]++; return; }
      h[Math.min(BIN - 1, Math.floor((Math.log(v) - llo) / binW))]++;
    });
    push(yA, hA); push(yB, hB);
    const nA = yA.length || 1, nB = yB.length || 1;
    const ymax = Math.max(...hA.map(v => v / nA), ...hB.map(v => v / nB)) * 1.15;
    const xd = [Math.exp(llo), Math.exp(lhi)], yd = [0, ymax];
    const P = makePlot($("#chartHist"), {
      h: 250, xd, yd, nx: 7,
      xfmt: v => v.toFixed(0) + "h", yfmt: v => (v * 100).toFixed(0) + "%",
      xlabel: "PR→PO 周期（小时，对数刻度）", ylabel: "组内占比"
    });
    axes(P, {
      xd, yd, nx: 7, xlabel: "PR→PO 周期（小时，对数刻度）", ylabel: "组内占比",
      xfmt: v => v.toFixed(0) + "h", yfmt: v => (v * 100).toFixed(0) + "%"
    });
    const w = P.pw / BIN;
    for (let i = 0; i < BIN; i++) {
      const x0 = Math.exp(llo + i * binW), x1 = Math.exp(llo + (i + 1) * binW);
      const xa = P.X(x0), xb = P.X(x1);
      const bw = (xb - xa) / 2 - 0.5;
      P.g.appendChild(S("rect", { x: xa, y: P.Y(hA[i] / nA), width: Math.max(0.6, bw), height: P.Y(0) - P.Y(hA[i] / nA), fill: C_A, opacity: .72 }));
      P.g.appendChild(S("rect", { x: xa + bw + 1, y: P.Y(hB[i] / nB), width: Math.max(0.6, bw), height: P.Y(0) - P.Y(hB[i] / nB), fill: C_B, opacity: .72 }));
    }
    const legend = H("div", "legend");
    legend.appendChild(H("span", "", `<i style="background:${C_A}"></i>对照组 A（n=${yA.length.toLocaleString("zh-CN")}）`));
    legend.appendChild(H("span", "", `<i style="background:${C_B}"></i>实验组 B（n=${yB.length.toLocaleString("zh-CN")}）`));
    $("#chartHist").appendChild(legend);
  }

  function drawSrm(series, A) {
    const xd = [1, Math.max(2, series.length)], yd = [0.35, 0.65];
    const P = makePlot($("#chartSrm"), {
      h: 210, xd, yd, nx: 7, ny: 4,
      xfmt: v => "D" + Math.round(v), yfmt: v => (v * 100).toFixed(0) + "%",
      xlabel: "实验天数", ylabel: "实验组占比"
    });
    axes(P, {
      xd, yd, nx: 7, ny: 4, xlabel: "实验天数", ylabel: "实验组占比",
      xfmt: v => "D" + Math.round(v), yfmt: v => (v * 100).toFixed(0) + "%"
    });
    P.g.appendChild(S("line", { x1: P.X(xd[0]), x2: P.X(xd[1]), y1: P.Y(0.5), y2: P.Y(0.5), stroke: C_MUTE, "stroke-dasharray": "4 4" }));
    // ±3σ 容忍带
    const up = [], dn = [];
    series.forEach(s => {
      const N = s.nA + s.nB; if (!N) return;
      const se = Math.sqrt(0.25 / N) * 3;
      up.push([s.day, 0.5 + se]); dn.push([s.day, 0.5 - se]);
    });
    if (up.length) {
      P.g.appendChild(S("path", { d: path(P, up) + " " + path(P, dn.reverse()).replace("M", "L"), fill: C_ACC, opacity: 0.14, stroke: "none" }));
      P.g.appendChild(S("path", { d: path(P, series.map(s => { const N = s.nA + s.nB; return [s.day, N ? s.nB / N : 0.5]; })), fill: "none", stroke: C_BRAND, "stroke-width": 2.2 }));
    }
    const srm = A.srm;
    const srmCls = !srm ? "warn" : srm.level === "ok" ? "ok" : srm.level === "warn" ? "warn" : "bad";
    const srmTxt = !srm ? "" : srm.level === "ok"
      ? "<b>通过</b>：分流比例与 1:1 无统计差异，样本可作比较。"
      : srm.level === "warn"
        ? "<b>告警</b>：分流比偏离已进入可疑区间（p &lt; 0.01）。先查分流埋点与去重逻辑，再决定是否继续。"
        : "<b>未通过！</b>分流比例显著偏离 1:1，存在随机化实现缺陷。此时任何效应估计都可能有偏，<b>必须先修分流、重跑实验</b>，不能直接看结果。";
    $("#srmBox").innerHTML =
      `<div class="note ${srmCls}" style="margin-top:10px">
        <b>SRM 检验：</b>χ² = ${srm ? fmt(srm.chi2, 3) : "—"}，p = ${srm ? pFmt(srm.p) : "—"}，
        A=${srm ? srm.nA.toLocaleString("zh-CN") : "—"} / B=${srm ? srm.nB.toLocaleString("zh-CN") : "—"}，
        实际占比 ${srm ? pct(srm.ratio, 2) : "—"}（偏离 1:1 达 ${srm ? signPct(srm.lift, 2) : "—"}）<br>
        ${srmTxt}
      </div>`;
  }

  /* =========================================================================
     5. 统计诊断页
     ========================================================================= */
  function renderDiag() {
    if (!state.rows) { $("#tblMethods").innerHTML = '<p class="muted tiny">请先在「沙盒运行」页运行实验。</p>'; return; }
    const A = state.analysis || ProcSim.analyze(state.rows, state.upto, {});
    const P = A.primary;

    /* ---- 多方法对照 ---- */
    const rows = [];
    if (P.logTest) rows.push({
      m: "对数尺度 Welch t（主口径）",
      e: `${fmt(Math.exp(P.logTest.diff), 4)}× 几何均值比`,
      d: `${fmt(P.logTest.diff, 4)} 对数小时`,
      ci: `[${fmt(Math.exp(P.logTest.ci[0]), 4)}, ${fmt(Math.exp(P.logTest.ci[1]), 4)}]×`,
      p: P.logTest.p, note: "抗尾部，主口径"
    });
    if (P.rawTest) rows.push({
      m: "原始尺度 Welch t",
      e: `${fmt(P.rawTest.diff, 2)} h 均值差`,
      d: `${fmt(P.rawTest.meanA, 1)} → ${fmt(P.rawTest.meanB, 1)} h`,
      ci: `[${fmt(P.rawTest.ci[0], 2)}, ${fmt(P.rawTest.ci[1], 2)}] h`,
      p: P.rawTest.p, note: "受超长周期 PR 拉拽"
    });
    rows.push({
      m: "Bootstrap 中位数差", e: `${fmt(P.medianDiff, 2)} h`,
      d: `${fmt(P.medA, 1)} → ${fmt(P.medB, 1)} h`,
      ci: `[${fmt(P.medianCi[0], 2)}, ${fmt(P.medianCi[1], 2)}] h`,
      p: null, note: "非参数，不依赖分布假设"
    });
    if (A.cuped && A.cuped.test) rows.push({
      m: "CUPED 调整后 Welch t", e: `${fmt(Math.exp(A.cuped.test.diff), 4)}× 几何均值比`,
      d: `${fmt(A.cuped.test.diff, 4)} 对数小时`,
      ci: `[${fmt(Math.exp(A.cuped.test.ci[0]), 4)}, ${fmt(Math.exp(A.cuped.test.ci[1]), 4)}]×`,
      p: A.cuped.test.p, note: `方差缩减 ${pct(A.cuped.reduction, 1)}`
    });
    rows.push({
      m: "P90 分位差", e: `${fmt(A.summaryB.p90 - A.summaryA.p90, 2)} h`,
      d: `${fmt(A.summaryA.p90, 1)} → ${fmt(A.summaryB.p90, 1)} h`,
      ci: "—", p: null, note: "看尾部是否同步改善"
    });

    let h = `<table><thead><tr><th>方法</th><th>效应估计</th><th>明细</th><th>95% 置信区间</th><th class="n">p 值</th><th>说明</th></tr></thead><tbody>`;
    rows.forEach(r => {
      h += `<tr><td>${r.m}</td><td class="mono">${r.e}</td><td class="mono">${r.d}</td><td class="mono">${r.ci}</td>
        <td class="n">${r.p === null ? "—" : pFmt(r.p)}</td><td class="tiny muted">${r.note}</td></tr>`;
    });
    h += `</tbody></table>`;
    const allAgree = rows.filter(r => r.p !== null).every(r => r.p < 0.05);
    h += `<div class="note ${allAgree ? "ok" : "warn"}" style="margin-top:12px">
      <b>口径一致性：</b>${allAgree
        ? "四种检验方法结论一致，且原始尺度与对数尺度方向相同 → 结论稳健，不是某种口径的偶然产物。"
        : "各方法结论不一致。常见原因：长尾把原始尺度均值带偏（看原始尺度 p 与对数尺度 p 的差异），或 Bootstrap 中位数差 CI 跨 0 说明效应集中在尾部而非中位。此时应以<b>对数尺度主口径</b>为准，并回到数据查长尾来源。"}</div>`;
    $("#tblMethods").innerHTML = h;

    /* ---- CUPED ---- */
    const c = A.cuped;
    $("#cupedBox").innerHTML = c ? `
      <div class="grid g3" style="margin-bottom:12px">
        <div class="kpi x"><div class="k">协变量相关性 ρ</div><div class="v">${fmt(c.rho, 3)}</div><div class="d tiny">历史平均审批时长 ↔ 本次周期</div></div>
        <div class="kpi"><div class="k">θ 系数</div><div class="v">${fmt(c.theta, 3)}</div><div class="d tiny">Cov(Y,X)/Var(X)</div></div>
        <div class="kpi"><div class="k">方差缩减</div><div class="v">${pct(c.reduction, 1)}</div><div class="d tiny">等效于样本量 ×${fmt(1 / Math.max(1 - c.reduction, 1e-6), 2)}</div></div>
      </div>
      <div class="note"><b>一句话讲清 CUPED：</b>把"这个品类本来就审得慢"这部分差异提前扣掉，剩下的才是策略真正带来的差异。
        等价于<b>不花一分流量，凭空多出 ${pct(c.reduction, 0)} 的样本</b>。以实测相关性 ρ=${fmt(c.rho, 2)} 计算，
        理论上限为 ρ²=${pct(c.rho * c.rho, 0)}；当前测得缩减 ${pct(c.reduction, 1)}，
        ${c.reduction > c.rho * c.rho + 0.02 ? "略高于理论上限（有限样本波动 + 协变量在两组中的相关结构不同所致，属正常现象）。" : "已基本达到该上限，继续加协变量的边际收益很低。"}</div>` : '<p class="muted tiny">未启用 CUPED。</p>';

    if (c) {
      const seRaw = c.testRaw ? c.testRaw.se : 1, seAdj = c.test ? c.test.se : 1;
      const xd = [0, 3], yd = [0, Math.max(seRaw, seAdj) * 1.35];
      const P = makePlot($("#chartCuped"), {
        h: 180, xd, yd, nx: 3, ny: 4, yfmt: v => v.toFixed(3),
        ylabel: "差值标准误", xfmt: v => ["", "调整前", "调整后", ""][Math.round(v)] || ""
      });
      axes(P, { xd, yd, nx: 3, ny: 4, ylabel: "差值标准误" });
      const bars = [[1, seRaw, C_MUTE, "调整前"], [2, seAdj, C_B, "调整后"]];
      bars.forEach(b => {
        const w = P.pw / 5;
        P.g.appendChild(S("rect", { x: P.X(b[0]) - w / 2, y: P.Y(b[1]), width: w, height: P.Y(0) - P.Y(b[1]), fill: b[2], opacity: .8 }));
        P.g.appendChild(S("text", { x: P.X(b[0]), y: P.Y(b[1]) - 5, "text-anchor": "middle", class: "lbl-b" }, [b[1].toFixed(4)]));
        P.g.appendChild(S("text", { x: P.X(b[0]), y: P.Y(0) + 15, "text-anchor": "middle", class: "lbl" }, [b[3]]));
      });
    }

    /* ---- 分布诊断 ---- */
    const dg = ProcSim.distributionDiag(state.rows.filter(r => r.day <= state.upto));
    $("#distBox").innerHTML = `
      <table>
        <thead><tr><th>诊断量</th><th class="n">原始尺度</th><th class="n">对数尺度</th><th>判读</th></tr></thead>
        <tbody>
          <tr><td>偏度</td><td class="n">${fmt(dg.rawSkew, 2)}</td><td class="n">${fmt(dg.logSkew, 2)}</td>
            <td class="tiny muted">${dg.rawSkew > 2 ? "原始尺度强右偏 → t 检验正态假设站不住" : "可接受"}</td></tr>
          <tr><td>超额峰度</td><td class="n">${fmt(dg.rawKurt, 2)}</td><td class="n">${fmt(dg.logKurt, 2)}</td>
            <td class="tiny muted">${dg.rawKurt > 3 ? "厚尾 → 均值估计不稳定" : "可接受"}</td></tr>
          <tr><td>标准差</td><td class="n">${fmt(dg.rawSd, 2)} h</td><td class="n">${fmt(dg.logSd, 3)}</td>
            <td class="tiny muted">对数尺度 σ 决定所需样本量</td></tr>
          <tr><td>均值 vs 中位数</td><td class="n">${fmt(dg.rawMean, 1)} / ${fmt(dg.rawMedian, 1)}</td><td class="n">—</td>
            <td class="tiny muted">均值被 P99=${fmt(dg.rawP99, 0)}h 拉高 ${fmt(dg.rawMean - dg.rawMedian, 1)}h</td></tr>
        </tbody>
      </table>
      <div class="note warn"><b>这就是为什么主指标必须在对数尺度上检验。</b>
        原始尺度偏度 ${fmt(dg.rawSkew, 1)}、峰度 ${fmt(dg.rawKurt, 1)}，均值比中位数高 ${fmt(dg.rawMean - dg.rawMedian, 1)} 小时 ——
        少数极端 PR（最长 ${fmt(dg.rawMax, 0)} 小时）会把均值带跑。取对数后偏度降到 ${fmt(dg.logSkew, 2)}，分布基本对称，
        Welch t 的假设才成立。同时几何均值比可直接读成"典型周期缩短了百分之几"，比"均值差 3.7 小时"好解释得多。</div>`;

    /* ---- 森林图 ---- */
    const groups = [];
    ["低", "中", "高"].forEach(r => groups.push({ name: "风险等级 · " + r, filter: x => x.risk === r }));
    ["低值(<5万)", "中值(5-50万)", "高值(>50万)"].forEach(b => groups.push({ name: "金额档 · " + b, filter: x => x.band === b }));
    ProcSim.CATEGORIES.forEach(c => groups.push({ name: "品类 · " + c.name, filter: x => x.category === c.name }));
    groups.push({ name: "策略覆盖（低值+低风险）", filter: x => x.targeted && x.autoPassed });
    groups.push({ name: "策略未覆盖", filter: x => !(x.targeted && x.autoPassed) });
    const het = ProcSim.heterogeneity(state.rows.filter(r => r.day <= state.upto), groups);
    drawForest(het);
    renderGuard(A);
    renderBH(A);
  }

  function drawForest(het) {
    if (!het.length) { $("#chartForest").innerHTML = '<p class="muted tiny">样本不足。</p>'; return; }
    const rowH = 26, h = het.length * rowH + 46;
    const lo = Math.min(-0.2, ...het.map(d => d.ci[0])) - 0.05;
    const hi = Math.max(0.2, ...het.map(d => d.ci[1])) + 0.05;
    const pad = { l: 190, r: 90, t: 24, b: 26 };
    const w = $("#chartForest").clientWidth || 900;
    const svg = S("svg", { viewBox: `0 0 ${w} ${h}`, width: "100%", height: h });
    const pw = w - pad.l - pad.r;
    const X = v => pad.l + (v - lo) / (hi - lo) * pw;
    $("#chartForest").innerHTML = "";
    $("#chartForest").appendChild(svg);

    // 参考线
    svg.appendChild(S("line", { x1: X(0), x2: X(0), y1: 18, y2: h - pad.b, stroke: C_MUTE, "stroke-dasharray": "3 3" }));
    svg.appendChild(S("text", { x: X(0), y: 13, "text-anchor": "middle", class: "lbl" }, ["无差异"]));
    // 轴
    const ticks = niceTicks(lo, hi, 6);
    ticks.forEach(t => {
      svg.appendChild(S("line", { x1: X(t), x2: X(t), y1: 18, y2: h - pad.b, stroke: "#eef1f5" }));
      svg.appendChild(S("text", { x: X(t), y: h - 8, "text-anchor": "middle", class: "lbl" }, [t.toFixed(2)]));
    });
    svg.appendChild(S("text", { x: pad.l + pw / 2, y: h - 0 + 0, "text-anchor": "middle", class: "lbl-b" }, [""]));

    svg.appendChild(S("text", { x: 8, y: 13, class: "lbl-b" }, ["子群"]));
    svg.appendChild(S("text", { x: w - 84, y: 13, class: "lbl-b" }, ["样本 / 效应"]));

    het.forEach((d, i) => {
      const y = 32 + i * rowH;
      const isCover = d.name.indexOf("覆盖") >= 0;
      const col = d.p < 0.05 ? (d.effect < 0 ? C_B : C_DANGER) : C_MUTE;
      svg.appendChild(S("text", { x: 8, y: y + 4, class: "lbl-b", fill: isCover ? C_BRAND : "#4a5c6e" }, [d.name]));
      svg.appendChild(S("line", { x1: X(d.ci[0]), x2: X(d.ci[1]), y1: y, y2: y, stroke: col, "stroke-width": 1.8, opacity: .7 }));
      [d.ci[0], d.ci[1]].forEach(v => svg.appendChild(S("line", { x1: X(v), x2: X(v), y1: y - 4, y2: y + 4, stroke: col, "stroke-width": 1.8, opacity: .7 })));
      const r = clamp(Math.sqrt(d.n) / 5, 2.6, 7);
      svg.appendChild(S("circle", { cx: X(d.effect), cy: y, r, fill: col, opacity: .9 }, [S("title", {}, [`${d.name}\nn=${d.n}  p=${pFmt(d.p)}\n几何均值比=${d.ratio.toFixed(3)}`])]));
      svg.appendChild(S("text", { x: w - 84, y: y + 4, class: "lbl", fill: "#4a5c6e" }, [`n=${d.n}  ${d.ratio.toFixed(3)}×`]));
    });
    const lg = H("div", "legend");
    lg.appendChild(H("span", "", `<i style="background:${C_B}"></i>显著变快`));
    lg.appendChild(H("span", "", `<i style="background:${C_MUTE}"></i>不显著`));
    lg.appendChild(H("span", "", `<i style="background:${C_DANGER}"></i>显著变慢`));
    lg.appendChild(H("span", "", "横轴 = 对数尺度效应（负=更快）；点大小 = 样本量"));
    $("#chartForest").appendChild(lg);
  }

  function renderGuard(A) {
    const sA = A.summaryA, sB = A.summaryB;
    const guards = A.guards || [];
    let h = `<table><thead><tr><th>指标</th><th class="n">A 组</th><th class="n">B 组</th><th class="n">变化</th><th>95% 置信区间（B−A）</th><th>非劣界</th><th>判定</th></tr></thead><tbody>`;
    guards.forEach(g => {
      const t = g.test, ci = t ? t.ci : null;
      const isPct = g.key !== "price";
      const fA = isPct ? pct(g.a, 2) : signPct(g.a, 2);
      const fB = isPct ? pct(g.b, 2) : signPct(g.b, 2);
      const fD = isPct ? signPct(g.delta, 2) : signPct(g.delta, 2);
      const ciTxt = ci ? `[${(ci[0] * 100).toFixed(2)}, ${(ci[1] * 100).toFixed(2)}] pp` : "—";
      const lim = g.key === "onTime" ? "不得下降 >5pp" : `上升 < ${(g.limit * 100).toFixed(1)}pp`;
      const vcls = g.verdict === "恶化" ? "bad" : (g.verdict === "越界" || g.verdict === "通过·需监控") ? "warn" : "ok";
      let vtxt = g.key === "onTime" ? (g.beyond ? "下降过多" : "通过") : g.verdict;
      if (g.key === "onTime" && !g.beyond) vtxt = "通过";
      h += `<tr><td><b>${g.name}</b><br><span class="tiny muted">${g.desc}</span></td>
        <td class="n">${fA}</td><td class="n">${fB}</td>
        <td class="n" style="color:${g.beyond ? "var(--danger)" : "var(--ink)"}">${fD}</td>
        <td class="mono">${ciTxt}</td>
        <td class="tiny">${lim}</td>
        <td><span class="pill ${vcls}">${vtxt}</span>
          <br><span class="tiny muted">p = ${t ? pFmt(t.p) : "—"}</span></td></tr>`;
    });
    h += `</tbody></table>`;
    const auditG = guards.find(g => g.key === "audit");
    const spot = sB.spotRate;
    h += `<div class="note warn" style="margin-top:12px"><b>抽检不是管控手段，只是威慑和发现机制。</b>
      实验组实际抽检覆盖率 <b>${pct(spot, 1)}</b> —— 覆盖率就是<b>发现率的上限</b>，10% 的抽检最多只能发现 10% 的异常，
      剩下 90% 它拦不住。当前 A 组 ${pct(sA.auditRate, 2)} → B 组 ${pct(sB.auditRate, 2)}
      （差 ${signPct(auditG ? auditG.delta : 0, 2)}）。<br>
      <span class="tiny">把左上角「事后抽检比例」滑块从 10% 拉到 40%（成本翻四倍），你会看到护栏点估计只挪动零点几个百分点 ——
        这是本实验最重要的一个负面发现：<b>放宽前置审批带来的风险，无法靠事后抽检抵消</b>。
        真正能兜底的是全量数据留痕、价格与供应商的事后自动比对、以及明确的责任追溯机制。</span></div>`;
    $("#tblGuard").innerHTML = h;
    return guards;
  }

  function renderBH(A) {
    const tests = [];
    const add = (name, p, type) => { if (p !== null && p !== undefined) tests.push({ name, p, type }); };
    add("主指标 · PR→PO 周期（对数尺度）", A.primary.logTest ? A.primary.logTest.p : null, "主");
    (A.guards || []).forEach(g => add((g.key === "onTime" ? "次指标 · " : "护栏 · ") + g.name, g.test ? g.test.p : null, g.key === "onTime" ? "次" : "护栏"));
    if (A.cuped && A.cuped.test) add("稳健性 · CUPED 调整后主指标", A.cuped.test.p, "稳健");

    const bh = Stats.benjaminiHochberg(tests.map(t => t.p), 0.05);
    let h = `<table><thead><tr><th>检验项</th><th>类型</th><th class="n">原始 p</th><th class="n">BH 校正 q</th><th>未校正结论</th><th>校正后结论</th></tr></thead><tbody>`;
    tests.forEach((t, i) => {
      const raw = t.p < 0.05, adj = bh.rejected[i];
      h += `<tr><td>${t.name}</td><td><span class="pill ${t.type === "主" ? "" : "gray"}">${t.type}</span></td>
        <td class="n">${pFmt(t.p)}</td><td class="n">${pFmt(bh.adj[i])}</td>
        <td>${raw ? '<span class="pill gray">检出差异</span>' : '<span class="pill gray">未检出</span>'}</td>
        <td>${adj ? '<span class="pill gray">仍检出</span>' : (raw ? '<span class="pill warn">校正后消失</span>' : '<span class="pill gray">未检出</span>')}</td></tr>`;
    });
    h += `</tbody></table>`;
    const flip = tests.some((t, i) => t.p < 0.05 && !bh.rejected[i]);
    h += `<div class="note ${flip ? "warn" : "ok"}" style="margin-top:12px">
      做了 <b>${tests.length}</b> 项检验，用 Benjamini-Hochberg 控制错误发现率（FDR=5%）。
      ${flip ? "有项目在校正后失去显著性 —— 说明该结论依赖「多测多看」，不应单独据此决策。"
        : "全部结论在校正后保持稳定，不存在靠多重检验「凑显著性」的问题。"}
      主指标不受多重比较影响（它只有一项），但它旁边的次指标和护栏必须校正后再对外汇报。</div>`;
    $("#tblBH").innerHTML = h;
  }

  /* =========================================================================
     6. 决策页
     ========================================================================= */
  function renderDecision() {
    if (!state.rows) {
      $("#decisionBox").innerHTML = '<div class="card"><h3>决策建议</h3><p class="muted">请先在「沙盒运行」页运行实验。</p></div>';
      return;
    }
    const A = state.analysis || ProcSim.analyze(state.rows, state.upto, {});
    const P = A.primary;
    const sA = A.summaryA, sB = A.summaryB;
    const pMain = P.logTest ? P.logTest.p : 1;
    const ciHi = P.ciGeo[1];
    const h1 = pMain < 0.05 && ciHi < 1;
    const pOn = A.secondary.onTime ? A.secondary.onTime.p : 1;
    const liftOn = sB.onTime48 - sA.onTime48;
    const h2 = pOn < 0.05 && liftOn > 0.10;
    const auditDelta = sB.auditRate - sA.auditRate;
    const priceDelta = sB.priceVar - sA.priceVar;
    const h3 = auditDelta < 0.010 && priceDelta < 0.015;
    const srmPass = A.srm ? A.srm.pass : true;
    const monitor = (A.guards || []).filter(g => g.verdict === "通过·需监控");
    const monitorNote = monitor.length
      ? `<div class="note warn" style="margin-top:12px"><b>附：有护栏指标虽未越界，但已统计显著上升，需纳入上线后监控。</b>
         ${monitor.map(g => `${g.name}（${signPct(g.delta, 2)}，p=${pFmt(g.test ? g.test.p : null)}）`).join("；")}。
         这说明风险确实在上升，只是幅度还在可接受范围内。"未越界"不等于"没变化" —— 上线后要盯住这条线。</div>`
      : "";

    let verdict, body, cls;
    if (!srmPass) {
      cls = "bad";
      verdict = "实验无效 · 立即停止";
      body = "SRM 检验未通过，分流比例偏离 1:1。这通常意味着随机化实现有缺陷，此时任何效应估计都不可信。必须先定位并修复分流逻辑，重跑实验，而不是解释结果。";
    } else if (h1 && h2 && h3) {
      cls = "ok";
      verdict = "有条件放量上线";
      body = "主指标与次指标均达到事前判据，三个护栏指标均未越界。建议按限定条件放量，而非全量放开。";
    } else if (h1 && !h3) {
      cls = "warn";
      verdict = "先补管控，再放量";
      body = "速度收益成立，但护栏越界 —— 用管控失守换取效率提升不可接受。应先加强事后抽检或收紧金额阈值，重跑确认后再放量。";
    } else {
      cls = "warn";
      verdict = "不上线";
      body = "主指标未达到事前判据。要么效应确实不足，要么样本量不够。需先区分这两种情况，再决定放弃还是延长实验。";
    }

    /* 主指标口径 */
    const ratio = P.ratio;
    const targetShare = state.rows.filter(r => r.arm === "B" && r.targeted && r.autoPassed).length /
      Math.max(1, state.rows.filter(r => r.arm === "B").length);
    const caceRatio = Math.exp(P.logTest ? P.logTest.diff / Math.max(targetShare, 1e-6) : 0);

    /* 年化收益估算 */
    const thr = state.params.amountThreshold;
    const volumeYear = state.params.dailyVolume * 250;
    const coveredYear = volumeYear * targetShare;
    const hoursSavedPer = sA.geomean - sB.geomean;
    const hoursSavedYear = coveredYear * hoursSavedPer;
    const laborRate = 65; // 元/小时（采购员综合人力成本）
    const laborSave = hoursSavedYear * laborRate * 0.55; // 其中约 55% 是人工等待/处理时间
    const spotCost = coveredYear * state.params.spotCheckRate * 0.35 * 80; // 抽检成本
    const netSave = laborSave - spotCost;

    $("#decisionBox").innerHTML = `
      <div class="card" style="border-left:4px solid var(--${cls === "ok" ? "ok" : cls === "bad" ? "danger" : "accent"})">
        <h3>实验结论</h3>
        <div style="display:flex;align-items:center;gap:12px;margin:8px 0 14px;flex-wrap:wrap">
          <span class="pill ${cls === "ok" ? "ok" : cls === "bad" ? "bad" : "warn"}" style="font-size:13px;padding:6px 14px">${verdict}</span>
          <span class="tiny muted">基于第 ${state.upto} 天、${A.n.toLocaleString("zh-CN")} 条 PR 的随机对照实验</span>
        </div>
        <p>${body}</p>
        <div class="grid g4" style="margin-top:14px">
          <div class="kpi a"><div class="k">对照组典型周期</div><div class="v">${fmt(sA.geomean, 1)}<span class="u">h</span></div><div class="d">几何均值 · 中位 ${fmt(sA.median, 1)}h</div></div>
          <div class="kpi b"><div class="k">实验组典型周期</div><div class="v">${fmt(sB.geomean, 1)}<span class="u">h</span></div><div class="d">几何均值 · 中位 ${fmt(sB.median, 1)}h</div></div>
          <div class="kpi x"><div class="k">典型周期变化</div><div class="v">${signPct(ratio - 1, 1)}</div><div class="d">95%CI [${pct(P.ciGeo[0] - 1, 1)}, ${pct(P.ciGeo[1] - 1, 1)}]</div></div>
          <div class="kpi"><div class="k">被覆盖人群实际效应</div><div class="v">${signPct(caceRatio - 1, 0)}</div><div class="d">CACE · 覆盖率 ${pct(targetShare, 0)}</div></div>
        </div>
        ${monitorNote}
      </div>

      <div class="grid g2">
        <div class="card">
          <h3>判据核对表</h3>
          <p class="sub">每一项都在实验开始前写死，现在只做核对，不做解释性调整。</p>
          <div class="scroll">
          <table>
            <thead><tr><th>判据</th><th>要求</th><th class="n">实测</th><th>结论</th></tr></thead>
            <tbody>
              <tr><td>H1 主指标显著</td><td>几何均值比 &lt;1 且 CI 上限 &lt;1</td><td class="n">${fmt(ratio, 3)}× / CI 上限 ${fmt(ciHi, 3)}×</td><td>${h1 ? '<span class="pill ok">达成</span>' : '<span class="pill bad">未达成</span>'}</td></tr>
              <tr><td>H2 次指标提升</td><td>48h 完成率 +10pp 以上</td><td class="n">${signPct(liftOn, 1)}</td><td>${h2 ? '<span class="pill ok">达成</span>' : '<span class="pill warn">未达成</span>'}</td></tr>
              <tr><td>H3-a 审计异常</td><td>上升 &lt; 1.0pp</td><td class="n">${signPct(auditDelta, 2)}</td><td>${auditDelta < 0.01 ? '<span class="pill ok">未越界</span>' : '<span class="pill bad">越界</span>'}</td></tr>
              <tr><td>H3-b 价格偏差</td><td>上升 &lt; 1.5pp</td><td class="n">${signPct(priceDelta, 2)}</td><td>${priceDelta < 0.015 ? '<span class="pill ok">未越界</span>' : '<span class="pill bad">越界</span>'}</td></tr>
              <tr><td>SRM 健康度</td><td>p &gt; 0.001</td><td class="n">${A.srm ? pFmt(A.srm.p) : "—"}</td><td>${srmPass ? '<span class="pill ok">通过</span>' : '<span class="pill bad">不通过</span>'}</td></tr>
            </tbody>
          </table>
          </div>
        </div>

        <div class="card">
          <h3>若放量：建议的落地条件</h3>
          <p class="sub">不是"开关式上线"，而是带边界的灰度方案。</p>
          <div class="note ok">
            <b>① 金额边界：</b>自动放行阈值锁定在 <b>${money(thr)}</b>。
              <span class="tiny">（把阈值往上推，你会看到护栏会先于主指标出问题 —— 见统计诊断页）</span><br>
            <b>② 品类边界：</b>仅限风险等级=低的品类（间接物料、IT 与办公、包装与耗材）。<br>
            <b>③ 全量留痕 + 事后比对：</b>自动放行通道不做人工前置审核，但必须保证价格、供应商、预算科目的
              <b>全量数据留痕</b>与<b>自动异常比对</b>；抽检只作为补充发现手段（10% 覆盖率只能发现 10% 的异常）。<br>
            <b>④ 熔断条件：</b>审计异常率月度环比上升超 1.0pp，自动回退至人工审批并触发根因排查。<br>
            <b>⑤ 季度复审：</b>金额阈值不是常数 —— 需随价格水平与风险画像变化重新校准。
          </div>
          <h4 style="margin-top:14px">年化收益粗估（按 ${state.params.dailyVolume} 条/日、250 工作日）</h4>
          <div class="scroll"><table>
            <tbody>
              <tr><td>年 PR 量</td><td class="n">${volumeYear.toLocaleString("zh-CN")} 条</td></tr>
              <tr><td>走自动通道</td><td class="n">${Math.round(coveredYear).toLocaleString("zh-CN")} 条（${pct(targetShare, 0)}）</td></tr>
              <tr><td>单条节省周期</td><td class="n">${fmt(hoursSavedPer, 1)} 小时</td></tr>
              <tr><td>释放的采购人力工时</td><td class="n">${Math.round(hoursSavedYear).toLocaleString("zh-CN")} 小时/年</td></tr>
              <tr><td>折算人力收益</td><td class="n" style="color:var(--ok)">+¥${Math.round(laborSave).toLocaleString("zh-CN")}</td></tr>
              <tr><td>新增抽检成本</td><td class="n" style="color:var(--danger)">−¥${Math.round(spotCost).toLocaleString("zh-CN")}</td></tr>
              <tr><td><b>净收益</b></td><td class="n"><b>¥${Math.round(netSave).toLocaleString("zh-CN")}</b></td></tr>
            </tbody>
          </table></div>
          <div class="tiny muted" style="margin-top:8px">口径说明：人力成本按 ¥65/小时估算，其中约 55% 的等待时间可被真正释放；
            抽检按每条 ¥0.35 的系统+人工成本估算。这是量级参考，不是财务承诺。</div>
        </div>
      </div>`;
  }

  /* =========================================================================
     局限 & 下一步（静态）
     ========================================================================= */
  function renderStatic() {
    $("#limits").innerHTML = `
      <div class="note warn"><b>① 流程耗时是仿真，不是实测。</b>
        公开数据里没有"PR 级审批节点时间戳"。沙盒从真实数据继承的是<b>分布形状</b>（对数正态、重尾、金额离散度、品类构成），
        耗时水平是结构化生成的。真实落地前必须用企业内部 OA/采购系统的日志重新标定。</div>
      <div class="note warn"><b>② 无长期效应评估。</b>
        实验覆盖 4 周，看不出"自动放行常态化后，申请人是否会主动把大额采购拆成小额来钻阈值空子"。
        拆单行为有滞后性，需要更长观察窗与专门的反规避监控。</div>
      <div class="note warn"><b>③ ITT 低估了价值，CACE 高估了可推广性。</b>
        实际覆盖率只有约 <b>三分之一</b>（低值 + 低风险 + 规则校验通过），全体口径的效应被明显稀释 ——
        ITT 口径下周期只降约 30%，而<b>被覆盖人群</b>的实际效应接近 67%。这两个数字差一倍以上。<br>
        只报 ITT 会低估价值，只报 CACE 会高估推广收益。而且阈值一旦上调、覆盖面扩大，
        边际人群的风险画像更差，效应与护栏都<b>不能线性外推</b>。</div>
      <div class="note warn"><b>④ 溢出与污染。</b>
        同一采购员同时处理两套流程，可能把新流程的处理习惯带入对照组，使效应被低估。
        若不接受这一点，应改为按部门/按人的整群随机化，代价是需要更大样本。</div>
      <div class="note warn"><b>⑤ 护栏指标的测量误差，以及"抽检兜不住"这一事实。</b>
        审计异常依赖事后抽检发现，抽检覆盖率只有 <b>10%</b>，意味着<b>最多只能发现 10% 的异常</b>，
        真实异常率必然被大幅低估。把抽检比例拉到 40%（四倍成本），护栏点估计几乎不动 ——
        所以护栏不是"跑一个实验就能证明安全"的东西，它只能靠<b>全量留痕 + 事后自动比对 + 熔断机制</b>来守。</div>`;

    $("#nextSteps").innerHTML = `
      <div class="note ok"><b>第 1 步 · 用真实日志替换仿真。</b>
        从 OA 审批流、采购系统、ERP 拉取 PR→PO 全链路时间戳，按本文同样的口径重算基线。
        如果实测 σ 与沙盒差异超过 30%，所有样本量结论都要重算。</div>
      <div class="note"><b>第 2 步 · 补一个前置的准实验。</b>
        在随机化上线前，用"同品类同金额档的历史同期对照"或差分中的差分（DiD）做一次预判，
        避免把明显无效的方案推进到正式实验。</div>
      <div class="note"><b>第 3 步 · 把阈值做成实验变量。</b>
        现在是"50,000 元"一个点。下一步做多臂实验（多阈值）或用响应面方法找最优阈值，
        同时观察"阈值—收益—风险"三者的边际曲线，而不是只回答"有效/无效"。</div>
      <div class="note"><b>第 4 步 · 建立常态化实验基建。</b>
        分流服务、指标字典、SRM 告警、序贯检验平台 —— 让下一次实验的准备时间从 3 周降到 3 天。
        单次实验的价值有限，<b>可复用的实验能力才是资产</b>。</div>
      <div class="note"><b>第 5 步 · 扩展到期次指标。</b>
        本实验只优化了"快"。真正该验证的下一环是"快是否带来业务结果"——
        库存周转天数、缺料停线次数、采购总成本（TCO）是否有同向变化。没有这一层，效率提升只是过程指标。</div>`;
  }

  /* =========================================================================
     初始化
     ========================================================================= */
  function bindTabs() {
    $$("#tabs .tab").forEach(b => b.addEventListener("click", () => showTab(b.dataset.t)));
  }
  function bindSliders() {
    ["s-mde", "s-base", "s-sd", "s-vol", "s-alpha", "s-power",
      "s-gmde", "s-gbase", "s-gdelta", "s-gvol"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener("input", () => { renderDesign(); });
    });
    ["s-thr", "s-delay", "s-pass", "s-spot", "s-vol2", "s-days", "s-seed", "s-bias", "s-speed"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener("input", () => { readRunLabels(); });
      if (el) el.addEventListener("change", () => { if (id !== "s-speed") { readRunLabels(); runExperiment(true); } });
    });
    $("#btnRun").addEventListener("click", () => runExperiment(false));
    $("#btnInstant").addEventListener("click", () => runExperiment(true));
    $("#btnReset").addEventListener("click", () => {
      const d = ProcSim.DEFAULTS;
      $("#s-thr").value = d.amountThreshold; $("#s-delay").value = d.autoDelayHours;
      $("#s-pass").value = d.autoPassRate; $("#s-spot").value = d.spotCheckRate;
      $("#s-vol2").value = d.dailyVolume; $("#s-days").value = d.days;
      $("#s-seed").value = 20260; $("#s-bias").value = 0; $("#s-speed").value = 1;
      clearInterval(state.timer); state.running = false; $("#btnRun").disabled = false;
      readRunLabels(); runExperiment(true);
    });
    $("#btnAA").addEventListener("click", runAA);
  }

  function init() {
    bindTabs();
    bindSliders();
    renderStatic();
    if (state.baseline) {
      renderData();
      const B = state.baseline;
      const totalAwards = (B.amountBands || []).reduce((s, b) => s + (b.count || 0), 0);
      $("#pillRows").textContent = `真实记录 ${totalAwards.toLocaleString("zh-CN")} 条`;
    }
    // 初始化运行页
    readRunLabels();
    const params = collectRunParams();
    state.params = params;
    state.rows = ProcSim.generatePanel(params).rows;
    state.series = ProcSim.dailySeries(state.rows);
    state.upto = params.days;
    renderRun(true);
    // 预填设计页
    renderDesign();
    // 用沙盒实测的基线更新规划器默认值
    const A0 = state.analysis;
    if (A0) {
      const gm = A0.summaryA.geomean, sd = Stats.sd(A0.raw.yA.map(Math.log));
      $("#s-base").value = Math.round(gm);
      $("#s-sd").value = clamp(sd, 0.3, 1.4).toFixed(2);
      renderDesign();
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
