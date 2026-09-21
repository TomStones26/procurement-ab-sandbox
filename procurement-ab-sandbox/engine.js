/* =========================================================================
   engine.js — 采购 A/B 沙盒内核
   模块：RNG / Dist 分布 / Stats 统计推断 / ProcSim 采购流程仿真
   纯前端、无依赖、可复现（种子化随机）。
   ========================================================================= */

/* ---------------- 1. 随机数 ---------------- */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class RNG {
  constructor(seed) { this.next = mulberry32(seed); this._spare = null; }
  u() { return this.next(); }
  /** 标准正态 —— Marsaglia polar */
  norm() {
    if (this._spare !== null) { const s = this._spare; this._spare = null; return s; }
    let u, v, s;
    do { u = this.u() * 2 - 1; v = this.u() * 2 - 1; s = u * u + v * v; } while (s === 0 || s >= 1);
    const m = Math.sqrt(-2 * Math.log(s) / s);
    this._spare = v * m;
    return u * m;
  }
  bool(p) { return this.u() < p; }
  /** 对数正态：给定中位数与对数标准差 */
  logNormal(median, sigmaLog) { return median * Math.exp(this.norm() * sigmaLog); }
  /** 泊松（Knuth，λ 较大时用正态近似） */
  poisson(lambda) {
    if (lambda > 60) return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * this.norm()));
    const L = Math.exp(-lambda); let k = 0, p = 1;
    do { k++; p *= this.u(); } while (p > L);
    return k - 1;
  }
  /** 按权重抽样 */
  weighted(items, weights) {
    const s = weights.reduce((a, b) => a + b, 0);
    let r = this.u() * s;
    for (let i = 0; i < items.length; i++) { r -= weights[i]; if (r <= 0) return items[i]; }
    return items[items.length - 1];
  }
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.u() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
}

