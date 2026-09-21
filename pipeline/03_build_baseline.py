# -*- coding: utf-8 -*-
"""
真实采集数据 → 沙盒基线画像 data.js (window.BASELINE)

关键判断：真实合同金额分布 **不是** 对数正态（单对数正态拟合 SSE 很大、P99 偏差近 8 倍）。
因此沙盒不采用拟合分布，而是直接把实测的经验分布搬进抽样器 —— 形状完全来自真实数据，
只对尺度做一个显式的、可追溯的映射（联邦合同中位数 → 中型企业采购中位数）。
"""
import json, math, collections

ROOT = "C:/Users/ynwas/WorkBuddy/2026-09-21-16-09-54/"
us = json.load(open(ROOT + "data_raw_usaspending.json", encoding="utf-8"))
cat = json.load(open(ROOT + "data_category.json", encoding="utf-8"))
wb = json.load(open(ROOT + "data_raw_wb_procnotices.json", encoding="utf-8"))

# ---------- 1. 金额分带计数 ----------
bm = {}
for b in us["bands"]:
    k = b["idx"]
    bm.setdefault(k, {"lo": b["lo"], "hi": b["hi"], "count": 0, "FY2023": 0, "FY2025": 0})
    bm[k]["count"] += (b["count"] or 0)
    bm[k][b["period"]] = b["count"] or 0
bands = [bm[k] for k in sorted(bm)]
tot = sum(b["count"] for b in bands)
base = us.get("counts_base", {})
base_tot = sum(base.values()) if base else None
print("bands=%d  带内合计=%d  全量合同=%s  覆盖率=%.1f%%"
      % (len(bands), tot, base_tot, 100 * tot / base_tot if base_tot else 0))
print("  FY2023 带内=%d (全量 %s)   FY2025 带内=%d (全量 %s)"
      % (sum(b["FY2023"] for b in bands), base.get("FY2023"),
         sum(b["FY2025"] for b in bands), base.get("FY2025")))

def emp_q(q):
    t = q * tot; acc = 0
    for b in bands:
        if acc + b["count"] >= t and b["count"] > 0:
            f = (t - acc) / b["count"]
            return math.exp(math.log(b["lo"]) + f * (math.log(b["hi"]) - math.log(b["lo"])))
        acc += b["count"]
    return bands[-1]["hi"]

q = {p: emp_q(p) for p in (0.10, 0.25, 0.50, 0.75, 0.90, 0.95, 0.99)}
print("分位数: " + "  ".join("P%d=$%s" % (int(p * 100), f"{v:,.0f}") for p, v in q.items()))

# ---------- 2. 若强行拟合对数正态：仅作为"对照"，用来说明它拟合得有多差 ----------
def ncdf(z):
    return 0.5 * (1 + math.erf(z / math.sqrt(2)))

def fit_lognormal():
    best, besterr = (math.log(q[0.50]), 1.8), None
    lo_mu, hi_mu = math.log(500), math.log(1e7)
    lo_s, hi_s = 0.3, 4.0
    for _ in range(4):
        for i in range(41):
            mu = lo_mu + (hi_mu - lo_mu) * i / 40
            for j in range(41):
                s = lo_s + (hi_s - lo_s) * j / 40
                err = 0.0
                for b in bands:
                    if b["count"] <= 0: continue
                    p = max(1e-13, ncdf((math.log(b["hi"]) - mu) / s) - ncdf((math.log(b["lo"]) - mu) / s))
                    err += (math.log(b["count"]) - math.log(p)) ** 2
                if besterr is None or err < besterr:
                    besterr, best = err, (mu, s)
        mu0, s0 = best
        dm, ds = (hi_mu - lo_mu) / 40, (hi_s - lo_s) / 40
        lo_mu, hi_mu = mu0 - dm, mu0 + dm
        lo_s, hi_s = max(0.05, s0 - ds), s0 + ds
    return best, besterr

(mu_f, s_f), sse = fit_lognormal()
# 用四分位距直接量化"是不是对数正态"
sigma_iqr = math.log(q[0.75] / q[0.25]) / (2 * 0.6744897501960817)
mu_iqr = math.log(q[0.50])
p99_pred_iqr = math.exp(mu_iqr + 2.3263478740408408 * sigma_iqr)
p99_ratio_iqr = q[0.99] / p99_pred_iqr          # 实测 P99 ÷ 对数正态预测 P99
p99_ratio_ls = math.exp(mu_f + 2.3263478740408408 * s_f) / q[0.99]

def lognormal_band_fit(mu, s):
    out = []
    for b in bands:
        if b["count"] <= 0: continue
        p = max(1e-13, ncdf((math.log(b["hi"]) - mu) / s) - ncdf((math.log(b["lo"]) - mu) / s))
        out.append([round(b["lo"]), round(b["hi"]), b["count"], round(p * tot)])
    return out

