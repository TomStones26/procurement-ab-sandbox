const fs = require("fs");
const path = "C:/Users/ynwas/WorkBuddy/2026-09-21-16-09-54/procurement-ab-sandbox/engine.js";
const src = fs.readFileSync(path, "utf8");
const build = new Function(src + "\nreturn {Stats, ProcSim, RNG};");
const { Stats, ProcSim, RNG } = build();

const out = [];
const log = (...a) => out.push(a.join(" "));
const f = (v, d) => (typeof v === "number" && isFinite(v)) ? v.toFixed(d === undefined ? 3 : d) : String(v);

const t0 = Date.now();
const params = Object.assign({}, ProcSim.DEFAULTS, { dailyVolume: 380, days: 28, seed: 20260921 });
const panel = ProcSim.generatePanel(params);
log(`panel rows: ${panel.rows.length}  生成耗时 ${Date.now() - t0} ms`);

const A = ProcSim.analyze(panel.rows, params.days, { alpha: 0.05 });
const sA = A.summaryA, sB = A.summaryB;
log("\n=== 对照组 A ===");
log(`n=${sA.n} 几何均值=${f(sA.geomean, 2)}h 中位=${f(sA.median, 2)}h P90=${f(sA.p90, 2)}h 均值=${f(sA.mean, 2)} sd=${f(sA.sd, 2)}`);
log(`48h完成率=${f(sA.onTime48 * 100, 2)}% 审计异常=${f(sA.auditRate * 100, 2)}% 价格偏差=${f(sA.priceVar * 100, 3)}% 紧急采购=${f(sA.maverickRate * 100, 2)}%`);

log("\n=== 实验组 B ===");
log(`n=${sB.n} 几何均值=${f(sB.geomean, 2)}h 中位=${f(sB.median, 2)}h P90=${f(sB.p90, 2)}h 均值=${f(sB.mean, 2)} sd=${f(sB.sd, 2)}`);
log(`48h完成率=${f(sB.onTime48 * 100, 2)}% 审计异常=${f(sB.auditRate * 100, 2)}% 价格偏差=${f(sB.priceVar * 100, 3)}% 紧急采购=${f(sB.maverickRate * 100, 2)}%`);

log("\n=== 主指标 ===");
log(`几何均值比=${f(A.primary.ratio, 4)}  95%CI=[${f(A.primary.ciGeo[0], 4)}, ${f(A.primary.ciGeo[1], 4)}]`);
log(`log Welch: diff=${f(A.primary.logTest.diff, 4)} se=${f(A.primary.logTest.se, 4)} t=${f(A.primary.logTest.t, 2)} p=${A.primary.logTest.p.toExponential(3)}`);
log(`raw Welch: diff=${f(A.primary.rawTest.diff, 3)}h p=${A.primary.rawTest.p.toExponential(3)}`);
log(`bootstrap 中位数差=${f(A.primary.medianDiff, 2)}h CI=[${f(A.primary.medianCi[0], 2)}, ${f(A.primary.medianCi[1], 2)}]`);

log("\n=== SRM ===");
log(`chi2=${f(A.srm.chi2, 4)} p=${f(A.srm.p, 4)} lift=${f(A.srm.lift * 100, 2)}% pass=${A.srm.pass}`);

log("\n=== CUPED ===");
log(`rho=${f(A.cuped.rho, 4)} theta=${f(A.cuped.theta, 4)} 方差缩减=${f(A.cuped.reduction * 100, 2)}%`);
log(`调整后 SE=${f(A.cuped.test.se, 5)} vs 调整前 SE=${f(A.cuped.testRaw.se, 5)}  adj p=${A.cuped.test.p.toExponential(3)}`);

log("\n=== 护栏 ===");
A.guards.forEach(g => log(`${g.name}: A=${f(g.a * 100, 3)}% B=${f(g.b * 100, 3)}% Δ=${f(g.delta * 100, 3)}pp p=${g.test ? g.test.p.toExponential(2) : "-"} → ${g.verdict}`));

const Brows = panel.rows.filter(r => r.arm === "B");
const targeted = Brows.filter(r => r.targeted).length;
const auto = Brows.filter(r => r.targeted && r.autoPassed).length;
const share = auto / Brows.length;
log("\n=== 覆盖与 CACE ===");
log(`B 组 n=${Brows.length}  目标人群=${targeted} (${f(targeted / Brows.length * 100, 1)}%)  实际自动放行=${auto} (${f(share * 100, 1)}%)`);
const cace = Math.exp(A.primary.logTest.diff / share);
log(`ITT 几何均值比=${f(A.primary.ratio, 4)}  CACE 几何均值比=${f(cace, 4)} (即覆盖人群缩短 ${f((1 - cace) * 100, 1)}%)`);

const dg = ProcSim.distributionDiag(panel.rows.filter(r => r.arm === "A"));
log("\n=== 分布诊断（A 组）===");
log(`原始尺度: 偏度=${f(dg.rawSkew, 2)} 峰度=${f(dg.rawKurt, 2)} sd=${f(dg.rawSd, 2)} 均值=${f(dg.rawMean, 1)} 中位=${f(dg.rawMedian, 1)} P99=${f(dg.rawP99, 0)} max=${f(dg.rawMax, 0)}`);
log(`对数尺度: 偏度=${f(dg.logSkew, 3)} 峰度=${f(dg.logKurt, 3)} sd=${f(dg.logSd, 3)}`);

