#!/bin/bash
#
# mesh-health.sh — Structured health check for the mesh stack.
#
# Checks every service on the current node:
#   - Tailscale (connected, has IP)
#   - NATS (server running on Ubuntu, reachable from macOS)
#   - MeshCentral (server on Ubuntu, agent on macOS)
#   - Mumble (server on Ubuntu)
#   - OpenClaw Agent (running, connected to NATS)
#   - Shared folder (exists, writable)
#   - Mesh CLI (in PATH, functional)
#   - Disk space (not critically low)
#   - Peer reachability (can ping the other node)
#
# OUTPUT MODES:
#   mesh-health.sh          → human-readable (colored)
#   mesh-health.sh --json   → JSON for programmatic parsing
#
# EXIT CODES:
#   0 = all healthy
#   1 = one or more services degraded/down

set -o pipefail

PLATFORM="$(uname)"
HOSTNAME="$(hostname)"
JSON_MODE=false
[ "$1" = "--json" ] && JSON_MODE=true

# ─── Node identity ────────────────────────────────────
if [ "$PLATFORM" = "Darwin" ]; then
    NODE_ROLE="lead"
    NODE_ID="moltymacs-virtual-machine-local"
    PEER_IP="100.91.131.61"
    PEER_NAME="Ubuntu (worker)"
    HOME_DIR="/Users/moltymac"
else
    NODE_ROLE="worker"
    NODE_ID="calos-vmware-virtual-platform"
    PEER_IP="100.65.201.114"
    PEER_NAME="macOS (lead)"
    HOME_DIR="/home/calos"
fi

SHARED_DIR="$HOME_DIR/openclaw/shared"
AGENT_JS="$HOME_DIR/openclaw/agent.js"

# ─── Results accumulator ─────────────────────────────
declare -a CHECK_NAMES=()
declare -a CHECK_STATUSES=()   # ok, degraded, down
declare -a CHECK_DETAILS=()
OVERALL="ok"

add_check() {
    local name="$1" status="$2" detail="$3"
    CHECK_NAMES+=("$name")
    CHECK_STATUSES+=("$status")
    CHECK_DETAILS+=("$detail")
    if [ "$status" = "down" ] && [ "$OVERALL" != "down" ]; then OVERALL="down"; fi
    if [ "$status" = "degraded" ] && [ "$OVERALL" = "ok" ]; then OVERALL="degraded"; fi
}

# ─── Checks ───────────────────────────────────────────

# 1. Tailscale
check_tailscale() {
    if ! command -v tailscale &>/dev/null; then
        add_check "tailscale" "down" "tailscale binary not found"
        return
    fi
    local ts_ip
    ts_ip=$(tailscale ip -4 2>/dev/null)
    if [ -z "$ts_ip" ]; then
        # Try with sudo on macOS
        if [ "$PLATFORM" = "Darwin" ]; then
            ts_ip=$(/Applications/Tailscale.app/Contents/MacOS/Tailscale ip -4 2>/dev/null || true)
        fi
    fi
    if [ -n "$ts_ip" ]; then
        add_check "tailscale" "ok" "$ts_ip"
    else
        local ts_status
        ts_status=$(tailscale status 2>&1 | head -1)
        add_check "tailscale" "down" "not connected: $ts_status"
    fi
}

# 2. NATS
check_nats() {
    if [ "$PLATFORM" != "Darwin" ]; then
        # Ubuntu — NATS server should be running locally
        if systemctl is-active --quiet nats 2>/dev/null; then
            # Also check the port is listening
            if nc -z 127.0.0.1 4222 2>/dev/null; then
                add_check "nats_server" "ok" "active, port 4222 listening"
            else
                add_check "nats_server" "degraded" "service active but port 4222 not responding"
            fi
        else
            if nc -z 127.0.0.1 4222 2>/dev/null; then
                add_check "nats_server" "degraded" "not managed by systemd but port 4222 responding"
            else
                add_check "nats_server" "down" "service not running, port 4222 not listening"
            fi
        fi
    else
        # macOS — NATS should be reachable on Ubuntu
        if nc -z -w3 100.91.131.61 4222 2>/dev/null; then
            add_check "nats_reachable" "ok" "100.91.131.61:4222 responding"
        else
            add_check "nats_reachable" "down" "100.91.131.61:4222 not responding"
        fi
    fi
}

# 3. MeshCentral
check_meshcentral() {
    if [ "$PLATFORM" != "Darwin" ]; then
        # Ubuntu — MeshCentral server
        if systemctl is-active --quiet meshcentral 2>/dev/null; then
            add_check "meshcentral_server" "ok" "service active"
        else
            add_check "meshcentral_server" "down" "service not running"
        fi
    else
        # macOS — MeshCentral agent
        if ps aux 2>/dev/null | grep '[m]eshagent' >/dev/null; then
            add_check "meshcentral_agent" "ok" "process running"
        else
            add_check "meshcentral_agent" "down" "process not found"
        fi
    fi
}

# 4. Mumble
check_mumble() {
    if [ "$PLATFORM" != "Darwin" ]; then
        # Ubuntu — Mumble server
        if systemctl is-active --quiet mumble-server 2>/dev/null; then
            add_check "mumble_server" "ok" "service active"
        elif nc -z 127.0.0.1 64738 2>/dev/null; then
            add_check "mumble_server" "degraded" "not in systemd but port 64738 responding"
        else
            add_check "mumble_server" "down" "service not running"
        fi
    fi
    # macOS doesn't run Mumble server — skip
}

