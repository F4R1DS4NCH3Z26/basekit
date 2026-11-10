# Installs the basekit CLI (Node) globally with npm, from its GitHub repository, on Windows (Windows PowerShell
# 5.1+ and PowerShell 7+). Runs exactly what `basekit install --global` runs.
#
#   irm https://raw.githubusercontent.com/F4R1DS4NCH3Z26/basekit/main/install.ps1 | iex
#   & ([scriptblock]::Create((irm https://raw.githubusercontent.com/F4R1DS4NCH3Z26/basekit/main/install.ps1))) -Version <ref>
#
# Environment:
#   BASEKIT_VERSION  same as -Version: a git ref (tag, branch or commit); default: the default branch
#   BASEKIT_SOURCE   package spec to install instead of github:F4R1DS4NCH3Z26/basekit (forks, tests); validated
#                    like `basekit install --from`
#
# Errors: run as a file (-File), the script exits 1, or 2 for usage errors. Under `irm | iex` (or a scriptblock)
# an `exit` would close the user's window, so it never exits: it prints the error and sets $LASTEXITCODE, and
# when the session is not interactive (powershell -Command, -EncodedCommand, -File, -NonInteractive or a bare
# command such as `powershell "irm ... | iex"`, without -NoExit) it throws the error instead, so
# `powershell -Command "irm ... | iex"` fails with exit code 1.
#
# The file is kept ASCII-only: Windows PowerShell 5.1 reads BOM-less scripts with the ANSI code page, so the
# Spanish accents in messages are written as [char] codes.
param(
  [string]$Version = $env:BASEKIT_VERSION
)

$basekitAsFile = $MyInvocation.MyCommand.CommandType -eq 'ExternalScript'

# New-BasekitError: an exception carrying the exit code the script uses when it runs as a file.
function New-BasekitError([string]$Message, [int]$Code) {
  $err = New-Object System.Exception $Message
  $err.Data['basekitExit'] = $Code
  return $err
}

# Invoke-BasekitNative runs a native command and returns its exit code and its stdout+stderr as text. Stderr is
# merged under ErrorActionPreference Continue: with Stop, Windows PowerShell 5.1 turns any stderr line into a
# terminating error.
function Invoke-BasekitNative([string]$Path, [string[]]$Arguments) {
  $ErrorActionPreference = 'Continue'
  $out = & $Path @Arguments 2>&1 | ForEach-Object { "$_" } | Out-String
  return [pscustomobject]@{ Code = $LASTEXITCODE; Output = $out.Trim() }
}

