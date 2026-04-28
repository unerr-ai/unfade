import type { CapturedEvent, Insight, Narrative } from "@/types/events";
import type { SystemHealth } from "@/types/health";
import type {
  Autonomy,
  Comprehension,
  Costs,
  Efficiency,
  MaturityAssessment,
  PromptPatterns,
  Velocity,
} from "@/types/intelligence";
import type { DiscoveredProject, Project, RepoEntry } from "@/types/projects";
import type { SummaryJson } from "@/types/summary";

/**
 * Warming-up error — thrown when a 202 is received so TanStack Query
 * retries with backoff instead of caching null forever.
 */
export class WarmingUpError extends Error {
  constructor(path: string) {
    super(`${path}: warming up (202)`);
    this.name = "WarmingUpError";
  }
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (res.status === 202) throw new WarmingUpError(path);
  if (res.status === 204) return null as T;
  if (!res.ok) throw new Error(`API ${path}: ${res.status}`);
  return res.json();
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 202) throw new WarmingUpError(path);
  if (res.status === 204) return null as T;
  if (!res.ok) throw new Error(`API ${path}: ${res.status}`);
  return res.json();
}

export const api = {
  summary: () => get<SummaryJson>("/api/summary"),
  health: () =>
    get<{ data: SystemHealth; _meta: unknown }>("/api/system/health").then((r) => r.data),

  repos: {
    list: () => get<RepoEntry[]>("/api/repos"),
    get: (id: string) => get<RepoEntry>(`/api/repos/${id}`),
    events: (id: string, params?: { from?: string; to?: string; limit?: number }) => {
      const qs = new URLSearchParams();
      if (params?.from) qs.set("from", params.from);
      if (params?.to) qs.set("to", params.to);
      if (params?.limit) qs.set("limit", String(params.limit));
      return get<{
        repoId: string;
        repoLabel: string;
        from: string;
        to: string;
        total: number;
        events: CapturedEvent[];
      }>(`/api/repos/${id}/events?${qs}`);
    },
  },

  projects: {
    list: () => get<{ projects: Project[] }>("/api/projects"),
    discover: () =>
      get<{ discovered: DiscoveredProject[] }>("/api/projects/discover").then((r) => ({
        projects: r.discovered,
      })),
    add: (path: string) =>
      post<{ ok: boolean; project: Project }>("/api/projects", { path }).then((r) => r.project),
    pause: (id: string) => post<{ ok: boolean; monitoring: string }>(`/api/projects/${id}/pause`),
    resume: (id: string) => post<{ ok: boolean; monitoring: string }>(`/api/projects/${id}/resume`),
    restart: (id: string) => post<{ ok: boolean; message: string }>(`/api/projects/${id}/restart`),
  },

  intelligence: {
    efficiency: () => get<Efficiency>("/api/intelligence/efficiency"),
    costs: () => get<Costs>("/api/intelligence/costs"),
    comprehension: () => get<Comprehension>("/api/intelligence/comprehension"),
    promptPatterns: () => get<PromptPatterns>("/api/intelligence/prompt-patterns"),
    velocity: () => get<Velocity>("/api/intelligence/velocity"),
    alerts: () => get<{ alerts: unknown[] }>("/api/intelligence/alerts"),
    replays: () => get<{ replays: unknown[] }>("/api/intelligence/replays"),
    decisionDurability: () => get<unknown>("/api/intelligence/decision-durability"),
    autonomy: () => get<Autonomy>("/api/intelligence/autonomy"),
    maturityAssessment: () => get<MaturityAssessment>("/api/intelligence/maturity-assessment"),
    commitAnalysis: () => get<unknown>("/api/intelligence/commit-analysis"),
    expertiseMap: () => get<unknown>("/api/intelligence/expertise-map"),
    dualVelocity: () => get<unknown>("/api/intelligence/dual-velocity"),
    efficiencySurvival: () => get<unknown>("/api/intelligence/efficiency-survival"),
    fileChurn: () => get<unknown>("/api/intelligence/file-churn"),
    aiGitLinks: () => get<unknown>("/api/intelligence/ai-git-links"),
    sessionsActive: () =>
      get<{ sessions: unknown[]; count: number }>("/api/intelligence/sessions/active"),
    diagnosticsActive: () =>
      get<{ diagnostics: unknown[]; count: number }>("/api/intelligence/diagnostics/active"),
    crossProject: () => get<unknown>("/api/intelligence/cross-project"),
    narratives: () =>
      get<{ narratives: Narrative[]; count: number }>("/api/intelligence/narratives"),
    correlations: () => get<unknown>("/api/intelligence/correlations"),
  },

  insights: {
    recent: () => get<Insight[]>("/api/insights/recent"),
  },

  substrate: {
    topology: () => get<unknown>("/api/substrate/topology"),
    trajectories: () => get<unknown>("/api/substrate/trajectories"),
    entityNeighborhood: (id: string) => get<unknown>(`/api/substrate/entity/${id}/neighborhood`),
  },

  decisions: {
    list: (params?: {
      q?: string;
      period?: string;
      domain?: string;
      limit?: number;
      offset?: number;
      project?: string;
    }) => {
      const qs = new URLSearchParams();
      if (params?.q) qs.set("q", params.q);
      if (params?.period) qs.set("period", params.period);
      if (params?.domain) qs.set("domain", params.domain);
      if (params?.limit) qs.set("limit", String(params.limit));
      if (params?.offset) qs.set("offset", String(params.offset));
      if (params?.project) qs.set("project", params.project);
      return get<{ data: { decisions: Decision[]; total: number }; _meta: unknown }>(
        `/api/decisions?${qs}`,
      );
    },
    detail: (index: number) => get<DecisionDetail>(`/api/decisions/${index}`),
  },

  distill: {
    latest: () =>
      get<{ data: DistillResponse | null; _meta: unknown }>("/api/distill/latest").then(
        (r) => r.data,
      ),
    byDate: (date: string) =>
      get<{ data: DistillResponse | null; _meta: unknown }>(`/api/distill/${date}`).then(
        (r) => r.data,
      ),
    enriched: (date: string) =>
      get<{ data: EnrichedDistillResponse | null; _meta: unknown }>(
        `/api/distill/${date}/enriched`,
      ).then((r) => r.data),
    generate: (date: string) => post<unknown>("/api/distill", { date }),
  },

  profile: {
    get: () => get<ProfileResponse>("/api/profile"),
  },

  setup: {
    discoverProjects: () =>
      get<{ projects: DiscoveredProject[]; cwd: string }>("/api/setup/discover-projects"),
    addProject: (path: string) =>
      post<{ success: boolean; entry: unknown; commitCount: number }>("/api/setup/add-project", {
        path,
      }),
    verifyLlm: (config: { provider: string; model: string; apiKey?: string; apiBase?: string }) =>
      post<{ success: boolean; message?: string; error?: string }>("/api/setup/verify-llm", config),
    complete: () => post<unknown>("/api/setup/complete"),
    detectAgents: () =>
      get<{ agents: Array<{ name: string; installed: boolean }> }>("/api/setup/detect-agents"),
    installSkills: (agents: string[]) => post<unknown>("/api/setup/install-skills", { agents }),
    progress: () =>
      get<{
        percent: number;
        phase: string;
        totalEvents: number;
        processedEvents: number;
        materializationPercent: number;
        intelligencePercent: number;
        coreFilesTotal: number;
        coreFilesComplete: number;
      }>("/api/setup/progress"),
  },

  settings: {
    status: () =>
      get<{
        data: {
          configured: boolean;
          provider: string;
          model: string;
          validated: boolean;
          reason?: string;
        };
        actions: Record<string, unknown>;
        _meta: unknown;
      }>("/api/settings/status"),
    saveLlm: (config: { provider: string; model: string; apiKey?: string; apiBase?: string }) =>
      post<unknown>("/api/settings/llm", config),
  },

  integrations: {
    status: () =>
      get<{
        tools: Array<{ tool: string; label: string; connected: boolean; path: string }>;
      }>("/api/integrations/status"),
    install: (tool: string) => post<unknown>("/api/integrations/install", { tool }),
  },

  logs: {
    list: (params?: { level?: string; source?: string; limit?: number }) => {
      const qs = new URLSearchParams();
      if (params?.level) qs.set("level", params.level);
      if (params?.source) qs.set("source", params.source);
      if (params?.limit) qs.set("limit", String(params.limit));
      return get<{
        data: { entries: LogEntry[]; total: number; bufferSize: number };
        _meta: unknown;
      }>(`/api/logs?${qs}`);
    },
  },

  cards: {
    generate: (params?: { date?: string; style?: string }) =>
      post<{
        data: { status: string; date: string; size: number; path: string };
        _meta: unknown;
      }>("/api/cards/generate", params),
    list: () =>
      get<{ cards: Array<{ date: string; size: number; createdAt: string }> }>("/api/cards/list"),
    imageUrl: (date: string) => `/api/cards/image/${date}`,
  },
} as const;

