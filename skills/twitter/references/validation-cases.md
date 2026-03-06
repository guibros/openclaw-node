# Twitter Skill — Validation Cases

## 1. Env check (no creds)

**Trigger:** Run any command without env vars set
**Expected:** Error listing missing variables + link to developer.x.com
**Pass criteria:** Non-zero exit, clear message

## 2. whoami

**Trigger:** `twitter.sh whoami`
**Expected:** JSON with id, name, username, followers, following, tweets
**Pass criteria:** Valid JSON, non-empty username field

## 3. Post tweet

**Trigger:** `twitter.sh post "Hello from Daedalus"`
**Expected:** JSON with id and text, plus URL to stderr
**Pass criteria:** id is numeric string, text matches input

## 4. Post too long

**Trigger:** `twitter.sh post "<281+ chars>"`
**Expected:** Error about character limit
**Pass criteria:** Non-zero exit, no API call made

## 5. Delete tweet

**Trigger:** `twitter.sh delete <valid_id>`
**Expected:** Confirmation message
**Pass criteria:** "Deleted tweet" in output

## 6. Lookup user

**Trigger:** `twitter.sh lookup elonmusk`
**Expected:** JSON with user info (name, bio, followers, etc.)
**Pass criteria:** Valid JSON, username matches input

## 7. Lookup with @ prefix

**Trigger:** `twitter.sh lookup @elonmusk`
**Expected:** Same as above (@ stripped automatically)

## 8. Rate limit handling

**Trigger:** Exceed 17 posts/day
**Expected:** HTTP 429 error with reset time
**Pass criteria:** Error surfaced clearly, no retry loop

## 9. Help

**Trigger:** `twitter.sh help` or `twitter.sh --help` or `twitter.sh`
**Expected:** Usage information
