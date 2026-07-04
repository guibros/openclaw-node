#!/usr/bin/env bash
# shim for plan-tick.sh — the old 207-line per-plan engine was retired 2026-07-04 (MASTER_PLAN §4.6)
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/plan-tick.sh" redesign "$@"
