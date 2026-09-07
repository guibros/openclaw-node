# ============================================================
# Helpers
# ============================================================

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${GREEN}[+]${NC} $*"; }
warn()  { echo -e "${YELLOW}[!]${NC} $*"; }
error() { echo -e "${RED}[✗]${NC} $*"; }
step()  { echo -e "\n${GREEN}━━━ $* ━━━${NC}"; }

run() {
  if $DRY_RUN; then
    echo "  [dry-run] $*"
    # Verify source paths exist for cp/rsync commands (catches path bugs)
    case "$1" in
      cp)
        if [ ! -e "$2" ]; then
          error "[dry-run] SOURCE MISSING: $2"
          DRY_RUN_ERRORS=$((${DRY_RUN_ERRORS:-0} + 1))
        fi
        ;;
      rsync)
        # rsync source is the last arg before the destination
        local src="${@:(-2):1}"
        if [ ! -e "${src%/}" ] && [ ! -d "${src%/}" ]; then
          error "[dry-run] SOURCE MISSING: ${src}"
          DRY_RUN_ERRORS=$((${DRY_RUN_ERRORS:-0} + 1))
        fi
        ;;
    esac
  else
    "$@"
  fi
}
DRY_RUN_ERRORS=0

# Heredoc-safe writer (review P4-3): `write_file "$dest" <<EOF … EOF`. The
# raw `cat > "$dest" <<EOF` form bypassed run()'s dry-run guard, so
# --dry-run was rewriting MEMORY.md, active-tasks.md, .env.local and the
# notification config on real installs. Dry-run prints and discards.
write_file() {
  local dest="$1"
  if $DRY_RUN; then
    echo "  [dry-run] would write $dest"
    cat >/dev/null
  else
    cat > "$dest"
  fi
}

detect_os() {
  case "$(uname -s)" in
    Darwin)  echo "macos" ;;
    Linux)   echo "linux" ;;
    *)       echo "unknown" ;;
  esac
}

OS=$(detect_os)
