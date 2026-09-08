#!/usr/bin/env bash
# llm-setup.sh — WAVE 2: download the node's local LLM brain, after confirming.
#
#   bash scripts/install/llm-setup.sh            # ask, then pull
#   bash scripts/install/llm-setup.sh --check    # report only, download nothing
#   bash scripts/install/llm-setup.sh --yes      # unattended: accept the recommendation
#
# Wave 1 (bootstrap.sh / install.sh) installs binaries and gets the node running.
# It deliberately does NOT pull models: that is 5-20 GB, and it should never
# start behind someone's back on a metered or slow connection.
#
# Reads the prompt from /dev/tty, not stdin: under `curl ... | bash` stdin IS the
# script, so `read` would consume the script's own remaining bytes. With no tty
# (CI, cron, piped with no terminal) the answer defaults to SKIP -- never hang,
# never download unattended.
#
# NOT `set -u`: stock macOS /bin/bash is 3.2, where empty "$@" raises "unbound
# variable" under nounset.
set -o pipefail

MODE=ask
ENDPOINT=""; ENDPOINT_MODEL=""
while [ $# -gt 0 ]; do
  case "$1" in
    --check) MODE=check ;;
    --yes|-y) MODE=yes ;;
    # Unattended: point the memory organ at any OpenAI-compatible server
    # (vLLM, LM Studio, llama.cpp, a hosted endpoint) instead of pulling
    # through ollama. The runtime only ever speaks that API (lib/llm-client.mjs).
    --endpoint) ENDPOINT="$2"; shift ;;
    --model) ENDPOINT_MODEL="$2"; shift ;;
  esac
  shift
done
[ "${OPENCLAW_LLM_AUTO:-0}" = "1" ] && [ "$MODE" = ask ] && MODE=yes

if ! declare -f ok >/dev/null 2>&1; then
  _G='\033[0;32m'; _Y='\033[1;33m'; _R='\033[0;31m'; _B='\033[1m'; _N='\033[0m'
  ok()   { echo -e "${_G}[+]${_N} $*"; }
  warn() { echo -e "${_Y}[!]${_N} $*"; }
  error(){ echo -e "${_R}[x]${_N} $*"; }
  step() { echo -e "\n${_B}━━━ $* ━━━${_N}"; }
fi
declare -f info >/dev/null 2>&1 || info() { echo -e "\033[0;32m[+]\033[0m $*"; }
have() { command -v "$1" >/dev/null 2>&1; }

OPENCLAW_ROOT="${OPENCLAW_ROOT:-$HOME/.openclaw}"
ENV_FILE="${ENV_FILE:-$OPENCLAW_ROOT/openclaw.env}"
WORKSPACE="${WORKSPACE:-$OPENCLAW_ROOT/workspace}"
NODE_BIN="${NODE_BIN:-$(command -v node)}"
REPO_DIR="${REPO_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
LLM_BASE_URL="${LLM_BASE_URL:-$(grep -m1 '^LLM_BASE_URL=' "$ENV_FILE" 2>/dev/null | cut -d= -f2-)}"
LLM_BASE_URL="${LLM_BASE_URL:-http://127.0.0.1:11434}"

step "Wave 2: local LLM model"

have ollama || { error "ollama is not installed — run wave 1 first (bootstrap.sh)"; exit 1; }

# ---------- what does this machine warrant? ----------
# Tiers mirror bin/check-llm-baseline.mjs: >=48GB qwen3:32b, >=32GB qwen3:14b,
# >=16GB qwen3:8b, below that no local tier is viable.
if [ "$(uname -s)" = Darwin ]; then
  RAM_GB=$(( $(sysctl -n hw.memsize) / 1024 / 1024 / 1024 ))
else
  RAM_GB=$(( $(awk '/MemTotal/{print $2}' /proc/meminfo) / 1024 / 1024 ))
fi

