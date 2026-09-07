#!/usr/bin/env bash
# prereqs.sh — install/verify the system baseline install.sh depends on.
#
#   bash scripts/install/prereqs.sh           # install what is missing
#   bash scripts/install/prereqs.sh --check   # verify only, change nothing
#
# Exit 0 only when every hard dependency is actually present. This is the single
# implementation; system-deps.sh calls it rather than keeping its own per-OS
# branches (which silently no-opped on macOS).
#
# For a machine with NOTHING on it -- no Homebrew, no Node -- use bootstrap.sh
# at the repo root instead; it installs Homebrew first and then calls this.
#
# NOT `set -u`: stock macOS /bin/bash is 3.2, where empty "$@"/${#arr[@]} raise
# "unbound variable" under nounset. Expansions below are guarded explicitly.
set -o pipefail

CHECK_ONLY=false
[ "${1:-}" = "--check" ] && CHECK_ONLY=true

if ! declare -f ok >/dev/null 2>&1; then
  _G='\033[0;32m'; _Y='\033[1;33m'; _R='\033[0;31m'; _N='\033[0m'
  ok()   { echo -e "${_G}[+]${_N} $*"; }
  warn() { echo -e "${_Y}[!]${_N} $*"; }
  error() { echo -e "${_R}[x]${_N} $*"; }
fi
declare -f info >/dev/null 2>&1 || info() { echo -e "\033[0;32m[+]\033[0m $*"; }
have() { command -v "$1" >/dev/null 2>&1; }

case "$(uname -s)" in
  Darwin) PREREQ_OS=macos ;;
  Linux)  PREREQ_OS=linux ;;
  *) error "unsupported OS: $(uname -s)"; exit 1 ;;
esac

if [ "$(id -u)" -eq 0 ]; then SUDO=""
elif have sudo; then SUDO="sudo"
else SUDO=""; fi

node_ok() { have node && [ "$(node -e 'console.log(process.versions.node.split(".")[0])' 2>/dev/null || echo 0)" -ge 22 ]; }

# ---------- macOS ----------
if [ "$PREREQ_OS" = macos ]; then
  if xcode-select -p >/dev/null 2>&1; then
    ok "Xcode Command Line Tools: $(xcode-select -p)"
  else
    error "Xcode Command Line Tools MISSING — better-sqlite3 cannot compile without them"
    $CHECK_ONLY || { warn "run: xcode-select --install   (or use bootstrap.sh)"; }
  fi

  if ! have brew; then
    for c in /opt/homebrew/bin/brew /usr/local/bin/brew; do
      [ -x "$c" ] && eval "$("$c" shellenv)" && break
    done
  fi
  if have brew; then
    ok "homebrew: $(brew --version | head -1)"
  else
    error "Homebrew MISSING — it is how every other macOS dependency installs."
    error "Use bootstrap.sh (installs Homebrew for you) or install it manually first."
    exit 1
  fi

  if node_ok; then
    ok "node $(node -v)"
  elif $CHECK_ONLY; then
    error "node 22+ MISSING (found: $(node -v 2>/dev/null || echo none))"
  else
    brew install node@22 && brew link --overwrite --force node@22
    node_ok && ok "node $(node -v)" || error "node 22+ still unavailable after install"
  fi

  # Report on the BINARY, never on the package manager's exit code: a formula
  # can install "successfully" and leave nothing on PATH (keg-only, bad link).
  FORMULAE="python@3.12 git sqlite jq nats-server"
  [ "${OPENCLAW_SKIP_LLM:-0}" = "1" ] || FORMULAE="$FORMULAE ollama"
  for f in $FORMULAE; do
    bin="$f"
    case "$f" in python@3.12) bin=python3 ;; sqlite) bin=sqlite3 ;; esac
    if have "$bin"; then
      ok "$bin present"
    elif $CHECK_ONLY; then
      error "$bin MISSING"
    else
      brew install "$f"
      have "$bin" && ok "$f installed ($bin on PATH)" || error "$f: $bin still not on PATH"
    fi
  done

  # install.sh derives --cluster-bind from `tailscale ip -4`.
  if have tailscale; then
    ok "tailscale present"
  elif $CHECK_ONLY; then
    error "tailscale MISSING (mesh clustering will not work)"
  else
    brew install --cask tailscale-app </dev/null
    # The cask puts the CLI inside the app bundle, not on PATH.
    TS_CLI="/Applications/Tailscale.app/Contents/MacOS/Tailscale"
    [ -x "$TS_CLI" ] && ln -sf "$TS_CLI" "$(brew --prefix)/bin/tailscale" 2>/dev/null
    have tailscale && ok "tailscale installed" || error "tailscale CLI still not on PATH"
  fi