# Test-BasekitBatchSession: true when this PowerShell runs one command or script and then ends, rather than
# leaving an interactive prompt. It reads the host's own command line left to right, the way powershell.exe
# (5.1) and pwsh parse it, and the first argument that decides wins:
#   -NoExit                           interactive (after the command it would be part of the command)
#   -NonInteractive                   batch
#   -Command, -EncodedCommand, -File  batch; everything after them belongs to the command or the script
#   a bare argument (no - or /)       batch: powershell.exe runs it as -Command and pwsh as -File, so
#                                     `powershell "irm ... | iex"` runs that one command and exits
# Parameters that take a value are skipped together with it, so `-ExecutionPolicy Bypass` does not make Bypass a
# bare argument. The hosts accept any prefix of a parameter name at least as long as its shortest form (-noe,
# -c, -ex, ...). The en dash, em dash and horizontal bar count as a dash, as they do for the hosts.
function Test-BasekitBatchSession {
  # Parameters that take a value, in powershell.exe and pwsh: full name = shortest accepted form. They are
  # matched before -Command and -EncodedCommand, which -config, -ex, -ep, -ea and -encodeda would otherwise look
  # like. pwsh's -Version takes no value, but it prints the version and exits, so skipping one more is harmless.
  $valued = @{
    'configurationname' = 'config'; 'configurationfile' = 'config'; 'custompipename' = 'cus'; 'windowstyle' = 'w'
    'executionpolicy' = 'ex'; 'ep' = 'ep'; 'encodedarguments' = 'encodeda'; 'ea' = 'ea'; 'settingsfile' = 'settings'
    'workingdirectory' = 'wo'; 'wd' = 'wd'; 'outputformat' = 'o'; 'of' = 'of'; 'inputformat' = 'in'; 'if' = 'if'
    'version' = 'v'; 'psconsolefile' = 'psc'
  }
  $dashes = '-/' + [char]0x2013 + [char]0x2014 + [char]0x2015
  $argv = @([Environment]::GetCommandLineArgs() | Select-Object -Skip 1)
  for ($k = 0; $k -lt $argv.Count; $k++) {
    # The hosts trim each argument and skip empty ones.
    $arg = "$($argv[$k])".Trim()
    if (-not $arg) { continue }
    if ($dashes.IndexOf($arg[0]) -lt 0) {
      # The console host runs a bare argument; the ISE opens it as a file to edit and stays interactive.
      return ($Host.Name -eq 'ConsoleHost')
    }
    if ($arg.Substring(1) -notmatch '^([A-Za-z]+)$') { continue }
    $name = $Matches[1].ToLowerInvariant()
    # -noe is the hosts' shortest -NoExit. For -NonInteractive they need -noni; -non is accepted here too
    # because a host never gives an interactive prompt for it (powershell.exe runs an unknown parameter as the
    # start of the command, pwsh exits with an error).
    if ($name.Length -ge 3 -and 'noexit'.StartsWith($name)) { return $false }
    if ($name.Length -ge 3 -and 'noninteractive'.StartsWith($name)) { return $true }
    $takesValue = $false
    foreach ($p in $valued.GetEnumerator()) {
      if ($name.Length -ge $p.Value.Length -and $p.Key.StartsWith($name)) { $takesValue = $true; break }
    }
    if ($takesValue) { $k++; continue }
    # -c, -f and -e (or -ec) are the shortest -Command, -File and -EncodedCommand.
    if ('command'.StartsWith($name) -or 'encodedcommand'.StartsWith($name) -or $name -eq 'ec' -or 'file'.StartsWith($name)) { return $true }
  }
  return $false
}

