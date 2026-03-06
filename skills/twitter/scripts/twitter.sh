#!/usr/bin/env bash
set -euo pipefail

# twitter.sh — X/Twitter API v2 client with OAuth 1.0a signing
# Dependencies: curl, openssl, jq
# Env: TWITTER_API_KEY, TWITTER_API_SECRET, TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_TOKEN_SECRET

BASE_URL="https://api.x.com/2"
SYNDICATION_URL="https://cdn.syndication.twimg.com"

# --- Env check -----------------------------------------------------------

check_env() {
  local missing=()
  [[ -z "${TWITTER_API_KEY:-}" ]] && missing+=("TWITTER_API_KEY")
  [[ -z "${TWITTER_API_SECRET:-}" ]] && missing+=("TWITTER_API_SECRET")
  [[ -z "${TWITTER_ACCESS_TOKEN:-}" ]] && missing+=("TWITTER_ACCESS_TOKEN")
  [[ -z "${TWITTER_ACCESS_TOKEN_SECRET:-}" ]] && missing+=("TWITTER_ACCESS_TOKEN_SECRET")
  if [[ ${#missing[@]} -gt 0 ]]; then
    echo "Error: Missing environment variables: ${missing[*]}" >&2
    echo "Get them from https://developer.x.com → Dashboard → App → Keys and Tokens" >&2
    exit 1
  fi
}

# --- OAuth 1.0a -----------------------------------------------------------

# RFC 3986 percent-encode (pure bash + printf, no curl dependency)
pct_encode() {
  local string="$1" i c o
  local length=${#string}
  for (( i = 0; i < length; i++ )); do
    c="${string:i:1}"
    case "$c" in
      [A-Za-z0-9._~-]) o+="$c" ;;
      *) o+=$(printf '%%%02X' "'$c") ;;
    esac
  done
  printf '%s' "$o"
}

# Generate OAuth 1.0a signature and Authorization header
oauth_header() {
  local method="$1"
  local url="$2"
  local body_params="${3:-}"

  local nonce
  nonce=$(openssl rand -hex 16)
  local timestamp
  timestamp=$(date +%s)

  # Collect OAuth params
  local -a params=(
    "oauth_consumer_key=$(pct_encode "$TWITTER_API_KEY")"
    "oauth_nonce=$(pct_encode "$nonce")"
    "oauth_signature_method=HMAC-SHA1"
    "oauth_timestamp=$timestamp"
    "oauth_token=$(pct_encode "$TWITTER_ACCESS_TOKEN")"
    "oauth_version=1.0"
  )

  # Add body params if present (for form-encoded POST)
  if [[ -n "$body_params" ]]; then
    while IFS= read -r line; do
      [[ -n "$line" ]] && params+=("$line")
    done <<< "$body_params"
  fi

  # Sort and join
  local sorted
  sorted=$(printf '%s\n' "${params[@]}" | sort)
  local param_string
  param_string=$(printf '%s\n' "$sorted" | paste -sd '&' -)

  # Signature base string
  local sig_base
  sig_base="${method}&$(pct_encode "$url")&$(pct_encode "$param_string")"

  # Signing key
  local signing_key
  signing_key="$(pct_encode "$TWITTER_API_SECRET")&$(pct_encode "$TWITTER_ACCESS_TOKEN_SECRET")"

  # HMAC-SHA1 signature
  local signature
  signature=$(printf '%s' "$sig_base" | openssl dgst -sha1 -hmac "$signing_key" -binary | base64)

  # Build Authorization header
  printf 'OAuth oauth_consumer_key="%s", oauth_nonce="%s", oauth_signature="%s", oauth_signature_method="HMAC-SHA1", oauth_timestamp="%s", oauth_token="%s", oauth_version="1.0"' \
    "$(pct_encode "$TWITTER_API_KEY")" \
    "$(pct_encode "$nonce")" \
    "$(pct_encode "$signature")" \
    "$timestamp" \
    "$(pct_encode "$TWITTER_ACCESS_TOKEN")"
}

# --- API calls ------------------------------------------------------------

api_get() {
  local url="$1"
  local auth
  auth=$(oauth_header "GET" "$url")
  curl -sf -H "Authorization: $auth" "$url" 2>&1 || {
    # Re-run without -f to get error body
    curl -s -H "Authorization: $(oauth_header "GET" "$url")" "$url"
  }
}

api_post_json() {
  local url="$1"
  local json_body="$2"
  local auth
  auth=$(oauth_header "POST" "$url")
  local response
  local http_code
  response=$(curl -s -w "\n%{http_code}" \
    -H "Authorization: $auth" \
    -H "Content-Type: application/json" \
    -d "$json_body" \
    "$url")
  http_code=$(echo "$response" | tail -1)
  local body
  body=$(echo "$response" | sed '$d')

  if [[ "$http_code" -ge 200 && "$http_code" -lt 300 ]]; then
    echo "$body"
  else
    echo "HTTP $http_code" >&2
    echo "$body" >&2
    return 1
  fi
}

api_delete() {
  local url="$1"
  local auth
  auth=$(oauth_header "DELETE" "$url")
  local response
  local http_code
  response=$(curl -s -w "\n%{http_code}" \
    -X DELETE \
    -H "Authorization: $auth" \
    "$url")
  http_code=$(echo "$response" | tail -1)
  local body
  body=$(echo "$response" | sed '$d')

  if [[ "$http_code" -ge 200 && "$http_code" -lt 300 ]]; then
    echo "$body"
  else
    echo "HTTP $http_code" >&2
    echo "$body" >&2
    return 1
  fi
}

# --- Commands -------------------------------------------------------------

cmd_whoami() {
  local url="${BASE_URL}/users/me?user.fields=username,name,id,public_metrics"
  local result
  result=$(api_get "$url")
  if echo "$result" | jq -e '.data' >/dev/null 2>&1; then
    echo "$result" | jq '{
      id: .data.id,
      name: .data.name,
      username: .data.username,
      followers: .data.public_metrics.followers_count,
      following: .data.public_metrics.following_count,
      tweets: .data.public_metrics.tweet_count
    }'
  else
    echo "Auth failed. Check your credentials." >&2
    echo "$result" >&2
    return 1
  fi
}

cmd_post() {
  local text="$1"
  if [[ -z "$text" ]]; then
    echo "Usage: twitter.sh post \"<text>\"" >&2
    return 1
  fi
  if [[ ${#text} -gt 280 ]]; then
    echo "Error: Tweet exceeds 280 characters (${#text})" >&2
    return 1
  fi

  local json
  json=$(jq -nc --arg t "$text" '{text: $t}')
  local result
  result=$(api_post_json "${BASE_URL}/tweets" "$json")
  if echo "$result" | jq -e '.data.id' >/dev/null 2>&1; then
    local tweet_id
    tweet_id=$(echo "$result" | jq -r '.data.id')
    echo "$result" | jq '{id: .data.id, text: .data.text}'
    echo "Posted: https://x.com/i/status/$tweet_id" >&2
  else
    echo "Post failed:" >&2
    echo "$result" >&2
    return 1
  fi
}

cmd_delete() {
  local tweet_id="$1"
  if [[ -z "$tweet_id" ]]; then
    echo "Usage: twitter.sh delete <tweet_id>" >&2
    return 1
  fi
  local result
  result=$(api_delete "${BASE_URL}/tweets/${tweet_id}")
  if echo "$result" | jq -e '.data.deleted' >/dev/null 2>&1; then
    echo "Deleted tweet $tweet_id"
  else
    echo "Delete failed:" >&2
    echo "$result" >&2
    return 1
  fi
}

cmd_lookup() {
  local username="$1"
  if [[ -z "$username" ]]; then
    echo "Usage: twitter.sh lookup <username>" >&2
    return 1
  fi
  # Strip leading @ if present
  username="${username#@}"
  local url="${BASE_URL}/users/by/username/${username}?user.fields=name,username,id,description,public_metrics,created_at,profile_image_url"
  local result
  result=$(api_get "$url")
  if echo "$result" | jq -e '.data' >/dev/null 2>&1; then
    echo "$result" | jq '{
      id: .data.id,
      name: .data.name,
      username: .data.username,
      bio: .data.description,
      followers: .data.public_metrics.followers_count,
      following: .data.public_metrics.following_count,
      tweets: .data.public_metrics.tweet_count,
      created: .data.created_at,
      avatar: .data.profile_image_url
    }'
  else
    echo "Lookup failed for @$username:" >&2
    echo "$result" >&2
    return 1
  fi
}

# --- Public read (syndication, no auth) ------------------------------------

# Extract tweet ID from URL or raw ID
parse_tweet_id() {
  local input="$1"
  # Handle full URLs: https://x.com/user/status/123 or https://twitter.com/user/status/123
  if [[ "$input" =~ status/([0-9]+) ]]; then
    echo "${BASH_REMATCH[1]}"
  elif [[ "$input" =~ ^[0-9]+$ ]]; then
    echo "$input"
  else
    echo "Error: Cannot parse tweet ID from: $input" >&2
    return 1
  fi
}

cmd_read() {
  local input="$1"
  if [[ -z "$input" ]]; then
    echo "Usage: twitter.sh read <tweet_id_or_url>" >&2
    return 1
  fi
  local tweet_id
  tweet_id=$(parse_tweet_id "$input") || return 1

  local result
  result=$(curl -s "${SYNDICATION_URL}/tweet-result?id=${tweet_id}&token=0")

  if echo "$result" | jq -e '.text' >/dev/null 2>&1; then
    echo "$result" | jq '{
      id: .id_str,
      author: .user.screen_name,
      author_name: .user.name,
      text: .text,
      created_at: .created_at,
      likes: .favorite_count,
      replies: .conversation_count,
      quoted_tweet: (if .quoted_tweet then {
        author: .quoted_tweet.user.screen_name,
        text: .quoted_tweet.text,
        article_title: .quoted_tweet.article.title,
        article_preview: .quoted_tweet.article.preview_text
      } else null end),
      article: (if .article then {
        title: .article.title,
        preview: .article.preview_text
      } else null end)
    }'
  else
    echo "Could not read tweet $tweet_id" >&2
    echo "$result" >&2
    return 1
  fi
}

cmd_timeline() {
  local username="$1"
  local count="${2:-5}"
  if [[ -z "$username" ]]; then
    echo "Usage: twitter.sh timeline <username> [count]" >&2
    return 1
  fi
  username="${username#@}"

  local result
  result=$(curl -s "${SYNDICATION_URL}/srv/timeline-profile/screen-name/${username}")

  if [[ -z "$result" || "$result" == "null" ]]; then
    echo "Could not fetch timeline for @$username" >&2
    return 1
  fi

  # The timeline endpoint returns HTML with embedded JSON. Extract tweet data.
  # Try the JSON data-props approach first
  local tweets_json
  tweets_json=$(echo "$result" | sed -n 's/.*data-props="\([^"]*\)".*/\1/p' | sed 's/&quot;/"/g; s/&amp;/\&/g; s/&lt;/</g; s/&gt;/>/g; s/&#39;/'"'"'/g')

  if [[ -n "$tweets_json" ]] && echo "$tweets_json" | jq -e '.timeline' >/dev/null 2>&1; then
    echo "$tweets_json" | jq --argjson n "$count" '[
      .timeline.entries[]
      | select(.content.tweet)
      | .content.tweet
      | {
          id: .id_str,
          text: .text,
          created_at: .created_at,
          likes: .favorite_count,
          retweets: .retweet_count
        }
    ][:$n]'
  else
    # Fallback: try extracting tweet IDs from the HTML and fetch individually
    local tweet_ids
    tweet_ids=$(echo "$result" | grep -oE 'status/[0-9]+' | grep -oE '[0-9]+' | head -n "$count" | sort -u)

    if [[ -z "$tweet_ids" ]]; then
      echo "Could not parse timeline for @$username. The syndication format may have changed." >&2
      return 1
    fi

    echo "["
    local first=true
    while IFS= read -r tid; do
      [[ -z "$tid" ]] && continue
      local tweet
      tweet=$(curl -s "${SYNDICATION_URL}/tweet-result?id=${tid}&token=0")
      if echo "$tweet" | jq -e '.text' >/dev/null 2>&1; then
        [[ "$first" == "true" ]] || echo ","
        echo "$tweet" | jq '{
          id: .id_str,
          author: .user.screen_name,
          text: .text,
          created_at: .created_at,
          likes: .favorite_count
        }'
        first=false
      fi
    done <<< "$tweet_ids"
    echo "]"
  fi
}

