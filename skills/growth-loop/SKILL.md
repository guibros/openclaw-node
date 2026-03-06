---
name: growth-loop
description: "Closed-loop content/growth operations engine. Platform-agnostic, objective-agnostic. Runs the cycle: Research → Generate → Distribute → Measure → Diagnose → Iterate. Use when user wants to set up a content pipeline, growth experiment, marketing loop, outreach system, or any systematic produce-distribute-measure-learn workflow."
triggers:
  - "set up a content pipeline"
  - "build a growth loop"
  - "create a marketing loop"
  - "run a growth experiment"
  - "set up an outreach system"
negative_triggers:
  - "write a single blog post"
  - "just do some research"
  - "marketing strategy advice"
metadata:
  openclaw:
    version: "1.0.0"
    author: "Daedalus"
    license: "MIT"
    tags: ["growth", "content", "marketing", "automation", "analytics", "loop"]
    category: "operations"
  clawdbot:
    emoji: "🔄"
    requires:
      bins: ["jq"]
---

# Growth Loop

Closed-loop engine for systematic content/growth operations. Platform-agnostic, objective-agnostic.

## The Loop

```
 ┌─────────────────────────────────────────┐
 │                                         │
 │   1. RESEARCH ──► 2. GENERATE           │
 │        ▲               │                │
 │        │               ▼                │
 │   6. ITERATE     3. DISTRIBUTE          │
 │        ▲               │                │
 │        │               ▼                │
 │   5. DIAGNOSE ◄── 4. MEASURE            │
 │                                         │
 └─────────────────────────────────────────┘
```

Every growth activity — TikTok slideshows, blog SEO, email sequences, product listings, outreach, dev marketing — is an instance of this loop with different config.

## When to Use

- Setting up a new content/growth channel
- Running a produce → distribute → measure experiment
- Building an outreach or lead-gen pipeline
- Optimizing any conversion funnel
- Any task where you generate something, put it in front of people, and want to learn from the results

## When NOT to Use

- One-off content creation (just write it directly)
- Pure research with no distribution intent
- Tasks where measurement isn't possible or relevant

## Phases

### Phase 1: RESEARCH

**Goal:** Understand what works in the target space before producing anything.

**Actions:**
- Identify 5-10 top performers in the space (competitors, influencers, reference points)
- Catalog what they do: format, frequency, tone, hooks, distribution channels
- Note engagement patterns: what gets signal (likes, shares, saves, conversions) vs noise
- Identify gaps: what's underserved, what's stale, where's the opening

**Output:** `campaign/research.md` — competitive landscape, engagement patterns, identified gaps, initial hypotheses.

**Tools to consider:** `tavily-search`, `web-search`, `deep-research`, `twitter` (timeline reads), platform-specific APIs.

### Phase 2: GENERATE

**Goal:** Produce content/assets based on research insights and current generation rules.

**Actions:**
- Define the content spec: format, length, tone, hook structure, CTA
- Generate a batch (not one piece — enough to test variations)
- Quality-check against research findings (does this match what works?)
- Stage for review — human approves before anything goes live

**Output:** `campaign/drafts/` — generated assets ready for human review.

**Rules file:** `campaign/gen-rules.md` — the living document that defines *how* to generate. Updated in Phase 6.

**Tools to consider:** `openai-image-gen`, `humanizer` (for text), platform-specific content tools.

### Phase 3: DISTRIBUTE

**Goal:** Push approved content to the target platform. Drafts first, never auto-publish.

**Actions:**
- Push to platform via API or manual staging (depends on channel)
- Tag/label for tracking (campaign ID, variant ID, timestamp)
- Log what was published, where, when, with what parameters

**Output:** `campaign/distribution-log.jsonl` — append-only log of every piece distributed.

```jsonl
{"id":"001","platform":"twitter","published_at":"2026-02-17T20:00:00-05:00","variant":"hook-a","content_ref":"drafts/tweet-001.md","status":"live"}
```

**Tools to consider:** `twitter` (post), platform APIs, scheduling tools.

### Phase 4: MEASURE

**Goal:** Pull performance data back. Raw numbers, no interpretation yet.

**Actions:**
- Collect platform metrics per piece (impressions, clicks, engagement, conversions)
- Collect business metrics if available (revenue, signups, leads generated)
- Merge with distribution log to create unified dataset

**Output:** `campaign/metrics.jsonl` — raw performance data keyed to distribution log entries.

```jsonl
{"id":"001","measured_at":"2026-02-18T20:00:00-05:00","impressions":1200,"clicks":45,"conversions":3,"revenue":0}
```

**Cadence:** Define measurement windows per channel (e.g., 24h for social, 7d for SEO, 30d for email sequences).

### Phase 5: DIAGNOSE

**Goal:** Figure out *why* things worked or didn't. Cross-reference engagement with actual outcomes.

