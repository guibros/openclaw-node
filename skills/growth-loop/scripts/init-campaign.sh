#!/usr/bin/env bash
# init-campaign.sh — Scaffold a new growth loop campaign
# Usage: init-campaign.sh <campaign-name> <platform>
# Platforms: twitter|blog|email|marketplace|github|outreach|custom

set -euo pipefail

CAMPAIGN_NAME="${1:-}"
PLATFORM="${2:-custom}"

if [ -z "$CAMPAIGN_NAME" ]; then
  echo "Usage: init-campaign.sh <campaign-name> <platform>"
  echo "Platforms: twitter|blog|email|marketplace|github|outreach|custom"
  exit 1
fi

CAMPAIGN_DIR="$(pwd)/campaigns/${CAMPAIGN_NAME}"

if [ -d "$CAMPAIGN_DIR" ]; then
  echo "Error: Campaign directory already exists: $CAMPAIGN_DIR"
  exit 1
fi

mkdir -p "$CAMPAIGN_DIR/drafts" "$CAMPAIGN_DIR/archive"

NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# config.json
cat > "$CAMPAIGN_DIR/config.json" <<CONF
{
  "name": "${CAMPAIGN_NAME}",
  "platform": "${PLATFORM}",
  "objective": "TODO: what success looks like in one sentence",
  "audience": "TODO: who we are reaching",
  "kpi": "TODO: primary metric we optimize for",
  "secondary_kpis": [],
  "constraints": {
    "budget": "0",
    "frequency": "TODO: pieces per period",
    "tone": "TODO: brand voice notes",
    "human_approval": true
  },
  "measurement_window": "7d",
  "created_at": "${NOW}",
  "status": "research"
}
CONF

# gen-rules.md — platform-specific starter
case "$PLATFORM" in
  twitter)
    cat > "$CAMPAIGN_DIR/gen-rules.md" <<'RULES'
# Generation Rules — Twitter/X

## Format
- Max 280 chars (or thread if deeper content)
- Hook in first line — stop the scroll
- One idea per tweet
- No external links in standalone tweets (kills reach) — use threads or quote-tweets

## Tone
- TODO: define voice

## Posting
- Frequency: 1-3x/day (test and adjust)
- Best times: test mornings, lunch, evening — let data decide

## Variations to Test
- Question hooks vs statement hooks
- Thread vs single tweet for same content
- With media vs text-only

## Rules Updated
- (append changes from iteration phase here)
RULES
    ;;
  blog)
    cat > "$CAMPAIGN_DIR/gen-rules.md" <<'RULES'
# Generation Rules — Blog/SEO

## Format
- 1200-2500 words per piece
- Structure: hook → problem → solution → proof → CTA
- One target keyword per post (long-tail preferred)
- H2/H3 structure for scanability

## SEO
- Keyword in title, first paragraph, one H2, meta description
- Internal links to conversion pages (min 2 per post)
- External links to authoritative sources (1-3 per post)

## Tone
- TODO: define voice

## Frequency
- TODO: posts per week

## Rules Updated
- (append changes from iteration phase here)
RULES
    ;;
  email)
    cat > "$CAMPAIGN_DIR/gen-rules.md" <<'RULES'
# Generation Rules — Email

## Subject Lines
- Test 3 variants minimum per send
- Under 50 chars preferred
- Personalization token in subject when possible

## Body
- One CTA per email (single focus)
- Mobile-first (short paragraphs, no wide tables)
- P.S. line for secondary hook

## Sequence Logic
- trigger → value → value → soft ask → hard ask → break
- Spacing: day 0, day 2, day 5, day 8, day 14

## Tone
- TODO: define voice

## Rules Updated
- (append changes from iteration phase here)
RULES
    ;;
  outreach)
    cat > "$CAMPAIGN_DIR/gen-rules.md" <<'RULES'
# Generation Rules — Outreach

## Structure
- Line 1: Personalization (prove you know them)
- Line 2: Value prop (what's in it for them)
- Line 3: Social proof or credibility (optional, keep short)
- Line 4: CTA (low friction — reply, not signup)

## Follow-up Cadence
- Day 0: Initial
- Day 3: Follow-up 1 (add new angle, don't just bump)
- Day 7: Follow-up 2 (different value prop or proof point)
- Day 14: Break-up email (last chance, no guilt)

## Personalization
- Reference their recent work, post, or company news
- Never fake familiarity

## Tone
- TODO: define voice

## Rules Updated
- (append changes from iteration phase here)
RULES
    ;;
  marketplace)
    cat > "$CAMPAIGN_DIR/gen-rules.md" <<'RULES'
# Generation Rules — Product Listings

## Title
- Primary keyword + differentiator
- Under 80 chars

## Images
- Hero shot (product in context)
- Feature callouts (annotated)
- Social proof (reviews, awards)
- Size/scale reference

## Description
- Benefit-led first paragraph
- Scannable bullet points for features
- Keyword-rich but readable
- Social proof embedded

## Pricing
- TODO: strategy notes

## Rules Updated
- (append changes from iteration phase here)
RULES
    ;;
  github)
    cat > "$CAMPAIGN_DIR/gen-rules.md" <<'RULES'
# Generation Rules — Dev Marketing

## README
- README = landing page
- Structure: problem → solution → quickstart (< 5 min) → proof → badges
- GIF/screenshot in first viewport
- Copy-pasteable install command

## Examples
- Example projects > documentation
- Start with the 3 most common use cases
- Each example: problem → solution → code → output

## Community
- Respond to issues within 24h
- Ship what people ask for (track feature requests)
- Changelog for every release

## Tone
- TODO: define voice

## Rules Updated
- (append changes from iteration phase here)
RULES
    ;;
  *)
    cat > "$CAMPAIGN_DIR/gen-rules.md" <<'RULES'
# Generation Rules

## Format
- TODO: define content format

## Tone
- TODO: define voice

## Frequency
- TODO: define cadence

## Variations to Test
- TODO: define what to vary

## Rules Updated
- (append changes from iteration phase here)
RULES
    ;;
esac

# research.md
cat > "$CAMPAIGN_DIR/research.md" <<'RESEARCH'
# Research

## Top Performers
- TODO: 5-10 reference points in this space

## What Works
- TODO: formats, hooks, tones, frequency

## Engagement Patterns
- TODO: what gets signal vs noise

## Gaps / Opportunities
- TODO: what's underserved

## Initial Hypotheses
- TODO: what we think will work and why
RESEARCH

# Empty log files
touch "$CAMPAIGN_DIR/distribution-log.jsonl"
touch "$CAMPAIGN_DIR/metrics.jsonl"

# diagnosis.md
cat > "$CAMPAIGN_DIR/diagnosis.md" <<'DIAG'
# Diagnosis

(Populated after first measurement cycle)
DIAG

# iteration-log.md
cat > "$CAMPAIGN_DIR/iteration-log.md" <<'ITER'
# Iteration Log

(Append entries after each diagnosis → iterate cycle)
ITER

echo "Campaign scaffolded: $CAMPAIGN_DIR"
echo "Platform: $PLATFORM"
echo ""
echo "Next steps:"
echo "  1. Edit config.json — fill in objective, audience, KPI"
echo "  2. Edit gen-rules.md — refine for your use case"
echo "  3. Start Phase 1: Research → fill in research.md"
