// FILE: src/server/routes/actions.ts
// 12B.5: Coach "Apply to project" endpoint — writes a rule to the detected target file.

import { Hono } from "hono";
import { loadConfig } from "../../config/manager.js";
import { detectRuleTarget } from "../../services/actions/auto-rules.js";
import { replaceMarkerSection } from "../../services/actions/runner.js";
import { localToday } from "../../utils/date.js";
import { getDaemonProjectRoot } from "../../utils/paths.js";

export const actionsRoutes = new Hono();

actionsRoutes.post("/api/actions/apply-rule", async (c) => {
  const body = await c.req.json<{ rule: string }>();
  if (!body.rule || typeof body.rule !== "string") {
    return c.json({ error: "Missing 'rule' field" }, 400);
  }

  const config = loadConfig();
  const repoRoot = getDaemonProjectRoot();
  const detected = detectRuleTarget(repoRoot, config);

  if (!detected) {
    return c.json(
      { error: "No rule target detected. Create .cursor/, CLAUDE.md, or .github/ directory." },
      404,
    );
  }

  const { target, path } = detected;
  const date = localToday();
  const ruleContent = `- ${body.rule} (applied via Coach on ${date})`;

  if (target === "cursor") {
    // For cursor, append to the unfade.mdc marker section
    replaceMarkerSection(path, "RULES", ruleContent);
  } else {
    replaceMarkerSection(path, "RULES", ruleContent);
  }

  return c.json({ applied: true, target: path, rule: body.rule });
});