**Actions:**
- Rank content by objective metric (not vanity — conversions, revenue, qualified leads)
- Identify patterns in winners vs losers: hook type, format, topic, timing, audience
- Find funnel breaks: high impressions but no clicks? High clicks but no conversions?
- Compare against research hypotheses — were we right about what works?

**Output:** `campaign/diagnosis.md` — what worked, what didn't, why, and where the funnel breaks.

**Diagnosis framework:**
```
For each piece/variant:
  - Reach: did people see it? (impressions)
  - Hook: did they stop? (click-through rate)
  - Hold: did they stay? (engagement rate, time on page)
  - Convert: did they act? (conversion rate)
  - Value: was the action worth it? (revenue per conversion)

The bottleneck is the first stage that drops below threshold.
```

### Phase 6: ITERATE

**Goal:** Update the generation rules based on diagnosis, then loop back to Phase 2.

**Actions:**
- Update `campaign/gen-rules.md` with specific, testable changes
- Document what was changed and why (for future diagnosis)
- Retire underperforming approaches explicitly (don't just hope)
- Identify new hypotheses to test in the next batch

**Output:** Updated `campaign/gen-rules.md` + `campaign/iteration-log.md` entry.

**Iteration log entry format:**
```markdown
## Iteration N — YYYY-MM-DD HH:MM

### What diagnosis showed
- [key findings]

### Changes to gen-rules
- [specific rule changes with rationale]

### Hypotheses for next batch
- [what we're testing and expected outcome]

### Retired approaches
- [what we're stopping and why]
```

## Campaign Setup

To instantiate a new loop, create a campaign directory:

```
campaign-name/
├── config.json          # Platform, objective, audience, constraints
├── research.md          # Phase 1 output
├── gen-rules.md         # Living generation rules (updated each iteration)
├── drafts/              # Phase 2 output (human reviews before distribution)
├── distribution-log.jsonl  # Phase 3 log
├── metrics.jsonl        # Phase 4 data
├── diagnosis.md         # Phase 5 analysis (rewritten each cycle)
├── iteration-log.md     # Phase 6 changelog (append-only)
└── archive/             # Old drafts, superseded rules, etc.
```

### config.json

```json
{
  "name": "campaign-name",
  "platform": "twitter|blog|email|marketplace|github|outreach|custom",
  "objective": "what success looks like in one sentence",
  "audience": "who we're reaching",
  "kpi": "primary metric we optimize for",
  "secondary_kpis": ["other metrics worth tracking"],
  "constraints": {
    "budget": "0|amount",
    "frequency": "pieces per period",
    "tone": "brand voice notes",
    "human_approval": true
  },
  "measurement_window": "24h|7d|30d",
  "created_at": "ISO timestamp",
  "status": "research|generating|distributing|measuring|diagnosing|iterating|paused"
}
```

## Platform Playbooks

These are starting-point `gen-rules.md` templates. Each gets refined by the loop.

### Social (Twitter, TikTok, Instagram)
- Hook in first line/3 seconds
- One idea per post
- Native format (no external links in feed posts — thread or carousel instead)
- Post frequency: test 1-3x/day, measure, adjust
- KPI: engagement rate → profile visits → link clicks → conversions

### Blog / SEO
- Target specific long-tail keyword per piece
- Structure: hook → problem → solution → proof → CTA
- Internal linking to conversion pages
- KPI: organic traffic → time on page → conversion rate

### Email
- Subject line = everything (test 3 variants minimum)
- One CTA per email
- Sequence logic: trigger → value → value → soft ask → hard ask → break
- KPI: open rate → click rate → conversion rate → unsubscribe rate (ceiling)

### Outreach (Sales, Partnerships, PR)
- Personalization in first sentence (prove you know them)
- Value prop in second sentence (what's in it for them)
- CTA = low friction (reply, not signup)
- Follow-up cadence: day 3, day 7, day 14, stop
- KPI: response rate → meeting rate → close rate

### Product Listings (Marketplace, App Store)
- Title optimization: primary keyword + differentiator
- Images: hero shot, feature callouts, social proof, size/scale reference
- Description: benefit-led, scannable, keyword-rich
- KPI: impressions → click-through → conversion rate → reviews

### Dev Marketing (GitHub, DevRel)
- README = landing page (problem → solution → quickstart → proof)
- Example projects > documentation walls
- Community engagement: answer issues fast, ship what people ask for
- KPI: stars → clones → issues opened → contributors → downstream usage

## Scripts

- `scripts/init-campaign.sh <name> <platform>` — scaffold a new campaign directory with config template and platform-specific gen-rules starter.

## References

- `references/diagnosis-framework.md` — expanded funnel diagnosis methodology.
- `references/platform-benchmarks.md` — baseline metrics by platform (what "good" looks like).
