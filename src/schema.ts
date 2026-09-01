export interface Death {
  phase: string;
  error: string;
  at: string | null;
}

export interface RunManifest {
  subject: string;
  repo_sha: string;
  model: string;
  runtime: "native" | "host-grok" | "host-opencode";
  openwiki_version: string;
  seed: number;
  started_at: string | null;
  finished_at: string | null;
  wall_seconds: number | null;
  outcome: "complete" | "incomplete" | "died";
  deaths: Death[];
  resumes: number | null;
  env: {
    provider: string;
    base_url: string | null;
    streaming: boolean | null;
    headers_timeout_ms: number | null;
  };
  prompt_sha: string | null;
  ignore_sha: string | null;
  system_sha?: string | null;
  execution?: {
    agent: string;
    opencode_version: string;
    session_ids: string[];
    timeout_seconds: number;
    telemetry_file: string;
  };
  cost: {
    input_tokens: number | null;
    output_tokens: number | null;
    usd: number | null;
    source: "none" | "langsmith" | "proxy" | "opencode";
  };
}

export interface SubjectManifest {
  id: string;
  repo_url: string;
  repo_sha: string;
  contamination: string;
  notes: string | null;
}

export interface PlanPage {
  path: string;
  title?: string;
  seedPaths?: string[];
}

export interface PlanSummary {
  plan_page_count?: number;
  pageCount?: number;
  pages: PlanPage[];
}

export interface Evidence {
  resource: string;
  version: string;
}

export interface ClaimFile {
  schemaVersion: number;
  claims: Array<{
    id: string;
    statement: string;
    evidence: Evidence[];
  }>;
}

export interface GroundingScore {
  claims: number;
  evidence: number;
  resolvable: number;
  in_range: number;
  exact: number;
  resolvable_pct: number;
  in_range_pct: number;
  exact_pct: number;
  claims_per_page: number;
  evidence_per_claim: number;
}

export interface StructureScore {
  plan_pages: number;
  completed_plan_pages: number;
  completeness: number;
  markdown_pages: number;
  markdown_lines: number;
  lines_per_page: number;
  citations_per_100_lines: number;
  internal_links: number;
  resolved_internal_links: number;
  link_integrity: number;
  coverage_units: number;
  covered_units: number;
  coverage: number;
  seed_paths: number | null;
  covered_seed_paths: number | null;
  seed_path_coverage: number | null;
  redundancy: number;
}

export interface RunScore {
  subject: string;
  model: string;
  runtime: RunManifest["runtime"];
  seed: number;
  outcome: RunManifest["outcome"];
  grounding: GroundingScore;
  structure: StructureScore;
}

export interface ScoresFile {
  schema_version: 1;
  subject: { id: string; repo_sha: string };
  runs: RunScore[];
}