if   [ "$RAM_GB" -ge 48 ]; then REC=qwen3:32b; REC_GB=18
elif [ "$RAM_GB" -ge 32 ]; then REC=qwen3:14b; REC_GB=9
elif [ "$RAM_GB" -ge 16 ]; then REC=qwen3:8b;  REC_GB=5
else                            REC="";        REC_GB=0
fi

CURRENT=$(grep -m1 '^LLM_MODEL=' "$ENV_FILE" 2>/dev/null | cut -d= -f2-)
EMBEDDER_NEEDED=true
[ -d "$HOME/.cache/huggingface" ] && grep -qri 'bge-m3' "$HOME/.cache/huggingface" 2>/dev/null && EMBEDDER_NEEDED=false

echo ""
echo "  Detected RAM   : ${RAM_GB} GB"
if [ -n "$REC" ]; then
  echo "  Recommended    : ${REC}  (~${REC_GB} GB download)"
else
  echo "  Recommended    : none — ${RAM_GB} GB is below the 16 GB floor"
fi
[ -n "$CURRENT" ] && echo "  Configured     : ${CURRENT}"
if $EMBEDDER_NEEDED; then
  echo "  Embedder       : Xenova/bge-m3  (~2 GB, required for semantic search)"
else
  echo "  Embedder       : already cached"
fi
TOTAL_GB=$REC_GB
$EMBEDDER_NEEDED && TOTAL_GB=$((TOTAL_GB + 2))
echo "  ─────────────────────────────────"
echo "  Total download : ~${TOTAL_GB} GB"
echo ""

if [ "$MODE" = check ]; then
  info "--check: nothing downloaded."
  exit 0
fi

# ---------- OpenAI-compatible endpoint (any server, any model) ----------
record_endpoint() {
  # $1 = base URL, $2 = model tag. No download: the model lives on the server.
  if [ -f "$ENV_FILE" ]; then
    if grep -q '^LLM_BASE_URL=' "$ENV_FILE"; then sed -i.bak "s|^LLM_BASE_URL=.*|LLM_BASE_URL=$1|" "$ENV_FILE"; else echo "LLM_BASE_URL=$1" >> "$ENV_FILE"; fi
    if grep -q '^LLM_MODEL=' "$ENV_FILE"; then sed -i.bak "s|^LLM_MODEL=.*|LLM_MODEL=$2|" "$ENV_FILE"; else echo "LLM_MODEL=$2" >> "$ENV_FILE"; fi
    rm -f "$ENV_FILE.bak"
    ok "LLM_BASE_URL=$1 LLM_MODEL=$2 recorded in $ENV_FILE"
  else
    warn "$ENV_FILE not found — endpoint not recorded"
  fi
  if curl -fsS --max-time 5 "$1/v1/models" >/dev/null 2>&1 || curl -fsS --max-time 5 "$1/api/tags" >/dev/null 2>&1; then
    ok "endpoint reachable: $1"
  else
    warn "endpoint not reachable right now: $1 (extraction falls back to regex until it is)"
  fi
}
if [ -n "$ENDPOINT" ]; then
  [ -n "$ENDPOINT_MODEL" ] || { error "--endpoint needs --model <tag>"; exit 1; }
  record_endpoint "$ENDPOINT" "$ENDPOINT_MODEL"
  CHOICE=""
  SKIP_PULL=true
else
  SKIP_PULL=false
fi

if ! $SKIP_PULL && [ -z "$REC" ]; then
  warn "This machine is below the local-LLM floor (16 GB) — no local model recommended."
  if { exec 3</dev/tty; } 2>/dev/null; then
    printf "  Use an OpenAI-compatible endpoint instead? (vLLM / LM Studio / hosted) [y/N] "
    read -r ANS <&3 || ANS=n
    exec 3<&- 2>/dev/null || true
    case "$(echo "${ANS:-n}" | tr '[:upper:]' '[:lower:]')" in
      y|yes)
        exec 3</dev/tty
        printf "  Base URL (e.g. http://host:8000): "; read -r ENDPOINT <&3
        printf "  Model tag: "; read -r ENDPOINT_MODEL <&3
        exec 3<&- 2>/dev/null || true
        record_endpoint "$ENDPOINT" "$ENDPOINT_MODEL"
        SKIP_PULL=true ;;
    esac
  fi
  if ! $SKIP_PULL; then
    warn "Extraction will use regex until a model or endpoint is configured."
    warn "Later: bash $REPO_DIR/scripts/install/llm-setup.sh --endpoint URL --model TAG"
    exit 0
  fi
