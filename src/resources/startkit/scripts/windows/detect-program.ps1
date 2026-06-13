$ErrorActionPreference = "Stop"

function Emit($obj) {
  $obj | ConvertTo-Json -Compress
}

$program = $env:STARTKIT_PROGRAM
$versionArg = if ($env:STARTKIT_VERSION_ARG) { $env:STARTKIT_VERSION_ARG } else { "--version" }
$cmd = $null

function ManagedCommand($program) {
  if (-not $env:STARTKIT_PLUGIN_BIN_DIR) { return $null }
  $managedExe = Join-Path $env:STARTKIT_PLUGIN_BIN_DIR "$program.exe"
  if (Test-Path $managedExe) { return @{ Source = $managedExe } }
  $managedPlain = Join-Path $env:STARTKIT_PLUGIN_BIN_DIR $program
  if (Test-Path $managedPlain) { return @{ Source = $managedPlain } }
  return $null
}

$cmd = Get-Command $program -ErrorAction SilentlyContinue
if ((-not $cmd) -and $env:STARTKIT_ITEM_MANAGED -eq "true") {
  $cmd = ManagedCommand $program
}

if (-not $cmd) {
  if ($env:STARTKIT_ITEM_MANAGED -eq "true") {
    Emit @{ status = "missing"; message = "$program was not found"; actions = @("install") }
  } else {
    Emit @{ status = "blocked"; message = "Install $program on this computer, then scan again."; actions = @() }
  }
  exit 0
}

$version = (& $cmd.Source $versionArg 2>&1 | Select-Object -First 1) -join ""

Emit @{ status = "ok"; version = $version; path = $cmd.Source; message = "$program is ready"; actions = @() }
