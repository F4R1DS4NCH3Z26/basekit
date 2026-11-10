#!/bin/sh
# Installs the basekit CLI (Node) globally with npm, from its GitHub repository (macOS, Linux, WSL, Git Bash,
# MSYS2, Cygwin). Runs exactly what `basekit install --global` runs.
#
#   curl -fsSL https://raw.githubusercontent.com/F4R1DS4NCH3Z26/basekit/main/install.sh | sh
#   curl -fsSL https://raw.githubusercontent.com/F4R1DS4NCH3Z26/basekit/main/install.sh | sh -s -- --version <ref>
#
# Environment:
#   BASEKIT_VERSION  same as --version: a git ref (tag, branch or commit); default: the default branch
#   BASEKIT_SOURCE   package spec to install instead of github:F4R1DS4NCH3Z26/basekit (forks, tests); validated
#                    like `basekit install --from`
#
# Every step lives in a function and the last line calls main: a download cut short runs nothing.
set -eu

BASEKIT_REPO_SPEC="github:F4R1DS4NCH3Z26/basekit"
# The `engines` floor of package.json.
NODE_MIN_MAJOR=20
NODE_MIN_MINOR=12

say() { printf '%s\n' "$*"; }
die() { printf 'basekit: %s\n' "$*" >&2; exit 1; }
usage_error() { printf 'basekit: %s\n' "$*" >&2; exit 2; }

usage() {
  cat <<'EOF'
Instala basekit (el CLI de Node) globalmente con npm, desde su repositorio de GitHub.

Uso: install.sh [--version <ref>]

  --version  etiqueta, rama o commit a instalar (por defecto la rama principal; también BASEKIT_VERSION)

BASEKIT_SOURCE instala otro origen (un fork o un .tgz) en lugar de github:F4R1DS4NCH3Z26/basekit.
EOF
}

# valid_ref <ref>: a git ref made of letters, digits and . _ / - only.
valid_ref() {
  case "$1" in
    '' | *[!A-Za-z0-9._/-]*) return 1 ;;
  esac
}

# valid_spec <spec>: the rule of `basekit install --from` (src/commands/install/options.ts): no spaces or shell
# characters, and never something npm would read as an option.
valid_spec() {
  case "$1" in
    '' | [!A-Za-z0-9_@./~]* | ?*[!A-Za-z0-9_@./:#+~\\-]*) return 1 ;;
  esac
}

# check_node: node >= NODE_MIN_MAJOR.NODE_MIN_MINOR and npm, before anything runs.
check_node() {
  command -v node >/dev/null 2>&1 ||
    die "no se encontró node. basekit necesita Node.js $NODE_MIN_MAJOR.$NODE_MIN_MINOR o superior: instálalo desde https://nodejs.org (o con nvm o fnm) y vuelve a ejecutar el instalador."
  node_version=$(node -p process.versions.node </dev/null 2>/dev/null) || node_version=""
  node_version=${node_version%"$(printf '\r')"}
  major=${node_version%%.*}
  rest=${node_version#*.}
  minor=${rest%%.*}
  case "$major.$minor" in
    *[!0-9.]* | .* | *.) die "no se pudo leer la versión de node (node -p process.versions.node dio '$node_version')" ;;
  esac
  if [ "$major" -lt "$NODE_MIN_MAJOR" ] || { [ "$major" -eq "$NODE_MIN_MAJOR" ] && [ "$minor" -lt "$NODE_MIN_MINOR" ]; }; then
    die "basekit necesita Node.js $NODE_MIN_MAJOR.$NODE_MIN_MINOR o superior y tienes la $node_version. Actualízalo desde https://nodejs.org (o con nvm o fnm) y vuelve a ejecutar el instalador."
  fi
  command -v npm >/dev/null 2>&1 ||
    die "no se encontró npm (viene con Node.js). Reinstala Node.js desde https://nodejs.org (o con nvm o fnm)."
}

# npm_bin_dir: where npm puts global commands: <prefix>/bin, or <prefix> itself on Windows.
npm_bin_dir() {
  prefix=$(npm prefix -g </dev/null 2>/dev/null) || return 1
  prefix=${prefix%"$(printf '\r')"}
  [ -n "$prefix" ] || return 1
  case "$(uname -s 2>/dev/null || true)" in
    MINGW* | MSYS* | CYGWIN*)
      if command -v cygpath >/dev/null 2>&1; then prefix=$(cygpath -u "$prefix"); fi
      printf '%s\n' "$prefix"
      ;;
    *) printf '%s\n' "${prefix%/}/bin" ;;
  esac
}

