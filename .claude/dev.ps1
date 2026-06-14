# Dev-server launcher for Claude Code previews.
#
# Claude-spawned shells inherit an EMPTY ANTHROPIC_API_KEY which overrides
# .env.local (dotenv never overwrites existing env vars). Re-read the real key
# from .env.local at runtime so /api/chat works in previews. No secret is
# stored in this file.
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$envFile = Join-Path $root ".env.local"
if (Test-Path $envFile) {
  $envLines = Get-Content $envFile
  $keys = @(
    "ANTHROPIC_API_KEY",
    "UPSTASH_REDIS_REST_URL",
    "UPSTASH_REDIS_REST_TOKEN",
    "ELEVENLABS_API_KEY",
    "ELEVENLABS_VOICE_ID",
    "OPENSKY_USER",
    "OPENSKY_PASS",
    "OPENSKY_CLIENT_ID",
    "OPENSKY_CLIENT_SECRET",
    "FRED_API_KEY",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "APP_ORIGIN",
    "CRON_SECRET"
  )
  foreach ($key in $keys) {
    $line = $envLines | Where-Object { $_ -match "^\s*${key}\s*=" } | Select-Object -First 1
    if ($line) { Set-Item -Path "Env:\$key" -Value ($line -replace "^\s*${key}\s*=", "").Trim() }
  }
}
Remove-Item Env:\ANTHROPIC_BASE_URL -ErrorAction SilentlyContinue

# OneDrive leaves stale .next reparse points that break the dev server (EINVAL
# readlink) — clean before starting.
$next = Join-Path $root ".next"
if (Test-Path $next) {
  try { Remove-Item -Recurse -Force $next -ErrorAction Stop } catch {}
}

npm run dev
