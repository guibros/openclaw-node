# Web Search API Details & Advanced Usage

Extracted from SKILL.md for reference. See the main SKILL.md for overview and quick start.

## Output Format Examples

### Text Format
```
1. Page Title Here
   URL: https://example.com/page
   Brief description of the page content...

2. Another Result
   URL: https://example.com/another
   Another description...
```

### Markdown Format
```markdown
## 1. Page Title Here

**URL:** https://example.com/page

Brief description of the page content...

## 2. Another Result

**URL:** https://example.com/another

Another description...
```

### JSON Format
```json
[
  {
    "title": "Page Title Here",
    "href": "https://example.com/page",
    "body": "Brief description of the page content..."
  },
  {
    "title": "Another Result",
    "href": "https://example.com/another",
    "body": "Another description..."
  }
]
```

## Common Usage Patterns

### Research on a Topic

Gather comprehensive information about a subject:

```bash
# Get overview from web
python scripts/search.py "machine learning basics" --max-results 15 --output ml_web.txt

# Get recent news
python scripts/search.py "machine learning" --type news --time-range m --output ml_news.txt

# Find tutorial videos
python scripts/search.py "machine learning tutorial" --type videos --max-results 10 --output ml_videos.txt
```

### Current Events Monitoring

Track news on specific topics:

```bash
python scripts/search.py "climate summit" --type news --time-range d --format markdown --output daily_climate_news.md
```

### Finding Visual Resources

Search for images with specific criteria:

```bash
python scripts/search.py "data visualization examples" --type images --image-type photo --image-size Large --max-results 25 --output viz_images.txt
```

### Fact-Checking

Verify information with recent sources:

```bash
python scripts/search.py "specific claim to verify" --time-range w --max-results 20
```

### Academic Research

Find resources on scholarly topics:

```bash
python scripts/search.py "quantum entanglement research" --time-range y --max-results 30 --output quantum_research.txt
```

### Market Research

Gather information about products or companies:

```bash
python scripts/search.py "electric vehicle market 2025" --max-results 20 --format markdown --output ev_market.md
python scripts/search.py "EV news" --type news --time-range m --output ev_news.txt
```

## Implementation Approach

When users request web searches:

1. **Identify search intent**:
   - What type of content (web, news, images, videos)?
   - How recent should results be?
   - How many results are needed?
   - Any filtering requirements?

2. **Configure search parameters**:
   - Choose appropriate search type (`--type`)
   - Set time range if currency matters (`--time-range`)
   - Adjust result count (`--max-results`)
   - Apply filters (image size, video duration, etc.)

3. **Select output format**:
   - Text for quick reading
   - Markdown for documentation
   - JSON for further processing

4. **Execute search**:
   - Run the search command
   - Save to file if results need to be preserved
   - Print to stdout for immediate review

5. **Process results**:
   - Read saved files if needed
   - Extract URLs or specific information
   - Combine results from multiple searches

## Advanced Use Cases

### Combining Multiple Searches

Gather comprehensive information by combining search types:

```bash
# Web overview
python scripts/search.py "topic" --max-results 15 --output topic_web.txt

# Recent news
python scripts/search.py "topic" --type news --time-range w --output topic_news.txt

# Images
python scripts/search.py "topic" --type images --max-results 20 --output topic_images.txt
```

### Programmatic Processing

Use JSON output for automated processing:

```bash
python scripts/search.py "research topic" --format json --output results.json
# Then process with another script
python analyze_results.py results.json
```

### Building a Knowledge Base

Create searchable documentation from web results:

```bash
# Search multiple related topics
python scripts/search.py "topic1" --format markdown --output kb/topic1.md
python scripts/search.py "topic2" --format markdown --output kb/topic2.md
python scripts/search.py "topic3" --format markdown --output kb/topic3.md
```

## Troubleshooting

**Common issues:**

- **"Missing required dependency"**: Run `pip install duckduckgo-search`
- **No results found**: Try broader search terms or remove time filters
- **Timeout errors**: The search service may be temporarily unavailable; retry after a moment
- **Rate limiting**: Space out searches if making many requests
- **Unexpected results**: DuckDuckGo's results may differ from Google; try refining the query

**Limitations:**

- Results quality depends on DuckDuckGo's index and algorithms
- No advanced search operators (unlike Google's site:, filetype:, etc.)
- Image and video searches may have fewer results than web search
- No control over result ranking or relevance scoring
- Some specialized searches may work better on dedicated search engines

## Resources

### scripts/search.py

The main search tool implementing DuckDuckGo search functionality. Key features:

- **Multiple search types** - Web, news, images, and videos
- **Flexible filtering** - Time range, region, safe search, and type-specific filters
- **Multiple output formats** - Text, Markdown, and JSON
- **File output** - Save results for later processing
- **Clean formatting** - Human-readable output with all essential information
- **Error handling** - Graceful handling of network errors and empty results

The script can be executed directly and includes comprehensive command-line help via `--help`.
