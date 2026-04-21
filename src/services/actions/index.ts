// FILE: src/services/actions/index.ts
// 12B.9: ActionRunner singleton with all actions registered.

import { autoRulesAction } from "./auto-rules.js";
import { ActionRunner } from "./runner.js";
import { sessionContextAction } from "./session-context.js";
import { weeklyDigestAction } from "./weekly-digest.js";

let instance: ActionRunner | null = null;

/**
 * Get the singleton ActionRunner with all actions registered.
 * Lazy-initialized on first call.
 */
export function getActionRunner(): ActionRunner {
  if (!instance) {
    instance = new ActionRunner();
    instance.register(autoRulesAction);
    instance.register(sessionContextAction);
    instance.register(weeklyDigestAction);
  }
  return instance;
}
