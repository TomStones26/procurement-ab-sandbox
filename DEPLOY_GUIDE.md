# GitHub 接入与更新指南

> 本文档记录本项目的 GitHub 接入方式、**当前卡在哪一步**、以及后续每次更新怎么做。
>
> **当前结论（2026-09-22 更新）：凭据问题已解决，现在只差一个"空仓库"。**
> 去网页手动建一个**空的** `procurement-ab-sandbox` 仓库，再重跑 `git push` 即可。详见第 4 节。

---

## 一、当前状态速览

| 项目 | 状态 |
|---|---|
| 本地仓库 | ✅ 已初始化（分支 `main`） |
| 首次提交 | ✅ 已完成 —— 两次提交（`19df1e7` init / `9646e42` docs） |
| 工作区 | ✅ 干净（无未提交改动） |
| 远程地址 | ✅ 已配置 → `https://github.com/TomStones26/procurement-ab-sandbox.git` |
| Git 凭据 | ✅ **已通** —— `git push` 秒回错误，不再卡死 |
| **远程仓库** | ❌ **尚未创建** —— 需在网页手动建，见第 4 节 |
| GitHub Pages | ⬜ 待推送后开启 |

### 一句话说清当前障碍

`git push` **不会自动创建仓库**，必须先有一个空的远程仓库。
而且本机当前用的是 GitHub Desktop 签发的 OAuth token（`gho_` 开头），**没有建仓库的权限** ——
所以只能你在网页上手动创建一次。

> 参考：你之前的 `credit-risk-modeling` 能推成功，正是因为那个仓库是**先在网页建好的**。

---

## 二、这次做了什么

1. **写了 `.gitignore`** —— 19 个文件入库，本地助手工作区（`.workbuddy/`）、临时清单、校验截图被排除
2. **补了根目录 `README.md`** —— 仓库门户页，含结论先行、三条核心发现、数据来源、方法论 SOP
3. **补了根目录 `index.html`** —— GitHub Pages 落地页（项目此前只有沙盒本体，缺对外入口）
4. **初始化 git 仓库并完成首次提交** —— 配置了 `core.quotepath=false`（中文文件名不乱码）和传输缓冲参数
5. **诊断出推送失败的真实原因** —— 见第 4 节

### 入库的 21 个文件

```
.gitignore
README.md                                ← 新增（仓库门户）
index.html                               ← 新增（Pages 落地页）
pipeline/01_fetch_amount_bands.py
pipeline/02_fetch_category_aggregates.py
pipeline/03_build_baseline.py
pipeline/README.md
pipeline/data/data_category.json              111 KB
pipeline/data/data_raw_usaspending.json       254 KB
pipeline/data/data_raw_wb_procnotices.json    6.0 MB
pipeline/tests/test_audit.js
pipeline/tests/test_e2e.js
pipeline/tests/test_engine.js
pipeline/tests/test_seed.js
pipeline/tests/test_seq.js
procurement-ab-sandbox/README.md
procurement-ab-sandbox/app.js
procurement-ab-sandbox/data.js
procurement-ab-sandbox/engine.js
procurement-ab-sandbox/index.html
procurement-ab-sandbox/styles.css
```

总体积约 **6.5 MB**，远低于 GitHub 单文件 100 MB 硬上限，无需 LFS。

> **数据文件为什么入库**：`data_raw_*.json` 是整条流水线的"事实底稿"。官方接口会随时间变动（字段改名、历史数据回填），只靠脚本重跑无法复现今天的数字。留快照才能保证结论可追溯。项目体积很小，这个代价值得。

---

## 三、两道障碍的完整诊断

推送失败前后有**两个不同的原因**，别混在一起看。

### 障碍一（已解决）：凭据助手在无窗口环境卡死

**现象**：`git push` 永久挂起，不报错也不超时，6 分钟无任何输出。

**原因**：这台机器 Git 的**系统级凭据助手**配置成了需要弹窗交互的组件。

```
$ git config --system --get credential.helper
helper-selector        ← GitHub Desktop 的凭据选择器
```

`git-credential-helper-selector` 需要弹窗让你选登录方式。在没有可交互桌面会话的环境里（自动化脚本、CI、后台任务），它**弹不出窗口也拿不到结果，就无限期挂住**。

实测三条证据：
1. `git credential fill` 挂起 —— 20 秒无响应
2. 强制换成 `store` / `wincred` 助手，**同样挂起**
3. 在**之前成功推送过**的 `风控项目` 目录下重试，**同样挂起** → 机器环境问题，非本项目问题