band_fit = lognormal_band_fit(mu_iqr, sigma_iqr)
print("四分位定义: mu=%.3f sigma=%.3f -> 预测P99=$%.0f，实测P99=$%.0f，**低估 %.2f 倍**"
      % (mu_iqr, sigma_iqr, p99_pred_iqr, q[0.99], p99_ratio_iqr))
print("最小二乘拟合: sigma=%.3f SSE=%.0f -> 预测P99 虚高 %.0f 倍（尾部外推失效）"
      % (s_f, sse, p99_ratio_ls))
print("分带拟合对照（实测计数 vs 对数正态预测）：")
for r in band_fit[:6] + band_fit[-4:]:
    print("  $%-10s–%-12s 实测=%-9d 预测=%-9d 比值=%.2f"
          % (f"{r[0]:,}", f"{r[1]:,}", r[2], r[3], r[3] / r[2] if r[2] else 0))

# ---------- 3. 采购品类 / 供应商 / 国家（聚合端点） ----------
recs = [(r.get("name", ""), float(r.get("amount") or 0)) for r in (cat.get("recipient") or [])]
recs = [r for r in recs if r[1] > 0]
t10 = sum(a for _, a in recs[:10]); tall = sum(a for _, a in recs)
psc = [[(r.get("name") or r.get("code") or ""), round(float(r.get("amount") or 0))] for r in (cat.get("psc") or [])]
psc = [p for p in psc if p[1] > 0]
naics = [[(r.get("name") or r.get("code") or ""), round(float(r.get("amount") or 0))] for r in (cat.get("naics") or [])]
agencies = [(r.get("name", ""), round(float(r.get("amount") or 0))) for r in (cat.get("awarding_agency") or [])]
countries = [(r.get("name", ""), round(float(r.get("amount") or 0))) for r in (cat.get("country") or [])]

wbm = collections.Counter()
for r in (wb.get("rows") or []):
    if r.get("procurement_method_name"):
        wbm[str(r["procurement_method_name"])] += 1

# ---------- 4. 组装 ----------
pct_le50k = 100 * sum(b["count"] for b in bands if b["hi"] <= 50000) / tot
TARGET_MEDIAN = 18000
SCALE = TARGET_MEDIAN / q[0.50]

BASELINE = {
    "generatedFrom": {
        "usaspending_api": us.get("source_url"),
        "usaspending_license": us.get("license"),
        "worldbank_api": wb.get("source_url"),
        "worldbank_license": wb.get("license"),
        "periods": us.get("periods"),
        "nContractsCounted": tot,
        "nContractsBase": base_tot,
        "coverage": round(tot / base_tot, 4) if base_tot else None,
        "bandRangeUSD": [bands[0]["lo"], bands[-1]["hi"]],
        "nRecipientsListed": len(recs),
        "nWB": len(wb.get("rows") or []),
        "retrievedAt": "2026-09-21",
    },
    "amountBands": [{"lo": b["lo"], "hi": b["hi"], "count": b["count"],
                     "fy23": b["FY2023"], "fy25": b["FY2025"]} for b in bands],
    "empirical": {
        "median": q[0.50], "p10": q[0.10], "p25": q[0.25], "p75": q[0.75],
        "p90": q[0.90], "p95": q[0.95], "p99": q[0.99],
        "sigmaIqr": round(sigma_iqr, 4),
        "fitLogMeanLS": round(mu_f, 4), "fitLogStdLS": round(s_f, 4),
        "fitSSE": round(sse, 1),
        "p99PredIqr": round(p99_pred_iqr),
        "p99RatioIqr": round(p99_ratio_iqr, 2),
        "p99RatioLS": round(p99_ratio_ls, 1),
        "bandFit": band_fit,
    },
    "scale": {"realMedianUSD": q[0.50], "targetMedianCNY": TARGET_MEDIAN,
              "factor": round(SCALE, 4), "cutoffQuantile": 0.99},
    "topSuppliers": [[n, round(a)] for n, a in recs[:20]],
    "top10Share": round(t10 / tall, 4) if tall else None,
    "nSuppliersListed": len(recs),
    "topPSC": psc, "topNAICS": naics, "topAgencies": agencies, "countries": countries,
    "wbMethods": wbm.most_common(8),
    "pctLe50k": round(pct_le50k, 1),
}

