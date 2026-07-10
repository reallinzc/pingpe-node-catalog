# Ping.pe Node Sync

A scheduled Cloudflare Worker that reads Ping.pe's public pinger catalog,
validates it, and publishes a sanitized dataset to GitHub.

The project keeps all observed public pingers and a stable 37-node route-test
selection covering North America, South America, Europe, Africa, the Middle
East, Asia, and Oceania. Selection is keyed by Ping.pe pinger ID, so a pinger's
IP can change without changing route-test labels or geographic intent.

## Architecture

1. A weekly Cloudflare Cron Trigger invokes the Worker.
2. Cloudflare Browser Run completes Ping.pe's browser check and starts a normal
   public ping/MTR task against the configured target.
3. The Worker reads the task's public `outstandingNodes` map.
4. A strict allowlist retains only ID, IP, location, provider, short labels,
   country code, and derived region. Unknown fields are discarded.
5. Coverage, node count, duplicates, shrinkage, and curated-target presence are
   validated.
6. If the normalized catalog hash changed, the Worker updates
   `data/pingpe-nodes.json` through GitHub's Contents API. Unchanged runs do not
   create commits.
7. Workers KV stores the last published catalog, run status, and a short-lived
   duplicate-run lock.

No packet capture service or VPS-side collector is required.

## Published data

The generated JSON contains:

- all current sanitized public Ping.pe pingers;
- region counts and validation metadata;
- the stable curated route-test targets with current IPs;
- a SHA-256 catalog hash;
- the observation timestamp, updated only when catalog contents change.

Once deployed, the same data is available from:

- GitHub: `data/pingpe-nodes.json`
- Worker: `/catalog.json`
- Worker status: `/healthz`

Consumers should use `curated_targets` for the international route matrix and
`nodes` when they need the complete catalog.

## Configuration

Non-secret values live in `wrangler.jsonc`:

- `PINGPE_TARGET`: reachable target used to start the public task;
- `GITHUB_OWNER`, `GITHUB_REPO`, `GITHUB_BRANCH`, `GITHUB_DATA_PATH`;
- `MIN_NODE_COUNT`: hard lower bound for structural validation.

Required Worker secrets:

- `GITHUB_TOKEN`: preferably a fine-grained token or GitHub App installation
  token limited to this repository with `Contents: write`;
- `ADMIN_TOKEN`: random bearer token for manual `POST /api/sync` runs.

Never commit `.dev.vars` or either token.

## Development

```bash
npm install
npm run types
npm test
npm run check
npm run build
```

Browser Run is remote infrastructure. A real integration test therefore uses
the deployed Worker or Wrangler remote development.

## Deployment

```bash
wrangler secret put GITHUB_TOKEN
wrangler secret put ADMIN_TOKEN
npm run deploy
```

The configured schedule is `30 20 * * SUN`, or Monday 04:30 in China Standard
Time. Cloudflare Cron expressions use UTC.

Manual authenticated refresh:

```bash
curl -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  https://pingpe-node-sync.<account-subdomain>.workers.dev/api/sync
```

## Failure behavior

The Worker refuses to overwrite known-good GitHub data when Ping.pe changes
shape, returns too few nodes, loses required continental coverage, drops more
than 25 percent of the prior catalog, or loses too many curated IDs. Failure
details are written to Workers logs and `/healthz`; secrets and unrecognized
Ping.pe fields are never included.

## Source and use

Ping.pe remains the source and owner of its service data. This project performs
one low-frequency public task per week and republishes only the minimal public
node metadata needed for network route testing.
