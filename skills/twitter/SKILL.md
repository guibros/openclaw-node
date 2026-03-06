---
name: twitter
description: "Posts tweets, deletes tweets, reads public tweets, and looks up users on X/Twitter via the v2 API. Use when the user wants to tweet, read a tweet, check a Twitter profile, or manage X posts."
triggers:
  - "post a tweet"
  - "tweet this"
  - "check this twitter user"
  - "read this tweet"
  - "delete my tweet"
negative_triggers:
  - "search twitter"
  - "like a tweet"
  - "retweet this"
  - "follow this account"
metadata:
  openclaw:
    version: "1.0.0"
    author: "Daedalus"
    license: "MIT"
    tags: ["twitter", "x", "social", "posting"]
    category: "social"
  clawdbot:
    emoji: "🐦"
    requires:
      bins: ["curl", "openssl", "jq"]
    primaryEnv: "TWITTER_API_KEY"
---

# Twitter / X

Post tweets and look up users via the X API v2 Free tier.

## Capabilities

- **Post** tweets (17/day, 500/month) — requires API keys
- **Delete** own tweets — requires API keys
- **Look up** users (100 reads/month) — requires API keys
- **Read** any public tweet by ID or URL — no auth needed (syndication)
- **Timeline** read recent tweets from any public user — no auth needed (syndication)
- **Cannot** search, like, retweet, or follow on free tier

## Environment Variables

```bash
export TWITTER_API_KEY="..."
export TWITTER_API_SECRET="..."
export TWITTER_ACCESS_TOKEN="..."
export TWITTER_ACCESS_TOKEN_SECRET="..."
```

Get these from developer.x.com → Dashboard → App → Keys and Tokens.

## Workflow

1. Verify credentials are set: `scripts/twitter.sh whoami`
2. Execute the requested action via the appropriate subcommand.
3. Return the JSON response to the user with relevant fields extracted.
4. On rate limit errors (429), report the reset time — do not retry.

## Scripts

Auth required (set env vars):
- `scripts/twitter.sh whoami` — Verify credentials, show authenticated user info.
- `scripts/twitter.sh post "<text>"` — Post a tweet. Returns tweet ID on success.
- `scripts/twitter.sh delete <tweet_id>` — Delete a tweet by ID.
- `scripts/twitter.sh lookup <username>` — Look up a user by handle (no @).

No auth needed (public syndication):
- `scripts/twitter.sh read <tweet_id_or_url>` — Read any public tweet. Accepts tweet ID or full URL.
- `scripts/twitter.sh timeline <username> [count]` — Read last N tweets from a user (default 5).

## References

- Use `references/validation-cases.md` for expected behaviors and edge cases.
