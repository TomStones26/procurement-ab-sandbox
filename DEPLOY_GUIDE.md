# GitHub 接入与更新指南

> 本文档记录本项目的 GitHub 接入方式、**当前卡在哪一步**、以及后续每次更新怎么做。
>
> **当前结论（2026-09-27 更新）：仓库已建好、页面已推送，只差"开启 Pages"这一步。**
> 去 Settings → Pages 选 `main` + `/ (root)` 保存即可。详见第 5 节。
> 另外本地还有一批新文件没推上去，见第 6 节。

---

## 一、当前状态速览

| 项目 | 状态 |
|---|---|
| 本地仓库 | ✅ 已初始化（分支 `main`），HEAD = `5bb8349` |
| 远程仓库 | ✅ 已创建 → `https://github.com/TomStones26/procurement-ab-sandbox` |
| 远程 main | ⚠️ 停在 `e7a9674`（2026-09-21），**本地有 2 个提交未推送** |
| 根目录 `index.html` | ✅ 已在线（落地页就绪） |
| **GitHub Pages** | ❌ **未开启** —— 这是访问 404 的直接原因，见第 5 节 |
| 线上沙盒地址 | ⬜ `https://tomstones26.github.io/procurement-ab-sandbox/`（开启后生效） |

### 两个待办（按顺序做）

1. **开启 Pages** —— 解决 404（见第 5 节）
2. **推送新文件** —— 同步 3 份文档与推送脚本（见第 6 节）

### ⚠️ 关于 404 的一个常见误判

打开线上地址看到 **404「There isn't a GitHub Pages site here」**，
**不是网络/VPN 问题**，而是 Pages 服务**从未开启**。

判断方法：网络问题的表现是**超时或连不上**，而 404 是**服务器正常应答**了，
只是那个位置没有站点。两者性质完全不同。

---

## 二、这次做了什么
所以只能你在网页上手动创建一次。

> 参考：你之前的 `credit-risk-modeling` 能推成功，正是因为那个仓库是**先在网页建好的**。

---

## 二、这次做了什么

1. **写了 `.gitignore`** —— 本地助手工作区（`.workbuddy/`）、临时清单、校验截图被排除
2. **补了根目录 `README.md`** —— 仓库门户页，含结论先行、三条核心发现、数据来源、方法论 SOP
3. **补了根目录 `index.html`** —— GitHub Pages 落地页（项目此前只有沙盒本体，缺对外入口）
4. **初始化 git 仓库并完成首次提交** —— 配置了 `core.quotepath=false`（中文文件名不乱码）和传输缓冲参数
5. **诊断并解决了推送障碍** —— 见第 4 节
6. **补了三份交付文档**（2026-09-22）—— 项目完整介绍 / 简历分点简介 / 改进方向建议
7. **加了 `推送到GitHub.ps1`** —— 一键推送脚本，含状态打印与失败分类提示

### 本地领先远程的 2 个提交（待推送）

```
5bb8349  chore: 加一键推送脚本（含失败分类提示）
ba5fc66  docs: 补项目完整介绍、简历分点简介、改进方向建议
e7a9674  ← 远程 main 当前停在在这里
```

### 入库的文件

