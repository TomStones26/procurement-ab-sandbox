$ErrorActionPreference = "Continue"

function Show-Header($text) {
    Write-Host ""
    Write-Host "===============================================" -ForegroundColor Cyan
    Write-Host "  $text" -ForegroundColor Cyan
    Write-Host "===============================================" -ForegroundColor Cyan
    Write-Host ""
}

Show-Header "推到 GitHub：采购 A/B 沙盒"

Set-Location "C:\Users\ynwas\WorkBuddy\2026-09-21-16-09-54"

# ---------- 1. 现状 ----------
Write-Host "[1/5] 当前状态" -ForegroundColor Yellow
$head = git rev-parse --short HEAD
Write-Host "  本地 HEAD : $head"

$dirty = (git status --short | Out-String).Trim()
if ($dirty) {
    Write-Host "  未提交的改动：" -ForegroundColor Yellow
    git status --short
    Write-Host ""
    Write-Host "  ⚠ 有未提交改动。本脚本只推送已提交内容。" -ForegroundColor Yellow
    Write-Host "    需要一并提交的话，先跑：git add -A; git commit -m '说明'" -ForegroundColor Gray
} else {
    Write-Host "  工作区    : 干净" -ForegroundColor Green
}

# ---------- 2. 拉取远程状态 ----------
Write-Host ""
Write-Host "[2/5] 同步远程状态" -ForegroundColor Yellow
git fetch origin main 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) {
    Write-Host "  已获取远程 main" -ForegroundColor Green
    $ahead = git rev-list --count "origin/main..HEAD" 2>$null
    if ($ahead) { Write-Host "  本地领先远程 : $ahead 个提交" -ForegroundColor Gray }
} else {
    Write-Host "  ⚠ 拉取远程状态失败（网络或凭据问题），仍将尝试推送" -ForegroundColor Yellow
}

# ---------- 3. 推送 ----------
Write-Host ""
Write-Host "[3/5] 推送" -ForegroundColor Yellow
Write-Host "  如弹出登录窗口，请点 Sign in with your browser 完成授权" -ForegroundColor Gray
Write-Host ""
git push origin main
$pushCode = $LASTEXITCODE

# ---------- 4. 结果 ----------
Write-Host ""
if ($pushCode -eq 0) {
    Write-Host "[4/5] ✅ 推送成功" -ForegroundColor Green
    Write-Host ""
    Write-Host "  仓库地址 : https://github.com/TomStones26/procurement-ab-sandbox" -ForegroundColor Green
} else {
    Write-Host "[4/5] ❌ 推送失败（退出码 $pushCode）" -ForegroundColor Red
    Write-Host ""
    Write-Host "  常见原因与对策：" -ForegroundColor Yellow
    Write-Host "  1) 提示 Username / Password"
    Write-Host "     -> 用户名填 TomStones26，密码粘贴 Personal Access Token"
    Write-Host "        （GitHub 已不接受账号密码；token 需勾 repo 权限）"
    Write-Host "  2) 403 / Permission denied"
    Write-Host "     -> token 权限不足或已过期，去重新生成一个（勾 repo）"
    Write-Host "  3) rejected / fetch first"
    Write-Host "     -> 远程有本地没有的提交，先跑：git pull --rebase origin main"
    Write-Host "  4) Repository not found"
    Write-Host "     -> 仓库名或远程地址不对，用 git remote -v 核对"
    Write-Host ""
    Write-Host "  把上面完整报错发给我，我来判断。" -ForegroundColor Yellow
}

# ---------- 5. Pages 状态提醒 ----------
Write-Host ""
Write-Host "[5/5] 在线站点（GitHub Pages）" -ForegroundColor Yellow
$pagesOn = $false
try {
    $r = Invoke-RestMethod -Uri "https://api.github.com/repos/TomStones26/procurement-ab-sandbox" `
         -Headers @{ "User-Agent" = "wb" } -TimeoutSec 20
    $pagesOn = $r.has_pages
} catch {
    Write-Host "  （无法查询 Pages 状态，跳过）" -ForegroundColor Gray
}

if ($pagesOn) {
    Write-Host "  ✅ Pages 已开启" -ForegroundColor Green
    Write-Host "  访问地址 : https://tomstones26.github.io/procurement-ab-sandbox/" -ForegroundColor Green
} else {
    Write-Host "  ❌ Pages 尚未开启 —— 现在打开线上地址会看到 404" -ForegroundColor Red
    Write-Host ""
    Write-Host "  这不是网络/VPN 问题，开启方法：" -ForegroundColor Yellow
    Write-Host "  1. 打开 https://github.com/TomStones26/procurement-ab-sandbox/settings/pages"
    Write-Host "  2. Source 选  Deploy from a branch"
    Write-Host "  3. Branch 选  main    目录选  / (root)"
    Write-Host "     ⚠ 目录必须是 / (root)，落地页在仓库根目录"
    Write-Host "  4. 点 Save，等 1~2 分钟"
    Write-Host ""
    Write-Host "  开启后地址 : https://tomstones26.github.io/procurement-ab-sandbox/" -ForegroundColor Green
}

Write-Host ""
Write-Host "按任意键关闭..." -ForegroundColor DarkGray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
