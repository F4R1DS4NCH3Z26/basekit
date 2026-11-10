# Offline tests for install.ps1 (Windows): fake node.cmd and npm.cmd on a sandboxed PATH (no network, no real npm;
# the user's global npm prefix and PATH are never touched). The fake npm logs its arguments, simulates success,
# EACCES and other failures, and on success writes a fake <prefix>\basekit.cmd so the installer can run
# `basekit --version`. Every case runs under Windows PowerShell 5.1 (powershell.exe) and PowerShell 7 (pwsh)
# when present. Output is matched on ASCII text only: accents may not survive the console code page.
# Usage: pwsh -File scripts/test-install.ps1
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'

$root = Split-Path -Parent $PSScriptRoot
$installer = Join-Path $root 'install.ps1'
$spec = 'github:F4R1DS4NCH3Z26/basekit'
$npmArgs = 'install -g --install-links --no-audit --no-fund'
$version = '0.1.0-test'
$work = Join-Path ([IO.Path]::GetTempPath()) ('basekit-test-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work | Out-Null
$script:fails = 0
$script:label = 'ascii'
$script:out = ''

function Pass([string]$What) { Write-Host "ok   ${script:label}: $What" }
function Fail([string]$What) {
  Write-Host "FAIL ${script:label}: $What"
  ($script:out -split "`n") | ForEach-Object { Write-Host "     | $_" }
  $script:fails++
}

# S2: the installer is ASCII-only (Windows PowerShell 5.1 reads BOM-less files with the ANSI code page).
$bytes = [IO.File]::ReadAllBytes($installer)
if (@($bytes | Where-Object { $_ -gt 127 }).Count -eq 0) { Pass 'install.ps1 es ASCII' } else { Fail 'install.ps1 tiene bytes no ASCII' }

# Fake tools, one per file; bin-* directories pick which ones are "installed".
$fake = Join-Path $work 'fake'
New-Item -ItemType Directory -Path $fake | Out-Null
Set-Content -LiteralPath (Join-Path $fake 'node.cmd') -Encoding Ascii -Value @'
@echo off
rem Fake node: answers `node -p process.versions.node` with FAKE_NODE_VERSION.
echo %FAKE_NODE_VERSION%
'@
Set-Content -LiteralPath (Join-Path $fake 'npm.cmd') -Encoding Ascii -Value @'
@echo off
rem Fake npm: logs its arguments; `prefix -g` prints FAKE_NPM_PREFIX; `install` follows FAKE_NPM_MODE.
>>"%NPM_LOG%" echo %*
if "%1"=="prefix" (
  echo %FAKE_NPM_PREFIX%
  exit /b 0
)
if "%FAKE_NPM_MODE%"=="eacces" (
  echo npm error code EACCES 1>&2
  echo npm error Error: EACCES: permission denied, mkdir 'C:\Program Files\nodejs\node_modules\basekit' 1>&2
  exit /b 243
)
if "%FAKE_NPM_MODE%"=="fail" (
  echo npm error code 128 1>&2
  echo npm error git dep preparation failed 1>&2
  exit /b 1
)
if not exist "%FAKE_NPM_PREFIX%" mkdir "%FAKE_NPM_PREFIX%"
>"%FAKE_NPM_PREFIX%\basekit.cmd" echo @echo %FAKE_BASEKIT_VERSION%
echo added 3 packages in 2s
exit /b 0
'@

function New-BinDir([string]$Name, [string[]]$Tools) {
  $d = Join-Path $work $Name
  New-Item -ItemType Directory -Path $d | Out-Null
  foreach ($t in $Tools) { Copy-Item -LiteralPath (Join-Path $fake "$t.cmd") -Destination $d }
  return $d
}
$binAll = New-BinDir 'bin-all' @('node', 'npm')
$binNoNode = New-BinDir 'bin-no-node' @('npm')
$binNoNpm = New-BinDir 'bin-no-npm' @('node')
$system32 = Join-Path $env:SystemRoot 'System32'

# Run-Install: runs install.ps1 in a child shell with PATH=<bins>;System32 (plus -ExtraPath), the fake npm prefix
# in the case directory and the given env vars. Mode File (-File with -Arguments), Iex (piped into
# Invoke-Expression, -After appended) or Block (a scriptblock with -Arguments, like the README's -Version form).
# -NoExit runs the command in an interactive-style session (-NoExit, without -NonInteractive).
# Leaves $script:rc, $script:out, $script:caseDir and $script:prefix.
function Run-Install {
  param([string]$Shell, [string]$Label, [string]$Bins, [hashtable]$Env = @{}, [string[]]$Arguments = @(),
    [ValidateSet('File', 'Iex', 'Block')][string]$Mode = 'File', [string]$After = '', [string]$ExtraPath = '', [switch]$NoExit)
  $script:label = "$Shell/$Label"
  $script:caseDir = Join-Path $work "$Shell-$Label"
  $script:prefix = Join-Path $script:caseDir 'prefix'
  New-Item -ItemType Directory -Force -Path $script:caseDir | Out-Null
  $path = "$Bins;$system32"
  if ($ExtraPath) { $path = "$ExtraPath;$path" }
  $vars = @{
    Path = $path; NPM_LOG = (Join-Path $script:caseDir 'npm.log'); FAKE_NPM_PREFIX = $script:prefix
    FAKE_NODE_VERSION = '22.11.0'; FAKE_BASEKIT_VERSION = $version; FAKE_NPM_MODE = ''
    BASEKIT_VERSION = ''; BASEKIT_SOURCE = ''
  }
  foreach ($k in $Env.Keys) { $vars[$k] = $Env[$k] }
  $saved = @{}
  foreach ($k in $vars.Keys) { $saved[$k] = [Environment]::GetEnvironmentVariable($k); [Environment]::SetEnvironmentVariable($k, $vars[$k]) }
  try {
    $exe = $script:shellPath
    $session = if ($NoExit) { @('-NoProfile', '-NoExit', '-ExecutionPolicy', 'Bypass') } else { @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass') }
    switch ($Mode) {
      'File' { $script:out = & $exe @session -File $installer @Arguments 2>&1 | Out-String }
      'Iex' {
        $cmd = "Get-Content -Raw -LiteralPath '$installer' | Invoke-Expression; $After"
        $script:out = & $exe @session -Command $cmd 2>&1 | Out-String
      }
      'Block' {
        $cmd = "& ([scriptblock]::Create((Get-Content -Raw -LiteralPath '$installer'))) $($Arguments -join ' ')"
        $script:out = & $exe @session -Command $cmd 2>&1 | Out-String
      }
    }
    $script:rc = $LASTEXITCODE
  } finally {
    foreach ($k in $saved.Keys) { [Environment]::SetEnvironmentVariable($k, $saved[$k]) }
  }
}

function Expect-Rc([int]$Want) { if ($script:rc -eq $Want) { Pass "exit $Want" } else { Fail "exit $($script:rc), se esperaba $Want" } }
function Expect-Out([string]$Text) { if ($script:out.Contains($Text)) { Pass "dice '$Text'" } else { Fail "la salida no contiene '$Text'" } }
function Expect-NoOut([string]$Text) { if ($script:out.Contains($Text)) { Fail "la salida contiene '$Text'" } else { Pass "no dice '$Text'" } }
# Expect-Npm: npm ran exactly these commands, in order.
function Expect-Npm([string[]]$Lines) {
  $log = Join-Path $script:caseDir 'npm.log'
  $got = if (Test-Path -LiteralPath $log) { (@(Get-Content -LiteralPath $log) | ForEach-Object { $_.TrimEnd() }) -join ' | ' } else { '' }
  $want = $Lines -join ' | '
  if ($got -eq $want) { Pass "npm recibio: $want" } else { Fail "npm recibio '$got', se esperaba '$want'" }
}
function Expect-NoNpm {
  $log = Join-Path $script:caseDir 'npm.log'
  if (Test-Path -LiteralPath $log) { Fail "npm no debia correr: $(Get-Content -Raw -LiteralPath $log)" } else { Pass 'npm no corrio' }
}

$shells = @('powershell.exe', 'pwsh') | Where-Object { Get-Command $_ -ErrorAction SilentlyContinue }
if (-not $shells) { Write-Host 'FAIL no hay powershell.exe ni pwsh'; exit 1 }

try {
  foreach ($sh in $shells) {
    $script:shellPath = (Get-Command $sh).Source

    # 1. Default, as a file: the exact command of `basekit install --global`, `basekit --version` from npm's
    #    global prefix, and the PATH hint because that prefix is not in PATH.
    Run-Install $sh default $binAll
    Expect-Rc 0
    Expect-Npm @("$npmArgs $spec", 'prefix -g')
    Expect-Out "basekit $version instalado en $($script:prefix)\basekit.cmd"
    Expect-Out "SetEnvironmentVariable('Path', [Environment]::GetEnvironmentVariable('Path', 'User') + ';$($script:prefix)', 'User')"
    Expect-Out 'Siguiente: basekit init <carpeta-del-proyecto>'

    # 2. npm's global prefix already in PATH: no hint.
    Run-Install $sh in-path $binAll -ExtraPath (Join-Path $work "$sh-in-path\prefix")
    Expect-Rc 0
    Expect-Out "basekit $version instalado"
    Expect-NoOut 'SetEnvironmentVariable'

    # 3. -Version <ref> appends #<ref> and wins over BASEKIT_VERSION.
    Run-Install $sh version $binAll @{ BASEKIT_VERSION = 'ignorada' } @('-Version', 'v1.2.0')
    Expect-Rc 0
    Expect-Npm @("$npmArgs $spec#v1.2.0", 'prefix -g')

    # 4. BASEKIT_VERSION, piped like `irm ... | iex`.
    Run-Install $sh env-iex $binAll @{ BASEKIT_VERSION = 'feat/rama_1.x' } -Mode Iex
    Expect-Rc 0
    Expect-Npm @("$npmArgs $spec#feat/rama_1.x", 'prefix -g')
    Expect-Out "basekit $version instalado"

    # 5. -Version through a scriptblock, the README's form for passing parameters.
    Run-Install $sh block $binAll -Arguments @('-Version', 'main') -Mode Block
    Expect-Rc 0
    Expect-Npm @("$npmArgs $spec#main", 'prefix -g')

    # 6. Invalid ref: usage error (exit 2 as a file) before npm runs.
    foreach ($ref in @('a b', 'x&calc', 'v1#2', 'x|y')) {
      Run-Install $sh bad-ref $binAll -Arguments @('-Version', $ref)
      $script:label = "$sh/bad-ref '$ref'"
      Expect-Rc 2
      Expect-Out "-Version '$ref' no es v"
      Expect-NoNpm
      Remove-Item -Recurse -Force -LiteralPath $script:caseDir
    }

    # 7. BASEKIT_SOURCE replaces the github: spec, validated like `basekit install --from`.
    Run-Install $sh source $binAll @{ BASEKIT_SOURCE = 'github:otra/basekit-fork' } @('-Version', 'v2')
    Expect-Rc 0
    Expect-Npm @("$npmArgs github:otra/basekit-fork#v2", 'prefix -g')
    foreach ($src in @('un fork', '-g', 'github:a/b&calc')) {
      Run-Install $sh bad-source $binAll @{ BASEKIT_SOURCE = $src }
      $script:label = "$sh/bad-source '$src'"
      Expect-Rc 2
      Expect-Out "BASEKIT_SOURCE '$src' no es v"
      Expect-NoNpm
      Remove-Item -Recurse -Force -LiteralPath $script:caseDir
    }

    # 8. Node missing or too old, npm missing: exit 1 pointing to nodejs.org, npm never runs.
    Run-Install $sh no-node $binNoNode
    Expect-Rc 1
    Expect-Out 'node. basekit necesita Node.js 20.12 o superior'
    Expect-Out 'https://nodejs.org'
    Expect-NoNpm
    foreach ($old in @('20.11.1', '18.20.4')) {
      Run-Install $sh old-node $binAll @{ FAKE_NODE_VERSION = $old }
      $script:label = "$sh/old-node $old"
      Expect-Rc 1
      Expect-Out "Node.js 20.12 o superior y tienes la $old"
      Expect-NoNpm
      Remove-Item -Recurse -Force -LiteralPath $script:caseDir
    }
    Run-Install $sh new-node $binAll @{ FAKE_NODE_VERSION = '20.12.0' }
    Expect-Rc 0
    Run-Install $sh no-npm $binNoNpm
    Expect-Rc 1
    Expect-Out 'npm (viene con Node.js)'

    # 9. npm fails: exit 1, npm's error and the retry command; EACCES adds the no-admin fix.
    Run-Install $sh npm-fail $binAll @{ FAKE_NPM_MODE = 'fail' }
    Expect-Rc 1
    Expect-Npm @("$npmArgs $spec")
    Expect-Out 'npm error git dep preparation failed'
    Expect-Out "ntalo con: npm install -g --install-links --no-audit --no-fund $spec"
    Expect-NoOut 'npm config set prefix'
    Run-Install $sh npm-eacces $binAll @{ FAKE_NPM_MODE = 'eacces' }
    Expect-Rc 1
    Expect-Out "ntalo con: npm install -g --install-links --no-audit --no-fund $spec"
    Expect-Out 'npm config set prefix "$env:APPDATA\npm"'
    Expect-Out 'nvm-windows'

    # 10. A failure under `irm ... | iex` in a non-interactive session fails the caller (exit 1)...
    Run-Install $sh iex-batch $binNoNode -Mode Iex
    Expect-Rc 1
    Expect-Out 'node. basekit necesita Node.js'
    Expect-NoNpm
    # ...and in an interactive session it prints the error, keeps the session alive and sets $LASTEXITCODE.
    Run-Install $sh iex-interactive $binAll @{ BASEKIT_SOURCE = 'un fork' } -Mode Iex -NoExit -After "Write-Output ('sesion viva ' + `$LASTEXITCODE); exit 0"
    Expect-Rc 0
    Expect-Out "BASEKIT_SOURCE 'un fork' no es v"
    Expect-Out 'sesion viva 2'
    Expect-NoNpm
  }
} finally {
  Remove-Item -Recurse -Force -LiteralPath $work -ErrorAction SilentlyContinue
}

if ($script:fails -ne 0) { Write-Host "test-install.ps1: $($script:fails) fallo(s)"; exit 1 }
Write-Host 'test-install.ps1: OK'
# Explicit success: some cases end with a child process that exits 1 on purpose, and hosts such as GitHub
# Actions' pwsh step exit with $LASTEXITCODE when it is set.
exit 0
