---
name: web-search
description: Search the web via DuckDuckGo for pages, news, images, or videos. Use when the user needs current information, research, fact-checking, or web resources beyond your training data.
triggers:
  - "search the web for"
  - "look this up online"
  - "find recent news about"
  - "search for images of"
  - "what's the latest on"
negative_triggers:
  - "search this codebase"
  - "grep for"
  - "find the file"
  - "search my whatsapp"
---

# Web Search

## Overview

Search the web using DuckDuckGo's API to find information across web pages, news articles, images, and videos. Returns results in multiple formats (text, markdown, JSON) with filtering options for time range, region, and safe search.

## When to Use This Skill

Use this skill when users request:
- Web searches for information or resources
- Finding current or recent information online
- Looking up news articles about specific topics
- Searching for images by description or topic
- Finding videos on specific subjects
- Research requiring current web data
- Fact-checking or verification using web sources
- Gathering URLs and resources on a topic

## Prerequisites

Install the required dependency:

```bash
pip install duckduckgo-search
```

This library provides a simple Python interface to DuckDuckGo's search API without requiring API keys or authentication.

## Core Capabilities

### 1. Basic Web Search

```bash
python scripts/search.py "<query>"
python scripts/search.py "<query>" --max-results <N>
```

### 2. Time Range Filtering

```bash
python scripts/search.py "<query>" --time-range <d|w|m|y>
```

Options: `d` (day), `w` (week), `m` (month), `y` (year)

### 3. News Search

```bash
python scripts/search.py "<query>" --type news
python scripts/search.py "<query>" --type news --time-range w --max-results 15
```

### 4. Image Search

```bash
python scripts/search.py "<query>" --type images
python scripts/search.py "<query>" --type images --image-size Large --image-color Blue
```

Image filters: `--image-size` (Small/Medium/Large/Wallpaper), `--image-color`, `--image-type` (photo/clipart/gif/transparent/line), `--image-layout` (Square/Tall/Wide)

### 5. Video Search

```bash
python scripts/search.py "<query>" --type videos
python scripts/search.py "<query>" --type videos --video-duration short --video-resolution high
```

### 6. Region-Specific Search

```bash
python scripts/search.py "<query>" --region <region-code>
```

Common codes: `us-en`, `uk-en`, `ca-en`, `au-en`, `de-de`, `fr-fr`, `wt-wt` (worldwide, default)

### 7. Safe Search Control

```bash
python scripts/search.py "<query>" --safe-search <on|moderate|off>
```

### 8. Output Formats

```bash
python scripts/search.py "<query>"                    # text (default)
python scripts/search.py "<query>" --format markdown   # markdown
python scripts/search.py "<query>" --format json       # JSON
```

### 9. Saving Results

```bash
python scripts/search.py "<query>" --output <file-path>
python scripts/search.py "<query>" --format json --output results.json
```

## Quick Reference

**Command structure:**
```bash
python scripts/search.py "<query>" [options]
```

**Essential options:**
- `-t, --type` - Search type (web, news, images, videos)
- `-n, --max-results` - Maximum results (default: 10)
- `--time-range` - Time filter (d, w, m, y)
- `-r, --region` - Region code (e.g., us-en, uk-en)
- `--safe-search` - Safe search level (on, moderate, off)
- `-f, --format` - Output format (text, markdown, json)
- `-o, --output` - Save to file

**Image-specific:** `--image-size`, `--image-color`, `--image-type`, `--image-layout`

**Video-specific:** `--video-duration` (short/medium/long), `--video-resolution` (high/standard)

**Get full help:**
```bash
python scripts/search.py --help
```

## Best Practices

1. **Be specific** - Use clear, specific search queries for better results
2. **Use time filters** - Apply `--time-range` for current information
3. **Adjust result count** - Start with 10-20 results, increase if needed
4. **Save important searches** - Use `--output` to preserve results
5. **Choose appropriate type** - Use news search for current events, web for general info
6. **Use JSON for automation** - JSON format is easiest to parse programmatically
7. **Respect usage** - Don't hammer the API with rapid repeated searches

See [references/api-details.md](references/api-details.md) for API details and advanced usage.

Covers: output format examples, common usage patterns (research, monitoring, fact-checking, academic, market research), implementation approach, advanced use cases (combining searches, programmatic processing, knowledge bases), troubleshooting, and script details.
