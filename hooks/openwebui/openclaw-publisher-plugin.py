"""
openclaw-publisher-plugin.py — OpenWebUI plugin for OpenClaw extraction triggering.

Publishes a mesh.memory.extract_request event when a conversation completes.
Uses subprocess to call the Node.js CLI tool (no Python NATS dependency required).

Installation:
  1. Copy this file to your OpenWebUI plugins directory.
  2. Enable the plugin in OpenWebUI settings.
  3. Ensure openclaw-nodedev is installed and NATS is running.

Env: OPENCLAW_REPO_PATH (path to openclaw-nodedev repo, auto-detected if not set)
"""

import os
import subprocess
import json
from datetime import datetime, timezone

# OpenWebUI plugin metadata
PLUGIN_NAME = "OpenClaw Extraction Trigger"
PLUGIN_VERSION = "1.0.0"
PLUGIN_DESCRIPTION = "Triggers OpenClaw memory extraction after conversations"


def _find_repo_root():
    """Find the openclaw-nodedev repo root."""
    env_path = os.environ.get("OPENCLAW_REPO_PATH")
    if env_path and os.path.isfile(os.path.join(env_path, "bin/openclaw-extract-now.mjs")):
        return env_path
    # Try common locations
    home = os.path.expanduser("~")
    for candidate in [
        os.path.join(home, "openclaw-nodedev"),
        os.path.join(home, "src", "openclaw-nodedev"),
        os.path.join(home, "projects", "openclaw-nodedev"),
    ]:
        if os.path.isfile(os.path.join(candidate, "bin/openclaw-extract-now.mjs")):
            return candidate
    return None


def _trigger_extraction(triggered_by="openwebui-plugin"):
    """Fire extraction request via the CLI tool (subprocess, fire-and-forget)."""
    repo_root = _find_repo_root()
    if not repo_root:
        return

    cli_path = os.path.join(repo_root, "bin", "openclaw-extract-now.mjs")
    try:
        subprocess.Popen(
            ["node", cli_path, f"--triggered-by={triggered_by}"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except Exception:
        pass  # Fire-and-forget


def on_message_complete(message, context=None):
    """Hook called by OpenWebUI after a message exchange completes."""
    _trigger_extraction("openwebui-plugin")
    return message


def on_conversation_end(conversation_id=None, context=None):
    """Hook called by OpenWebUI when a conversation ends."""
    _trigger_extraction("openwebui-conversation-end")