log("\n=== 异质性 ===");
const het = ProcSim.heterogeneity(panel.rows, [
  { name: "低风险", filter: r => r.risk === "低" },
  { name: "中风险", filter: r => r.risk === "中" },
  { name: "高风险", filter: r => r.risk === "高" },
  { name: "覆盖人群", filter: r => r.targeted && r.autoPassed },
  { name: "未覆盖", filter: r => !(r.targeted && r.autoPassed) },
]);
het.forEach(d => log(`${d.name.padEnd(6)} n=${String(d.n).padStart(5)} ratio=${f(d.ratio, 3)} CI=[${f(d.ci[0], 3)},${f(d.ci[1], 3)}] p=${d.p.toExponential(2)}`));

log("\n=== 序贯 ===");
const series = ProcSim.dailySeries(panel.rows, {});
const bounds = Stats.obfBoundary(params.days, 0.05);
const firstCross = series.find((s, i) => Math.abs(s.z) > bounds[i]);
log(`末|z|=${f(Math.abs(series[series.length - 1].z), 2)} 边界=${f(bounds[params.days - 1], 2)}`);
log(firstCross ? `首次越界：第 ${firstCross.day} 天 |z|=${f(Math.abs(firstCross.z), 2)}` : "未越界");

log("\n=== 样本量规划（MDE 12%, σ=0.78, 380/日）===");
log(JSON.stringify(Stats.planDays(0.12, 0.78, 380, 0.05, 0.8)));

log("\n=== 数字函数自检 ===");
log(`normCdf(1.96)=${f(Stats.normCdf(1.96), 5)} (期望 0.97500)`);
log(`normInv(0.975)=${f(Stats.normInv(0.975), 5)} (期望 1.95996)`);
log(`tSf(1.96, 10000)=${f(Stats.tSf(1.96, 10000), 5)} (期望 0.02501)`);
log(`chi2Sf(3.841,1)=${f(Stats.chi2Sf(3.841, 1), 5)} (期望 0.05001)`);
log(`chi2Sf(5.991,2)=${f(Stats.chi2Sf(5.991, 2), 5)} (期望 0.05001)`);
log(`chi2Sf(11.070,5)=${f(Stats.chi2Sf(11.070, 5), 5)} (期望 0.05001)`);
const rng = new RNG(1);
let s = 0; for (let i = 0; i < 200000; i++) s += rng.norm();
log(`标准正态 2e5 抽样均值=${f(s / 200000, 4)} (期望 ~0)`);

log("\n=== 随机化故障注入（SRM 检出能力）===");
[0, 0.005, 0.01, 0.02, 0.03].forEach(b => {
  const pn = ProcSim.generatePanel(Object.assign({}, params, { srmBias: b, dailyVolume: 380, days: 28 }));
  const an = ProcSim.analyze(pn.rows, 28, {});
  log(`偏移 ${f(b * 100, 1)}% → 实际占比 ${f(an.srm.ratio * 100, 2)}%  chi2=${f(an.srm.chi2, 2)}  p=${an.srm.p.toExponential(2)}  SRM判定=${an.srm.pass ? "通过(漏报)" : "拦截"}`);
});

log("\n=== A/A 假阳性率（单次检验 / 偷看 / 序贯）===");
const ctrlLogs = panel.rows.filter(r => r.arm === "A").map(r => Math.log(r.yC));
const mu = ctrlLogs.reduce((a, b) => a + b, 0) / ctrlLogs.length;
const sg = Math.sqrt(ctrlLogs.reduce((a, v) => a + (v - mu) ** 2, 0) / (ctrlLogs.length - 1));
const r2 = new RNG(424242);
const days = 28, perDayArm = 100, ITER = 300;
const zEnd = 1.96; let fp1 = 0, fp2 = 0, fp3 = 0;
for (let it = 0; it < ITER; it++) {
  let sA = 0, sA2 = 0, nA = 0, sB = 0, sB2 = 0, nB = 0, peek = false, obf = false, lastZ = 0;
  for (let d = 0; d < days; d++) {
    for (let k = 0; k < perDayArm; k++) {
      const a = mu + sg * r2.norm(); sA += a; sA2 += a * a; nA++;
      const b = mu + sg * r2.norm(); sB += b; sB2 += b * b; nB++;
    }
    const vA = (sA2 - sA * sA / nA) / (nA - 1), vB = (sB2 - sB * sB / nB) / (nB - 1);
    const se = Math.sqrt(vA / nA + vB / nB);
    lastZ = se > 0 ? (sB / nB - sA / nA) / se : 0;
    if (Math.abs(lastZ) > zEnd) peek = true;
    if (Math.abs(lastZ) > bounds[d]) obf = true;
  }
  const pv = 2 * Stats.tSf(Math.abs(lastZ), 2 * perDayArm * days - 2);
  if (pv < 0.05) fp1++;
  if (peek) fp2++;
  if (obf) fp3++;
}
log(`① 单次最终检验 假阳性率 = ${f(fp1 / ITER * 100, 1)}%   (目标 5%)`);
log(`② 每天偷看不校正 = ${f(fp2 / ITER * 100, 1)}%`);
log(`③ OBF 序贯边界   = ${f(fp3 / ITER * 100, 1)}%`);

log(`\n总耗时 ${Date.now() - t0} ms`);
fs.writeFileSync("C:/Users/ynwas/WorkBuddy/2026-09-21-16-09-54/_engine_test.txt", out.join("\n"), "utf8");
console.log("done");
