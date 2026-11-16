#!/bin/sh
# Log wrangler into the personal Cloudflare account, opening the approval link
# in a Chrome Incognito window so a work Cloudflare session is never used.
cd "$(dirname "$0")/.." || exit 1
XDG_CONFIG_HOME="$PWD/.wrangler-home" ./node_modules/.bin/wrangler login --browser=false 2>&1 | while IFS= read -r line; do
  printf '%s\n' "$line"
  url=$(printf '%s' "$line" | grep -o 'https://dash.cloudflare.com/oauth2/auth[^ ]*')
  [ -n "$url" ] && open -na "Google Chrome" --args --incognito "$url"
done
