# -*- coding: utf-8 -*-
"""
补采：路径式 spending_by_category 聚合端点（供应商集中度 / 品类 / 行业 / 机构）
"""
import json, ssl, time, urllib.request, os

ctx = ssl.create_default_context(); ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE
HDR = {"Content-Type": "application/json", "User-Agent": "Mozilla/5.0"}
ROOT = "C:/Users/ynwas/WorkBuddy/2026-09-21-16-09-54/"
B = "https://api.usaspending.gov/api/v2/search/spending_by_category/"
F_LATEST = {"award_type_codes": ["A", "B", "C", "D"],
            "time_period": [{"start_date": "2024-10-01", "end_date": "2025-09-30",
                             "date_type": "new_awards_only"}]}

def post(url, payload, to=70, tries=4):
    body = json.dumps(payload).encode(); last = None
    for t in range(tries):
        try:
            req = urllib.request.Request(url, data=body, headers=HDR, method="POST")
            with urllib.request.urlopen(req, timeout=to, context=ctx) as r:
                return json.loads(r.read().decode())
        except Exception as e:
            last = e; time.sleep(2 + 3 * t)
    raise last

res = {"source": "USASpending.gov API v2 /search/spending_by_category/<category>/",
       "source_url": B, "license": "Public domain (U.S. federal government open data)",
       "filters_period": "FY2025 (2024-10-01 ~ 2025-09-30), award_type_codes A,B,C,D",
       "recipient": [], "psc": [], "naics": [], "agency": [], "country": [], "errors": []}

# 供应商：多页，用于集中度曲线
for page in range(1, 6):
    try:
        r = post(B + "recipient/", {"filters": F_LATEST, "limit": 100, "page": page,
                                    "order": "desc", "sort": "amount", "subawards": False})
        got = r.get("results", [])
        res["recipient"].extend(got)
        print(f"recipient p{page}: +{len(got)} total {len(res['recipient'])}", flush=True)
        if len(got) < 100: break
    except Exception as e:
        res["errors"].append({"c": "recipient", "p": page, "e": repr(e)[:140]})
        print("recipient fail", page, flush=True)
    time.sleep(2.5)

for cat, lim in [("psc", 40), ("naics", 40), ("awarding_agency", 20), ("country", 15)]:
    try:
        r = post(B + cat + "/", {"filters": F_LATEST, "limit": lim, "page": 1,
                                 "order": "desc", "sort": "amount", "subawards": False})
        res[cat] = r.get("results", [])
        print(f"{cat}: {len(res[cat])}", flush=True)
    except Exception as e:
        res["errors"].append({"c": cat, "e": repr(e)[:140]})
        print(f"{cat} fail", flush=True)
    time.sleep(2.5)

with open(ROOT + "data_category.json", "w", encoding="utf-8") as f:
    json.dump(res, f, ensure_ascii=False)
print("DONE recipient=%d psc=%d naics=%d agency=%d err=%d" %
      (len(res["recipient"]), len(res["psc"]), len(res["naics"]), len(res["agency"]), len(res["errors"])), flush=True)
