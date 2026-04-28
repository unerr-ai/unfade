// Types for the onboarding launch SSE stream payloads.

export type NarrativePhase = "capturing" | "understanding" | "building" | "forming" | "ready";

export interface NarrativePhaseConfig {
  id: NarrativePhase;
  title: string;
  description: string;
  messages: string[];
}

export interface LaunchProgress {
  percent: number;
  phase: "pending" | "materializing" | "analyzing" | "complete";
  materializationPercent: number;
  intelligencePercent: number;
  coreFilesComplete: number;
  coreFilesTotal: number;
  currentStage?: string;
  stageDetail?: string;
}

export interface Discovery {
  ts: string;
  message: string;
  icon: string;
}

export interface InsightPreview {
  ts: string;
  analyzer: string;
  title: string;
  headline: string;
  icon: string;
}
