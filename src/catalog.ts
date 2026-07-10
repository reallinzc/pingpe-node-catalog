import type {
  CuratedTarget,
  PingerNode,
  PublishedCatalog,
  Region,
  SelectionConfig,
} from "./types";

const REGION_ORDER: Region[] = [
  "north-america",
  "south-america",
  "europe",
  "africa",
  "middle-east",
  "asia",
  "oceania",
  "unknown",
];

const REGION_BY_CODE: Record<string, Region> = {
  AR: "south-america",
  AU: "oceania",
  AZ: "middle-east",
  BD: "asia",
  BR: "south-america",
  CA: "north-america",
  CL: "south-america",
  CN: "asia",
  CO: "south-america",
  CY: "middle-east",
  GH: "africa",
  GB: "europe",
  HK: "asia",
  ID: "asia",
  IL: "middle-east",
  IN: "asia",
  IR: "middle-east",
  JP: "asia",
  KE: "africa",
  MA: "africa",
  MN: "asia",
  NG: "africa",
  OM: "middle-east",
  PK: "asia",
  PY: "south-america",
  SG: "asia",
  TH: "asia",
  TR: "middle-east",
  TW: "asia",
  UAE: "middle-east",
  UA: "europe",
  US: "north-america",
  ZA: "africa",
};

const EUROPE_CODES = new Set([
  "AT",
  "CH",
  "DE",
  "ES",
  "FI",
  "FR",
  "GR",
  "IE",
  "IT",
  "NL",
  "NO",
  "PL",
  "RO",
  "SE",
  "SI",
  "XK",
]);

function nonEmptyString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isIPv4(value: string): boolean {
  const parts = value.split(".");
  return (
    parts.length === 4 &&
    parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
  );
}

export function countryCodeFromId(id: string): string {
  const parts = id.split("_");
  if (parts[0] === "EU" && parts[1]) {
    return parts[1];
  }
  return parts[0] === "UAE" ? "AE" : (parts[0] ?? "");
}

export function regionFromId(id: string): Region {
  const parts = id.split("_");
  if (parts[0] === "EU" && parts[1] && EUROPE_CODES.has(parts[1])) {
    return "europe";
  }
  return REGION_BY_CODE[parts[0] ?? ""] ?? "unknown";
}

/**
 * Convert Ping.pe's public task payload into a strict allowlist. Ping.pe may
 * add internal fields to the response; none of them are allowed into GitHub.
 */
export function sanitizePingerMap(raw: unknown): PingerNode[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Ping.pe outstandingNodes is not an object");
  }

  const nodes: PingerNode[] = [];
  for (const [id, value] of Object.entries(raw)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      continue;
    }
    const record = value as Record<string, unknown>;
    if (record.is_public === false) {
      continue;
    }

    const ip = nonEmptyString(record.ip);
    const location = nonEmptyString(record.location);
    const provider = nonEmptyString(record.provider);
    if (!id || !isIPv4(ip) || !location || !provider) {
      continue;
    }

    nodes.push({
      id,
      ip,
      location,
      provider,
      short_location: nonEmptyString(record.short_location),
      short_provider: nonEmptyString(record.short_provider),
      country_code: countryCodeFromId(id),
      region: regionFromId(id),
    });
  }

  return nodes.sort((left, right) => left.id.localeCompare(right.id));
}

export function buildCuratedTargets(
  nodes: PingerNode[],
  selection: SelectionConfig,
): { targets: CuratedTarget[]; missing: string[] } {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const targets: CuratedTarget[] = [];
  const missing: string[] = [];

  for (const selected of selection.targets) {
    const node = byId.get(selected.id);
    if (!node) {
      missing.push(selected.id);
      continue;
    }
    targets.push({ ...node, label: selected.label, reason: selected.reason });
  }

  return { targets, missing };
}

export function countRegions(nodes: PingerNode[]): Record<Region, number> {
  const counts = Object.fromEntries(REGION_ORDER.map((region) => [region, 0])) as Record<
    Region,
    number
  >;
  for (const node of nodes) {
    counts[node.region] += 1;
  }
  return counts;
}

export function validateCatalog(
  nodes: PingerNode[],
  curated: CuratedTarget[],
  missing: string[],
  minimumNodeCount: number,
  previousNodeCount?: number,
): void {
  if (nodes.length < minimumNodeCount) {
    throw new Error(`Catalog too small: ${nodes.length} < ${minimumNodeCount}`);
  }

  const ids = new Set<string>();
  for (const node of nodes) {
    if (ids.has(node.id)) {
      throw new Error(`Duplicate pinger ID: ${node.id}`);
    }
    ids.add(node.id);
  }

  if (previousNodeCount && nodes.length < Math.floor(previousNodeCount * 0.75)) {
    throw new Error(`Catalog shrank unexpectedly: ${previousNodeCount} -> ${nodes.length}`);
  }

  const regions = countRegions(nodes);
  const required: Partial<Record<Region, number>> = {
    africa: 4,
    asia: 15,
    europe: 20,
    "north-america": 20,
    oceania: 2,
    "south-america": 4,
  };
  for (const [region, minimum] of Object.entries(required) as [Region, number][]) {
    if (regions[region] < minimum) {
      throw new Error(`Region ${region} below minimum: ${regions[region]} < ${minimum}`);
    }
  }

  if (missing.length > 5 || curated.length < 30) {
    throw new Error(
      `Curated set incomplete: ${curated.length} present, ${missing.length} missing`,
    );
  }
}

export async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function buildCatalog(
  rawNodes: unknown,
  selection: SelectionConfig,
  target: string,
  minimumNodeCount: number,
  previousNodeCount?: number,
  now = new Date(),
): Promise<PublishedCatalog> {
  const nodes = sanitizePingerMap(rawNodes);
  const { targets, missing } = buildCuratedTargets(nodes, selection);
  validateCatalog(nodes, targets, missing, minimumNodeCount, previousNodeCount);

  const hashInput = JSON.stringify({ nodes, targets, missing });
  const catalogHash = await sha256Hex(hashInput);

  return {
    schema_version: 1,
    source: {
      name: "ping.pe",
      url: `https://ping.pe/${encodeURIComponent(target)}`,
      target,
      method: "public-task-result",
    },
    observed_at: now.toISOString(),
    catalog_hash: catalogHash,
    node_count: nodes.length,
    curated_count: targets.length,
    region_counts: countRegions(nodes),
    missing_curated_ids: missing,
    nodes,
    curated_targets: targets,
  };
}