export interface LogEntry {
  timestamp: string;
  level: "debug" | "info" | "warn" | "error";
  component: string;
  message: string;
}

export interface Decision {
  date: string;
  decision: string;
  rationale: string;
  domain?: string;
  alternativesConsidered?: number;
  /** Which project this decision belongs to. */
  projectId?: string;
  /** Human-readable project name resolved from registry. */
  projectName?: string;
  /** Event IDs that contributed to this decision (evidence chain). */
  evidenceEventIds?: string[];
  /** Human Direction Score — how much the developer steered this decision (0-1). */
  humanDirectionScore?: number;
  /** Classification: human-directed, ai-suggested, collaborative. */
  directionClassification?: string;
}

export interface EvidenceEvent {
  id: string;
  timestamp: string;
  source: string;
  type: string;
  summary: string;
  detail?: string;
  branch?: string;
  files?: string[];
  conversationTitle?: string;
}

export interface DecisionDetail {
  index: number;
  decision: Decision & { evidenceEventIds?: string[] };
  evidence: EvidenceEvent[];
  projectName?: string;
}

export interface DistillResponse {
  date: string;
  content: string;
  synthesizedBy?: string;
  metadata?: { decisions?: number; domains?: string[]; deadEnds?: number; tradeOffs?: number };
}

