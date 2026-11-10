#!/bin/sh
# Offline tests for install.sh: fake `node` and `npm` on a sandboxed PATH (no network, no real npm, the user's
# global prefix and PATH are never touched). The fake npm logs its arguments, simulates success, EACCES and
# other failures, and on success creates a fake global `basekit` so the installer can run `basekit --version`.
# Usage: sh scripts/test-install.sh   (INSTALL_SH=/bin/dash runs install.sh under another POSIX shell)
set -eu

root=$(cd "$(dirname "$0")/.." && pwd)
installer="$root/install.sh"
shell=$(command -v "${INSTALL_SH:-sh}") || { echo "FAIL no existe el shell ${INSTALL_SH:-sh}"; exit 1; }
spec="github:F4R1DS4NCH3Z26/basekit"
npm_args="install -g --install-links --no-audit --no-fund"
version=0.1.0-test
work=$(mktemp -d 2>/dev/null || mktemp -d -t basekit-test)
trap 'rm -rf "$work"' EXIT
trap 'exit 1' INT TERM
fails=0

echo "== install.sh con $shell, node y npm falsos en $work"

# sys: only the system tools the installer and the shims need, so a real node or npm never leaks in.
mkdir -p "$work/sys"
for tool in uname mkdir cat chmod; do
  ln -s "$(command -v "$tool")" "$work/sys/$tool"
done

# Fake tools, one per file; bin-* directories pick which ones are "installed".
mkdir -p "$work/fake"
cat > "$work/fake/node" <<'EOF'
#!/bin/sh
# Fake node: answers `node -p process.versions.node` with $FAKE_NODE_VERSION.
printf '%s\n' "$FAKE_NODE_VERSION"
EOF
cat > "$work/fake/npm" <<'EOF'
#!/bin/sh
# Fake npm: logs its arguments; `prefix -g` prints $FAKE_NPM_PREFIX; `install` follows $FAKE_NPM_MODE.
printf '%s\n' "$*" >> "$NPM_LOG"
case "$1" in
  prefix) printf '%s\n' "$FAKE_NPM_PREFIX"; exit 0 ;;
  install)
    case "${FAKE_NPM_MODE:-ok}" in
      eacces)
        echo "npm error code EACCES" >&2
        echo "npm error Error: EACCES: permission denied, mkdir '/usr/local/lib/node_modules/basekit'" >&2
        exit 243 ;;
      fail)
        echo "npm error code 128" >&2
        echo "npm error git dep preparation failed" >&2
        exit 1 ;;
    esac
    # npm puts global bins in <prefix>/bin on Unix and in <prefix> itself on Windows.
    bindir="$FAKE_NPM_PREFIX/bin"
    if [ "${FAKE_NPM_WINDOWS:-}" = 1 ]; then bindir=$FAKE_NPM_PREFIX; fi
    mkdir -p "$bindir"
    printf '#!/bin/sh\necho %s\n' "$FAKE_BASEKIT_VERSION" > "$bindir/basekit"
    chmod 755 "$bindir/basekit"
    echo "added 3 packages in 2s" ;;
esac
EOF
cat > "$work/fake/sudo" <<'EOF'
#!/bin/sh
# Fake sudo: the installer must never call it.
printf '%s\n' "$*" >> "$SUDO_LOG"
exit 1
EOF
cat > "$work/fake/uname-mingw" <<'EOF'
#!/bin/sh
# Fake uname for Git Bash on Windows.
echo MINGW64_NT-10.0-26100
EOF
cat > "$work/fake/cygpath" <<'EOF'
#!/bin/sh
# Fake cygpath -u <path>: the tests already use POSIX paths.
printf '%s\n' "$2"
EOF
chmod 755 "$work/fake/"*

