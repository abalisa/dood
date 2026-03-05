# Git Push Shortcut Script
# Usage: .\update_git.ps1 "Pesan commit anda"

$commitMessage = $args[0]
if (-not $commitMessage) {
    $commitMessage = "Update project: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
}

Write-Host "--- GIT UPDATE START ---" -ForegroundColor Cyan

# Check if .git exists
if (-not (Test-Path .git)) {
    Write-Host "Initializing Git repository..." -ForegroundColor Yellow
    git init
    git branch -M main
}

Write-Host "Adding changes..." -ForegroundColor Gray
git add .

Write-Host "Committing changes..." -ForegroundColor Gray
git commit -m "$commitMessage"

# Check if remote exists
$remoteExists = git remote
if (-not $remoteExists) {
    Write-Host "WARNING: No remote origin found." -ForegroundColor Red
    Write-Host "Please add your remote first with: git remote add origin <URL>" -ForegroundColor Yellow
} else {
    Write-Host "Pushing to main..." -ForegroundColor Green
    git push -u origin main
}

Write-Host "--- GIT UPDATE DONE ---" -ForegroundColor Cyan
