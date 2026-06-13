$ErrorActionPreference = "Stop"

function Emit($obj) {
  $obj | ConvertTo-Json -Compress
}

function Major($version) {
  if (-not $version) { return 0 }
  return [int](($version.TrimStart("v") -split "\.")[0])
}

$minMajor = Major($env:STARTKIT_MIN_VERSION)
$candidate = $null
$cmd = Get-Command node -ErrorAction SilentlyContinue
if ($cmd) { $candidate = $cmd.Source }

if (-not $candidate) {
  Emit @{ status = "missing"; message = "Install Node.js $env:STARTKIT_MIN_VERSION or newer. The Node.js installer includes npm."; actions = @("manual") }
  exit 0
}

$npm = Get-Command npm -ErrorAction SilentlyContinue
if (-not $npm) {
  Emit @{ status = "missing"; path = $candidate; message = "npm was not found. Reinstall Node.js $env:STARTKIT_MIN_VERSION or newer with npm enabled."; actions = @("manual") }
  exit 0
}

$version = & $candidate --version 2>$null
if ((Major $version) -lt $minMajor) {
  Emit @{ status = "outdated"; version = $version; path = $candidate; message = "Node.js $version is below the required version. Install Node.js $env:STARTKIT_MIN_VERSION or newer; it includes npm."; actions = @("manual") }
  exit 0
}

Emit @{ status = "ok"; version = $version; path = $candidate; message = "Node.js and npm are ready"; actions = @() }