BASELINE["paramMap"] = [
    {"k": "PR 金额分布形状", "v": "直接用真实经验分布", "src": "实测",
     "note": "由 %s 条真实合同按 %d 个对数金额分带取计数还原。**没有拟合任何参数化分布** —— "
             "因为实测显示它并不服从对数正态（见下方拟合对照）" % (f"{tot:,}", len(bands))},
    {"k": "→ 强行拟合对数正态的代价", "v": "P99 低估 %.1f 倍" % p99_ratio_iqr, "src": "实测",
     "note": "若按四分位距反推 σ=%.2f，预测 P99=$%s，而实测 P99=$%s —— 低估 %.1f 倍。"
             "改用对数空间最小二乘拟合 σ=%.2f，尾部又虚高到 %.0f 倍。两个方向都失败，"
             "说明真实金额分布是「大量小额 + 极少数巨额」的混合体，单一对数正态拟合不了。"
             "因此沙盒直接用经验分布抽样，不引入任何参数化假设"
             % (sigma_iqr, f"{p99_pred_iqr:,.0f}", f"{q[0.99]:,.0f}", p99_ratio_iqr, s_f, p99_ratio_ls)},
    {"k": "PR 金额中位数", "v": "¥18,000", "src": "场景设定",
     "note": "真实中位数 $%s 属联邦合同量级。沙盒只做一次**显式的尺度平移**（×%.4f）：形状不变，"
             "把中位数映射到中型制造企业采购水平" % (f"{q[0.50]:,.0f}", SCALE)},
    {"k": "金额抽样截断", "v": "真实分布 P99 以内", "src": "推导",
     "note": "真实 P99 = $%s（换算后约 ¥%s）。更极端的尾部多为项目级/多年期合同，不构成单张采购申请，"
             "故在 P99 处截断，避免把联邦合同的极端尾部带进企业场景" % (f"{q[0.99]:,.0f}", f"{q[0.99]*SCALE:,.0f}")},
    {"k": "金额档切分（¥5万 / ¥50万）", "v": "低值 / 中值 / 高值", "src": "推导",
     "note": "真实数据中 %.1f%% 的合同金额在 $50,000 以下 —— 「大量小额」的结构正是低值免审批策略的适用面"
             % pct_le50k},
    {"k": "品类 = 6 类（含风险分级）", "v": "6 类", "src": "推导",
     "note": "真实 PSC 金额前三位是 %s，与制造企业采购结构差异明显。沙盒按「产品/服务 × 风险等级」重构为 6 类，"
             "目的是把「低风险」写成可规则化的判据" % "、".join(p[0][:18] for p in psc[:3])},
    {"k": "供应商集中度", "v": "前 10 家占 %.1f%%" % (t10 / tall * 100), "src": "实测",
     "note": "按合同金额降序取前 %d 家（聚合端点，非全量），前 10 家占其合计的 %.1f%%。"
             "集中度决定了「合格供应商名录」能不能成为有效闸门" % (len(recs), t10 / tall * 100)},
    {"k": "供应来源国", "v": countries[0][0] if countries else "—", "src": "实测",
     "note": "金额占比前三位：%s。地域集中度越高，单一来源风险越难被规则自动识别"
             % "、".join(c[0] for c in countries[:3])},
    {"k": "公开竞争方式构成（世行）", "v": (wbm.most_common(1)[0][0][:20] if wbm else "—"), "src": "实测",
     "note": "来自 World Bank 采购公告 %d 条" % len(wb.get("rows") or [])},
    {"k": "审批节点耗时", "v": "主管 5.5h / 经理 14h", "src": "场景设定",
     "note": "公开数据不含 PR 级审批时间戳。按重尾 + 周末低谷 + 积压放大 + 风险等级分化的结构生成；"
             "落地前必须用企业内部 OA / 采购系统日志重新标定"},
    {"k": "审计异常基线率", "v": "1.2%", "src": "场景设定",
     "note": "取自采购合规实务常见量级，非实测；真实值需以企业内审数据标定"},
    {"k": "策略覆盖率", "v": "≈37%", "src": "推导",
     "note": "= 低风险品类占比 × 金额≤阈值占比 × 规则校验通过率，决定 ITT 口径下效应被稀释多少"},
]

with open(ROOT + "procurement-ab-sandbox/data.js", "w", encoding="utf-8") as f:
    f.write("/* 自动生成 · USASpending.gov API（%s 条真实合同的分带计数 + 聚合端点）"
            " + World Bank Procurement Notices（%d 条公告） */\n"
            % (f"{tot:,}", len(wb.get("rows") or [])))
    f.write("window.BASELINE = " + json.dumps(BASELINE, ensure_ascii=False) + ";\n")

print("WROTE data.js")
print("  scale factor ×%.4f   真实中位 $%s → 沙盒中位 ¥%s" % (SCALE, f"{q[0.50]:,.0f}", f"{TARGET_MEDIAN:,}"))
print("  P99 截断: $%s → ¥%s" % (f"{q[0.99]:,.0f}", f"{q[0.99]*SCALE:,.0f}"))
print("  pctLe50k=%.1f%%   前10家占比=%.1f%%   PSC前3=%s"
      % (pct_le50k, t10 / tall * 100, "、".join(p[0][:14] for p in psc[:3])))