**怎么好的**：你在**有桌面的 PowerShell** 里手动执行了一次，交互窗口正常弹出、完成授权。之后 `git push` 秒回错误，不再卡死。

→ **这条经验要记住：首次授权必须在有桌面的会话里做，不能用后台/自动化方式。**

### 障碍二（当前卡点）：远程仓库不存在，且当前凭据无权创建

**现象**：

```
$ git push -u origin main
remote: Repository not found.
fatal: repository 'https://github.com/TomStones26/procurement-ab-sandbox.git/' not found
```

**原因有两层：**

**第一层 —— `git push` 不会自动创建仓库。**
它只能推到**已存在**的仓库。`Repository not found` 是字面意思：GitHub 上确实还没有这个仓库。
（核实结果：你账号下当时只有 `credit-risk-modeling` 和 `search-trend-insight` 两个仓库。）

**第二层 —— 当前凭据没有"建仓库"的权限。**
本机凭据库里用的是 GitHub Desktop 签发的 OAuth token（`gho_` 开头）。这种 token 的权限范围**不包含创建仓库**，所以能认证、能读写已有仓库，但建不了新仓库。

> 这正好解释了为什么 `credit-risk-modeling` 当初能推成功 —— 因为那个仓库是**先在网页上手动建好的**。

---

## 四、怎么修（就一步：手动建一个空仓库）

### 第 1 步：在 GitHub 网页建空仓库

1. 打开 <https://github.com/new>
2. **Repository name** 填：`procurement-ab-sandbox`
   ⚠️ 必须完全一致，否则要改远程地址
3. **Description** 填：
   `供应链采购流程 A/B 实验沙盒：PR 审批分级授权（低值低风险 PR 规则引擎自动放行 + 事后审计），含真实数据采集管道与完整统计诊断`
4. 选 **Public**（免费账号的私有仓库不能发布 Pages，想要在线站点必须 Public）
5. ⚠️ **三个勾一个都不要勾** —— 这是最容易出错的一步：
   - ☐ Add a README file
   - ☐ Add .gitignore
   - ☐ Choose a license

   **原因**：本地已经有这些文件了。远程再生成一份，两边历史不一致，推送会被直接拒绝（`rejected - fetch first`）。
6. 点 **Create repository**

### 第 2 步：重跑推送

```powershell
cd "C:\Users\ynwas\WorkBuddy\2026-09-21-16-09-54"

git push -u origin main
```

**成功的标志**：

```
Enumerating objects: 24, done.
...
To https://github.com/TomStones26/procurement-ab-sandbox.git
 * [new branch]      main -> main
branch 'main' set up to track 'origin/main'.
```

看到这几行就成功了。刷新 GitHub 页面能看到 21 个文件。

### 万一还是失败

**报 `rejected - fetch first` / `failed to push some refs`**
说明建仓库时不小心勾了 README / .gitignore（远程多了一个提交）。确认远程内容可丢弃后强制覆盖：

```powershell
git push -u origin main --force
```

⚠️ `--force` 会覆盖远程内容，**只在确认远程是刚建的空仓库时**用。

**报 `Repository not found` 但仓库明明建好了**
检查仓库名有没有拼错（大小写不敏感，但连字符别漏）：

```powershell
git remote -v
```

如果地址不对，改掉再推：

```powershell
git remote set-url origin https://github.com/TomStones26/procurement-ab-sandbox.git
git push -u origin main
```

**授权又卡住了**
说明凭据需要重新验证。到网页重新签一次授权，或改用 Personal Access Token：

1. GitHub 右上角头像 → **Settings** → 左栏拉到底 → **Developer settings**
2. **Personal access tokens** → **Tokens (classic)** → **Generate new token (classic)**
3. Note 填 `local-push`，Expiration 选 90 days，权限**勾 `repo`**（第一个大项）
4. **Generate token** → **立刻复制那串字符**（只显示这一次）
5. 回 PowerShell，弹出提示时 `Username:` 填 `TomStones26`，`Password:` **粘贴 token**（输入时不显示字符，属正常）

> **想一劳永逸**：用带 `repo` 权限的 classic token，就不依赖 GitHub Desktop 的 OAuth 了，建仓库、推送都能做，不会再遇到这次的权限问题。

---

## 五、推送成功后：开启在线站点

1. 仓库页面 → 顶部 **Settings**
2. 左侧栏找 **Pages**（大概在中间）
3. **Source** 选 **Deploy from a branch**
4. **Branch** 选 **`main`**，目录选 **`/ (root)`** → **Save**
5. 等 **1~2 分钟**，刷新页面，顶部出现绿字：

