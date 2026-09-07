#!/usr/bin/env bash
# bootstrap.sh — ONE-COMMAND install of an OpenClaw node on a virgin machine.
#
#   curl -fsSL https://raw.githubusercontent.com/moltyguibros-design/openclaw-node/main/bootstrap.sh | bash
#
# This is the only entrypoint that works on a machine with nothing on it.
# `npx openclaw-node-harness` cannot be: npx requires npm requires Node, and
# Node is one of the things we are here to install.
#
# Assumes ONLY: bash, a sudo-capable user, and SOME way to have gotten this file.
# macOS always ships /usr/bin/curl in the base system. Minimal Debian/Ubuntu
# images (containers, netinst, stripped cloud images) may have neither curl nor
# wget -- if so this installs curl via apt before doing anything else, and falls
# back to wget when that is what exists.
#
# Everything else -- Homebrew, Xcode CLT, Node 22, Python 3, Git, SQLite3,
# build tools, jq, nats-server, ollama, Tailscale -- is installed here.
#
# You will be asked for your password once. Homebrew and apt install into system
# locations; that is not automatable away and should not be.
#
# Env overrides:
#   OPENCLAW_REPO      owner/name to fetch      (default moltyguibros-design/openclaw-node)
#   OPENCLAW_REF       branch/tag              (default main)
#   OPENCLAW_SRC       use an existing checkout instead of downloading
#   OPENCLAW_NO_INSTALL=1   install deps only, do not run install.sh
#   plus any install.sh flag passed straight through:
#   curl ... | bash -s -- --skip-llm --role=worker

# NOT `set -u`: stock macOS /bin/bash is 3.2, where an empty "$@" or ${#arr[@]}
# raises "unbound variable" under nounset -- and `curl | bash` lands on exactly
# that shell. Every expansion below is guarded explicitly instead.
set -o pipefail

REPO="${OPENCLAW_REPO:-moltyguibros-design/openclaw-node}"
REF="${OPENCLAW_REF:-main}"

G='\033[0;32m'; Y='\033[1;33m'; R='\033[0;31m'; B='\033[1m'; N='\033[0m'
ok()   { echo -e "${G}[+]${N} $*"; }
warn() { echo -e "${Y}[!]${N} $*"; }
err()  { echo -e "${R}[x]${N} $*"; }
step() { echo -e "\n${B}━━━ $* ━━━${N}"; }
have() { command -v "$1" >/dev/null 2>&1; }
die()  { err "$*"; exit 1; }

case "$(uname -s)" in
  Darwin) OS=macos ;;
  Linux)  OS=linux ;;
  *) die "unsupported OS: $(uname -s). macOS and Debian/Ubuntu only." ;;
esac

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║   OpenClaw — one-command node bootstrap  ║"
echo "╚══════════════════════════════════════════╝"
ok "platform: $OS ($(uname -m))"

# sudo up front so the password prompt happens here, not randomly mid-install.
# Reads from the tty, so this still works when the script is piped from curl.
if [ "$(id -u)" -eq 0 ]; then
  SUDO=""
elif have sudo; then
  SUDO="sudo"
  step "Authorization"
  echo "Homebrew/apt install into system locations and need your password once."
  sudo -v || die "sudo authorization failed."
  # Keep the timestamp warm for the rest of the run.
  while true; do sudo -n true 2>/dev/null; sleep 50; kill -0 "$$" 2>/dev/null || exit; done &
  SUDO_KEEPALIVE=$!
  trap 'kill "$SUDO_KEEPALIVE" 2>/dev/null || true' EXIT
else
  die "need root or sudo."
fi

# Downloader. macOS always ships /usr/bin/curl (base system, not Command Line
# Tools). Minimal Debian/Ubuntu images -- containers, netinst, stripped cloud
# images -- ship NEITHER curl nor wget, so apt has to provide one before
# anything else can be fetched.
fetch() {
  if have curl; then curl -fsSL "$1"
  elif have wget; then wget -qO- "$1"
  else return 1; fi
}