# 5. OpenClaw Agent (agent.js)
check_agent() {
    local agent_running=false
    local agent_pid=""

    if [ "$PLATFORM" = "Darwin" ]; then
        # macOS: pgrep fails inside execSync sandbox — use ps aux instead
        agent_pid=$(ps aux 2>/dev/null | grep 'agent\.js' | grep -v grep | awk '{print $2}' | head -1)
        if [ -n "$agent_pid" ]; then
            agent_running=true
        fi
    else
        # Linux: check systemd
        if systemctl is-active --quiet openclaw-agent 2>/dev/null; then
            agent_running=true
            agent_pid=$(systemctl show -p MainPID --value openclaw-agent 2>/dev/null || echo "?")
        elif pgrep -f "node.*agent.js" &>/dev/null; then
            agent_running=true
            agent_pid=$(pgrep -f 'node.*agent.js' | head -1)
        fi
    fi

    if [ "$agent_running" = true ]; then
        if grep -q "Agent v[0-9]" "$AGENT_JS" 2>/dev/null; then
            add_check "openclaw_agent" "ok" "running (PID ${agent_pid})"
        else
            add_check "openclaw_agent" "degraded" "running but unrecognized version — sync may not work"
        fi
    else
        add_check "openclaw_agent" "down" "process not found"
    fi
}

# 6. Shared folder
check_shared() {
    if [ ! -d "$SHARED_DIR" ]; then
        add_check "shared_folder" "down" "$SHARED_DIR does not exist"
        return
    fi
    if [ ! -d "$SHARED_DIR/captures" ]; then
        add_check "shared_folder" "degraded" "exists but captures/ subdirectory missing"
        return
    fi
    # Test writability
    local testfile="$SHARED_DIR/.health-check-$$"
    if touch "$testfile" 2>/dev/null; then
        rm -f "$testfile"
        local count
        count=$(find "$SHARED_DIR" -type f 2>/dev/null | wc -l | tr -d ' ')
        add_check "shared_folder" "ok" "$count files, writable"
    else
        add_check "shared_folder" "degraded" "exists but not writable"
    fi
}

# 7. Mesh CLI
check_cli() {
    if command -v mesh &>/dev/null; then
        add_check "mesh_cli" "ok" "$(which mesh)"
    elif [ -x "$HOME_DIR/openclaw/bin/mesh" ]; then
        add_check "mesh_cli" "degraded" "installed at ~/openclaw/bin/mesh but not in PATH"
    else
        add_check "mesh_cli" "down" "not installed"
    fi
}

# 8. Disk space
check_disk() {
    local usage
    if [ "$PLATFORM" = "Darwin" ]; then
        usage=$(df -h / | tail -1 | awk '{print $5}' | tr -d '%')
    else
        usage=$(df -h / | tail -1 | awk '{print $5}' | tr -d '%')
    fi
    if [ "$usage" -gt 95 ]; then
        add_check "disk_space" "down" "${usage}% used — critically low"
    elif [ "$usage" -gt 85 ]; then
        add_check "disk_space" "degraded" "${usage}% used — getting full"
    else
        add_check "disk_space" "ok" "${usage}% used"
    fi
}

# 9. Peer reachability
check_peer() {
    if ping -c 1 -W 3 "$PEER_IP" &>/dev/null; then
        add_check "peer_reachable" "ok" "$PEER_NAME at $PEER_IP"
    else
        add_check "peer_reachable" "down" "$PEER_NAME at $PEER_IP not responding"
    fi
}

# ─── Run all checks ──────────────────────────────────
check_tailscale
check_nats
check_meshcentral
check_mumble
check_agent
check_shared
check_cli
check_disk
check_peer

# ─── Output ──────────────────────────────────────────

if $JSON_MODE; then
    # JSON output for programmatic consumption
    echo "{"
    echo "  \"node\": \"$NODE_ID\","
    echo "  \"role\": \"$NODE_ROLE\","
    echo "  \"platform\": \"$(uname -s)\","
    echo "  \"overall\": \"$OVERALL\","
    echo "  \"timestamp\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\","
    echo "  \"checks\": ["
    for i in "${!CHECK_NAMES[@]}"; do
        comma=","
        [ "$i" -eq $((${#CHECK_NAMES[@]} - 1)) ] && comma=""
        echo "    {\"name\": \"${CHECK_NAMES[$i]}\", \"status\": \"${CHECK_STATUSES[$i]}\", \"detail\": \"${CHECK_DETAILS[$i]}\"}$comma"
    done
    echo "  ]"
    echo "}"
else
    # Human-readable output
    echo ""
    echo "═══ Mesh Health: $HOSTNAME ($NODE_ROLE) ═══"
    echo ""
    for i in "${!CHECK_NAMES[@]}"; do
        icon=""
        case "${CHECK_STATUSES[$i]}" in
            ok)       icon="  ✓" ;;
            degraded) icon="  ⚠" ;;
            down)     icon="  ✗" ;;
        esac
        printf "%-3s %-22s %s\n" "$icon" "${CHECK_NAMES[$i]}" "${CHECK_DETAILS[$i]}"
    done
    echo ""
    case "$OVERALL" in
        ok)       echo "  Status: ALL HEALTHY" ;;
        degraded) echo "  Status: DEGRADED — some services need attention" ;;
        down)     echo "  Status: UNHEALTHY — critical services down" ;;
    esac
    echo ""
fi

[ "$OVERALL" = "ok" ] && exit 0 || exit 1