# --- Main -----------------------------------------------------------------

usage() {
  cat <<EOF
twitter.sh — X/Twitter API v2 client (Free tier + syndication read)

Usage (auth required — set env vars):
  twitter.sh whoami                  Verify credentials
  twitter.sh post "<text>"           Post a tweet (max 280 chars)
  twitter.sh delete <tweet_id>       Delete a tweet
  twitter.sh lookup <username>       Look up a user

Usage (no auth — public syndication):
  twitter.sh read <tweet_id_or_url>  Read a tweet by ID or URL
  twitter.sh timeline <user> [n]     Read last n tweets (default 5)

Environment (for auth commands only):
  TWITTER_API_KEY                    API key (consumer key)
  TWITTER_API_SECRET                 API secret (consumer secret)
  TWITTER_ACCESS_TOKEN               Access token
  TWITTER_ACCESS_TOKEN_SECRET        Access token secret

Get credentials at https://developer.x.com
EOF
}

main() {
  local cmd="${1:-}"
  shift || true

  case "$cmd" in
    whoami)   check_env; cmd_whoami ;;
    post)     check_env; cmd_post "${1:-}" ;;
    delete)   check_env; cmd_delete "${1:-}" ;;
    lookup)   check_env; cmd_lookup "${1:-}" ;;
    read)     cmd_read "${1:-}" ;;
    timeline) cmd_timeline "${1:-}" "${2:-5}" ;;
    help|-h|--help) usage ;;
    *)
      echo "Unknown command: $cmd" >&2
      usage >&2
      exit 1
      ;;
  esac
}

main "$@"