if ! have curl && ! have wget; then
  if [ "$OS" = linux ] && have apt-get; then
    warn "no curl or wget — installing curl via apt first"
    ${SUDO:-} apt-get update -y >/dev/null 2>&1
    ${SUDO:-} apt-get install -y curl || die "could not install curl."
    have curl || die "curl still unavailable after apt-get install."
    ok "curl installed"
  else
    die "need curl or wget to continue, and no package manager to install one."
  fi
fi
ok "downloader: $(have curl && echo curl || echo wget)"

node_ok() { have node && [ "$(node -e 'console.log(process.versions.node.split(".")[0])' 2>/dev/null || echo 0)" -ge 22 ]; }

# ============================================================
# macOS
# ============================================================
if [ "$OS" = macos ]; then
  step "Homebrew + Xcode Command Line Tools"
  if ! have brew; then
    for c in /opt/homebrew/bin/brew /usr/local/bin/brew; do
      [ -x "$c" ] && eval "$("$c" shellenv)" && break
    done
  fi
  if have brew; then
    ok "homebrew present: $(brew --version | head -1)"
  else
    # Homebrew's own installer pulls in the Command Line Tools, which is where
    # the compiler comes from. Installing brew first therefore also fixes the
    # build-tools gap that breaks better-sqlite3 later.
    warn "installing Homebrew (this also installs the Xcode Command Line Tools)"
    NONINTERACTIVE=1 /bin/bash -c \
      "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" \
      || die "Homebrew install failed."
    BREW=""
    for c in /opt/homebrew/bin/brew /usr/local/bin/brew; do
      [ -x "$c" ] && BREW="$c" && break
    done
    [ -n "$BREW" ] || die "Homebrew installed but brew binary not found."
    eval "$("$BREW" shellenv)"
    RC="$HOME/.zprofile"; [ "${SHELL##*/}" = bash ] && RC="$HOME/.bash_profile"
    grep -qF "$BREW shellenv" "$RC" 2>/dev/null || {
      printf '\neval "$(%s shellenv)"\n' "$BREW" >> "$RC"
      ok "persisted brew to $RC"
    }
    ok "homebrew installed"
  fi
  xcode-select -p >/dev/null 2>&1 && ok "command line tools: $(xcode-select -p)" \
    || warn "CLT still absent; native modules may fail to build"

  step "Toolchain"
  if node_ok; then
    ok "node $(node -v)"
  else
    brew install node@22 && brew link --overwrite --force node@22
    node_ok && ok "node $(node -v)" || err "node 22+ install failed"
  fi

  # Report on whether the BINARY landed, never on the package manager's exit
  # code. A formula can install "successfully" and still leave nothing on PATH
  # (keg-only, failed link) -- and a green line that outruns reality is how the
  # original installer hid its own failures.
  for f in python@3.12 git sqlite jq nats-server ollama; do
    bin="$f"
    case "$f" in python@3.12) bin=python3 ;; sqlite) bin=sqlite3 ;; esac
    if have "$bin"; then
      ok "$bin present"
    else
      brew install "$f"
      if have "$bin"; then ok "$f installed ($bin on PATH)"
      else err "$f: $bin still not on PATH after brew install"; fi
    fi
  done

  # install.sh derives --cluster-bind from `tailscale ip -4`; without it,
  # multi-machine NATS clustering silently degrades to a single node.
  if have tailscale; then
    ok "tailscale present"
  else
    brew install --cask tailscale-app
    have tailscale && ok "tailscale installed" || err "tailscale: CLI still not on PATH"
  fi