function Install-Basekit {
  param([string]$Version)
  # Set here, not at the top: under `irm | iex` top-level variables would leak into the user's session.
  $ErrorActionPreference = 'Stop'
  $a = [char]0xE1; $e = [char]0xE9; $i = [char]0xED; $o = [char]0xF3; $u = [char]0xFA

  $repoSpec = 'github:F4R1DS4NCH3Z26/basekit'
  # The `engines` floor of package.json.
  $minMajor = 20; $minMinor = 12

  if ($Version -and $Version -cnotmatch '^[A-Za-z0-9._/-]+\z') {
    throw (New-BasekitError "-Version '$Version' no es v${a}lida: usa una etiqueta, rama o commit (solo letras, n${u}meros y . _ / -)" 2)
  }
  # The rule of `basekit install --from` (src/commands/install/options.ts): no spaces or shell characters, and
  # never something npm would read as an option. \z, not $: .NET's $ also matches before a final newline.
  $source = if ($env:BASEKIT_SOURCE) { $env:BASEKIT_SOURCE } else { $repoSpec }
  if ($source -cnotmatch '^[A-Za-z0-9_@./~][A-Za-z0-9_@./:#+~\\-]*\z') {
    throw (New-BasekitError "BASEKIT_SOURCE '$source' no es v${a}lido: usa un paquete, una URL o una ruta sin espacios" 2)
  }
  $spec = $source
  if ($Version) {
    if ($source.Contains('#')) {
      throw (New-BasekitError "BASEKIT_SOURCE '$source' ya indica una versi${o}n (#...): no uses tambi${e}n -Version ni BASEKIT_VERSION" 2)
    }
    $spec = "$source#$Version"
  }

  $node = Get-Command node -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $node) {
    throw "no se encontr$o node. basekit necesita Node.js $minMajor.$minMinor o superior: inst${a}lalo desde https://nodejs.org (o con nvm-windows o fnm) y vuelve a ejecutar el instalador."
  }
  $nodeVersion = (Invoke-BasekitNative $node.Source @('-p', 'process.versions.node')).Output
  if ($nodeVersion -notmatch '^(\d+)\.(\d+)') {
    throw "no se pudo leer la versi${o}n de node (node -p process.versions.node dio '$nodeVersion')"
  }
  $major = [int]$Matches[1]; $minor = [int]$Matches[2]
  if ($major -lt $minMajor -or ($major -eq $minMajor -and $minor -lt $minMinor)) {
    throw "basekit necesita Node.js $minMajor.$minMinor o superior y tienes la $nodeVersion. Actual${i}zalo desde https://nodejs.org (o con nvm-windows o fnm) y vuelve a ejecutar el instalador."
  }
  $npm = Get-Command npm.cmd -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $npm) {
    throw "no se encontr$o npm (viene con Node.js). Reinstala Node.js desde https://nodejs.org (o con nvm-windows o fnm)."
  }

  # Exactly what `basekit install --global` runs (src/commands/install/install.ts).
  Write-Host "Instalando basekit con npm desde $spec (puede tardar un minuto)..."
  $r = Invoke-BasekitNative $npm.Source @('install', '-g', '--install-links', '--no-audit', '--no-fund', $spec)
  if ($r.Code -ne 0) {
    if ($r.Output) { Write-Host $r.Output }
    $msg = "No se pudo instalar. Reint${e}ntalo con: npm install -g --install-links --no-audit --no-fund $spec"
    if ($r.Output -match 'EACCES|EPERM') {
      $msg += "`n`nnpm no tiene permiso para escribir en su carpeta global. No uses una terminal de administrador para esto: " +
        "haz que npm instale en una carpeta tuya`n  npm config set prefix `"`$env:APPDATA\npm`"`n" +
        "y agrega esa carpeta a tu PATH de usuario, o instala Node.js con nvm-windows (https://github.com/coreybutler/nvm-windows) " +
        "o fnm (https://github.com/Schniz/fnm). Luego vuelve a ejecutar el instalador."
    }
    throw $msg
  }
  if ($r.Output) { Write-Host $r.Output }

  # On Windows npm puts global commands in the prefix itself, as <name>.cmd.
  $r = Invoke-BasekitNative $npm.Source @('prefix', '-g')
  $prefix = $r.Output.TrimEnd('\')
  if ($r.Code -ne 0 -or -not $prefix) { throw "npm termin$o, pero no se pudo averiguar su carpeta global (npm prefix -g)" }
  $bin = Join-Path $prefix 'basekit.cmd'
  if (-not (Test-Path -LiteralPath $bin -PathType Leaf)) { throw "npm termin$o, pero no se encuentra basekit en $prefix" }
  $r = Invoke-BasekitNative $bin @('--version')
  if ($r.Code -ne 0) { throw "basekit se instal$o en $bin pero no se pudo ejecutar: $($r.Output)" }
  Write-Host "basekit $($r.Output) instalado en $bin"

  $inPath = @($env:Path -split ';' | Where-Object { $_ } | ForEach-Object { [Environment]::ExpandEnvironmentVariables($_).TrimEnd('\') }) -contains $prefix
  if (-not $inPath) {
    $quoted = $prefix -replace "'", "''"
    Write-Host ''
    Write-Host "$prefix no est$a en tu PATH. Agr${e}galo a tu PATH de usuario con esta l${i}nea y abre una terminal nueva:"
    Write-Host "  [Environment]::SetEnvironmentVariable('Path', [Environment]::GetEnvironmentVariable('Path', 'User') + ';$quoted', 'User')"
  }
  Write-Host ''
  Write-Host 'Siguiente: basekit init <carpeta-del-proyecto>'
}

try {
  Install-Basekit -Version $Version
} catch {
  $basekitCode = 1
  if ($_.Exception.Data.Contains('basekitExit')) { $basekitCode = [int]$_.Exception.Data['basekitExit'] }
  $basekitMessage = "basekit: $($_.Exception.Message)"
  if ($basekitAsFile) {
    Write-Host $basekitMessage -ForegroundColor Red
    exit $basekitCode
  }
  $global:LASTEXITCODE = $basekitCode
  if (Test-BasekitBatchSession) { throw $basekitMessage }
  Write-Host $basekitMessage -ForegroundColor Red
}
