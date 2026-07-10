import type { PublishedCatalog } from "./types";

interface GitHubContentResponse {
  sha: string;
  content: string;
  encoding: string;
  html_url: string;
}

interface GitHubUpdateResponse {
  content?: { html_url?: string };
  commit?: { html_url?: string };
}

export interface GitHubConfig {
  token: string;
  owner: string;
  repo: string;
  branch: string;
  path: string;
}

export interface ExistingGitHubCatalog {
  sha: string;
  catalog?: PublishedCatalog;
  htmlUrl?: string;
}

const API_VERSION = "2026-03-10";

function headers(token: string): HeadersInit {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "User-Agent": "pingpe-node-sync-worker",
    "X-GitHub-Api-Version": API_VERSION,
  };
}

function contentUrl(config: GitHubConfig): string {
  const path = config.path
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(
    config.repo,
  )}/contents/${path}`;
}

export function encodeBase64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

export function decodeBase64Utf8(value: string): string {
  const binary = atob(value.replace(/\s/g, ""));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export async function getExistingCatalog(
  config: GitHubConfig,
): Promise<ExistingGitHubCatalog | undefined> {
  const response = await fetch(`${contentUrl(config)}?ref=${encodeURIComponent(config.branch)}`, {
    headers: headers(config.token),
  });
  if (response.status === 404) {
    return undefined;
  }
  if (!response.ok) {
    throw new Error(`GitHub read failed: ${response.status} ${await response.text()}`);
  }

  const content = (await response.json()) as GitHubContentResponse;
  let catalog: PublishedCatalog | undefined;
  if (content.encoding === "base64") {
    try {
      const parsed = JSON.parse(decodeBase64Utf8(content.content)) as PublishedCatalog;
      if (parsed.schema_version === 1 && typeof parsed.catalog_hash === "string") {
        catalog = parsed;
      }
    } catch {
      // The repository may still contain the first-run placeholder.
    }
  }
  return { sha: content.sha, catalog, htmlUrl: content.html_url };
}

export async function publishCatalog(
  config: GitHubConfig,
  catalog: PublishedCatalog,
  existing?: ExistingGitHubCatalog,
): Promise<{ action: "created" | "updated" | "unchanged"; commitUrl?: string }> {
  if (existing?.catalog?.catalog_hash === catalog.catalog_hash) {
    return { action: "unchanged", commitUrl: existing.htmlUrl };
  }

  const body: Record<string, unknown> = {
    message: `chore(data): refresh Ping.pe catalog (${catalog.node_count} nodes)`,
    content: encodeBase64Utf8(`${JSON.stringify(catalog, null, 2)}\n`),
    branch: config.branch,
  };
  if (existing?.sha) {
    body.sha = existing.sha;
  }

  const response = await fetch(contentUrl(config), {
    method: "PUT",
    headers: { ...headers(config.token), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`GitHub update failed: ${response.status} ${await response.text()}`);
  }

  const result = (await response.json()) as GitHubUpdateResponse;
  return {
    action: existing ? "updated" : "created",
    commitUrl: result.commit?.html_url ?? result.content?.html_url,
  };
}