/* ---------------- 2. 统计推断 ---------------- */
const Stats = (() => {

  /* --- 特殊函数 --- */
  function logGamma(x) {
    const c = [76.18009172947146, -86.50532032941677, 24.01409824083091,
      -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
    let y = x, tmp = x + 5.5;
    tmp -= (x + 0.5) * Math.log(tmp);
    let ser = 1.000000000190015;
    for (let j = 0; j < 6; j++) ser += c[j] / ++y;
    return -tmp + Math.log(2.5066282746310005 * ser / x);
  }
  function betacf(a, b, x) {
    const MAXIT = 300, EPS = 3e-12, FPMIN = 1e-300;
    const qab = a + b, qap = a + 1, qam = a - 1;
    let c = 1, d = 1 - qab * x / qap;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    d = 1 / d; let h = d;
    for (let m = 1; m <= MAXIT; m++) {
      const m2 = 2 * m;
      let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d; h *= d * c;
      aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d;
      const del = d * c; h *= del;
      if (Math.abs(del - 1) < EPS) break;
    }
    return h;
  }
  /** 正则化不完全贝塔 I_x(a,b) */
  function ibeta(x, a, b) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    const bt = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
    if (x < (a + 1) / (a + b + 2)) return bt * betacf(a, b, x) / a;
    return 1 - bt * betacf(b, a, 1 - x) / b;
  }
  /** 标准正态 CDF */
  function normCdf(z) {
    return 0.5 * (1 + erf(z / Math.SQRT2));
  }
  function erf(x) {
    const s = x < 0 ? -1 : 1; x = Math.abs(x);
    const t = 1 / (1 + 0.3275911 * x);
    const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return s * y;
  }
  function normInv(p) {
    if (p <= 0) return -Infinity; if (p >= 1) return Infinity;
    const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
      1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
    const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
      6.680131188771972e+01, -1.328068155288572e+01];
    const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
      -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
    const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
    const pl = 0.02425;
    let q, r;
    if (p < pl) { q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
    if (p > 1 - pl) { q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
    q = p - 0.5; r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  /** t 分布 CDF */
  function tCdf(t, df) {
    const x = df / (df + t * t);
    const p = 0.5 * ibeta(x, df / 2, 0.5);
    return t > 0 ? 1 - p : p;
  }
  function tSf(t, df) { return 1 - tCdf(t, df); }
  /** 卡方 CDF（df 任意） */
  function chi2Sf(x, df) {
    if (x <= 0) return 1;
    return 1 - gammap(df / 2, x / 2);
  }
  function gammap(a, x) {
    if (x < 0 || a <= 0) return 0;
    if (x < a + 1) { // 级数
      let ap = a, sum = 1 / a, del = sum;
      for (let n = 1; n < 500; n++) {
        ap++; del *= x / ap; sum += del;
        if (Math.abs(del) < Math.abs(sum) * 1e-14) break;
      }
      return sum * Math.exp(-x + a * Math.log(x) - logGamma(a));
    }
    // 连分式
    const FPMIN = 1e-300; let b = x + 1 - a, c = 1 / FPMIN, d = 1 / b, h = d;
    for (let i = 1; i < 500; i++) {
      const an = -i * (i - a);
      b += 2; d = an * d + b; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = b + an / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d; const del = d * c; h *= del;
      if (Math.abs(del - 1) < 1e-14) break;
    }
    return 1 - Math.exp(-x + a * Math.log(x) - logGamma(a)) * h;
  }

  /* --- 基础描述 --- */
  const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
  function variance(a, ddof = 1) {
    const m = mean(a); if (a.length <= ddof) return 0;
    return a.reduce((s, v) => s + (v - m) * (v - m), 0) / (a.length - ddof);
  }
  const sd = a => Math.sqrt(variance(a));
  function quantile(a, q) {
    if (!a.length) return NaN;
    const s = Array.from(a).sort((x, y) => x - y);
    const pos = (s.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (pos - lo);
  }
  const median = a => quantile(a, 0.5);
  function geomean(a) {
    const f = a.filter(v => v > 0);
    return f.length ? Math.exp(mean(f.map(Math.log))) : NaN;
  }
  function skewness(a) {
    const n = a.length, m = mean(a), s = sd(a);
    if (!s) return 0;
    return (n / ((n - 1) * (n - 2))) * a.reduce((acc, v) => acc + Math.pow((v - m) / s, 3), 0);
  }
  function kurtosis(a) {
    const n = a.length, m = mean(a), s = sd(a);
    if (!s) return 0;
    return a.reduce((acc, v) => acc + Math.pow((v - m) / s, 4), 0) / n - 3;
  }

  /* --- 均值差 Welch t 检验（对原始值或对数变换后的值均可） --- */
  function welchT(x, y) {
    const n1 = x.length, n2 = y.length;
    if (n1 < 2 || n2 < 2) return null;
    const m1 = mean(x), m2 = mean(y), v1 = variance(x), v2 = variance(y);
    const se = Math.sqrt(v1 / n1 + v2 / n2);
    if (se === 0) return null;
    const diff = m1 - m2;
    const t = diff / se;
    const df = Math.pow(v1 / n1 + v2 / n2, 2) /
      (Math.pow(v1 / n1, 2) / (n1 - 1) + Math.pow(v2 / n2, 2) / (n2 - 1));
    const p = 2 * tSf(Math.abs(t), df);
    const zc = normInv(0.975);
    return {
      diff, se, t, df, p,
      meanA: m1, meanB: m2, nA: n1, nB: n2,
      sdA: Math.sqrt(v1), sdB: Math.sqrt(v2),
      ci: [diff - zc * se, diff + zc * se],
      ciT: [diff - tcrit(df) * se, diff + tcrit(df) * se],
    };
  }
  function tcrit(df) {
    // 双侧 95% 临界值（Newton 迭代）
    let lo = 0, hi = 10;
    for (let i = 0; i < 80; i++) {
      const mid = (lo + hi) / 2;
      if (2 * tSf(mid, df) > 0.05) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  /* --- 比例差 z 检验 --- */
  function propZ(s1, n1, s2, n2) {
    if (!n1 || !n2) return null;
    const p1 = s1 / n1, p2 = s2 / n2;
    const p = (s1 + s2) / (n1 + n2);
    const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
    const seUn = Math.sqrt(p1 * (1 - p1) / n1 + p2 * (1 - p2) / n2);
    if (!isFinite(se) || !isFinite(seUn)) return null;
    if (se === 0 && seUn === 0) {
      return {
        pA: p1, pB: p2, diff: p1 - p2, se: 0, z: 0, p: 1, degenerate: true,
        ci: [0, 0], nA: n1, nB: n2, sA: s1, sB: s2,
      };
    }
    const z = (p1 - p2) / (se || 1e-12);
    const pval = 2 * (1 - normCdf(Math.abs(z)));
    const zc = normInv(0.975);
    return {
      pA: p1, pB: p2, diff: p1 - p2, se: seUn, z, p: pval,
      ci: [p1 - p2 - zc * seUn, p1 - p2 + zc * seUn],
      nA: n1, nB: n2, sA: s1, sB: s2,
    };
  }

  /* --- SRM 检验（样本比例失配） --- */
  function srm(nA, nB, expectedRatio = 0.5) {
    const N = nA + nB;
    if (!N) return null;
    const eA = N * expectedRatio, eB = N * (1 - expectedRatio);
    const chi2 = Math.pow(nA - eA, 2) / eA + Math.pow(nB - eB, 2) / eB;
    const p = chi2Sf(chi2, 1);
    const z = Math.sqrt(chi2);
    const zc = normInv(0.975);
    const se = Math.sqrt(expectedRatio * (1 - expectedRatio) / N);
    const lift = nA / eA - 1;
    // 两级判定：p<0.001 或 |偏离|>2% → 硬失败；p<0.01 → 告警
    const level = (p < 0.001 || Math.abs(lift) > 0.02) ? "fail" : (p < 0.01 ? "warn" : "ok");
    return {
      nA, nB, N, ratio: nA / N, expected: expectedRatio, chi2, p, z, lift, level,
      lo: (expectedRatio - zc * se) * N, hi: (expectedRatio + zc * se) * N,
      pass: level === "ok",
    };
  }

  /* --- 快速选择（求分位数用，避免整体排序） --- */
  function nthSelect(a, k) {
    let lo = 0, hi = a.length - 1;
    while (lo < hi) {
      const pivot = a[(lo + hi) >> 1];
      let i = lo, j = hi;
      while (i <= j) {
        while (a[i] < pivot) i++;
        while (a[j] > pivot) j--;
        if (i <= j) { const t = a[i]; a[i] = a[j]; a[j] = t; i++; j--; }
      }
      if (k <= j) hi = j; else if (k >= i) lo = i; else break;
    }
    return a[k];
  }
  function typedMedian(a) {
    const n = a.length;
    if (!n) return NaN;
    if (n % 2) return nthSelect(a, (n - 1) >> 1);
    const lo = nthSelect(a, (n >> 1) - 1);
    // 复制后半段以避免 nthSelect 破坏 lo 的定位（此处直接再取一次）
    const hi = nthSelect(a, n >> 1);
    return (lo + hi) / 2;
  }

  /* --- Bootstrap：统计量的经验分布（Float64Array + 快速选择） --- */
  function bootstrap(x, y, statFn, B = 600, seed = 12345) {
    const rng = new RNG(seed);
    const X = Float64Array.from(x), Y = Float64Array.from(y);
    const n1 = X.length, n2 = Y.length;
    const bx = new Float64Array(n1), by = new Float64Array(n2);
    const out = new Float64Array(B);
    for (let b = 0; b < B; b++) {
      for (let i = 0; i < n1; i++) bx[i] = X[(rng.u() * n1) | 0];
      for (let i = 0; i < n2; i++) by[i] = Y[(rng.u() * n2) | 0];
      out[b] = statFn(bx, by);
    }
    const arr = Array.from(out).sort((p, q) => p - q);
    return {
      mean: mean(arr),
      ci: [quantile(arr, 0.025), quantile(arr, 0.975)],
      dist: arr,
    };
  }
  /** 中位数差的 Bootstrap（快速选择版，O(B·n)） */
  function bootMedianDiff(x, y, B = 600, seed = 12345) {
    const rng = new RNG(seed);
    const X = Float64Array.from(x), Y = Float64Array.from(y);
    const n1 = X.length, n2 = Y.length;
    const bx = new Float64Array(n1), by = new Float64Array(n2);
    const out = new Float64Array(B);
    for (let b = 0; b < B; b++) {
      for (let i = 0; i < n1; i++) bx[i] = X[(rng.u() * n1) | 0];
      for (let i = 0; i < n2; i++) by[i] = Y[(rng.u() * n2) | 0];
      out[b] = typedMedian(by) - typedMedian(bx);
    }
    const arr = Array.from(out).sort((p, q) => p - q);
    return { ci: [quantile(arr, 0.025), quantile(arr, 0.975)], dist: arr };
  }

  /* --- CUPED 方差缩减 --- */
  function cuped(yA, xA, yB, xB) {
    const n = yA.length + yB.length;
    const xAll = new Float64Array(n), yAll = new Float64Array(n);
    let i = 0;
    for (let k = 0; k < yA.length; k++) { yAll[i] = yA[k]; xAll[i] = xA[k]; i++; }
    for (let k = 0; k < yB.length; k++) { yAll[i] = yB[k]; xAll[i] = xB[k]; i++; }
    const mx = mean(xAll), my = mean(yAll);
    let sxy = 0, sxx = 0;
    for (let k = 0; k < n; k++) { sxy += (xAll[k] - mx) * (yAll[k] - my); sxx += (xAll[k] - mx) ** 2; }
    const theta = sxx === 0 ? 0 : sxy / sxx;
    const yAdjA = yA.map((v, k) => v - theta * (xA[k] - mx));
    const yAdjB = yB.map((v, k) => v - theta * (xB[k] - mx));
    const vRaw = (variance(yA) * (yA.length - 1) + variance(yB) * (yB.length - 1)) / (n - 2);
    const vAdj = (variance(yAdjA) * (yAdjA.length - 1) + variance(yAdjB) * (yAdjB.length - 1)) / (n - 2);
    // 相关系数
    let sx = Math.sqrt(sxx / (n - 1)), sy = 0;
    for (let k = 0; k < n; k++) sy += (yAll[k] - my) ** 2;
    sy = Math.sqrt(sy / (n - 1));
    const rho = (sx && sy) ? (sxy / (n - 1)) / (sx * sy) : 0;
    return {
      theta, rho,
      reduction: vRaw > 0 ? 1 - vAdj / vRaw : 0,
      test: welchT(yAdjA, yAdjB),
      testRaw: welchT(yA, yB),
    };
  }

  /* --- 序贯检验边界 ---
     Lan-DeMets O'Brien-Fleming 型 α 消耗函数 + Armitage–McPherson 递归精确求解临界值。
     各次检验的 Z 统计量已标准化（Z_k ~ N(0,1)），相邻相关性 corr(Z_j,Z_k)=√(t_j/t_k)，
     因此递推核为 N(ρu, 1−ρ²)，ρ = √(t_{k−1}/t_k)。 */
  const _seqCache = new Map();
  function obfBoundary(K, alphaTwoSided = 0.05) {
    const key = K + "|" + alphaTwoSided;
    if (_seqCache.has(key)) return _seqCache.get(key);
    const zA = normInv(1 - alphaTwoSided / 2);
    const spend = t => (t >= 1 ? alphaTwoSided : 2 * (1 - normCdf(zA / Math.sqrt(t))));

    const HI = 8;                          // 网格半宽：临界值最大约 2，边界外密度可忽略
    const M = K <= 12 ? 1201 : K <= 28 ? 801 : 601;
    const h = (2 * HI) / (M - 1);
    const gr = new Float64Array(M);
    for (let i = 0; i < M; i++) gr[i] = -HI + i * h;
    const w = new Float64Array(M);
    for (let i = 0; i < M; i++) w[i] = (i === 0 || i === M - 1) ? h / 2 : h;
    const C = 0.3989422804014327;
    const phi = z => Math.exp(-0.5 * z * z) * C;

    const c = new Float64Array(K);
    let f = new Float64Array(M);
    for (let i = 0; i < M; i++) f[i] = phi(gr[i]);         // Z_1 ~ N(0,1)

    // 第 1 次检验：P(|Z_1| ≥ c_1) = spend(1/K)，闭式解
    c[0] = zA * Math.sqrt(K);
    for (let i = 0; i < M; i++) if (Math.abs(gr[i]) >= c[0]) f[i] = 0;

    for (let k = 2; k <= K; k++) {
      const t = k / K, tPrev = (k - 1) / K;
      const rho = Math.sqrt(tPrev / t);
      const s = Math.sqrt(1 - rho * rho);
      const nf = new Float64Array(M);
      for (let i = 0; i < M; i++) {
        const gi = gr[i];
        let acc = 0;
        for (let j = 0; j < M; j++) {
          const fj = f[j];
          if (fj === 0) continue;
          const d = (gi - rho * gr[j]) / s;
          if (d * d > 70) continue;
          acc += w[j] * fj * phi(d);
        }
        nf[i] = acc / s;
      }
      f = nf;

      let mass = 0;
      for (let i = 0; i < M; i++) mass += w[i] * f[i];
      const targetMass = 1 - spend(t);

      if (targetMass >= mass) {
        // 网格内的越界质量已可忽略 → OBF 闭式解在此处严格成立
        c[k - 1] = zA / Math.sqrt(t);
      } else {
        let lo = 0, hi = HI;
        for (let it = 0; it < 60; it++) {
          const mid = (lo + hi) / 2;
          let m = 0;
          for (let i = 0; i < M; i++) if (Math.abs(gr[i]) < mid) m += w[i] * f[i];
          if (m > targetMass) hi = mid; else lo = mid;
        }
        let ck = (lo + hi) / 2;
        // 触到网格上沿说明真值在网格外，此时无截断发生，用闭式解
        if (!isFinite(ck) || ck <= 0 || ck >= HI - 0.02) ck = zA / Math.sqrt(t);
        c[k - 1] = ck;
        for (let i = 0; i < M; i++) if (Math.abs(gr[i]) >= c[k - 1]) f[i] = 0;
      }
    }
    const out = Array.from(c);
    _seqCache.set(key, out);
    return out;
  }

  /* --- 功效与样本量（连续型，Δ 为标准化效应） --- */
  function sampleSizeContinuous(effectSize, alpha = 0.05, power = 0.8, ratio = 1) {
    const zA = normInv(1 - alpha / 2), zB = normInv(power);
    const n1 = Math.pow(zA + zB, 2) * (1 + 1 / ratio) / (effectSize * effectSize);
    return Math.ceil(n1);
  }
  function sampleSizeProportion(p1, p2, alpha = 0.05, power = 0.8) {
    const zA = normInv(1 - alpha / 2), zB = normInv(power);
    const pbar = (p1 + p2) / 2;
    const n = Math.pow(zA * Math.sqrt(2 * pbar * (1 - pbar)) + zB * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2)), 2) / Math.pow(p2 - p1, 2);
    return Math.ceil(n);
  }
  function powerContinuous(effectSize, n1, alpha = 0.05, ratio = 1) {
    const zA = normInv(1 - alpha / 2);
    const n2 = n1 * ratio;
    const se = Math.sqrt(1 / n1 + 1 / n2);
    return 1 - normCdf(zA - Math.abs(effectSize) / se) + normCdf(-zA - Math.abs(effectSize) / se);
  }
  /** 达到给定 MDE（相对提升）所需天数。logSd 为对数尺度标准差 */
  function planDays(relMde, logSd, dailyN, alpha = 0.05, power = 0.8) {
    const esLog = Math.abs(Math.log(1 - relMde)) / Math.max(logSd, 1e-6);
    const perArm = sampleSizeContinuous(esLog, alpha, power, 1);
    const totalPR = perArm * 2;
    return { perArm, totalPR, days: totalPR / dailyN, effectSize: esLog };
  }

  /* --- BH 多重比较 --- */
  function benjaminiHochberg(pvals, alpha = 0.05) {
    const idx = pvals.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p);
    const m = pvals.length;
    const rejected = new Array(m).fill(false);
    let kmax = -1;
    idx.forEach((o, r) => { if (o.p <= ((r + 1) / m) * alpha) kmax = r; });
    const adj = new Array(m).fill(1);
    let prev = 1;
    for (let r = m - 1; r >= 0; r--) {
      const v = Math.min(prev, idx[r].p * m / (r + 1));
      adj[idx[r].i] = v; prev = v;
    }
    if (kmax >= 0) for (let r = 0; r <= kmax; r++) rejected[idx[r].i] = true;
    return { adj, rejected };
  }

  return {
    mean, variance, sd, quantile, median, geomean, skewness, kurtosis,
    welchT, propZ, srm, bootstrap, bootMedianDiff, cuped, obfBoundary,
    sampleSizeContinuous, sampleSizeProportion, powerContinuous, planDays,
    benjaminiHochberg, normCdf, normInv, chi2Sf, tSf, tCdf, tcrit,
  };
})();

/* ---------------- 3. 采购流程仿真 ---------------- */
const ProcSim = (() => {

  /* 品类与风险映射 —— 用于生成 PR 属性 */
  const CATEGORIES = [
    { name: "间接物料 MRO", share: 0.22, riskWeights: { 低: 1.0, 中: 0, 高: 0 }, amountMult: 0.72 },
    { name: "IT 与办公", share: 0.15, riskWeights: { 低: 0.80, 中: 0.20, 高: 0 }, amountMult: 0.85 },
    { name: "生产原料", share: 0.24, riskWeights: { 低: 0, 中: 0.70, 高: 0.30 }, amountMult: 1.55 },
    { name: "包装与耗材", share: 0.16, riskWeights: { 低: 0.85, 中: 0.15, 高: 0 }, amountMult: 0.62 },
    { name: "物流服务", share: 0.13, riskWeights: { 低: 0, 中: 0.75, 高: 0.25 }, amountMult: 1.10 },
    { name: "专业服务", share: 0.10, riskWeights: { 低: 0, 中: 0.40, 高: 0.60 }, amountMult: 1.30 },
  ];
  const RISKS = ["低", "中", "高"];

  const DEFAULTS = {
    seed: 20260921,
    dailyVolume: 380,        // 日均 PR 数
    days: 28,
    // —— 策略参数 ——
    amountThreshold: 50000,  // 自动放行金额阈值（元）
    autoDelayHours: 1.0,     // 自动放行系统校验+出单耗时（小时）
    autoPassRate: 0.93,      // 合规校验一次通过率
    spotCheckRate: 0.10,     // 事后抽检比例（Treatment）
    // —— 流程基线参数 ——
    medianAmount: 18000,     // PR 金额中位数（元）——仅在没有真实分带数据时作为回退
    sigmaLogAmount: 1.35,    // 回退用的对数标准差
    amountBands: null,       // 真实金额经验分布（分带计数），由 data.js 注入
    amountScale: 1,          // 尺度平移因子（真实中位数 → 企业采购中位数）
    amountCutoff: 0.99,      // 抽样截断分位（剔除项目级/多年期合同的极端尾部）
    l1Med: 5.5, l1Sig: 0.90, // 主管审批
    l2Med: 14.0, l2Sig: 0.85,// 采购经理审批
    reworkMed: 12.0, reworkSig: 0.80, // 驳回返工
    postMed: 14.0, postSig: 0.60,     // 询价定点 + PO 签发
    rejectL1: 0.07, rejectL2: 0.11,
    maxRework: 2,
    backlogRate: 0.10, backlogMult: 3.2, // 积压概率与放大倍数
    // —— 护栏参数 ——
    auditBase: 0.012,        // 基线审计异常率
    auditAutoLift: 0.0245,   // 自动放行带来的异常率上升（绝对）：免掉前置审核后，
                             // 拆单/超预算/指定供应商这类问题失去第一道拦截，流出率上升约 2.4 倍
    spotCheckRecover: 0.62,  // 抽检一旦抽中，能识别的比例
    priceVarBase: 0.002,     // 基线价格中位偏差
    priceVarAutoLift: 0.036, // 自动放行带来的价格偏差上升
    priceVarSigma: 0.055,    // 价格偏差个体噪声
    maverickBase: 0.045,     // 基线紧急/围标采购比例
    maverickLift: 0.010,
    // —— 随机化 ——
    srmBias: 0,              // 实验组分配比例偏移（注入故障用）
    // —— CUPED ——
    cupedRho: 0.75,          // 协变量与结果的相关性（历史基线对本次周期的预测力）
    // —— 层 ——
    layerSd: 0.17,           // 层间随机效应（对数尺度）
  };

  /** 金额档 */
  function amountBand(a) {
    if (a <= 50000) return "低值(<5万)";
    if (a <= 500000) return "中值(5-50万)";
    return "高值(>50万)";
  }

  /**
   * 金额抽样器：直接从"真实数据的经验分布"抽样（不做任何参数化拟合）。
   * 传入的分带计数以对数等宽带给出，带内按对数均匀插值；
   * scale 是一次显式的尺度平移（联邦合同中位数 → 企业采购中位数），cutoff 截断极端尾部。
   */
  function buildAmountSampler(spec) {
    const b = (spec.bands || []).filter(x => x.count > 0);
    if (!b.length) return null;
    const total = b.reduce((s, x) => s + x.count, 0);
    const n = b.length;
    const cum = new Float64Array(n);
    const lo = new Float64Array(n), hi = new Float64Array(n);
    let acc = 0;
    for (let i = 0; i < n; i++) {
      acc += b[i].count; cum[i] = acc / total;
      lo[i] = Math.log(b[i].lo); hi[i] = Math.log(b[i].hi);
    }
    const cutoff = spec.cutoff || 1, scale = spec.scale || 1;
    return function (rng) {
      const u = rng.u() * cutoff;
      let a = 0, c = n - 1;
      while (a < c) { const m = (a + c) >> 1; if (cum[m] < u) a = m + 1; else c = m; }
      const prev = a === 0 ? 0 : cum[a - 1];
      const w = cum[a] - prev;
      const f = w > 0 ? (u - prev) / w : 0.5;
      return Math.exp(lo[a] + f * (hi[a] - lo[a])) * scale;
    };
  }

  /**
   * 生成 PR 面板 + 双组潜在结果（potential outcomes）
   * 采用共同随机数（CRN）：除被策略改变的部分外，两组共享同一套随机源，
   * 使组间差异只来自干预本身，降低方差。
   */
  function generatePanel(params) {
    const P = Object.assign({}, DEFAULTS, params || {});
    const rng = new RNG(P.seed);
    const rows = [];
    const catNames = CATEGORIES.map(c => c.name);
    const catShares = CATEGORIES.map(c => c.share);
    const sampleAmount = P.amountBands && P.amountBands.length
      ? buildAmountSampler({ bands: P.amountBands, cutoff: P.amountCutoff || 0.99, scale: P.amountScale || 1 })
      : null;

    // 层效应（品类 × 金额档）
    // 关键：这一项代表"某些品类/金额档天然处理得更慢"这一过程属性，
    // 是对总体水平的整体平移。若每次模拟都重新抽，基线就会随随机种子漂移 ±12%，
    // 让沙盒看起来不可复现。因此用固定种子生成一张**均值归零**的层效应表，
    // 只保留层间差异，不引入整体漂移。
    const layerEffect = {};
    const cells = [];
    for (const c of catNames) for (const b of ["低值(<5万)", "中值(5-50万)", "高值(>50万)"]) cells.push(c + "|" + b);
    const lrng = new RNG(90210);
    const raw = cells.map(() => lrng.norm() * P.layerSd);
    const rawMean = raw.reduce((a, b) => a + b, 0) / raw.length;
    cells.forEach((cell, i) => { layerEffect[cell] = raw[i] - rawMean; });

    let id = 0;
    for (let d = 0; d < P.days; d++) {
      // 到达量：日度波动 + 周末低谷
      const dow = (d + 1) % 7;
      const weekend = (dow === 6 || dow === 0) ? 0.18 : 1.0;   // 周末提交量极低
      const seasonal = 1 + 0.13 * Math.sin(d / P.days * Math.PI * 2);
      const n = Math.max(4, Math.round(P.dailyVolume * weekend * seasonal * (0.88 + rng.u() * 0.24)));
      for (let k = 0; k < n; k++) {
        id++;
        const cat = rng.weighted(CATEGORIES, catShares);
        const risk = rng.weighted(RISKS, [cat.riskWeights.低, cat.riskWeights.中, cat.riskWeights.高]);
        const amount = sampleAmount
          ? Math.max(300, sampleAmount(rng) * cat.amountMult)
          : Math.max(300, rng.logNormal(P.medianAmount * cat.amountMult, P.sigmaLogAmount));
        const cell = cat.name + "|" + amountBand(amount);
        const lEff = layerEffect[cell] || 0;

        /* —— 流程时长：控制组 —— */
        const bl = rng.bool(P.backlogRate) ? P.backlogMult : 1;
        let t1 = rng.logNormal(P.l1Med, P.l1Sig) * bl;
        const r1 = rng.bool(P.rejectL1);
        let rework = 0, reworkCount = 0;
        if (r1) { reworkCount++; rework += rng.logNormal(P.reworkMed, P.reworkSig); t1 *= 0.6; }
        const r2 = rng.bool(P.rejectL2);
        if (r2) { reworkCount++; rework += rng.logNormal(P.reworkMed, P.reworkSig); }
        const t2 = rng.logNormal(P.l2Med, P.l2Sig) * bl * (risk === "高" ? 1.45 : risk === "中" ? 1.12 : 1.0);
        const t3 = rng.logNormal(P.postMed, P.postSig) * (risk === "高" ? 1.18 : 1.0);

        const yC = Math.max(0.2, (t1 + t2 + rework + t3) * Math.exp(lEff));

        /* —— 流程时长：实验组 —— */
        // 目标 = 低值 且 低风险；是否走自动放行由合规校验通过率决定
        const targeted = (amount <= P.amountThreshold) && (risk === "低");
        const autoPassed = targeted ? rng.bool(P.autoPassRate) : false;
        let yT, path;
        if (autoPassed) {
          path = "auto";
          const tAuto = P.autoDelayHours * (0.6 + rng.u() * 0.9);
          // 自动放行只跳过审批环节，后置的询价/定点/PO 签发照常发生
          yT = Math.max(0.15, (tAuto + t3) * Math.exp(lEff));
        } else if (targeted) {
          path = "manual_fallback";
          yT = yC + P.autoDelayHours;               // 先系统校验、再落人工
        } else {
          path = "manual";
          yT = yC;
        }

        /* —— 护栏：价格偏差（相对品类基准价的偏离，正=买贵） —— */
        const priceVarC = P.priceVarBase + rng.norm() * P.priceVarSigma;
        const priceVarT = autoPassed
          ? P.priceVarBase + P.priceVarAutoLift + rng.norm() * P.priceVarSigma
          : priceVarC;

        /* —— 护栏：事后审计异常 —— */
        const auditC = rng.bool(P.auditBase) ? 1 : 0;
        let auditT;
        if (autoPassed) {
          const raw = rng.bool(P.auditBase + P.auditAutoLift) ? 1 : 0;
          // 抽检：被抽中且存在异常 → 拦回（记为已拦截，不计入"流出异常"）
          const caught = raw && rng.bool(P.spotCheckRate) && rng.bool(P.spotCheckRecover);
          auditT = caught ? 0 : raw;
        } else {
          auditT = auditC;
        }
        const spotChecked = autoPassed ? rng.bool(P.spotCheckRate) : false;

        /* —— 护栏：紧急/围标采购 —— */
        const mavC = rng.bool(P.maverickBase) ? 1 : 0;
        const mavT = autoPassed ? (rng.bool(P.maverickBase + P.maverickLift) ? 1 : 0) : mavC;

        /* —— CUPED 协变量：该层历史平均审批时长（标准化后加噪，保证目标相关性） —— */
        const cupedX = 0;   // 占位，循环结束后统一构造

        /* —— 随机分配（可注入分配偏差） —— */
        const pTreat = 0.5 + P.srmBias;
        const arm = (rng.u() < pTreat) ? "B" : "A";
        const assignedArm = P.srmBiasFix ? 0.5 : pTreat; // 预留

        rows.push({
          id, day: d + 1, arm,
          category: cat.name, risk, amount, band: amountBand(amount), cell,
          targeted, autoPassed, path,
          yC, yT, reworkCount, layerEffect: lEff, cupedX,
          y: arm === "A" ? yC : yT,
          priceVar: arm === "A" ? priceVarC : priceVarT,
          audit: arm === "A" ? auditC : auditT,
          spotChecked: arm === "A" ? 0 : (spotChecked ? 1 : 0),
          maverick: arm === "A" ? mavC : mavT,
          // 便于事后按任意阈值重算
          autoEligible: risk === "低" && autoPassed,
        });
      }
    }

    /* —— CUPED 协变量：把「同层历史平均审批时长」构造成控制组结果的相关变量 ——
       X = ρ · z(log yC) + √(1−ρ²)·ε ，使得 corr(X, log yC) ≈ ρ。
       协变量只依赖控制组的潜在结果（历史基线），不含任何策略信息，避免信息泄露。 */
    const logs = rows.map(r => Math.log(r.yC));
    const mLog = logs.reduce((a, b) => a + b, 0) / logs.length;
    const sdLog = Math.sqrt(logs.reduce((s, v) => s + (v - mLog) ** 2, 0) / (logs.length - 1)) || 1;
    const rho = Math.min(Math.max(P.cupedRho, 0), 0.95);
    const k = Math.sqrt(Math.max(0, 1 - rho * rho));
    rows.forEach((r, i) => {
      r.cupedX = rho * ((logs[i] - mLog) / sdLog) + k * rng.norm();
    });

    return { rows, params: P, layerEffect };
  }

  /* 派生指标 */
  const M = {
    cycle: r => r.y,
    cycleLog: r => Math.log(r.y),
    onTime48: r => (r.y <= 48 ? 1 : 0),
    onTime72: r => (r.y <= 72 ? 1 : 0),
    priceVar: r => r.priceVar,
    audit: r => r.audit,
    maverick: r => r.maverick,
  };

  /** 汇总一个子集 */
  function summarize(rows) {
    const y = rows.map(r => r.y);
    const n = rows.length;
    return {
      n,
      mean: Stats.mean(y),
      median: Stats.median(y),
      p90: Stats.quantile(y, 0.9),
      p95: Stats.quantile(y, 0.95),
      sd: Stats.sd(y),
      geomean: Stats.geomean(y),
      onTime48: n ? Stats.mean(y.map(v => v <= 48 ? 1 : 0)) : 0,
      onTime72: n ? Stats.mean(y.map(v => v <= 72 ? 1 : 0)) : 0,
      priceVar: n ? Stats.mean(rows.map(r => r.priceVar)) : 0,
      auditRate: n ? Stats.mean(rows.map(r => r.audit)) : 0,
      maverickRate: n ? Stats.mean(rows.map(r => r.maverick)) : 0,
      spotRate: n ? Stats.mean(rows.map(r => r.spotChecked)) : 0,
    };
  }

  /** 二值指标的比例差检验 */
  function propTest(A, B, fn) {
    const sa = A.reduce((s, r) => s + fn(r), 0);
    const sb = B.reduce((s, r) => s + fn(r), 0);
    return Stats.propZ(sb, B.length, sa, A.length);
  }

  /**
   * 主分析：对给定数据切分（截至第 uptoDay 天）做完整推断
   */
  function analyze(rows, uptoDay, opts = {}) {
    const alpha = opts.alpha || 0.05;
    const useCuped = opts.cuped !== false;
    const useBoot = opts.bootstrap !== false;
    const data = uptoDay ? rows.filter(r => r.day <= uptoDay) : rows;
    const A = data.filter(r => r.arm === "A");
    const B = data.filter(r => r.arm === "B");

    const yA = A.map(M.cycle), yB = B.map(M.cycle);
    const lA = A.map(M.cycleLog), lB = B.map(M.cycleLog);

    const srmRes = Stats.srm(A.length, B.length, 0.5);
    // 主指标：对数尺度 Welch t（几何均值比）
    const logTest = Stats.welchT(lB, lA);          // 注意顺序：B - A
    const rawTest = Stats.welchT(yB, yA);
    const geoA = Stats.geomean(yA), geoB = Stats.geomean(yB);
    const medA = Stats.median(yA), medB = Stats.median(yB);

    // 中位数差的 Bootstrap CI（动画过程中可关闭以保证流畅）
    let medianCi = [NaN, NaN], bootDist = null;
    if (useBoot) {
      const bm = Stats.bootMedianDiff(yA, yB, opts.bootB || 600, 987654);
      medianCi = bm.ci; bootDist = bm.dist;
    } else {
      const se = logTest ? logTest.se : 1;
      medianCi = [medB - medA - 1.96 * se * medA, medB - medA + 1.96 * se * medA];
    }

    // 转化型次指标
    const otA = A.reduce((s, r) => s + M.onTime48(r), 0);
    const otB = B.reduce((s, r) => s + M.onTime48(r), 0);
    const onTimeTest = Stats.propZ(otB, B.length, otA, A.length);

    // CUPED
    let cupedRes = null;
    if (useCuped) {
      cupedRes = Stats.cuped(
        lB, B.map(r => r.cupedX),
        lA, A.map(r => r.cupedX)
      );
    }

    const summaryA = summarize(A), summaryB = summarize(B);

    /* ---- 护栏与次指标检验 ---- */
    const pvA = A.map(M.priceVar), pvB = B.map(M.priceVar);
    const guards = [
      {
        key: "audit", name: "事后审计异常率", dir: 1, limit: 0.010,
        unit: "pp", desc: "拆单规避、超预算、指定单一供应商的流出比例",
        a: summaryA.auditRate, b: summaryB.auditRate,
        test: propTest(A, B, M.audit),
      },
      {
        key: "price", name: "采购价格偏差", dir: 1, limit: 0.015,
        unit: "pp", desc: "成交价相对品类基准价的偏离（连续变量，用 Welch t）",
        a: summaryA.priceVar, b: summaryB.priceVar,
        test: Stats.welchT(pvB, pvA),
      },
      {
        key: "maverick", name: "紧急/围标采购占比", dir: 1, limit: 0.010,
        unit: "pp", desc: "绕开正常流程的采购",
        a: summaryA.maverickRate, b: summaryB.maverickRate,
        test: propTest(A, B, M.maverick),
      },
      {
        key: "onTime", name: "48h 完成率（次指标）", dir: -1, limit: -0.05,
        unit: "pp", desc: "越快越好，不得下降",
        a: summaryA.onTime48, b: summaryB.onTime48,
        test: propTest(A, B, M.onTime48),
      },
    ];
    guards.forEach(g => {
      const ci = g.test ? g.test.ci : null;
      g.delta = g.b - g.a;
      g.worsenSignificant = !!(g.test && g.test.p < 0.05 &&
        ((g.dir > 0 && ci && ci[0] > 0) || (g.dir < 0 && ci && ci[1] < 0)));
      g.beyond = g.dir > 0 ? (g.delta > g.limit) : (g.delta < g.limit);
      g.verdict = g.beyond ? (g.worsenSignificant ? "恶化" : "越界")
        : (g.worsenSignificant && g.dir > 0 ? "通过·需监控" : "通过");
    });

    return {
      uptoDay: uptoDay || null,
      nA: A.length, nB: B.length, n: data.length,
      srm: srmRes,
      guards,
      primary: {
        geoA, geoB,
        ratio: geoA > 0 ? geoB / geoA : NaN,
        logTest, rawTest,
        medA, medB,
        medianDiff: medB - medA,
        medianCi,
        bootDist,
        ciGeo: [Math.exp(logTest.ci[0]), Math.exp(logTest.ci[1])],
      },
      secondary: {
        onTime: onTimeTest,
        onTimeA: summaryA.onTime48, onTimeB: summaryB.onTime48,
        onTimeA30: Stats.quantile(yA, 0.3), onTimeB30: Stats.quantile(yB, 0.3),
      },
      cuped: cupedRes,
      summaryA, summaryB,
      raw: { yA, yB, A, B },
    };
  }

  /** 逐日累积效应曲线（用于序贯检验图） */
  function dailySeries(rows, opts = {}) {
    const K = Math.max(...rows.map(r => r.day));
    const out = [];
    for (let d = 1; d <= K; d++) {
      const s = rows.filter(r => r.day <= d);
      const a = s.filter(r => r.arm === "A").map(M.cycleLog);
      const b = s.filter(r => r.arm === "B").map(M.cycleLog);
      if (a.length < 20 || b.length < 20) { out.push({ day: d, z: 0, diff: 0, lo: 0, hi: 0, nA: a.length, nB: b.length }); continue; }
      const t = Stats.welchT(b, a);
      out.push({
        day: d, z: t ? t.t : 0, diff: t ? t.diff : 0,
        lo: t ? t.ci[0] : 0, hi: t ? t.ci[1] : 0,
        ratio: t ? Math.exp(t.diff) : 1,
        nA: a.length, nB: b.length,
        p: t ? t.p : 1,
      });
    }
    return out;
  }

  /** 异质性分析（CATE）：按预设子群 */
  function heterogeneity(rows, groups) {
    const res = [];
    for (const g of groups) {
      const sub = rows.filter(g.filter);
      const a = sub.filter(r => r.arm === "A").map(M.cycleLog);
      const b = sub.filter(r => r.arm === "B").map(M.cycleLog);
      if (a.length < 15 || b.length < 15) continue;
      const t = Stats.welchT(b, a);
      res.push({
        name: g.name, n: sub.length, nA: a.length, nB: b.length,
        effect: t.diff, ci: t.ci, p: t.p,
        ratio: Math.exp(t.diff),
        meanA: Math.exp(Stats.mean(a)), meanB: Math.exp(Stats.mean(b)),
      });
    }
    return res;
  }

  /** 双组指标体检：正态性/长尾诊断 */
  function distributionDiag(rows) {
    const l = rows.map(M.cycleLog);
    const y = rows.map(M.cycle);
    return {
      logSkew: Stats.skewness(l), logKurt: Stats.kurtosis(l),
      rawSkew: Stats.skewness(y), rawKurt: Stats.kurtosis(y),
      logSd: Stats.sd(l), rawSd: Stats.sd(y),
      rawMean: Stats.mean(y), rawMedian: Stats.median(y),
      rawP99: Stats.quantile(y, 0.99), rawMax: Math.max(...y),
    };
  }

  return { DEFAULTS, CATEGORIES, generatePanel, summarize, analyze, dailySeries, heterogeneity, distributionDiag, amountBand, M };
})();