# bin_dir <name> <tools…>: a directory holding the given fake tools.
bin_dir() {
  d="$work/$1"; shift
  mkdir -p "$d"
  for t in "$@"; do ln -s "$work/fake/$t" "$d/${t%-mingw}"; done
}
bin_dir bin-all node npm sudo
bin_dir bin-no-node npm sudo
bin_dir bin-no-npm node sudo
bin_dir bin-gitbash node npm sudo uname-mingw cygpath

# run_install <label> <bin dir> [env assignments…] <shell> <args…>: runs install.sh with a clean HOME, the fake
# npm prefix in the case directory and PATH=<bin dir>:sys (plus $extra_path, if set). Leaves the exit code in
# $rc, stdout+stderr in $out, and the npm and sudo logs in $case_dir.
run_install() {
  label=$1 bins="$work/$2"; shift 2
  case_dir="$work/case-$label"
  prefix="$case_dir/prefix"
  mkdir -p "$case_dir/home"
  vars="HOME=$case_dir/home NPM_LOG=$case_dir/npm.log SUDO_LOG=$case_dir/sudo.log FAKE_NPM_PREFIX=$prefix"
  set -f
  # shellcheck disable=SC2086 # $vars is a word list on purpose (paths come from mktemp, without spaces).
  set -- $vars FAKE_NODE_VERSION=22.11.0 FAKE_BASEKIT_VERSION="$version" PATH="${extra_path:+$extra_path:}$bins:$work/sys" "$@"
  set +f
  rc=0
  out=$(env "$@" 2>&1 </dev/null) || rc=$?
}

pass() { echo "ok   $label: $1"; }
fail() { echo "FAIL $label: $1"; printf '%s\n' "$out" | sed 's/^/     | /'; fails=$((fails + 1)); }
expect_rc() { if [ "$rc" -eq "$1" ]; then pass "exit $1"; else fail "exit $rc, se esperaba $1"; fi; }
expect_out() { case "$out" in *"$1"*) pass "dice '$1'" ;; *) fail "la salida no contiene '$1'" ;; esac; }
expect_no_out() { case "$out" in *"$1"*) fail "la salida contiene '$1'" ;; *) pass "no dice '$1'" ;; esac; }
# expect_npm <line>…: npm ran exactly these commands, in order.
expect_npm() {
  want=$(printf '%s\n' "$@")
  got=$(cat "$case_dir/npm.log" 2>/dev/null || true)
  if [ "$got" = "$want" ]; then pass "npm recibió: $(printf '%s | ' "$@")"
  else fail "npm recibió '$got', se esperaba '$want'"; fi
}
expect_no_npm() { if [ -e "$case_dir/npm.log" ]; then fail "npm no debía correr: $(cat "$case_dir/npm.log")"; else pass "npm no corrió"; fi; }
expect_no_sudo() { if [ -e "$case_dir/sudo.log" ]; then fail "se llamó a sudo"; else pass "sin sudo"; fi; }

# 1. Default: the exact command of `basekit install --global`, then `basekit --version` from npm's global bin,
#    and the PATH hint because that bin is not in PATH.
run_install default bin-all "$shell" "$installer"
expect_rc 0
expect_npm "$npm_args $spec" "prefix -g"
expect_out "basekit $version instalado en $prefix/bin/basekit"
expect_out "$prefix/bin no está en tu PATH"
expect_out "export PATH=\"$prefix/bin:\$PATH\""
expect_out "Siguiente: basekit init <carpeta-del-proyecto>"
expect_no_sudo

# 2. npm's global bin already in PATH: no hint.
extra_path="$work/case-in-path/prefix/bin"
run_install in-path bin-all "$shell" "$installer"
extra_path=""
expect_rc 0
expect_out "basekit $version instalado en $prefix/bin/basekit"
expect_no_out "export PATH="

