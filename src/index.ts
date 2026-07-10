import selectionJson from "../config/selection.json";
import { buildCatalog } from "./catalog";
import {
  getExistingCatalog,
  publishCatalog,
  type GitHubConfig,
} from "./github";
import { fetchPingPePingers } from "./pingpe";
import type { PublishedCatalog, SelectionConfig, SyncStatus } from "./types";

interface Env {
  BROWSER: Fetcher;
  STATE: KVNamespace;
  GITHUB_TOKEN: string;
  ADMIN_TOKEN: string;
  PINGPE_TARGET: string;
  GITHUB_OWNER: string;
  GITHUB_REPO: string;
  GITHUB_BRANCH: string;
  GITHUB_DATA_PATH: string;
  MIN_NODE_COUNT: string;
}

const STATUS_KEY = "sync-status";
const CATALOG_KEY = "published-catalog";
const LOCK_KEY = "sync-lock";
const selection = selectionJson as SelectionConfig;

function githubConfig(env: Env): GitHubConfig {
  return {
    token: env.GITHUB_TOKEN,
    owner: env.GITHUB_OWNER,
    repo: env.GITHUB_REPO,
    branch: env.GITHUB_BRANCH,
    path: env.GITHUB_DATA_PATH,
  };
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 1_000) : "Unknown error";
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  let difference = leftBytes.length ^ rightBytes.length;
  const length = Math.max(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}

async function runSync(env: Env, trigger: string): Promise<SyncStatus> {
  const startedAt = new Date().toISOString();
  const currentLock = await env.STATE.get(LOCK_KEY);
  if (currentLock && Date.now() - Date.parse(currentLock) < 10 * 60 * 1_000) {
    throw new Error("A catalog sync is already running");
  }
  await env.STATE.put(LOCK_KEY, startedAt, { expirationTtl: 15 * 60 });

  const running: SyncStatus = { status: "running", trigger, started_at: startedAt };
  await env.STATE.put(STATUS_KEY, JSON.stringify(running));

  try {
    if (!env.GITHUB_TOKEN) {
      throw new Error("GITHUB_TOKEN secret is not configured");
    }
    const existing = await getExistingCatalog(githubConfig(env));
    const rawNodes = await fetchPingPePingers(env.BROWSER, env.PINGPE_TARGET);
    const minimumNodeCount = Number.parseInt(env.MIN_NODE_COUNT, 10) || 120;
    const catalog = await buildCatalog(
      rawNodes,
      selection,
      env.PINGPE_TARGET,
      minimumNodeCount,
      existing?.catalog?.node_count,
    );
    const published = await publishCatalog(githubConfig(env), catalog, existing);

    const storedCatalog: PublishedCatalog =
      published.action === "unchanged" && existing?.catalog ? existing.catalog : catalog;
    await env.STATE.put(CATALOG_KEY, JSON.stringify(storedCatalog));

    const finishedAt = new Date().toISOString();
    const success: SyncStatus = {
      status: "success",
      trigger,
      started_at: startedAt,
      finished_at: finishedAt,
      last_checked_at: finishedAt,
      action: published.action,
      node_count: catalog.node_count,
      curated_count: catalog.curated_count,
      catalog_hash: catalog.catalog_hash,
      commit_url: published.commitUrl,
    };
    await env.STATE.put(STATUS_KEY, JSON.stringify(success));
    console.log(JSON.stringify({ event: "sync_success", ...success }));
    return success;
  } catch (error) {
    const finishedAt = new Date().toISOString();
    const failed: SyncStatus = {
      status: "failed",
      trigger,
      started_at: startedAt,
      finished_at: finishedAt,
      last_checked_at: finishedAt,
      error: safeError(error),
    };
    await env.STATE.put(STATUS_KEY, JSON.stringify(failed));
    console.error(JSON.stringify({ event: "sync_failed", ...failed }));
    throw error;
  } finally {
    await env.STATE.delete(LOCK_KEY);
  }
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/healthz") {
      const status = await env.STATE.get<SyncStatus>(STATUS_KEY, "json");
      return json(status ?? { status: "idle" }, status?.status === "failed" ? 503 : 200);
    }

    if (url.pathname === "/catalog.json") {
      const catalog = await env.STATE.get(CATALOG_KEY);
      if (!catalog) {
        return json({ error: "Catalog has not been published yet" }, 503);
      }
      return new Response(catalog, {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "public, max-age=300",
        },
      });
    }

    if (url.pathname === "/api/sync") {
      if (request.method !== "POST") {
        return json({ error: "Method not allowed" }, 405);
      }
      const authorization = request.headers.get("Authorization") ?? "";
      const expected = `Bearer ${env.ADMIN_TOKEN}`;
      if (!env.ADMIN_TOKEN || !constantTimeEqual(authorization, expected)) {
        return json({ error: "Unauthorized" }, 401);
      }
      try {
        return json(await runSync(env, "manual"));
      } catch (error) {
        const message = safeError(error);
        return json({ status: "failed", error: message }, message.includes("already") ? 409 : 502);
      }
    }

    if (url.pathname === "/robots.txt") {
      return new Response("User-agent: *\nDisallow: /\n", {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    if (url.pathname === "/") {
      return json({
        service: "pingpe-node-sync",
        source: "https://ping.pe/",
        repository: `https://github.com/${env.GITHUB_OWNER}/${env.GITHUB_REPO}`,
        endpoints: ["/healthz", "/catalog.json"],
        schedule: "30 20 * * SUN (UTC)",
      });
    }

    return json({ error: "Not found" }, 404);
  },

  async scheduled(
    controller: ScheduledController,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    await runSync(env, `cron:${controller.cron}`);
  },
} satisfies ExportedHandler<Env>;