```
Your site is live at https://tomstones26.github.io/procurement-ab-sandbox/
```

6. 点进去就是**落地页**（根目录 `index.html`），点「进入沙盒」直接可玩。

> 落地页用 `file://` 打开也能正常看，但如果想改样式后立刻在本地预览，直接双击根目录 `index.html` 即可。

---

## 六、以后每次更新怎么做

改完文件后，**三条命令**：

```powershell
cd "C:\Users\ynwas\WorkBuddy\2026-09-21-16-09-54"

git add -A
git commit -m "说明这次改了什么，例如：调整护栏非劣界阈值"
git push
```

- 实际只推几百 KB 到几 MB，**几秒钟完成**
- Pages 站点会在 **1 分钟内自动重新发布**，不用再进 Settings
- 沙盒是纯前端，改动即时生效，无需构建

### 也可以直接让助手帮你做

改完文件后跟我说一句"同步到 GitHub"即可。**首次推送成功后**，凭据已缓存，助手就能直接推了。

### 什么时候必须你手动做

- **首次创建远程仓库** —— 当前凭据没有建仓库权限，只能网页操作（或改用带 `repo` 权限的 token）
- **改了 `.gitignore` 想加例外** —— 需要确认新文件确实不含隐私数据
- **想改仓库可见性（Public/Private）** —— 只能进 Settings 操作
- **凭据过期或被撤销** —— 重新授权需要你在桌面环境点一下

---

## 七、⛔ 一条红线

**绝对不要**用 `git add -f` 去强推这些东西：

- `.workbuddy/` —— 本地助手的会话记忆，含内部工作记录，对外没有意义
- `FINAL_TREE.txt` —— 临时文件清单
- `.shots/` —— 校验截图

它们已经被 `.gitignore` 挡住。一旦强推：

- 单文件超过 100 MB 会被 GitHub **直接拒绝**
- 就算推成功了，文件会**永久留在提交历史里** —— 删掉当前版本也没用，只能重写全部历史 + 强制推送，所有人都得重新下载

如果哪天不小心提交了，**先停下来找我**，别自己折腾。

---

## 八、常见问题

**Q1：`error: remote origin already exists`**
之前配过了，改用这条覆盖：

```powershell
git remote set-url origin https://github.com/TomStones26/procurement-ab-sandbox.git
```

**Q2：`failed to push some refs` / `rejected`**
远程有本地没有的提交（通常是建仓库时不小心勾了 README）。确认远程是空仓库后：

```powershell
git push -u origin main --force
```

⚠️ `--force` 会覆盖远程内容，**只在确认远程内容可丢弃时**用。

**Q3：中文文件名显示成 `\344\270\255` 这种转义**
执行 `git config core.quotepath false`（本项目已经设过了，一般不会再遇到）。

**Q4：想改成私有仓库**
Settings → 最下方 **Danger Zone** → **Change repository visibility**。
但注意：免费账号的私有仓库**不能对外发布 Pages**，改成私有后在线站点会失效。

**Q5：想彻底删掉仓库**
Settings → 最下方 **Danger Zone** → **Delete this repository**（需按提示输入仓库名确认）。

**Q6：`git push` 又卡住了（无响应）**
先确认是不是凭据助手又弹不出窗口：

```powershell
git config --system --get credential.helper
```

如果输出 `helper-selector`，说明还是 GitHub Desktop 那个交互式助手。在**有桌面的** PowerShell 里重跑一次，让它弹窗完成授权即可。

**Q7：`remote: Repository not found`**
两种可能：
① 仓库还没建 —— 见第 4 节，去网页建一个空仓库；
② 仓库名或远程地址拼错了 —— 用 `git remote -v` 核对。

**Q8：怎么一劳永逸避免权限问题**
去建一个带 `repo` 权限的 **Personal Access Token**（classic），推送到提示时用它当密码。
这样就不依赖 GitHub Desktop 的 OAuth 了，建仓库、推送都能做，不会再遇到本次这类问题。

---

## 九、什么会上传、什么不会

| | 内容 | 体积 |
|---|---|---|
| ✅ 会上传 | 沙盒代码 `.html/.css/.js`、文档 `.md`、采集脚本 `.py`、原始数据快照 `.json` | 约 **6.5 MB** |
| ❌ 不会上传 | `.workbuddy/`、`FINAL_TREE.txt`、`.shots/`、`__pycache__/`、`.vscode/` | 约 **1 MB** |

规则写在根目录 `.gitignore` 里。想加新的例外（比如某个文件也想上去），在文件末尾加一行：

```
!路径/文件名
```