# 3. --version <ref> appends #<ref>; --version=<ref> too; it wins over BASEKIT_VERSION.
run_install version bin-all BASEKIT_VERSION=ignorada "$shell" "$installer" --version v1.2.0
expect_rc 0
expect_npm "$npm_args $spec#v1.2.0" "prefix -g"
run_install version-eq bin-all "$shell" "$installer" --version=feat/rama_1.x
expect_rc 0
expect_npm "$npm_args $spec#feat/rama_1.x" "prefix -g"

# 4. BASEKIT_VERSION, piped like `curl … | sh -s -- …`.
run_install env-version bin-all BASEKIT_VERSION=0123abc "$shell" -c "'$shell' -s < '$installer'"
expect_rc 0
expect_npm "$npm_args $spec#0123abc" "prefix -g"
run_install piped bin-all "$shell" -c "'$shell' -s -- --version main < '$installer'"
expect_rc 0
expect_npm "$npm_args $spec#main" "prefix -g"
expect_out "basekit $version instalado"

# 5. Invalid ref: usage error (exit 2) before npm runs.
# shellcheck disable=SC2016 # '$(id)' must stay literal: it is the input under test.
for ref in "a b" 'x;rm' '$(id)' 'v1#2' ''; do
  run_install bad-ref bin-all "$shell" "$installer" --version "$ref"
  label="bad-ref '$ref'"
  if [ -z "$ref" ]; then
    expect_rc 2; expect_out "falta el valor de --version"
  else
    expect_rc 2; expect_out "--version '$ref' no es válida"
  fi
  expect_no_npm
  rm -rf "$work/case-bad-ref"
done
run_install bad-env-ref bin-all BASEKIT_VERSION='v1 && x' "$shell" "$installer"
expect_rc 2
expect_out "no es válida"
expect_no_npm

# 6. BASEKIT_SOURCE replaces the github: spec (forks, tests), validated like `basekit install --from`.
run_install source bin-all BASEKIT_SOURCE=github:otra/basekit-fork "$shell" "$installer" --version v2
expect_rc 0
expect_npm "$npm_args github:otra/basekit-fork#v2" "prefix -g"
run_install source-tgz bin-all BASEKIT_SOURCE=./basekit-0.1.0.tgz "$shell" "$installer"
expect_rc 0
expect_npm "$npm_args ./basekit-0.1.0.tgz" "prefix -g"
for src in "un fork" "-g" 'github:a/b;id' 'github:a/b|x'; do
  run_install bad-source bin-all BASEKIT_SOURCE="$src" "$shell" "$installer"
  label="bad-source '$src'"
  expect_rc 2
  expect_out "BASEKIT_SOURCE '$src' no es válido"
  expect_no_npm
  rm -rf "$work/case-bad-source"
done

# 7. Unknown option: usage error.
run_install bad-flag bin-all "$shell" "$installer" --nope
expect_rc 2
expect_out "opción desconocida: --nope"
expect_no_npm

# 8. Node missing, too old, or unreadable: exit 1 pointing to nodejs.org, npm never runs.
run_install no-node bin-no-node "$shell" "$installer"
expect_rc 1
expect_out "no se encontró node"
expect_out "https://nodejs.org"
expect_no_npm
for old in 20.11.1 18.20.4 8.0.0; do
  run_install old-node bin-all FAKE_NODE_VERSION="$old" "$shell" "$installer"
  label="old-node $old"
  expect_rc 1
  expect_out "Node.js 20.12 o superior y tienes la $old"
  expect_out "https://nodejs.org"
  expect_no_npm
  rm -rf "$work/case-old-node"
done
run_install odd-node bin-all FAKE_NODE_VERSION=banana "$shell" "$installer"
expect_rc 1
expect_out "no se pudo leer la versión de node"
expect_no_npm
for ok in 20.12.0 21.0.0 24.21.0 100.1.2; do
  run_install new-node bin-all FAKE_NODE_VERSION="$ok" "$shell" "$installer"
  label="new-node $ok"
  expect_rc 0
  rm -rf "$work/case-new-node"
done

