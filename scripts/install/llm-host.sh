# ============================================================
# LLM host bridge — a VM uses its host's Ollama
# ============================================================
# Inference inside a VM runs on a paravirtual GPU. On a UTM node (2026-10-01) qwen3:8b generated
# ~2 tok/s in the VM against ~75 tok/s from the host's Ollama, so every Foreman assessment and
# every extraction timed out. When this machine is a VM and its host already serves Ollama with
# the node's model, LLM_BASE_URL points at the host instead of an Ollama started and pulled in
# the VM. OPENCLAW_LLM_HOST=0 keeps a VM on its own Ollama; an operator-set endpoint is never
# replaced. Sourced by install.sh and by llm-setup.sh, so it stays bash 3.2 compatible.

# llm_url_is_local URL — true when URL names this machine.
llm_url_is_local() {
  local hostport="${1#*://}"
  hostport="${hostport%%/*}"
  case "$hostport" in
    localhost|localhost:*|127.*|\[::1\]|\[::1\]:*) return 0 ;;
  esac
  return 1
}

# vm_hypervisor — prints what this machine runs under when it is a VM; fails on hardware.
vm_hypervisor() {
  case "$(uname -s)" in
    Darwin)
      [ "$(sysctl -n kern.hv_vmm_present 2>/dev/null)" = 1 ] || return 1
      sysctl -n hw.model 2>/dev/null || echo vm
      ;;
    Linux)
      local virt
      if command -v systemd-detect-virt >/dev/null 2>&1; then
        virt="$(systemd-detect-virt --vm 2>/dev/null)" || return 1
        [ -n "$virt" ] && [ "$virt" != none ] || return 1
        echo "$virt"
      else
        grep -qw hypervisor /proc/cpuinfo 2>/dev/null || return 1
        echo vm
      fi
      ;;
    *) return 1 ;;
  esac
}

# default_gateway — the VM's route out. NAT'd hypervisors (UTM, Parallels, QEMU, VirtualBox)
# answer it on the host itself; VMware's NAT puts its own device there, so it finds nothing.
default_gateway() {
  case "$(uname -s)" in
    Darwin) route -n get default 2>/dev/null | awk '/gateway:/ { print $2; exit }' ;;
    Linux) ip route show default 2>/dev/null | awk '$1 == "default" { print $3; exit }' ;;
  esac
}

# ollama_has_model URL MODEL — true when the Ollama at URL lists MODEL.
ollama_has_model() {
  curl -fsS --max-time 5 "$1/api/tags" 2>/dev/null | grep -q "\"$2\""
}

# host_ollama_url — prints the host's Ollama URL when this machine is a VM and the host
# answers on 11434; fails otherwise.
host_ollama_url() {
  local gateway
  vm_hypervisor >/dev/null || return 1
  gateway="$(default_gateway)"
  [ -n "$gateway" ] || return 1
  curl -fsS --max-time 3 "http://$gateway:11434/api/tags" 2>/dev/null | grep -q '"models"' || return 1
  echo "http://$gateway:11434"
}

# bridge_llm_to_host — in a VM still on a local LLM_BASE_URL, record the host's Ollama when it
# serves the node's model (set_env_key from helpers.sh, which honours --dry-run). Fails when
# nothing changed.
bridge_llm_to_host() {
  local hypervisor url gateway model="${LLM_MODEL:-qwen3:8b}"
  [ "${OPENCLAW_LLM_HOST:-1}" = 0 ] && return 1
  llm_url_is_local "${LLM_BASE_URL:-http://localhost:11434}" || return 1
  hypervisor="$(vm_hypervisor)" || return 1
  if ! url="$(host_ollama_url)"; then
    gateway="$(default_gateway)"
    info "VM detected ($hypervisor): no Ollama answers on the host${gateway:+ at http://$gateway:11434} — keeping a local one."
    info "  For host-speed inference, serve Ollama on the host with OLLAMA_HOST=0.0.0.0, then re-run with --update."
    return 1
  fi
  if ! ollama_has_model "$url" "$model"; then
    warn "VM detected ($hypervisor): the host's Ollama at $url lacks $model — keeping a local one."
    warn "  On the host: ollama pull $model   then re-run with --update."
    return 1
  fi
  set_env_key LLM_BASE_URL "$url"
  export LLM_BASE_URL="$url"
  info "VM detected ($hypervisor): LLM_BASE_URL=$url — the host's Ollama serves $model; nothing runs or downloads in the VM."
}
