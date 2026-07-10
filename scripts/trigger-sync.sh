#!/usr/bin/env bash
set -euo pipefail

project_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
env_file=${NETOPS_ENV_FILE:-"$project_dir/../../.env"}

if [[ ! -f "$env_file" ]]; then
  echo "private env file not found: $env_file" >&2
  exit 1
fi

# shellcheck disable=SC1090
source "$env_file"
: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN is required in the private env file}"

# Derive a stable, purpose-specific credential without copying the Cloudflare
# token into the Worker or printing either value.
admin_token=$(
  printf 'pingpe-node-sync-admin-v1:%s' "$CLOUDFLARE_API_TOKEN" \
    | shasum -a 256 \
    | awk '{print $1}'
)

cd "$project_dir"
printf '%s\n' "$admin_token" | npx wrangler secret put ADMIN_TOKEN >/dev/null
npx wrangler deploy >/dev/null

curl --fail --silent --show-error --max-time 90 --config - <<EOF
request = "POST"
header = "X-Admin-Token: $admin_token"
url = "https://pingpe-node-sync.reallinzc.workers.dev/api/sync"
EOF
printf '\n'
