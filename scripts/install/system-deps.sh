# ============================================================
# Step 1: System Dependencies
# ============================================================

if ! $UPDATE_ONLY; then
  step "Step 1: System Dependencies"

  # Node.js
  if command -v node >/dev/null 2>&1; then
    NODE_VERSION=$(node -e "console.log(process.versions.node.split('.')[0])")
    if [ "$NODE_VERSION" -ge 22 ]; then
      info "Node.js v$(node -v | tr -d 'v') found"
    else
      warn "Node.js v$NODE_VERSION found but v22+ required (Mission Control requires 22; the whole product standardizes on it)"
      if [ "$OS" = "linux" ]; then
        info "Installing Node.js 22 LTS..."
        run sudo mkdir -p /etc/apt/keyrings
        curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | sudo gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
        echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" | sudo tee /etc/apt/sources.list.d/nodesource.list
        run sudo apt-get update
        run sudo apt-get install -y nodejs
      else
        error "Please install Node.js 18+ manually: https://nodejs.org"
        exit 1
      fi
    fi
  else
    warn "Node.js not found"
    if [ "$OS" = "linux" ]; then
      info "Installing Node.js 22 LTS..."
      run sudo mkdir -p /etc/apt/keyrings
      curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | sudo gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
      echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" | sudo tee /etc/apt/sources.list.d/nodesource.list
      run sudo apt-get update
      run sudo apt-get install -y nodejs
    else
      error "Please install Node.js 18+: https://nodejs.org"
      exit 1
    fi
  fi

  # Python 3
  if command -v python3 >/dev/null 2>&1; then
    info "Python 3 found: $(python3 --version)"
  else
    warn "Python 3 not found"
    if [ "$OS" = "linux" ]; then
      run sudo apt-get install -y python3
    else
      error "Please install Python 3"
      exit 1
    fi
  fi

  # Git
  if command -v git >/dev/null 2>&1; then
    info "Git found: $(git --version | head -1)"
  else
    if [ "$OS" = "linux" ]; then
      run sudo apt-get install -y git
    fi
  fi

  # SQLite3
  if command -v sqlite3 >/dev/null 2>&1; then
    info "SQLite3 found"
  else
    if [ "$OS" = "linux" ]; then
      run sudo apt-get install -y sqlite3
    fi
  fi

  # build-essential (needed for better-sqlite3 native compilation)
  if [ "$OS" = "linux" ]; then
    if dpkg -s build-essential >/dev/null 2>&1; then
      info "build-essential found"
    else
      info "Installing build-essential (needed for native modules)..."
      run sudo apt-get install -y build-essential
    fi
  fi

  # curl
  if command -v curl >/dev/null 2>&1; then
    info "curl found"
  else
    if [ "$OS" = "linux" ]; then
      run sudo apt-get install -y curl
    fi
  fi

  # jq (used by test scripts and JSON processing)
  if command -v jq >/dev/null 2>&1; then
    info "jq found"
  else
    if [ "$OS" = "linux" ]; then
      run sudo apt-get install -y jq
    else
      warn "jq not found — install with: brew install jq (optional, used by test scripts)"
    fi
  fi

  # Python pip (needed for pyyaml)
  if [ "$OS" = "linux" ]; then
    if ! command -v pip3 >/dev/null 2>&1; then
      info "Installing python3-pip..."
      run sudo apt-get install -y python3-pip
    fi
  fi

  # PyYAML (required by compile-boot)
  if python3 -c "import yaml" 2>/dev/null; then
    info "PyYAML found"
  else
    info "Installing PyYAML (required by compile-boot)..."
    run pip3 install --user pyyaml 2>/dev/null || run pip install --user pyyaml 2>/dev/null || warn "Could not install pyyaml — compile-boot will not work"
  fi

  # Screenshot tool (Linux only)
  if [ "$OS" = "linux" ]; then
    if command -v scrot >/dev/null 2>&1 || command -v gnome-screenshot >/dev/null 2>&1 || command -v flameshot >/dev/null 2>&1; then
      info "Screenshot tool found"
    else
      info "Installing scrot (screenshot capture)..."
      run sudo apt-get install -y scrot || warn "Could not install scrot — screenshots will not work"
    fi
  fi

  # nats-server — the bus. Every subsystem talks through it; without it the node
  # is a pile of crash-looping clients (2026-07-11 fresh-install audit).
  if command -v nats-server >/dev/null 2>&1 || [ -x /opt/homebrew/bin/nats-server ] || [ -x /usr/local/bin/nats-server ]; then
    info "nats-server found"
  else
    warn "nats-server not found"
    if [ "$OS" = "macos" ]; then
      if command -v brew >/dev/null 2>&1; then
        run brew install nats-server || { error "brew install nats-server failed — install it and re-run"; exit 1; }
      else
        error "Install nats-server first: brew install nats-server (or https://github.com/nats-io/nats-server/releases)"
        exit 1
      fi
    else
      NATS_VER="${OPENCLAW_NATS_SERVER_VERSION:-2.12.6}"
      case "$(uname -m)" in
        x86_64) NATS_ARCH="amd64" ;;
        aarch64|arm64) NATS_ARCH="arm64" ;;
        *) NATS_ARCH="amd64" ;;
      esac
      info "Installing nats-server v${NATS_VER} (linux-${NATS_ARCH})..."
      if curl -fsSL "https://github.com/nats-io/nats-server/releases/download/v${NATS_VER}/nats-server-v${NATS_VER}-linux-${NATS_ARCH}.tar.gz" | tar xz -C /tmp; then
        run sudo install "/tmp/nats-server-v${NATS_VER}-linux-${NATS_ARCH}/nats-server" /usr/local/bin/nats-server
        info "nats-server installed to /usr/local/bin"
      else
        error "nats-server download failed — install it manually and re-run"
        exit 1
      fi
    fi
  fi

  # ollama — the local LLM runtime (extraction + local mesh agents).
  if ! $SKIP_LLM; then
    if command -v ollama >/dev/null 2>&1; then
      info "ollama found"
    else
      warn "ollama not found"
      if [ "$OS" = "macos" ]; then
        if command -v brew >/dev/null 2>&1; then
          run brew install ollama || warn "brew install ollama failed — extraction degrades to regex until installed"
        else
          warn "Install ollama for local extraction: https://ollama.com/download (node still installs; extraction degrades to regex)"
        fi
      else
        info "Installing ollama (official script)..."
        curl -fsSL https://ollama.com/install.sh | sh || warn "ollama install failed — extraction degrades to regex until installed"
      fi
    fi
  fi
fi
