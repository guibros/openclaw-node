---
name: web-search
description: Search the web for real-time information. Use when the user needs current data, news, prices, docs, or anything beyond the model's training cutoff.
triggers:
  - "search the web for"
  - "look up the latest"
  - "what's the current price of"
  - "find information about"
negative_triggers:
  - "search my files"
  - "grep the codebase"
  - "query the knowledge graph"
---
# web-search

@command(web_search)
Usage: web_search --query <query>
Run: curl -s "https://ddg-api.herokuapp.com/search?q={{query}}"