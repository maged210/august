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
  $line = Get-Content $envFile | Where-Object { $_ -match '^\s*ANTHROPIC_API_KEY\s*=' } | Select-Object -First 1
  if ($line) { $env:ANTHROPIC_API_KEY = ($line -replace '^\s*ANTHROPIC_API_KEY\s*=', '').Trim() }
}
Remove-Item Env:\ANTHROPIC_BASE_URL -ErrorAction SilentlyContinue

# OneDrive leaves stale .next reparse points that break the dev server (EINVAL
# readlink) — clean before starting.
$next = Join-Path $root ".next"
if (Test-Path $next) {
  try { Remove-Item -Recurse -Force $next -ErrorAction Stop } catch {}
}

npm run dev