fi

# ---------- confirmation ----------
# Probe by actually opening /dev/tty on fd 3. `[ -r /dev/tty ]` can succeed on a
# tty that then fails to read, which is how a raw "Device not configured" error
# ends up in front of the user.
# The redirection must wrap a brace group: `exec 3</dev/tty 2>/dev/null` applies
# redirections left to right, so the fd-3 failure is reported before stderr is
# silenced and the error escapes anyway. A group redirects first, and being a
# group (not a subshell) fd 3 still lands in this shell.
if { exec 3</dev/tty; } 2>/dev/null; then TTY_OK=true; else TTY_OK=false; fi

CHOICE=""
if $SKIP_PULL; then
  CHOICE=""
elif [ "$MODE" = yes ]; then
  CHOICE="$REC"
  info "unattended (--yes): taking the recommendation, $REC"
elif $TTY_OK; then
  echo "  [y] download ${REC} + embedder   (~${TOTAL_GB} GB)"
  echo "  [e] use an OpenAI-compatible endpoint instead (vLLM / LM Studio / hosted — any model)"
  echo "  [s] skip — set it up later"
  echo "  [c] choose a different model"
  echo ""
  printf "  Download now? [y/e/s/c] "
  read -r ANS <&3 || ANS=s
  case "$(echo "${ANS:-s}" | tr '[:upper:]' '[:lower:]')" in
    y|yes) CHOICE="$REC" ;;
    e|endpoint)
      printf "  Base URL (e.g. http://host:8000): "; read -r ENDPOINT <&3
      printf "  Model tag: "; read -r ENDPOINT_MODEL <&3
      record_endpoint "$ENDPOINT" "$ENDPOINT_MODEL"
      SKIP_PULL=true; CHOICE="" ;;
    c|choose)
      echo ""
      echo "    1) qwen3:32b   ~18 GB   best quality, ~5-15 tok/s      (wants 48 GB RAM)"
      echo "    2) qwen3:14b   ~9  GB   balanced                       (wants 32 GB RAM)"
      echo "    3) qwen3:8b    ~5  GB   floor tier, JSON-mode reliable (wants 16 GB RAM)"
      echo "    4) skip"
      echo ""
      printf "  Which? [1-4] "
      read -r PICK <&3 || PICK=4
      case "${PICK:-4}" in
        1) CHOICE=qwen3:32b ;;
        2) CHOICE=qwen3:14b ;;
        3) CHOICE=qwen3:8b ;;
        *) CHOICE="" ;;
      esac
      # Undersized picks are allowed but named for what they are: the model will
      # swap or refuse to load rather than fail cleanly at pull time.
      case "$CHOICE" in
        qwen3:32b) [ "$RAM_GB" -lt 48 ] && warn "$CHOICE on ${RAM_GB} GB will swap badly" ;;
        qwen3:14b) [ "$RAM_GB" -lt 32 ] && warn "$CHOICE on ${RAM_GB} GB will swap badly" ;;
      esac
      ;;
    *) CHOICE="" ;;
  esac
else
  warn "no usable terminal — skipping rather than pulling ${TOTAL_GB} GB unattended."
  warn "use --yes (or OPENCLAW_LLM_AUTO=1) if you actually want it downloaded here."
  CHOICE=""
fi
exec 3<&- 2>/dev/null || true

if [ -z "$CHOICE" ] && $SKIP_PULL; then
  info "No local pull: the memory organ uses the configured endpoint."
