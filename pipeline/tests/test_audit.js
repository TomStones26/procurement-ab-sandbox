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

log(`DEFAULTS: auditBase=${ProcSim.DEFAULTS.auditBase} auditAutoLift=${ProcSim.DEFAULTS.auditAutoLift} spotCheckRate=${ProcSim.DEFAULTS.spotCheckRate} spotCheckRecover=${ProcSim.DEFAULTS.spotCheckRecover}`);

let sumA = 0, sumB = 0, nA = 0, nB = 0, autoA = 0, autoB = 0, aAutoAudit = 0, bAutoAudit = 0, aOtherAudit = 0, bOtherAudit = 0, autoOther = 0, nonAuto = 0;
let autoRaw = 0, autoCaught = 0;
const SEEDS = 12;
for (let s = 0; s < SEEDS; s++) {
  const pn = ProcSim.generatePanel(Object.assign({}, base, { seed: 1000 + s }));
  pn.rows.forEach(r => {
    if (r.arm === "A") {
      sumA += r.audit; nA++;
      if (r.autoPassed) { aAutoAudit += r.audit; } else { aOtherAudit += r.audit; }
    } else {
      sumB += r.audit; nB++;
      if (r.autoPassed) { bAutoAudit += r.audit; } else { bOtherAudit += r.audit; }
    }
    if (r.autoPassed) autoOther++;
  });
}
log(`\n${SEEDS} 个种子合并：`);
log(`A 组审计异常率 = ${(sumA / nA * 100).toFixed(3)}%  (n=${nA})`);
log(`B 组审计异常率 = ${(sumB / nB * 100).toFixed(3)}%  (n=${nB})`);
log(`差 Δ = ${((sumB / nB - sumA / nA) * 100).toFixed(3)} pp   ← 期望 ≈ +0.26pp`);
log(`A 组中 autoPassed 子集审计率 = ${(aAutoAudit / Math.max(1, aAutoAudit + aOtherAudit) * 100).toFixed(3)}%`);
log(`A 组中非 auto 子集审计率     = ${(aOtherAudit / Math.max(1, (nA - (autoOther / 2))) * 100).toFixed(3)}%`);
log(`B 组中 auto 子集审计率       = ${(bAutoAudit / (autoOther / 2) * 100).toFixed(3)}%  (n≈${(autoOther / 2) | 0})`);
log(`B 组中非 auto 子集审计率     = ${(bOtherAudit / (nB - autoOther / 2) * 100).toFixed(3)}%`);

// 单独检验 autoPassed 行：raw 与 caught 的分解
log("\n--- autoPassed 行的审计概率分解（理论值）---");
const pRaw = ProcSim.DEFAULTS.auditBase + ProcSim.DEFAULTS.auditAutoLift;
const pCatch = ProcSim.DEFAULTS.spotCheckRate * ProcSim.DEFAULTS.spotCheckRecover;
log(`P(raw=1)=${pRaw}  P(caught)=${pCatch.toFixed(4)}  →  P(流出)=${(pRaw * (1 - pCatch)).toFixed(5)}`);
log(`非 auto 行 P(流出)=${ProcSim.DEFAULTS.auditBase}  →  理论 Δ（按 auto 占比 r）= r*(0.01970-0.012)`);

// 直接统计 B 组 auto 行里"本该异常但被拦"的数量是否与理论一致
let cntAuto = 0, cntAutoAudit = 0;
const pn2 = ProcSim.generatePanel(Object.assign({}, base, { seed: 1000 }));
pn2.rows.filter(r => r.arm === "B" && r.autoPassed).forEach(r => { cntAuto++; cntAutoAudit += r.audit; });
log(`\nB 组 auto 行: n=${cntAuto} 流出异常=${cntAutoAudit} (${(cntAutoAudit / cntAuto * 100).toFixed(3)}%)  理论 ${(pRaw * (1 - pCatch) * 100).toFixed(3)}%`);
const cntNon = pn2.rows.filter(r => r.arm === "B" && !r.autoPassed).length;
const cntNonAudit = pn2.rows.filter(r => r.arm === "B" && !r.autoPassed).reduce((s, r) => s + r.audit, 0);
log(`B 组非 auto 行: n=${cntNon} 流出异常=${cntNonAudit} (${(cntNonAudit / cntNon * 100).toFixed(3)}%)  理论 1.200%`);

fs.writeFileSync("C:/Users/ynwas/WorkBuddy/2026-09-21-16-09-54/_audit.txt", out.join("\n"), "utf8");
console.log("done");
