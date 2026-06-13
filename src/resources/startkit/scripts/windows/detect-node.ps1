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
  Emit @{ status = "blocked"; message = "Install Node.js $env:STARTKIT_MIN_VERSION or newer, then scan again."; actions = @() }
  exit 0
}

$version = & $candidate --version 2>$null
if ((Major $version) -lt $minMajor) {
  Emit @{ status = "blocked"; version = $version; path = $candidate; message = "Node.js $version is below the required version. Install Node.js $env:STARTKIT_MIN_VERSION or newer, then scan again."; actions = @() }
  exit 0
}

Emit @{ status = "ok"; version = $version; path = $candidate; message = "Node.js is ready"; actions = @() }