# 9. npm missing.
run_install no-npm bin-no-npm "$shell" "$installer"
expect_rc 1
expect_out "no se encontró npm"
expect_out "https://nodejs.org"

# 10. npm fails: exit 1, npm's error, the retry command, and no EACCES advice.
run_install npm-fail bin-all FAKE_NPM_MODE=fail "$shell" "$installer" --version v1
expect_rc 1
expect_npm "$npm_args $spec#v1"
expect_out "npm error git dep preparation failed"
expect_out "Reinténtalo con: npm install -g --install-links --no-audit --no-fund $spec#v1"
expect_no_out "npm config set prefix"
expect_no_out "instalado en"
expect_no_sudo

# 11. npm fails with EACCES: also the no-sudo fix.
run_install npm-eacces bin-all FAKE_NPM_MODE=eacces "$shell" "$installer"
expect_rc 1
expect_npm "$npm_args $spec"
expect_out "Reinténtalo con: npm install -g --install-links --no-audit --no-fund $spec"
expect_out "No uses sudo"
expect_out "npm config set prefix ~/.local"
expect_out "export PATH=\"\$HOME/.local/bin:\$PATH\""
expect_out "nvm"
expect_no_sudo

# 12. Git Bash / MSYS2 / Cygwin: npm's global bin is the prefix itself (cygpath converts it).
run_install gitbash bin-gitbash FAKE_NPM_WINDOWS=1 "$shell" "$installer"
expect_rc 0
expect_out "basekit $version instalado en $prefix/basekit"
expect_out "export PATH=\"$prefix:\$PATH\""

# 13. A truncated download (`curl | sh` cut at any line) runs nothing. Control first: the whole file, run the
#     same way, does reach npm, so the loop below cannot pass because nothing runs at all.
label=truncated
lines=0
if [ -f "$installer" ]; then lines=$(wc -l < "$installer" | tr -d ' '); fi
head -n "$lines" "$installer" > "$work/truncated.sh" 2>/dev/null || true
run_install truncated bin-all "$shell" -c "'$shell' -s < '$work/truncated.sh'"
label="truncated (control, archivo completo)"
expect_rc 0
expect_npm "$npm_args $spec" "prefix -g"
n=1 ran=""
while [ "$n" -lt "$lines" ]; do
  head -n "$n" "$installer" > "$work/truncated.sh"
  rm -rf "$work/case-truncated"
  run_install truncated bin-all "$shell" -c "'$shell' -s < '$work/truncated.sh'"
  if [ -e "$case_dir/npm.log" ]; then ran="$ran $n"; fi
  n=$((n + 1))
done
# Cuts inside the last line, byte by byte (e.g. right after `main`, which would run main without its arguments).
if [ "$lines" -ge 10 ]; then
  body=$(head -n "$((lines - 1))" "$installer" | wc -c | tr -d ' ')
  last=$(tail -n 1 "$installer" | wc -c | tr -d ' ')
  k=1
  while [ "$k" -lt "$((last - 1))" ]; do  # last - 1: the whole line without its newline is complete
    head -c "$((body + k))" "$installer" > "$work/truncated.sh"
    rm -rf "$work/case-truncated"
    run_install truncated bin-all "$shell" -c "'$shell' -s < '$work/truncated.sh'"
    if [ -e "$case_dir/npm.log" ]; then ran="$ran last+$k"; fi
    k=$((k + 1))
  done
fi
label=truncated out=""
if [ "$lines" -lt 10 ]; then fail "install.sh no existe o está vacío"
elif [ -n "$ran" ]; then fail "npm corrió con install.sh cortado en las líneas:$ran"
else pass "npm no corrió con install.sh cortado en ninguna de sus $((lines - 1)) primeras líneas"; fi

if [ "$fails" -ne 0 ]; then echo "test-install: $fails fallo(s)"; exit 1; fi
echo "test-install: OK"
