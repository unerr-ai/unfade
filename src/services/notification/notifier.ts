// FILE: src/services/notification/notifier.ts
// UF-040: Notification service.
// Sends system notification when distillation completes.
// Uses USER_TERMS for all user-facing text.

import { exec } from "node:child_process";
import { platform } from "node:os";
import notifier from "node-notifier";
import { USER_TERMS } from "../../constants/terminology.js";
import type { UnfadeConfig } from "../../schemas/config.js";
import type { DailyDistill } from "../../schemas/distill.js";
import { logger } from "../../utils/logger.js";

/**
 * Build a human-readable preview from a distill.
 * Example: "3 decisions, 1 dead end explored"
 */
function buildPreview(distill: DailyDistill): string {
  const parts: string[] = [];

  const dc = distill.decisions.length;
  if (dc > 0) parts.push(`${dc} decision${dc === 1 ? "" : "s"}`);

  const de = distill.deadEnds?.length ?? 0;
  if (de > 0) parts.push(`${de} dead end${de === 1 ? "" : "s"} explored`);

  const to = distill.tradeOffs?.length ?? 0;
  if (to > 0) parts.push(`${to} trade-off${to === 1 ? "" : "s"}`);

  const bt = distill.breakthroughs?.length ?? 0;
  if (bt > 0) parts.push(`${bt} breakthrough${bt === 1 ? "" : "s"}`);

  return parts.length > 0 ? parts.join(", ") : "No significant activity";
}

/**
 * Open the web UI distill viewer in the default browser.
 */
function openWebUI(port: number): void {
  const url = `http://localhost:${port}/distill`;
  const os = platform();

  let cmd: string;
  if (os === "darwin") {
    cmd = `open "${url}"`;
  } else if (os === "win32") {
    cmd = `start "" "${url}"`;
  } else {
    cmd = `xdg-open "${url}"`;
  }

  exec(cmd, (err) => {
    if (err) {
      logger.warn("Could not open browser", { url, error: err.message });
    }
  });
}

/**
 * Send a system notification when distillation completes.
 * Respects config.notification.enabled.
 * Click handler opens web UI.
 */
export function notify(distill: DailyDistill, config: UnfadeConfig): void {
  if (!config.notification.enabled) {
    logger.debug("Notifications disabled, skipping");
    return;
  }

  const title = `Your ${USER_TERMS.distill} is ready`;
  const message = buildPreview(distill);
  const httpPort = config.mcp.httpPort;

  notifier.notify(
    {
      title,
      message,
      sound: config.notification.sound,
      wait: true,
    },
    (err) => {
      if (err) {
        logger.warn("Notification failed", { error: String(err) });
      }
    },
  );

  notifier.on("click", () => {
    openWebUI(httpPort);
  });

  logger.debug("Sent distill notification", { title, message });
}

export { buildPreview };
