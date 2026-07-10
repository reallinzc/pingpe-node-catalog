export type Region =
  | "africa"
  | "asia"
  | "europe"
  | "middle-east"
  | "north-america"
  | "oceania"
  | "south-america"
  | "unknown";

export interface PingerNode {
  id: string;
  ip: string;
  location: string;
  provider: string;
  short_location: string;
  short_provider: string;
  country_code: string;
  region: Region;
}

export interface SelectionTarget {
  id: string;
  label: string;
  reason: string;
}

export interface SelectionConfig {
  schema_version: number;
  description: string;
  targets: SelectionTarget[];
}

export interface CuratedTarget extends PingerNode {
  label: string;
  reason: string;
}

export interface PublishedCatalog {
  schema_version: 1;
  source: {
    name: "ping.pe";
    url: string;
    target: string;
    method: "public-task-result";
  };
  observed_at: string;
  catalog_hash: string;
  node_count: number;
  curated_count: number;
  region_counts: Record<Region, number>;
  missing_curated_ids: string[];
  nodes: PingerNode[];
  curated_targets: CuratedTarget[];
}

export interface SyncStatus {
  status: "idle" | "running" | "success" | "failed";
  trigger?: string;
  started_at?: string;
  finished_at?: string;
  last_checked_at?: string;
  action?: "created" | "updated" | "unchanged";
  node_count?: number;
  curated_count?: number;
  catalog_hash?: string;
  commit_url?: string;
  error?: string;
}
