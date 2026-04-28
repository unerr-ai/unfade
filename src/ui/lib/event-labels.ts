/** Human-readable source label. */
export function sourceLabel(source: string): string {
  switch (source) {
    case "git":
      return "Git";
    case "ai-session":
      return "AI Session";
    case "terminal":
      return "Terminal";
    case "manual":
      return "Manual";
    default:
      return source;
  }
}

/** Human-readable event type label. */
export function typeLabel(type: string): string {
  switch (type) {
    case "commit":
      return "Commit";
    case "ai-conversation":
      return "AI Conversation";
    case "ai-completion":
      return "AI Completion";
    case "ai-rejection":
      return "AI Rejection";
    case "branch-switch":
      return "Branch Switch";
    case "revert":
      return "Revert";
    default:
      return type;
  }
}

/** Source badge color class. */
export function sourceBadgeClass(source: string): string {
  switch (source) {
    case "git":
      return "bg-orange-500/10 text-orange-400";
    case "ai-session":
      return "bg-violet-500/10 text-violet-400";
    case "terminal":
      return "bg-emerald-500/10 text-emerald-400";
    default:
      return "bg-muted/10 text-muted";
  }
}
