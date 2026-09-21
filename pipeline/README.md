# Pipeline · 采购真实数据采集与基线生成

把公开的真实采购数据抓下来，加工成沙盒可直接使用的基线画像 `../procurement-ab-sandbox/data.js`。

## 执行顺序

```bash
PY="C:\Users\ynwas\.workbuddy\binaries\python\versions\3.13.12\python.exe"

# 1) 金额分带计数 + 慢速明细（约 14 分钟：86 个计数请求 + 30 个明细请求）
$PY 01_fetch_amount_bands.py

# 2) 聚合端点：供应商 / PSC / NAICS / 机构 / 国家（约 1 分钟）
$PY 02_fetch_category_aggregates.py

# 3) 汇总成 data.js
$PY 03_build_baseline.py
```

> World Bank 公告数据的抓取脚本见历史提交（写入 `data/data_raw_wb_procnotices.json`）。

## 数据源

| 端点 | 用途 |
|---|---|
| `POST /api/v2/search/spending_by_award_count/` | 按 `award_amounts` 区间取**真实计数** → 还原金额密度 |
| `POST /api/v2/search/spending_by_award/` | 取明细（合同期限等） |
| `POST /api/v2/search/spending_by_category/<cat>/` | 聚合：`recipient` / `psc` / `naics` / `awarding_agency` / `country` |

- 过滤条件：`award_type_codes = [A, B, C, D]`、`date_type = new_awards_only`
- 期间：FY2023（2022-10-01 ~ 2023-09-30）、FY2025（2024-10-01 ~ 2025-09-30）
- 分带：43 个几何带，起点 $1,000，公比 1.5（覆盖 $1,000 – $37M）

## 踩过的坑（下次别再踩）

1. **`spending_by_award` 不返回 `total`**，`page_metadata` 里只有 `hasNext`。要总数得用 `spending_by_award_count`。
2. **按 `Award Amount` 降序翻页会得到头部截断样本**（前 4000 条合同最低也有 $3,300 万）。
   必须按**金额区间分带**取，才能还原完整分布。
3. **`spending_by_category` 是路径式端点**：`/spending_by_category/recipient/`，
   把它当 body 参数写成 `/spending_by_category/` 会 404。
4. **明细接口的 `award_amounts` 边界必须是整数**，写 `5062.5` 会返回 422（计数接口却能接受）。
5. 明细接口有节流，连续请求会静默返回空数组；用 4–8 秒间隔 + 指数退避。

## 产物

```
data/data_raw_usaspending.json      86 条分带计数 + 400 条明细
data/data_category.json             500 家供应商 + 40 PSC + 40 NAICS + 机构 + 国家
data/data_raw_wb_procnotices.json   1,000 条世行采购公告
```

## 验证脚本（`tests/`）

```bash
NODE="C:\Users\ynwas\.workbuddy\binaries\node\versions\22.22.2-3\node.exe"

$NODE tests/test_e2e.js      # 端到端：基线注入 → 仿真 → 全部分析口径
$NODE tests/test_seq.js      # 序贯边界：与 OBF 参考表对照 + 第一类错误率蒙特卡洛
$NODE tests/test_seed.js     # 种子稳健性：14 个种子的基线与效应波动
$NODE tests/test_audit.js    # 审计异常护栏的抽样分布核查
$NODE tests/test_engine.js   # 引擎冒烟测试 + 分布函数自检
```