main() {
  ref="${BASEKIT_VERSION:-}"
  while [ $# -gt 0 ]; do
    case "$1" in
      --version)
        { [ $# -ge 2 ] && [ -n "$2" ]; } || usage_error "falta el valor de --version"
        ref=$2; shift 2 ;;
      --version=*)
        ref=${1#*=}; shift
        [ -n "$ref" ] || usage_error "falta el valor de --version" ;;
      -h | --help) usage; exit 0 ;;
      *) usage_error "opción desconocida: $1 (usa --help)" ;;
    esac
  done
  if [ -n "$ref" ] && ! valid_ref "$ref"; then
    usage_error "--version '$ref' no es válida: usa una etiqueta, rama o commit (solo letras, números y . _ / -)"
  fi

  source="${BASEKIT_SOURCE:-$BASEKIT_REPO_SPEC}"
  valid_spec "$source" ||
    usage_error "BASEKIT_SOURCE '$source' no es válido: usa un paquete, una URL o una ruta sin espacios"
  spec=$source
  if [ -n "$ref" ]; then
    case "$source" in
      *'#'*) usage_error "BASEKIT_SOURCE '$source' ya indica una versión (#…): no uses también --version ni BASEKIT_VERSION" ;;
    esac
    spec="$source#$ref"
  fi

  check_node

  # Exactly what `basekit install --global` runs (src/commands/install/install.ts). stdin is /dev/null so npm
  # never reads the rest of a piped script; git still asks for credentials through the terminal.
  say "Instalando basekit con npm desde $spec (puede tardar un minuto)..."
  rc=0
  out=$(npm install -g --install-links --no-audit --no-fund "$spec" </dev/null 2>&1) || rc=$?
  if [ "$rc" -ne 0 ]; then
    if [ -n "$out" ]; then printf '%s\n' "$out" >&2; fi
    printf 'basekit: No se pudo instalar. Reinténtalo con: npm install -g --install-links --no-audit --no-fund %s\n' "$spec" >&2
    case "$out" in
      *EACCES*)
        cat >&2 <<'EOF'

npm no tiene permiso para escribir en su carpeta global. No uses sudo: haz que npm instale en una carpeta tuya
  npm config set prefix ~/.local
y agrega esta línea a tu ~/.profile, ~/.bashrc o ~/.zshrc (abre una terminal nueva después):
  export PATH="$HOME/.local/bin:$PATH"
O instala Node.js con nvm (https://github.com/nvm-sh/nvm) o fnm (https://github.com/Schniz/fnm), que ya usan una
carpeta tuya. Luego vuelve a ejecutar el instalador.
EOF
        ;;
    esac
    exit 1
  fi
  if [ -n "$out" ]; then say "$out"; fi

  bindir=$(npm_bin_dir) || die "npm terminó, pero no se pudo averiguar su carpeta global (npm prefix -g)"
  bin="$bindir/basekit"
  [ -x "$bin" ] || die "npm terminó, pero no se encuentra basekit en $bindir"
  installed=$("$bin" --version </dev/null 2>&1) || die "basekit se instaló en $bin pero no se pudo ejecutar: $installed"
  say "basekit $installed instalado en $bin"

  case ":$PATH:" in
    *":$bindir:"* | *":$bindir/:"*) ;;
    *)
      say ""
      say "$bindir no está en tu PATH. Agrega esta línea a tu ~/.profile, ~/.bashrc o ~/.zshrc y abre una terminal nueva:"
      say "  export PATH=\"$bindir:\$PATH\""
      ;;
  esac
  say ""
  say "Siguiente: basekit init <carpeta-del-proyecto>"
}

main "$@"
