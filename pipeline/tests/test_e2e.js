const fs = require("fs");
const D = "C:/Users/ynwas/WorkBuddy/2026-09-21-16-09-54/procurement-ab-sandbox/";
const engine = fs.readFileSync(D + "engine.js", "utf8");
const dataJs = fs.readFileSync(D + "data.js", "utf8");
const sandbox = { window: {} };
const build = new Function("window", "fs", dataJs + "\n" + engine + "\nreturn {Stats, ProcSim, RNG};");
const { Stats, ProcSim, RNG } = build(sandbox.window, fs);
const B = sandbox.window.BASELINE;

const out = [];
const log = (...a) => out.push(a.join(" "));
const f = (v, d) => (typeof v === "number" && isFinite(v)) ? v.toFixed(d === undefined ? 3 : d) : String(v);

log("=== 基线注入检查 ===");
log(`真实合同计数 ${B.generatedFrom.nContractsCounted.toLocaleString()} / 全量 ${B.generatedFrom.nContractsBase.toLocaleString()} 覆盖 ${(B.generatedFrom.coverage * 100).toFixed(1)}%`);
log(`分带 ${B.amountBands.length} 个   尺度因子 ×${B.scale.factor}   截断分位 ${B.scale.cutoffQuantile}`);
log(`经验分位: P25=$${Math.round(B.empirical.p25).toLocaleString()} P50=$${Math.round(B.empirical.median).toLocaleString()} P90=$${Math.round(B.empirical.p90).toLocaleString()} P99=$${Math.round(B.empirical.p99).toLocaleString()}`);
log(`PSC 前 3: ${B.topPSC.slice(0, 3).map(p => p[0].slice(0, 22)).join(" | ")}`);
log(`供应商前 3: ${B.topSuppliers.slice(0, 3).map(p => p[0].slice(0, 22)).join(" | ")}`);

const params = Object.assign({}, ProcSim.DEFAULTS, {
  dailyVolume: 380, days: 28, seed: 20260921,
  amountBands: B.amountBands, amountScale: B.scale.factor, amountCutoff: B.scale.cutoffQuantile,
});
const t0 = Date.now();
const panel = ProcSim.generatePanel(params);
log(`\n生成 ${panel.rows.length} 条 PR，耗时 ${Date.now() - t0} ms`);

const amts = panel.rows.map(r => r.amount).sort((a, b) => a - b);
const q = p => amts[Math.floor(p * (amts.length - 1))];
log(`PR 金额分位（元）: P10=${Math.round(q(.1)).toLocaleString()} P25=${Math.round(q(.25)).toLocaleString()} P50=${Math.round(q(.5)).toLocaleString()} P75=${Math.round(q(.75)).toLocaleString()} P90=${Math.round(q(.9)).toLocaleString()} P99=${Math.round(q(.99)).toLocaleString()} max=${Math.round(amts[amts.length - 1]).toLocaleString()}`);
log(`金额 ≤ ¥50,000 的占比: ${(amts.filter(a => a <= 50000).length / amts.length * 100).toFixed(1)}%`);
const byCat = {};
panel.rows.forEach(r => { byCat[r.category] = (byCat[r.category] || 0) + 1; });
log("品类分布: " + Object.entries(byCat).map(([k, v]) => `${k}=${(v / panel.rows.length * 100).toFixed(1)}%`).join("  "));
const byRisk = {};
panel.rows.forEach(r => { byRisk[r.risk] = (byRisk[r.risk] || 0) + 1; });
log("风险分布: " + Object.entries(byRisk).map(([k, v]) => `${k}=${(v / panel.rows.length * 100).toFixed(1)}%`).join("  "));

const A = ProcSim.analyze(panel.rows, 28, {});
const sA = A.summaryA, sB = A.summaryB;
log("\n=== 主结果 ===");
log(`A 组 n=${sA.n} 几何均值=${f(sA.geomean, 2)}h 中位=${f(sA.median, 2)}h P90=${f(sA.p90, 2)}h`);
log(`B 组 n=${sB.n} 几何均值=${f(sB.geomean, 2)}h 中位=${f(sB.median, 2)}h P90=${f(sB.p90, 2)}h`);
log(`几何均值比=${f(A.primary.ratio, 4)} CI=[${f(A.primary.ciGeo[0], 4)}, ${f(A.primary.ciGeo[1], 4)}] p=${A.primary.logTest.p.toExponential(2)}`);
log(`48h 完成率 A=${f(sA.onTime48 * 100, 2)}% B=${f(sB.onTime48 * 100, 2)}% (Δ=${f((sB.onTime48 - sA.onTime48) * 100, 2)}pp, p=${A.secondary.onTime.p.toExponential(2)})`);
log(`SRM: p=${f(A.srm.p, 4)} level=${A.srm.level}`);
log(`CUPED: rho=${f(A.cuped.rho, 3)} 方差缩减=${f(A.cuped.reduction * 100, 1)}%`);
A.guards.forEach(g => log(`护栏 ${g.name}: A=${f(g.a * 100, 2)}% B=${f(g.b * 100, 2)}% Δ=${f(g.delta * 100, 2)}pp → ${g.verdict}`));