# ============================================================
# Debian / Ubuntu
# ============================================================
else
  have apt-get || die "only Debian/Ubuntu apt is supported on Linux."

  step "APT baseline"
  # Unconditional. install.sh only refreshes lists inside its node-missing
  # branch, so a box that already ships Node 22 installs against stale lists
  # and dies mid-run under `set -e`.
  $SUDO apt-get update -y || die "apt-get update failed."
  $SUDO apt-get install -y \
    curl git sqlite3 build-essential jq python3 python3-pip ca-certificates gnupg \
    || die "apt baseline install failed."
  ok "git, sqlite3, build-essential, jq, python3 installed"

  step "Node.js 22"
  if node_ok; then
    ok "node $(node -v)"
  else
    $SUDO mkdir -p /etc/apt/keyrings
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
      | $SUDO gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" \
      | $SUDO tee /etc/apt/sources.list.d/nodesource.list >/dev/null
    $SUDO apt-get update -y && $SUDO apt-get install -y nodejs
    node_ok && ok "node $(node -v)" || err "node 22+ install failed"
  fi

  step "nats-server, ollama, tailscale"
  if have nats-server; then
    ok "nats-server present"
  else
    V="${OPENCLAW_NATS_SERVER_VERSION:-2.12.6}"
    case "$(uname -m)" in aarch64|arm64) A=arm64 ;; *) A=amd64 ;; esac
    # Pinned checksums (upstream SHA256SUMS for v2.12.6). A binary that will run
    # the mesh bus as a service is verified before it is installed; an override
    # version must bring its own OPENCLAW_NATS_SERVER_SHA256 or it is refused.
    case "${V}-${A}" in
      2.12.6-amd64) EXPECT_SHA="77fe7dd69ff5144126026b78355900be0ab0bb4339dc61a7621dcc9b9e9d07a6" ;;
      2.12.6-arm64) EXPECT_SHA="fddaf3f223c7af3f4d0a0d2c2fc084406e6b3ec7adfd1b9e6a37fbd03bfe222f" ;;
      *) EXPECT_SHA="${OPENCLAW_NATS_SERVER_SHA256:-}" ;;
    esac
    T=$(mktemp -d)
    TGZ="$T/nats-server-v${V}-linux-${A}.tar.gz"
    if [ -z "$EXPECT_SHA" ]; then
      err "no pinned checksum for nats-server v${V} (${A}); set OPENCLAW_NATS_SERVER_SHA256 to install it"
    elif curl -fsSL -o "$TGZ" "https://github.com/nats-io/nats-server/releases/download/v${V}/nats-server-v${V}-linux-${A}.tar.gz"; then
      ACTUAL_SHA=$(sha256sum "$TGZ" | awk '{print $1}')
      if [ "$ACTUAL_SHA" != "$EXPECT_SHA" ]; then
        err "nats-server checksum MISMATCH (got $ACTUAL_SHA, expected $EXPECT_SHA) — not installing"
      elif tar xzf "$TGZ" -C "$T"; then
        $SUDO install "$T/nats-server-v${V}-linux-${A}/nats-server" /usr/local/bin/nats-server
        have nats-server && ok "nats-server v$V installed (sha256 verified)" || err "nats-server not on PATH after install"
      else
        err "nats-server archive could not be extracted"
      fi
    else
      err "nats-server download failed"
    fi
    rm -rf "$T"
  fi

  if have ollama; then
    ok "ollama present"
  else
    curl -fsSL https://ollama.com/install.sh | sh
    have ollama && ok "ollama installed" || warn "ollama not on PATH — extraction degrades to regex"
  fi

  if have tailscale; then
    ok "tailscale present"
  else
    curl -fsSL https://tailscale.com/install.sh | sh
    have tailscale && ok "tailscale installed" || err "tailscale not on PATH after install"
  fi
fi

# ============================================================
# PyYAML — hard dependency of compile-boot
# ============================================================
step "PyYAML"
if python3 -c 'import yaml' 2>/dev/null; then
  ok "PyYAML present"
