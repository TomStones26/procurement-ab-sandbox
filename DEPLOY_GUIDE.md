# GitHub 接入与更新指南

> 本文档记录本项目的 GitHub 接入方式、**当前卡在哪一步**、以及后续每次更新怎么做。
>
> **先说结论：本地仓库已建好、首次提交已完成，只差最后一步"推送"。**
> 推送失败的原因不在代码、不在网络、也不在 GitHub 账号 —— 是**本机的 Git 凭据助手在无窗口环境下拿不到凭据**。修法在第 4 节，一条命令。

---

## 一、当前状态速览

| 项目 | 状态 |
|---|---|
| 本地仓库 | ✅ 已初始化（分支 `main`） |
| 首次提交 | ✅ 已完成 —— `19df1e7`，21 个文件 / 4,600 行 |
| 工作区 | ✅ 干净（无未提交改动） |
| 远程地址 | ✅ 已配置 → `https://github.com/TomStones26/procurement-ab-sandbox.git` |
| **推送到 GitHub** | ❌ **未完成** —— 卡在凭据助手，见第 4 节 |
| 远程仓库 | ❌ 尚未创建（需先推送成功，或手动建） |
| GitHub Pages | ⬜ 待推送后开启 |

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

## 三、推送失败的真实原因

### 现象

`git push` 会**永久挂起**，不报错也不超时：

```
$ git push -u origin main
（卡住，6 分钟无任何输出）
```

### 排查过程与排除项

| 怀疑对象 | 结论 |
|---|---|
| 网络不通 | ❌ 排除 —— `curl https://github.com` 返回 200，约 2.6 秒 |
| 账号不对 | ❌ 排除 —— `TomStones26` 账号存在，已有 2 个仓库 |
| 仓库名冲突 | ❌ 排除 —— 远程仓库不存在（API 返回 404） |
| 代码有问题 | ❌ 排除 —— 本地提交干净，`git status` 无异常 |
| 缺少凭据 | ❌ 排除 —— Windows 凭据库里有 `git:https://github.com`，用户 `TomStones26` |

### 真正的原因

问题出在这台机器 Git 的**系统级凭据助手配置**：

```
$ git config --system --get credential.helper
helper-selector        ← 指向 GitHub Desktop 的凭据选择器
```

`git-credential-helper-selector` 是一个**需要弹窗交互**的组件（选择用哪个账号/方式登录）。在没有可交互桌面会话的环境里（比如自动化脚本、CI、后台任务），它**弹不出窗口，也拿不到结果，就无限期挂住**。

实测三条证据：

1. `git credential fill` 挂起 —— 20 秒无响应
2. 强制换成 `store` / `wincred` 助手，**同样挂起** —— 说明系统级配置的干预比预期更强，命令行覆盖不生效
3. 在**之前成功推送过**的 `风控项目` 目录下重试，**同样挂起** —— 证明这是机器环境问题，**不是本项目的问题**

> 换句话说：之前那两个仓库能推上去，是因为你在**有桌面的环境里手动执行**的。现在由助手在后台执行，就卡住了。

---

## 四、怎么修（推荐路径）

**最省事的办法：你自己在 PowerShell 里跑一次推送。**

因为是你在有桌面的会话里操作，凭据助手能正常弹窗，一次性授权后永久记住。

打开 **PowerShell**（开始菜单搜 "PowerShell"），**逐行**执行：

```powershell
cd "C:\Users\ynwas\WorkBuddy\2026-09-21-16-09-54"

git push -u origin main
```

远程仓库 `procurement-ab-sandbox` 会在**第一次推送时自动创建**（GitHub 的默认行为，前提是账号有建仓库权限）。

### 会看到什么

**情况 A（正常）**：弹出 **GitHub Desktop / Git Credential Manager** 窗口 → 点 **Sign in with your browser** → 浏览器里授权一下。之后永久记住。

**情况 B**：命令行提示 `Username:` / `Password:`。注意 —— **GitHub 从 2021 年起不接受账号密码**，这里要填 **Personal Access Token**：

1. GitHub 右上角头像 → **Settings**
2. 左栏拉到底 → **Developer settings**
3. **Personal access tokens** → **Tokens (classic)**
4. **Generate new token** → **Generate new token (classic)**
5. Note 填 `local-push`，Expiration 选 90 days，权限勾 **`repo`**（第一个大项）
6. 点 **Generate token** → **立刻复制那串字符**（只显示这一次）
7. 回 PowerShell：`Username:` 填 `TomStones26`；`Password:` **粘贴那串 token**（输入时不显示字符，属正常，粘贴完直接回车）

### 成功的标志

```
Enumerating objects: 24, done.
...
To https://github.com/TomStones26/procurement-ab-sandbox.git
 * [new branch]      main -> main
branch 'main' set up to track 'origin/main'.
```

看到这几行就成功了。刷新 GitHub 页面能看到 21 个文件。

### 如果情况 A 窗口没弹出来

说明系统级助手配置在这台机器上确实不通。改用**明确指定助手**的方式：

```powershell
cd "C:\Users\ynwas\WorkBuddy\2026-09-21-16-09-54"

git -c credential.helper=manager push -u origin main
```

还是不行的话，把系统级配置清掉（需要**管理员身份**的 PowerShell）：

```powershell
git config --system --unset credential.helper
git config --global credential.helper manager
```

然后再跑一次 `git push -u origin main`。

### 备选路径：手动建仓库

如果自动创建失败（权限或策略限制），就去 GitHub 手动建一个**空**仓库：

1. 右上角 **`+`** → **New repository**
2. **Repository name** 填：`procurement-ab-sandbox`（必须完全一致，否则要改远程地址）
3. **Description** 填：
   `供应链采购流程 A/B 实验沙盒：PR 审批分级授权（低值低风险 PR 规则引擎自动放行 + 事后审计），含真实数据采集管道与完整统计诊断`
4. 选 **Public**（免费账号的私有仓库不能发布 Pages，想要在线站点必须 Public）
5. ⚠️ **三个勾一个都不要勾**（Add a README / Add .gitignore / Choose a license）
   —— 本地已经有了，远程再生成一份，推送时会"打架"报错
6. 点 **Create repository**，然后回到第 4 节跑推送命令

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

改完文件后跟我说一句"同步到 GitHub"即可。**首次推送成功后**，凭据会被缓存，后续助手就能直接推了（挂起问题的前提是"第一次授权还没完成"）。

### 什么时候必须你手动做

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

**Q6：`git push` 又卡住了**
先确认是不是又回到了凭据问题：

```powershell
git config --system --get credential.helper
```

如果输出 `helper-selector`，说明还是 GitHub Desktop 的助手。按第 4 节末段改成 `manager` 即可。

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
