#!/bin/sh
# Sign the cf CLI (full Cloudflare API) into the personal account. Credentials stay in
# .wrangler-home/; the approval link opens in Chrome Incognito, never a work session.
cd "$(dirname "$0")/.." || exit 1
XDG_CONFIG_HOME="$PWD/.wrangler-home" ./node_modules/.bin/cf auth create personal --no-browser 2>&1 | while IFS= read -r line; do
  printf '%s\n' "$line"
  url=$(printf '%s' "$line" | grep -o 'https://[^ ]*cloudflare[^ ]*' | head -1)
  [ -n "$url" ] && [ -z "$opened" ] && open -na "Google Chrome" --args --incognito "$url" && opened=1
done
