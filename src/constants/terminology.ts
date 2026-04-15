// FILE: src/constants/terminology.ts
// User-facing terminology constants.
// All user-facing output MUST import from this module.
// "Daemon" remains in code identifiers, logs, and developer docs.

export const USER_TERMS = {
  daemon: "capture engine",
  daemonRunning: "Capturing",
  daemonStopped: "Capture paused",
  daemonCrashed: "Capture engine stopped unexpectedly",
  daemonStarting: "Starting capture engine",
  daemonStopping: "Stopping capture engine",
  events: "reasoning signals",
  distill: "Daily Distill",
  distilling: "Distilling",
  profile: "Reasoning Fingerprint",
  unfadeDir: ".unfade",
  initCommand: "unfade init",
} as const;

export type UserTerm = keyof typeof USER_TERMS;
