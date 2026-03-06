from __future__ import annotations

"""
Lightweight YAML frontmatter parser for SKILL.md files.
Regex-based, no external dependencies.

Usage:
    from lib.frontmatter import parse_frontmatter

    fm, body = parse_frontmatter(text)
    # fm = dict with parsed fields
    # body = remaining markdown after frontmatter
"""

import re

_FM_RE = re.compile(r"\A---\s*\n(.*?\n)---\s*\n?", re.DOTALL)
_LIST_ITEM_RE = re.compile(r'^\s*-\s+"?([^"]*?)"?\s*$')


def parse_frontmatter(text: str) -> tuple[dict, str]:
    """Parse YAML frontmatter from text.

    Returns (frontmatter_dict, body_text).
    If no frontmatter found, returns ({}, full_text).
    """
    m = _FM_RE.match(text)
    if not m:
        return {}, text

    raw = m.group(1)
    body = text[m.end():]
    fm = _parse_yaml_lite(raw)
    return fm, body


def _parse_yaml_lite(raw: str) -> dict:
    """Minimal YAML parser for SKILL.md frontmatter.

    Handles:
      - key: value (scalar)
      - key: "quoted value"
      - key: |  (multiline block)
      - key:\\n  - item1\\n  - item2  (list)
      - Nested metadata blocks (treated as raw string)
    """
    result = {}
    lines = raw.split("\n")
    i = 0

    while i < len(lines):
        line = lines[i]

        # Skip blank lines and comments
        if not line.strip() or line.strip().startswith("#"):
            i += 1
            continue

        # Match top-level key: value
        kv = re.match(r"^(\w[\w\-]*):\s*(.*)", line)
        if not kv:
            i += 1
            continue

        key = kv.group(1)
        value = kv.group(2).strip()

        # Check if next lines are list items
        if value == "" and i + 1 < len(lines):
            next_line = lines[i + 1] if i + 1 < len(lines) else ""
            if re.match(r"^\s+-\s+", next_line):
                # Parse list
                items = []
                i += 1
                while i < len(lines) and re.match(r"^\s+-\s+", lines[i]):
                    item_match = _LIST_ITEM_RE.match(lines[i])
                    if item_match:
                        items.append(item_match.group(1))
                    else:
                        val = re.sub(r"^\s+-\s+", "", lines[i]).strip().strip('"')
                        items.append(val)
                    i += 1
                result[key] = items
                continue
            elif re.match(r"^\s+\S", next_line):
                # Nested block (metadata, etc.) — capture as raw string
                block_lines = []
                i += 1
                while i < len(lines) and (lines[i].startswith("  ") or lines[i].startswith("\t") or not lines[i].strip()):
                    block_lines.append(lines[i])
                    i += 1
                result[key] = "\n".join(block_lines).strip()
                continue

        # Block scalar (| or >-)
        if value in ("|", ">", ">-", "|-"):
            block_lines = []
            i += 1
            while i < len(lines) and (lines[i].startswith("  ") or lines[i].startswith("\t") or not lines[i].strip()):
                block_lines.append(lines[i].strip())
                i += 1
            if value.startswith(">"):
                # Folded scalar: join lines with spaces
                result[key] = " ".join(line for line in block_lines if line).strip()
            else:
                result[key] = "\n".join(block_lines).strip()
            continue

        # Simple scalar
        value = value.strip('"').strip("'")
        result[key] = value
        i += 1

    return result
