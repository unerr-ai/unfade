export interface CapturedEvent {
  id: string;
  timestamp: string;
  source: string;
  type: string;
  content: {
    summary?: string;
    detail?: string;
    files?: string[];
    branch?: string;
    project?: string;
  };
}

export interface Narrative {
  id: string;
  claim: string;
  severity?: "info" | "warning" | "critical";
  type?: "diagnostic" | "prescription";
  action?: string;
  estimatedImpact?: string;
  confidence?: number;
  timestamp?: string;
}

export interface Insight {
  claim: string;
  confidence?: number;
  sources?: string[];
  projectId?: string;
  timestamp?: string;
}