# ---------- Debian / Ubuntu ----------
else
  have apt-get || { error "only Debian/Ubuntu apt is supported on Linux"; exit 1; }

  if ! $CHECK_ONLY; then
    # Unconditional. The old code refreshed lists only inside its node-missing
    # branch, so a box already carrying Node 22 installed against stale lists
    # and died mid-run under `set -e`.
    $SUDO apt-get update -y || { error "apt-get update failed"; exit 1; }
    $SUDO apt-get install -y \
      curl git sqlite3 build-essential jq python3 python3-pip ca-certificates gnupg \
      || error "apt baseline install failed"
  fi

  for bin in git sqlite3 build-essential jq python3 curl; do
    probe="$bin"; [ "$bin" = build-essential ] && probe=cc
    have "$probe" && ok "$bin present" || error "$bin MISSING"
  done

  if node_ok; then
    ok "node $(node -v)"
  elif $CHECK_ONLY; then
    error "node 22+ MISSING (found: $(node -v 2>/dev/null || echo none))"
  else
    $SUDO mkdir -p /etc/apt/keyrings
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
      | $SUDO gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" \
      | $SUDO tee /etc/apt/sources.list.d/nodesource.list >/dev/null
    $SUDO apt-get update -y && $SUDO apt-get install -y nodejs
    node_ok && ok "node $(node -v)" || error "node 22+ still unavailable after install"
  fi

  if have nats-server; then
    ok "nats-server present"
  elif $CHECK_ONLY; then
    error "nats-server MISSING"
  else
    V="${OPENCLAW_NATS_SERVER_VERSION:-2.12.6}"
    case "$(uname -m)" in aarch64|arm64) A=arm64 ;; *) A=amd64 ;; esac
    T=$(mktemp -d)
    if curl -fsSL "https://github.com/nats-io/nats-server/releases/download/v${V}/nats-server-v${V}-linux-${A}.tar.gz" | tar xz -C "$T"; then
      $SUDO install "$T/nats-server-v${V}-linux-${A}/nats-server" /usr/local/bin/nats-server
      have nats-server && ok "nats-server v$V installed" || error "nats-server not on PATH"
    else
      error "nats-server download failed"
    fi
    rm -rf "$T"
  fi

  if [ "${OPENCLAW_SKIP_LLM:-0}" = "1" ]; then
    info "ollama skipped (--skip-llm) — extraction degrades to regex"
  elif have ollama; then
    ok "ollama present"
  elif $CHECK_ONLY; then
    error "ollama MISSING"
  else
    curl -fsSL https://ollama.com/install.sh | sh
    have ollama && ok "ollama installed" || warn "ollama not on PATH — extraction degrades to regex"
  fi

  if have tailscale; then
    ok "tailscale present"
  elif $CHECK_ONLY; then
    error "tailscale MISSING (mesh clustering will not work)"
  else
    curl -fsSL https://tailscale.com/install.sh | sh
    have tailscale && ok "tailscale installed" || error "tailscale not on PATH"
  fi
fi

# ---------- PyYAML (compile-boot hard dependency) ----------
if python3 -c 'import yaml' 2>/dev/null; then
  ok "PyYAML present"
elif $CHECK_ONLY; then
  error "PyYAML MISSING — compile-boot will not work"
else
  python3 -m pip install --user pyyaml 2>/dev/null \
    || python3 -m pip install --user --break-system-packages pyyaml 2>/dev/null
  python3 -c 'import yaml' 2>/dev/null && ok "PyYAML installed" \
    || error "PyYAML install failed — compile-boot will not work"
fi

# ---------- Gate ----------
PREREQ_FAIL=0
_chk() { if eval "$2" >/dev/null 2>&1; then ok "$1"; else error "$1 — MISSING"; PREREQ_FAIL=1; fi; }
echo ""
echo "───── prerequisite gate ─────"
_chk "node 22+"      'node_ok'
_chk "python3 3.8+"  'python3 -c "import sys; sys.exit(0 if sys.version_info>=(3,8) else 1)"'
_chk "PyYAML"        'python3 -c "import yaml"'
_chk "git"           'command -v git'
_chk "sqlite3"       'command -v sqlite3'
_chk "build tools"   '{ [ "$PREREQ_OS" = macos ] && xcode-select -p; } || command -v cc'
_chk "curl"          'command -v curl'
_chk "jq"            'command -v jq'
_chk "nats-server"   'command -v nats-server'
[ "${OPENCLAW_SKIP_LLM:-0}" = "1" ] || _chk "ollama" 'command -v ollama'
_chk "tailscale"     'command -v tailscale'
echo ""

exit $PREREQ_FAIL
