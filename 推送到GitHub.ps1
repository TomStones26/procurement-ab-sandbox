$ErrorActionPreference = "Continue"

Write-Host ""
Write-Host "===============================================" -ForegroundColor Cyan
Write-Host "  推到 GitHub：采购 A/B 沙盒（含 3 份新文档）" -ForegroundColor Cyan
Write-Host "===============================================" -ForegroundColor Cyan
Write-Host ""

Set-Location "C:\Users\ynwas\WorkBuddy\2026-09-21-16-09-54"

Write-Host "[1/4] 当前状态" -ForegroundColor Yellow
Write-Host "  本地 HEAD : $(git rev-parse --short HEAD)"
Write-Host "  待推送文件："
git status --short
Write-Host ""

Write-Host "[2/4] 建立远程跟踪引用" -ForegroundColor Yellow
git fetch origin main
Write-Host ""

Write-Host "[3/4] 推送" -ForegroundColor Yellow
Write-Host "  如果弹出登录窗口，请点 Sign in with your browser 完成授权" -ForegroundColor Gray
Write-Host ""
git push origin main

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "[4/4] 推送成功！" -ForegroundColor Green
    Write-Host ""
    Write-Host "  仓库地址 : https://github.com/TomStones26/procurement-ab-sandbox" -ForegroundColor Green
    Write-Host "  在线沙盒 : https://tomstones26.github.io/procurement-ab-sandbox/" -ForegroundColor Green
    Write-Host ""
    Write-Host "  下一步：如果还没开 Pages，去 Settings -> Pages 选 main + / (root)" -ForegroundColor Gray
} else {
    Write-Host ""
    Write-Host "[4/4] 推送失败（退出码 $LASTEXITCODE）" -ForegroundColor Red
    Write-Host ""
    Write-Host "  常见原因与对策：" -ForegroundColor Yellow
    Write-Host "  1) 提示 Username/Password  ->  填用户名 TomStones26，密码粘贴 Personal Access Token"
    Write-Host "     （GitHub 不接受账号密码；token 需勾 repo 权限）"
    Write-Host "  2) 提示 403 / Permission denied  ->  token 权限不足或已过期，重新生成"
    Write-Host "  3) 提示 rejected / fetch first  ->  远程有本地没有的提交，先 git pull --rebase origin main"
    Write-Host ""
    Write-Host "  把上面的完整报错发给我，我来判断。" -ForegroundColor Yellow
}
Write-Host ""
Write-Host "按任意键关闭..." -ForegroundColor DarkGray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
