$ErrorActionPreference = "Stop"

function Emit($obj) {
  $obj | ConvertTo-Json -Compress
}

function Major($version) {
  if (-not $version) { return 0 }
  return [int](($version.TrimStart("v") -split "\.")[0])
}

$winget = Get-Command winget -ErrorAction SilentlyContinue
if (-not $winget) {
  Emit @{ status = "blocked"; message = "winget is not available. Install Node.js on this computer, then run setup again."; actions = @("verify") }
  exit 0
}

& $winget.Source install --id OpenJS.NodeJS.LTS --source winget --accept-package-agreements --accept-source-agreements --silent

$cmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $cmd) {
  Emit @{ status = "blocked"; message = "Node.js installer finished, but node is not on PATH yet. Restart the app or run setup again."; actions = @("verify") }
  exit 0
}

$version = & $cmd.Source --version 2>$null
if ((Major $version) -lt (Major $env:STARTKIT_MIN_VERSION)) {
  Emit @{ status = "error"; version = $version; path = $cmd.Source; message = "Installed Node.js is below the required version."; actions = @("install") }
  exit 0
}

Emit @{ status = "ok"; version = $version; path = $cmd.Source; message = "Node.js installed"; actions = @() }