```
.gitignore
README.md                                ← 仓库门户
index.html                               ← Pages 落地页
DEPLOY_GUIDE.md                          ← 本文件
01_项目完整介绍.md                        ← 完整介绍（12 节）
02_简历分点简介.md                        ← 三个篇幅版本
03_改进方向建议.md                        ← P0/P1/P2 分级建议
推送到GitHub.ps1                          ← 一键推送脚本
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

共 **26 个文件**，总体积约 **6.5 MB**，远低于 GitHub 单文件 100 MB 硬上限，无需 LFS。

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

## 五、开启在线站点（当前待办第 1 项）

**前置确认**：远程仓库必须已有 `main` 分支和根目录 `index.html`。
本项目两者都满足（`index.html` 已在线上），可以直接做这一步。

### 操作步骤

1. 打开 <https://github.com/TomStones26/procurement-ab-sandbox/settings/pages>
   （或：仓库页面 → 顶部 **Settings** → 左侧栏找 **Pages**）
2. **Source** 选 **`Deploy from a branch`**
3. **Branch** 选 **`main`**，右边目录选 **`/ (root)`**

   ⚠️ **目录必须选 `/ (root)`，不要选 `/docs`。**
   我们的落地页 `index.html` 在仓库根目录。选错目录会得到一个空站点。

4. 点 **Save**
5. 等 **1~2 分钟**，刷新这个页面，顶部会出现绿字：

```
Your site is live at https://tomstones26.github.io/procurement-ab-sandbox/
```

6. 点进去就是**落地页**，再点「进入沙盒」即可交互。

### 如果开启后仍然 404

按顺序排查：

| 检查项 | 怎么查 |
|---|---|
| **是否等够时间** | 首次发布需要 1~2 分钟，偶尔到 5 分钟。先在 Settings → Pages 页面看有没有 "Your site is live" 绿字 |
| **分支/目录选对了吗** | 必须 `main` + `/ (root)` |
| **Actions 有没有报错** | 仓库顶部 **Actions** 页签，看名为 `pages build and deployment` 的工作流是否绿色对勾 |
| **浏览器缓存** | 强制刷新（`Ctrl + F5`），或用无痕窗口打开 |
| **仓库是不是 Private** | 免费账号的私有仓库不能发布 Pages，必须是 Public |
| **`index.html` 在不在根目录** | 仓库首页应该能直接看到 `index.html` 文件 |

### 验证页面引用的相对路径（Pages 特有坑）

Pages 是**静态托管**，链接大小写敏感（本地 Windows 不敏感，容易漏）。

本项目的落地页引用写成 `procurement-ab-sandbox/index.html`（全小写），
与实际目录名完全一致，**已核对无误**。

> 以后如果新增文件，务必确认链接大小写与实际文件名**逐字符一致**。

---

## 六、推送本地新文件（当前待办第 2 项）

当前远程 `main` 停在 `e7a9674`（2026-09-21），**本地领先 2 个提交**，包含这些未同步的文件：

```
01_项目完整介绍.md
02_简历分点简介.md
03_改进方向建议.md
推送到GitHub.ps1
```

### 同步方法

**方法 A（推荐）**：双击项目根目录的 **`推送到GitHub.ps1`**
脚本会自动打印状态、执行推送，并按错误类型给出提示。

**方法 B**：手动执行

```powershell
cd "C:\Users\ynwas\WorkBuddy\2026-09-21-16-09-54"
git push origin main
```

### ⚠️ 为什么助手不能代劳

经实测，助手环境的 `git push` **必然失败（HTTP 401）**：

```
<= Recv header: HTTP/2 401
<= Recv header: www-authenticate: Basic realm="GitHub"
```

**凭据没有被送出去。** 原因是环境里有本地 HTTP 代理（`127.0.0.1:57316`），
而 `credential.helper` 指向的凭据管理器在当前路径下不存在 —— 凭据通道是断的。

**关键认知：凭据授权是"用户桌面终端"维度的事，与助手会话不共享。**
你在自己的 PowerShell 里能推成功，助手环境照样推不了。

→ **所以推送一律由你在桌面终端执行。** 助手负责：改文件、本地提交、核对状态、把命令写好。

---

## 七、以后每次更新怎么做

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

## 八、⛔ 一条红线

**绝对不要**用 `git add -f` 去强推这些东西：

- `.workbuddy/` —— 本地助手的会话记忆，含内部工作记录，对外没有意义
- `FINAL_TREE.txt` —— 临时文件清单
- `.shots/` —— 校验截图

它们已经被 `.gitignore` 挡住。一旦强推：

- 单文件超过 100 MB 会被 GitHub **直接拒绝**
- 就算推成功了，文件会**永久留在提交历史里** —— 删掉当前版本也没用，只能重写全部历史 + 强制推送，所有人都得重新下载

如果哪天不小心提交了，**先停下来找我**，别自己折腾。

---

## 九、常见问题

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
① 仓库还没建 —— 去网页建一个空仓库（本项目已建好，不会再遇到）；
② 仓库名或远程地址拼错了 —— 用 `git remote -v` 核对。

**Q8：怎么一劳永逸避免权限问题**
去建一个带 `repo` 权限的 **Personal Access Token**（classic），推送到提示时用它当密码。
这样就不依赖 GitHub Desktop 的 OAuth 了，建仓库、推送都能做，不会再遇到本次这类问题。

**Q9：线上地址报 404「There isn't a GitHub Pages site here」**
**这不是 VPN 问题**，是 Pages 服务没开启（或站点尚未发布完成）。见第 5 节。
判断要点：网络问题表现为**超时/连不上**；404 是服务器**正常应答**了，只是那个位置没站点。

**Q10：Pages 开了但页面样式全乱 / 沙盒打不开**
几乎都是**相对路径大小写**问题。Pages 是 Linux 环境，**大小写敏感**；
本地 Windows 不敏感，所以本地测试正常、线上报错。
检查 `index.html` 里的链接是否与实际文件名**逐字符**一致。

---

## 十、什么会上传、什么不会

| | 内容 | 体积 |
|---|---|---|
| ✅ 会上传 | 沙盒代码 `.html/.css/.js`、文档 `.md`、采集脚本 `.py`、原始数据快照 `.json` | 约 **6.5 MB** |
| ❌ 不会上传 | `.workbuddy/`、`FINAL_TREE.txt`、`.shots/`、`__pycache__/`、`.vscode/` | 约 **1 MB** |

规则写在根目录 `.gitignore` 里。想加新的例外（比如某个文件也想上去），在文件末尾加一行：

```
!路径/文件名
```
