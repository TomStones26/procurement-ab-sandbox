# -*- coding: utf-8 -*-
"""
USASpending 采集 v2 —— 低请求量方案
  A. 金额对数分带计数（spending_by_award_count）→ 还原完整金额密度，拟合对数正态
  B. 聚合端点（spending_by_category）→ 品类 / 机构 / 供应商构成，无需逐条明细
  C. 少量慢速明细（spending_by_award）→ 合同期限分布
"""
import json, ssl, time, urllib.request

ctx = ssl.create_default_context(); ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE
HDR = {"Content-Type": "application/json",
       "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
B = "https://api.usaspending.gov/api/v2/search/"

def post(ep, payload, timeout=70, tries=3, gap=1.0):
    body = json.dumps(payload).encode(); last = None
    for t in range(tries):
        try:
            req = urllib.request.Request(B + ep, data=body, headers=HDR, method="POST")
            with urllib.request.urlopen(req, timeout=timeout, context=ctx) as r:
                return json.loads(r.read().decode("utf-8", "ignore"))
        except Exception as e:
            last = e; time.sleep(gap + 3 * t)
    raise last

TYPES = ["A", "B", "C", "D"]
PERIODS = [("FY2025", "2024-10-01", "2025-09-30"),
           ("FY2023", "2022-10-01", "2023-09-30")]

def F(s, e, lo=None, hi=None):
    f = {"award_type_codes": TYPES,
         "time_period": [{"start_date": s, "end_date": e, "date_type": "new_awards_only"}]}
    if lo is not None:
        f["award_amounts"] = [{"lower_bound": round(lo, 2), "upper_bound": round(hi, 2)}]
    return f

LO, RATIO, NB = 1000.0, 1.5, 43
bands, x = [], LO
for _ in range(NB):
    bands.append((x, x * RATIO)); x *= RATIO

out = {"source": "USASpending.gov API v2",
       "source_url": "https://api.usaspending.gov/api/v2/search/",
       "license": "Public domain (U.S. federal government open data)",
       "method": "A) log-spaced amount-band counts  B) category aggregation  C) slow detail rows",
       "periods": [p[0] for p in PERIODS], "bands": [], "category": {},
       "rows": [], "errors": [], "counts_base": {}}

# ---------- A. 分带计数 ----------
for label, s, e in PERIODS:
    try:
        tot = post("spending_by_award_count/", {"filters": F(s, e), "subawards": False})
        out["counts_base"][label] = int(tot["results"]["contracts"])
    except Exception as ex:
        out["errors"].append({"t": "base", "p": label, "e": repr(ex)[:120]})
    for i, (lo, hi) in enumerate(bands):
        rec = {"period": label, "idx": i, "lo": round(lo, 2), "hi": round(hi, 2), "count": None}
        try:
            c = post("spending_by_award_count/", {"filters": F(s, e, lo, hi), "subawards": False})
            rec["count"] = int(c["results"]["contracts"])
        except Exception as ex:
            out["errors"].append({"t": "count", "p": label, "b": i, "e": repr(ex)[:120]})
        out["bands"].append(rec)
        print(f"[A] {label} b{i:02d} count={rec['count']}", flush=True)
        time.sleep(0.15)

# ---------- B. 聚合构成 ----------
label, s, e = PERIODS[0]
for cat in ["psc", "naics", "awarding_agency", "recipient"]:
    try:
        r = post("spending_by_category/", {"category": cat, "filters": F(s, e), "limit": 60, "page": 1},
                 tries=3, gap=2.0)
        out["category"][cat] = r.get("results", [])
        print(f"[B] {cat}: {len(out['category'][cat])}", flush=True)
    except Exception as ex:
        out["errors"].append({"t": "cat", "c": cat, "e": repr(ex)[:150]})
        print(f"[B] {cat} FAIL", flush=True)
    time.sleep(1.2)

# ---------- C. 慢速明细（合同期限 + 补充样本） ----------
FIELDS = ["Award ID", "Recipient Name", "Award Amount", "Start Date", "End Date",
          "Awarding Agency", "Contract Award Type", "NAICS", "PSC"]
pick = [0, 2, 4, 6, 8, 10, 12, 15, 18, 21, 25, 29, 33, 37, 42]
for label, s, e in PERIODS:
    for i in pick:
        lo, hi = bands[i]
        try:
            j = post("spending_by_award/",
                     {"filters": F(s, e, lo, hi), "fields": FIELDS, "page": 1, "limit": 100,
                      "sort": "Award Amount", "order": "desc", "subawards": False},
                     tries=2, gap=6.0)
            rs = j.get("results", [])
            for r in rs:
                r["_fy"] = label; r["_band"] = i
            out["rows"].extend(rs)
            print(f"[C] {label} b{i:02d} rows={len(rs)} total={len(out['rows'])}", flush=True)
        except Exception as ex:
            out["errors"].append({"t": "rows", "p": label, "b": i, "e": repr(ex)[:120]})
            print(f"[C] {label} b{i:02d} FAIL", flush=True)
        time.sleep(4.0)

with open("C:/Users/ynwas/WorkBuddy/2026-09-21-16-09-54/data_raw_usaspending.json", "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False)
print("BANDS", len(out["bands"]), "ROWS", len(out["rows"]), "ERR", len(out["errors"]), flush=True)