else
  python3 -m pip install --user pyyaml 2>/dev/null \
    || python3 -m pip install --user --break-system-packages pyyaml 2>/dev/null \
    || err "PyYAML install failed — compile-boot will not work"
fi

# ============================================================
# Gate — refuse to hand a broken box to install.sh
# ============================================================
step "Verification"
FAIL=0
chk() { if eval "$2" >/dev/null 2>&1; then ok "$1"; else err "$1 — MISSING"; FAIL=1; fi; }
chk "node 22+"      'node_ok'
chk "python3 3.8+"  'python3 -c "import sys; sys.exit(0 if sys.version_info>=(3,8) else 1)"'
chk "PyYAML"        'python3 -c "import yaml"'
chk "git"           'command -v git'
chk "sqlite3"       'command -v sqlite3'
chk "build tools"   '{ [ "$OS" = macos ] && xcode-select -p; } || command -v cc'
chk "curl"          'command -v curl'
chk "jq"            'command -v jq'
chk "nats-server"   'command -v nats-server'
chk "ollama"        'command -v ollama'
chk "tailscale"     'command -v tailscale'
[ "$OS" = macos ] && chk "homebrew" 'command -v brew'

if [ $FAIL -ne 0 ]; then
  echo ""
  die "baseline incomplete — install.sh NOT started. Fix the items above and re-run."
fi
ok "baseline complete"

[ "${OPENCLAW_NO_INSTALL:-0}" = "1" ] && { ok "OPENCLAW_NO_INSTALL=1 — stopping before install.sh"; exit 0; }

# ============================================================
# Fetch the repo and hand off
# ============================================================
step "Fetching $REPO@$REF"
if [ -n "${OPENCLAW_SRC:-}" ]; then
  SRC="$OPENCLAW_SRC"
  [ -f "$SRC/install.sh" ] || die "OPENCLAW_SRC=$SRC has no install.sh"
  ok "using existing checkout: $SRC"
else
  SRC="$HOME/.openclaw-src/openclaw-node"
  mkdir -p "$(dirname "$SRC")"
  rm -rf "$SRC"; mkdir -p "$SRC"
  # Tarball, not `git clone`: on a virgin Mac `git` is a stub that pops the
  # Xcode GUI prompt, which would stall a piped install.
  curl -fsSL "https://codeload.github.com/$REPO/tar.gz/refs/heads/$REF" \
    | tar xz -C "$SRC" --strip-components=1 \
    || die "could not download $REPO@$REF"
  ok "source at $SRC"
fi

step "Wave 1: running install.sh"
cd "$SRC" || die "cannot enter $SRC"

# Wave 1 is binaries + a running node. --skip-llm is forced here so the 5-20 GB
# model pull never starts unannounced; wave 2 below asks first. If the caller
# already passed --skip-llm they want no models at all, so wave 2 is skipped too.
USER_SKIP_LLM=false
for a in "$@"; do [ "$a" = "--skip-llm" ] && USER_SKIP_LLM=true; done

if [ $# -gt 0 ]; then
  bash install.sh --enable-services --skip-llm "$@"
else
  bash install.sh --enable-services --skip-llm
fi
RC=$?

if [ $RC -ne 0 ]; then
  echo ""
  err "install.sh exited $RC — dependencies were fine, the failure is downstream."
  exit $RC
fi
ok "wave 1 complete — node installed and running (no models yet)"

# ============================================================
# Wave 2 — models, only after the user says so
# ============================================================
if $USER_SKIP_LLM; then
  echo ""
  ok "--skip-llm given: no models. Set them up any time with:"
  echo "    bash $SRC/scripts/install/llm-setup.sh"
else
  bash "$SRC/scripts/install/llm-setup.sh"
fi

echo ""
ok "done. Next:"
echo "    tailscale up                 # authenticate the mesh (opens a browser)"
echo "    open http://localhost:3000   # Mission Control"
exit 0
