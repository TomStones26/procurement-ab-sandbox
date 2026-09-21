const fs = require("fs");
const D = "C:/Users/ynwas/WorkBuddy/2026-09-21-16-09-54/procurement-ab-sandbox/";
const dataJs = fs.readFileSync(D + "data.js", "utf8");
const engine = fs.readFileSync(D + "engine.js", "utf8");
const sb = { window: {} };
const { Stats, ProcSim } = new Function("window", dataJs + "\n" + engine + "\nreturn {Stats, ProcSim};")(sb.window);
const B = sb.window.BASELINE;

const base = Object.assign({}, ProcSim.DEFAULTS, {
  amountBands: B.amountBands, amountScale: B.scale.factor, amountCutoff: B.scale.cutoffQuantile,
  dailyVolume: 380, days: 28,
});

const out = [];
const log = (...a) => out.push(a.join(" "));
log("seed      nA    geoA     medA    p90A    geoB    比率   cov%   lEff均值  中位金额");
[20260921, 99999, 20260, 1, 42, 777, 55555, 31337, 88888, 1234, 2, 3, 4, 5].forEach(sd => {  const pn = ProcSim.generatePanel(Object.assign({}, base, { seed: sd }));
  const A = ProcSim.analyze(pn.rows, 28, { bootstrap: false, cuped: false });
  const As = pn.rows.filter(r => r.arm === "A");
  const le = As.reduce((s, r) => s + r.layerEffect, 0) / As.length;
  const br = pn.rows.filter(r => r.arm === "B");
  const cov = br.filter(r => r.targeted && r.autoPassed).length / br.length;
  const amts = pn.rows.map(r => r.amount).sort((a, b) => a - b);
  log(`${String(sd).padStart(8)} ${String(A.summaryA.n).padStart(5)} ${A.summaryA.geomean.toFixed(2).padStart(7)} ${A.summaryA.median.toFixed(2).padStart(7)} ${A.summaryA.p90.toFixed(1).padStart(7)} ${A.summaryB.geomean.toFixed(2).padStart(7)} ${A.primary.ratio.toFixed(3).padStart(6)} ${(cov * 100).toFixed(1).padStart(5)} ${le.toFixed(4).padStart(9)} ${Math.round(amts[amts.length >> 1]).toLocaleString()}`);
});

// 层效应的抽样分布
log("\n--- layerEffect 的样本均值分布（20 次）---");
const means = [];
for (let i = 0; i < 20; i++) {
  const pn = ProcSim.generatePanel(Object.assign({}, base, { seed: 7000 + i }));
  const As = pn.rows.filter(r => r.arm === "A");
  means.push(As.reduce((s, r) => s + r.layerEffect, 0) / As.length);
}
log("均值=" + (means.reduce((a, b) => a + b, 0) / means.length).toFixed(4) +
    "  sd=" + Stats.sd(means).toFixed(4) +
    "  min=" + Math.min(...means).toFixed(4) + "  max=" + Math.max(...means).toFixed(4));
log("→ 对几何均值的影响幅度: exp(±3sd) = " + Math.exp(3 * Stats.sd(means)).toFixed(3) + " 倍");

fs.writeFileSync("C:/Users/ynwas/WorkBuddy/2026-09-21-16-09-54/_seedtest.txt", out.join("\n"), "utf8");
console.log("done");