export interface EnrichedDecisionResponse {
  decision: string;
  rationale: string;
  domain?: string;
  alternativesConsidered: number;
  impactScore: number;
  tier: "primary" | "supporting" | "background";
  projectId?: string;
  projectName?: string;
  evidenceEventIds: string[];
  causalTrigger?: string;
  outcome?: string;
  humanDirectionScore?: number;
  directionClassification?: "human-directed" | "collaborative" | "ai-suggested";
  actIndex?: number;
}

export interface EnrichedTradeOffResponse {
  tradeOff: string;
  chose: string;
  rejected: string;
  context?: string;
  evidenceEventIds: string[];
}

export interface EnrichedDeadEndResponse {
  description: string;
  attemptSummary: string;
  timeSpentMinutes?: number;
  resolution?: string;
  detectionMethod: string;
  evidenceEventIds: string[];
}

export interface NarrativeArc {
  type: string;
  headline: string;
  openingContext: string;
  closingState: string;
}

export interface ContinuityThread {
  question: string;
  evidenceEventIds: string[];
  domain: string;
  resolved: boolean;
  continuedFrom?: string;
}

/** v2 enriched distill — structured narrative output */
export type EnrichedDistillResponse =
  | {
      version: 2;
      date: string;
      narrative: { arc: NarrativeArc; acts: unknown[]; continuityThreads: ContinuityThread[] };
      decisions: EnrichedDecisionResponse[];
      tradeOffs: EnrichedTradeOffResponse[];
      deadEnds: EnrichedDeadEndResponse[];
      breakthroughs: Array<{ description: string; trigger?: string }>;
      patterns: string[];
      domains: string[];
      continuityThreads: ContinuityThread[];
      meta: {
        eventsProcessed: number;
        synthesizedBy: "llm" | "fallback";
        synthesizedAt: string;
        signalCounts: { primary: number; supporting: number; background: number };
        dayShape: { dominantDomain: string; peakActivityHour: number; arcType: string };
      };
      lastUpdated?: string;
    }
  | {
      version: 1;
      date: string;
      markdown: string;
      lastUpdated?: string;
    };

export interface ProfileResponse {
  data: {
    version: number;
    updatedAt: string;
    distillCount: number;
    dataPoints: number;
    avgAlternativesEvaluated: number;
    aiAcceptanceRate: number;
    decisionStyle: {
      avgAlternativesEvaluated: number;
      medianAlternativesEvaluated: number;
      aiAcceptanceRate: number;
      aiModificationRate: number;
      explorationDepthMinutes: { overall: number };
    };
    domainDistribution: Array<{
      domain: string;
      frequency: number;
      percentageOfTotal: number;
      depth: string;
      depthTrend: string;
      avgAlternativesInDomain: number;
    }>;
    patterns: Array<{
      pattern: string;
      category: string;
      confidence: number;
      examples: number;
      observedSince: string;
    }>;
    tradeOffPreferences: Array<{
      preference: string;
      confidence: number;
      supportingDecisions: number;
      contradictingDecisions: number;
    }>;
    temporalPatterns: { avgDecisionsPerDay: number; mostProductiveHours: number[] };
  };
  _meta: unknown;
}