const Brows = panel.rows.filter(r => r.arm === "B");
const share = Brows.filter(r => r.targeted && r.autoPassed).length / Brows.length;
log(`\n覆盖率（实际自动放行 / B 组）= ${(share * 100).toFixed(1)}%`);
log(`ITT 比值=${f(A.primary.ratio, 4)}   CACE 比值=${f(Math.exp(A.primary.logTest.diff / share), 4)}`);

const dg = ProcSim.distributionDiag(panel.rows.filter(r => r.arm === "A"));
log(`\n分布诊断 A 组: 原始偏度=${f(dg.rawSkew, 2)} 峰度=${f(dg.rawKurt, 1)}   对数偏度=${f(dg.logSkew, 3)} 对数σ=${f(dg.logSd, 3)}`);

log("\n=== 异质性 ===");
ProcSim.heterogeneity(panel.rows, [
  { name: "低风险", filter: r => r.risk === "低" },
  { name: "中风险", filter: r => r.risk === "中" },
  { name: "高风险", filter: r => r.risk === "高" },
  { name: "覆盖人群", filter: r => r.targeted && r.autoPassed },
  { name: "未覆盖", filter: r => !(r.targeted && r.autoPassed) },
]).forEach(d => log(`${d.name} n=${d.n} ratio=${f(d.ratio, 3)} p=${d.p.toExponential(2)}`));

log("\n=== 不同阈值下的 ITT 效应 ===");
[10000, 20000, 50000, 100000, 300000, 1000000].forEach(thr => {
  const pn = ProcSim.generatePanel(Object.assign({}, params, { amountThreshold: thr }));
  const an = ProcSim.analyze(pn.rows, 28, { bootstrap: false });
  const sh = pn.rows.filter(r => r.arm === "B" && r.targeted && r.autoPassed).length / pn.rows.filter(r => r.arm === "B").length;
  log(`阈值 ¥${thr.toLocaleString()} → 覆盖率 ${(sh * 100).toFixed(1)}%  ITT 比 ${f(an.primary.ratio, 3)}  审计异常Δ ${f((an.summaryB.auditRate - an.summaryA.auditRate) * 100, 2)}pp  价格Δ ${f((an.summaryB.priceVar - an.summaryA.priceVar) * 100, 2)}pp`);
});

log("\n=== 抽检比例对护栏的影响 ===");
[0, 0.05, 0.10, 0.20, 0.40].forEach(sr => {
  const pn = ProcSim.generatePanel(Object.assign({}, params, { spotCheckRate: sr }));
  const an = ProcSim.analyze(pn.rows, 28, { bootstrap: false });
  log(`抽检 ${(sr * 100).toFixed(0)}% → 流出审计异常 A=${f(an.summaryA.auditRate * 100, 2)}% B=${f(an.summaryB.auditRate * 100, 2)}% Δ=${f((an.summaryB.auditRate - an.summaryA.auditRate) * 100, 2)}pp  判定=${an.guards.find(g => g.key === 'audit').verdict}`);
});

log("\n=== 样本量规划 ===");
log("主指标 MDE 12%, 对数σ=0.78 " + JSON.stringify(Stats.planDays(0.12, 0.78, 380, 0.05, 0.8)));
log("主指标 MDE 30%, 对数σ=0.78 " + JSON.stringify(Stats.planDays(0.30, 0.78, 380, 0.05, 0.8)));
log(`护栏 1.20%→1.50% 每组需 ${Stats.sampleSizeProportion(0.012, 0.015, 0.05, 0.8).toLocaleString()} 条 → ${(Stats.sampleSizeProportion(0.012, 0.015, 0.05, 0.8) * 2 / 380).toFixed(0)} 天`);
log(`护栏 1.20%→2.50% 每组需 ${Stats.sampleSizeProportion(0.012, 0.025, 0.05, 0.8).toLocaleString()} 条 → ${(Stats.sampleSizeProportion(0.012, 0.025, 0.05, 0.8) * 2 / 380).toFixed(0)} 天`);

log("\n=== 序贯边界 ===");
const bnd = Stats.obfBoundary(28, 0.05);
log(`首=${f(bnd[0], 2)} 第7天=${f(bnd[6], 2)} 第14天=${f(bnd[13], 2)} 末=${f(bnd[27], 3)}`);
const series = ProcSim.dailySeries(panel.rows);
const cross = series.find((s, i) => Math.abs(s.z) > bnd[i]);
log(cross ? `首次越界：第 ${cross.day} 天 |z|=${f(Math.abs(cross.z), 2)}（边界 ${f(bnd[cross.day - 1], 2)}）` : "未越界");

log(`\n总耗时 ${Date.now() - t0} ms`);
fs.writeFileSync("C:/Users/ynwas/WorkBuddy/2026-09-21-16-09-54/_e2e.txt", out.join("\n"), "utf8");
console.log("done");
