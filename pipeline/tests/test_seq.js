const fs = require("fs");
const P = "C:/Users/ynwas/WorkBuddy/2026-09-21-16-09-54/procurement-ab-sandbox/engine.js";
const { Stats, ProcSim, RNG } = new Function(fs.readFileSync(P, "utf8") + "\nreturn {Stats, ProcSim, RNG};")();
const out = [];
const log = (...a) => out.push(a.join(" "));

// 1) 边界形状
[5, 7, 14, 28, 56].forEach(K => {
  const b = Stats.obfBoundary(K, 0.05);
  log(`K=${K}: ` + b.map(x => x.toFixed(3)).join("  "));
});
log("参考值（O'Brien-Fleming, 双侧 α=0.05, 等间距 K=5）：4.877 3.357 2.680 2.290 2.031");
log("参考值（同上 K=3）：3.471 2.454 2.004");

// 2) 边界正确性：蒙特卡洛验证整体第一类错误率
function fpRate(K, ITER, useBoundary) {
  const bounds = Stats.obfBoundary(K, 0.05);
  const rng = new RNG(20260101);
  let hit = 0;
  const mu = 1.0, sg = 0.9;               // 任意基线分布
  const perDayArm = 100;
  for (let it = 0; it < ITER; it++) {
    let sA = 0, sA2 = 0, nA = 0, sB = 0, sB2 = 0, nB = 0, crossed = false;
    for (let d = 0; d < K; d++) {
      for (let k = 0; k < perDayArm; k++) {
        const a = mu + sg * rng.norm(); sA += a; sA2 += a * a; nA++;
        const b = mu + sg * rng.norm(); sB += b; sB2 += b * b; nB++;
      }
      const vA = (sA2 - sA * sA / nA) / (nA - 1), vB = (sB2 - sB * sB / nB) / (nB - 1);
      const se = Math.sqrt(vA / nA + vB / nB);
      const z = se > 0 ? Math.abs((sB / nB - sA / nA) / se) : 0;
      const lim = useBoundary === "obf" ? bounds[d] : 1.96;
      if (z > lim) { crossed = true; break; }
    }
    if (crossed) hit++;
  }
  return hit / ITER;
}
log("");
log(`A/A 假阳性率 · 每天看一次且不做校正     ： ${(fpRate(28, 400, "naive") * 100).toFixed(1)}%  （失控）`);
log(`A/A 假阳性率 · OBF 精确序贯边界        ： ${(fpRate(28, 400, "obf") * 100).toFixed(1)}%  （应 ≤ 5%）`);
log(`A/A 假阳性率 · OBF 边界 K=56           ： ${(fpRate(56, 300, "obf") * 100).toFixed(1)}%`);
log(`A/A 假阳性率 · OBF 边界 K=7            ： ${(fpRate(7, 400, "obf") * 100).toFixed(1)}%`);

// 3) 功效验证：注入真实效应后，序贯检验多大概率能检出
function powerRate(K, ITER, lift) {
  const bounds = Stats.obfBoundary(K, 0.05);
  const rng = new RNG(777);
  let hit = 0;
  const mu = 1.0, sg = 0.9, shift = Math.log(1 - lift);
  const perDayArm = 100;
  for (let it = 0; it < ITER; it++) {
    let sA = 0, sA2 = 0, nA = 0, sB = 0, sB2 = 0, nB = 0, crossed = false;
    for (let d = 0; d < K; d++) {
      for (let k = 0; k < perDayArm; k++) {
        const a = mu + sg * rng.norm(); sA += a; sA2 += a * a; nA++;
        const b = mu + shift + sg * rng.norm(); sB += b; sB2 += b * b; nB++;
      }
      const vA = (sA2 - sA * sA / nA) / (nA - 1), vB = (sB2 - sB * sB / nB) / (nB - 1);
      const se = Math.sqrt(vA / nA + vB / nB);
      const z = se > 0 ? Math.abs((sB / nB - sA / nA) / se) : 0;
      if (z > bounds[d]) { crossed = true; break; }
    }
    if (crossed) hit++;
  }
  return hit / ITER;
}
log("");
log(`功效 · 真实效应 15%、28天、200条/天 ： ${(powerRate(28, 400, 0.15) * 100).toFixed(1)}%`);
log(`功效 · 真实效应  8%、28天、200条/天 ： ${(powerRate(28, 400, 0.08) * 100).toFixed(1)}%`);
log(`功效 · 真实效应  8%、56天、200条/天 ： ${(powerRate(56, 300, 0.08) * 100).toFixed(1)}%`);

// 4) 关键分布函数
log("");
log(`chi2Sf(3.841,1)=${Stats.chi2Sf(3.841, 1).toFixed(5)}  tSf(1.96,1e4)=${Stats.tSf(1.96, 10000).toFixed(5)}  normInv(.975)=${Stats.normInv(0.975).toFixed(5)}`);

fs.writeFileSync("C:/Users/ynwas/WorkBuddy/2026-09-21-16-09-54/_seq_test.txt", out.join("\n"), "utf8");
console.log("done");
