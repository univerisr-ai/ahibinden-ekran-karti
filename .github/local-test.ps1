# Lokal test calistirici (Windows - PowerShell)
# Gereksinim: Docker Desktop (WSL2 backend) kurulu ve calisiyor olmali.
#
# Kullanim:
#   .github\local-test.ps1
#
# Bu script:
#   1. Scraper Docker imajini build eder
#   2. WARP proxy + Camoufox + scraper'i iceride calistirir
#   3. Loglari, videolari ve screenshot'lari .github/local-output/ altina kopyalar

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$composeFile = Join-Path $PSScriptRoot "docker-compose.test.yml"
$outputDir = Join-Path $PSScriptRoot "local-output"

if (!(Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Host "HATA: docker komutu bulunamadi. Docker Desktop kurulu mu?" -ForegroundColor Red
    exit 1
}

Write-Host "Local-output dizini hazirlaniyor: $outputDir"
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null

Write-Host "Docker imaji build ediliyor, bu biraz zaman alabilir..." -ForegroundColor Cyan
Set-Location $repoRoot
docker compose -f $composeFile build scraper

Write-Host "Test baslatiliyor..." -ForegroundColor Green
docker compose -f $composeFile up --abort-on-container-exit

Write-Host "Tamamlandi. Ciktilar: $outputDir" -ForegroundColor Green
Write-Host "  scraper.log      -> log"
Write-Host "  warp-trace.txt   -> WARP IP bilgisi"
Write-Host "  videos/          -> Playwright video kayitlari"
Write-Host "  screenshots/     -> ekran goruntuleri"