elif [ -z "$CHOICE" ]; then
  echo ""
  info "Skipped. Nothing was downloaded. Run wave 2 whenever you want:"
  echo ""
  echo "    bash $REPO_DIR/scripts/install/llm-setup.sh"
  echo ""
  info "Until then extraction falls back to regex and semantic search is unavailable."
  exit 0
fi

# ---------- ollama has to be up to pull ----------
# The endpoint path never pulls: the model lives on the server the operator named.
if $SKIP_PULL; then :; else
if ! curl -fsS --max-time 3 "$LLM_BASE_URL/api/tags" >/dev/null 2>&1; then
  info "starting ollama..."
  mkdir -p "$OPENCLAW_ROOT/logs"
  if [ "$(uname -s)" = Darwin ]; then
    brew services start ollama >/dev/null 2>&1 || { nohup ollama serve >"$OPENCLAW_ROOT/logs/ollama.log" 2>&1 & }
  else
    ${SUDO:-sudo} systemctl start ollama 2>/dev/null || { nohup ollama serve >"$OPENCLAW_ROOT/logs/ollama.log" 2>&1 & }
  fi
  for _ in $(seq 1 15); do
    curl -fsS --max-time 2 "$LLM_BASE_URL/api/tags" >/dev/null 2>&1 && break
    sleep 2
  done
fi
curl -fsS --max-time 3 "$LLM_BASE_URL/api/tags" >/dev/null 2>&1 \
  || { error "ollama unreachable at $LLM_BASE_URL — cannot pull."; exit 1; }
ok "ollama reachable at $LLM_BASE_URL"

# ---------- pull ----------
step "Pulling $CHOICE"
if ollama list 2>/dev/null | awk '{print $1}' | grep -qx "$CHOICE"; then
  ok "$CHOICE already present"
else
  ollama pull "$CHOICE" || { error "ollama pull $CHOICE failed"; exit 1; }
  # Trust the listing, not pull's exit code.
  ollama list 2>/dev/null | awk '{print $1}' | grep -qx "$CHOICE" \
    && ok "$CHOICE pulled" \
    || { error "$CHOICE still not in \`ollama list\` after pull"; exit 1; }
fi

# ---------- record the choice ----------
if [ -f "$ENV_FILE" ]; then
  if grep -q '^LLM_MODEL=' "$ENV_FILE"; then
    sed -i.bak "s|^LLM_MODEL=.*$|LLM_MODEL=$CHOICE|" "$ENV_FILE" && rm -f "$ENV_FILE.bak"
  else
    echo "LLM_MODEL=$CHOICE" >> "$ENV_FILE"
  fi
  ok "LLM_MODEL=$CHOICE recorded in $ENV_FILE"
else
  warn "$ENV_FILE not found — LLM_MODEL not recorded"
fi
fi  # SKIP_PULL

# ---------- embedder ----------
if $EMBEDDER_NEEDED && [ -d "$WORKSPACE/node_modules/@huggingface/transformers" ]; then
  step "Prefetching embedder Xenova/bge-m3 (~2 GB, one-time)"
  if OPENCLAW_WS_LIB="$WORKSPACE/lib" "$NODE_BIN" --input-type=module -e '
      const core = await import(process.env.OPENCLAW_WS_LIB + "/mcp-knowledge/core.mjs");
      const embed = core.embed || core.getEmbedder;
      if (!embed) throw new Error("no embed/getEmbedder export");
      await embed("installation warmup");
    '; then
    ok "embedder ready"
  else
    warn "embedder prefetch failed — first semantic search will download it (needs internet)"
  fi
elif $EMBEDDER_NEEDED; then
  warn "workspace deps missing — embedder not prefetched"
fi

echo ""
ok "Wave 2 complete — model: ${CHOICE:-endpoint $ENDPOINT ($ENDPOINT_MODEL)}"
info "Restart the services so they pick it up:"
echo "    bash $REPO_DIR/install.sh --update --enable-services"
echo ""
