# Diagnosis Framework

## The Funnel

Every piece of content passes through a funnel. Diagnosis means finding where it breaks.

```
REACH → HOOK → HOLD → CONVERT → VALUE
  │       │       │       │        │
  │       │       │       │        └─ Revenue per conversion
  │       │       │       └─ Conversion rate (action taken)
  │       │       └─ Engagement / time on page / watch time
  │       └─ Click-through rate / stop rate
  └─ Impressions / deliverability
```

**The bottleneck is the first stage that drops below threshold.**

Don't optimize Hook if Reach is the problem. Don't optimize Convert if nobody's staying past the first 3 seconds.

## Stage Thresholds (starting points — calibrate with platform benchmarks)

| Stage | Metric | Poor | OK | Good |
|-------|--------|------|----|------|
| Reach | Impressions relative to audience size | <1% | 1-5% | >5% |
| Hook | CTR / stop rate | <1% | 1-3% | >3% |
| Hold | Engagement rate / avg time | <10s / <5% | 10-30s / 5-15% | >30s / >15% |
| Convert | Conversion rate | <0.5% | 0.5-2% | >2% |
| Value | Revenue per conversion | Below CAC | At CAC | Above CAC |

These vary wildly by platform and audience. Replace with your own baselines after 2-3 measurement cycles.

## Diagnosis Protocol

### Step 1: Sort by Objective

Rank all pieces by the KPI that matters (usually conversions or revenue, not impressions).

### Step 2: Compare Winners vs Losers

For top 20% vs bottom 20%, compare:
- Content attributes: topic, format, length, hook type, CTA type
- Distribution attributes: time of day, day of week, channel variant
- Audience attributes: segment, source, device (if available)

### Step 3: Identify the Break Point

For underperformers, walk the funnel:
1. Did people see it? (Reach) — if no: distribution problem
2. Did they stop/click? (Hook) — if no: hook/headline problem
3. Did they stay? (Hold) — if no: content quality or format problem
4. Did they act? (Convert) — if no: CTA, offer, or trust problem
5. Was the action valuable? (Value) — if no: targeting or offer-market fit problem

### Step 4: Formulate Testable Hypotheses

Bad: "We need better content"
Good: "Hook-style A (question) outperformed hook-style B (statement) by 2.3x CTR. Next batch: 70% question hooks, test a third style (bold claim)."

### Step 5: Update Gen-Rules

Every diagnosis should produce at least one specific, testable change to `gen-rules.md`. If diagnosis doesn't change anything, the measurement wasn't granular enough.

## Common Patterns

### High Reach, Low Hook
- Headlines/hooks aren't stopping people
- Fix: test different hook archetypes (question, bold claim, number, story, controversy)

### High Hook, Low Hold
- Content doesn't deliver on the hook's promise
- Fix: front-load value, reduce fluff, match hook specificity

### High Hold, Low Convert
- People like the content but don't take action
- Fix: CTA clarity, reduce friction, add urgency or social proof near CTA

### High Convert, Low Value
- Getting conversions but they're not worth much
- Fix: targeting (wrong audience), offer mismatch, or qualification step needed

### Everything Low
- Wrong channel, wrong audience, or wrong offer entirely
- Fix: go back to Phase 1 (Research). This isn't an optimization problem, it's a strategy problem.
