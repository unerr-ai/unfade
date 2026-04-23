// FILE: src/server/pages/profile.ts
// Profile visualization page (GET /profile) —
// decision style metrics, domain distribution with depth/trend,
// patterns with confidence bars, trade-off preferences,
// temporal activity patterns.

import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { Hono } from "hono";
import { USER_TERMS } from "../../constants/terminology.js";
import type { ReasoningModelV2 } from "../../schemas/profile.js";
import { getProfileDir } from "../../utils/paths.js";
import { escapeHtml, layout } from "./layout.js";

export const profilePage = new Hono();

/**
 * Load v2 reasoning profile from disk. Returns null if missing or not v2.
 */
async function loadProfileV2(cwd?: string): Promise<{
  profile: ReasoningModelV2 | null;
  lastUpdated: string | null;
}> {
  const profilePath = join(getProfileDir(cwd), "reasoning_model.json");
  if (!existsSync(profilePath)) return { profile: null, lastUpdated: null };
  try {
    const raw = await readFile(profilePath, "utf-8");
    const parsed = JSON.parse(raw);
    const lastUpdated = (await stat(profilePath)).mtime.toISOString();
    if (parsed.version === 2) return { profile: parsed as ReasoningModelV2, lastUpdated };
    return { profile: null, lastUpdated: null };
  } catch {
    return { profile: null, lastUpdated: null };
  }
}

/**
 * Render a confidence bar (0–1 scale).
 */
function confidenceBar(confidence: number): string {
  const pct = Math.round(confidence * 100);
  return `<div class="flex items-center gap-2 w-full">
    <div class="flex-1 bg-raised rounded h-2 overflow-hidden">
      <div class="h-full bg-accent rounded" style="width:${pct}%"></div>
    </div>
    <span class="font-mono text-xs text-muted min-w-[3ch]">${pct}%</span>
  </div>`;
}

/**
 * Render a percentage bar for domain frequency.
 */
function domainBar(percentage: number): string {
  const pct = Math.round(percentage * 100);
  return `<div class="flex-1 bg-raised rounded h-1.5 overflow-hidden min-w-[80px]">
    <div class="h-full bg-accent rounded" style="width:${pct}%"></div>
  </div>`;
}

/**
 * Depth badge with semantic color.
 */
function depthBadge(depth: string): string {
  const styles: Record<string, string> = {
    deep: "text-success",
    moderate: "text-warning",
    shallow: "text-muted",
  };
  const cls = styles[depth] ?? "text-muted";
  return `<span class="text-xs font-semibold uppercase ${cls}">${escapeHtml(depth)}</span>`;
}

/**
 * Trend arrow icon.
 */
function trendArrow(trend: string): string {
  if (trend === "deepening") return `<span class="text-success" title="Deepening">↑</span>`;
  if (trend === "broadening") return `<span class="text-accent" title="Broadening">→</span>`;
  return `<span class="text-muted" title="Stable">—</span>`;
}

profilePage.get("/profile", async (c) => {
  const { profile, lastUpdated } = await loadProfileV2();

  if (!profile || profile.dataPoints < 2) {
    const content = `
      <h1 class="text-2xl font-heading font-semibold mb-6">${escapeHtml(USER_TERMS.profile)}</h1>
      <div class="bg-surface border border-border rounded p-5">
        <div class="text-center py-8 text-muted">
          <p class="mb-2">Not enough data to build a reasoning profile yet.</p>
          <p class="text-sm">The profile builds automatically as the ${escapeHtml(USER_TERMS.daemon)} captures ${escapeHtml(USER_TERMS.events)} and distills are generated.</p>
          <p class="mt-4 text-sm">Requires at least 2 distills to detect patterns.</p>
        </div>
      </div>
    `;
    return c.html(layout(USER_TERMS.profile, content));
  }

  const ds = profile.decisionStyle;

  const decisionStyleHtml = `
    <div class="bg-surface border border-border rounded p-5 mb-4">
      <h2 class="text-lg font-heading font-semibold mb-4">Decision Style</h2>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div class="bg-canvas border border-border rounded p-4 text-center">
          <div class="font-mono text-2xl font-bold text-accent">${ds.avgAlternativesEvaluated.toFixed(1)}</div>
          <div class="text-xs text-muted mt-1">Avg alternatives evaluated</div>
        </div>
        <div class="bg-canvas border border-border rounded p-4 text-center">
          <div class="font-mono text-2xl font-bold text-accent">${ds.medianAlternativesEvaluated.toFixed(1)}</div>
          <div class="text-xs text-muted mt-1">Median alternatives</div>
        </div>
        <div class="bg-canvas border border-border rounded p-4 text-center">
          <div class="font-mono text-2xl font-bold text-accent">${Math.round(ds.aiAcceptanceRate * 100)}%</div>
          <div class="text-xs text-muted mt-1">AI acceptance rate</div>
        </div>
        <div class="bg-canvas border border-border rounded p-4 text-center">
          <div class="font-mono text-2xl font-bold text-accent">${Math.round(ds.aiModificationRate * 100)}%</div>
          <div class="text-xs text-muted mt-1">AI modification rate</div>
        </div>
      </div>
      ${
        ds.explorationDepthMinutes.overall > 0
          ? `<p class="text-muted text-sm mt-3">Exploration depth: ${ds.explorationDepthMinutes.overall.toFixed(0)} min average</p>`
          : ""
      }
    </div>
  `;

  const sortedDomains = [...(profile.domainDistribution ?? [])].sort(
    (a, b) => b.frequency - a.frequency,
  );
  const domainHtml =
    sortedDomains.length > 0
      ? `<div class="bg-surface border border-border rounded p-5 mb-4">
           <h2 class="text-lg font-heading font-semibold mb-4">Domain Distribution</h2>
           <div class="space-y-0">
             ${sortedDomains
               .map(
                 (d) => `
               <div class="flex items-center gap-3 py-3 border-b border-border last:border-0">
                 <span class="min-w-[120px] font-semibold text-sm">${escapeHtml(d.domain)}</span>
                 ${domainBar(d.percentageOfTotal)}
                 <span class="font-mono text-sm text-cyan min-w-[3ch]">${d.frequency}</span>
                 ${depthBadge(d.depth)}
                 ${trendArrow(d.depthTrend)}
                 <span class="text-xs text-muted">${d.avgAlternativesInDomain.toFixed(1)} avg alts</span>
               </div>`,
               )
               .join("")}
           </div>
         </div>`
      : "";

  const surfaceable = (profile.patterns ?? []).filter((p) => p.confidence >= 0.7);
  const patternsHtml =
    surfaceable.length > 0
      ? `<div class="bg-surface border border-border rounded p-5 mb-4">
           <h2 class="text-lg font-heading font-semibold mb-2">Detected Patterns</h2>
           <p class="text-muted text-sm mb-4">Confidence &gt; 70% — based on ${profile.dataPoints} observations</p>
           ${surfaceable
             .map(
               (p) => `
             <div class="bg-raised rounded p-4 mb-3">
               <div class="flex justify-between items-center mb-1">
                 <span class="text-sm">${escapeHtml(p.pattern)}</span>
                 <span class="inline-block px-2 py-0.5 rounded-full text-xs font-semibold bg-accent/15 text-accent">${escapeHtml(p.category)}</span>
               </div>
               ${confidenceBar(p.confidence)}
               <div class="text-xs text-muted mt-1">${p.examples} examples · since ${escapeHtml(p.observedSince)}</div>
             </div>`,
             )
             .join("")}
         </div>`
      : `<div class="bg-surface border border-border rounded p-5 mb-4">
           <h2 class="text-lg font-heading font-semibold mb-2">Detected Patterns</h2>
           <p class="text-muted">No patterns detected yet (requires confidence &gt; 70%).</p>
         </div>`;

  const tradeOffs = profile.tradeOffPreferences ?? [];
  const tradeOffsHtml =
    tradeOffs.length > 0
      ? `<div class="bg-surface border border-border rounded p-5 mb-4">
           <h2 class="text-lg font-heading font-semibold mb-4">Trade-off Preferences</h2>
           ${tradeOffs
             .map(
               (t) => `
             <div class="py-3 border-b border-border last:border-0">
               <span class="font-semibold text-sm">${escapeHtml(t.preference)}</span>
               ${confidenceBar(t.confidence)}
               <span class="text-xs text-muted">${t.supportingDecisions} supporting · ${t.contradictingDecisions} contradicting</span>
             </div>`,
             )
             .join("")}
         </div>`
      : "";

  const tp = profile.temporalPatterns;
  const temporalHtml = `
    <div class="bg-surface border border-border rounded p-5 mb-4">
      <h2 class="text-lg font-heading font-semibold mb-4">Activity Patterns</h2>
      <div class="grid grid-cols-2 gap-4">
        <div class="bg-canvas border border-border rounded p-4 text-center">
          <div class="font-mono text-2xl font-bold text-accent">${tp.avgDecisionsPerDay.toFixed(1)}</div>
          <div class="text-xs text-muted mt-1">Decisions / day</div>
        </div>
        <div class="bg-canvas border border-border rounded p-4 text-center">
          <div class="font-mono text-2xl font-bold text-accent">${profile.dataPoints}</div>
          <div class="text-xs text-muted mt-1">Total observations</div>
        </div>
      </div>
      ${
        tp.mostProductiveHours.length > 0
          ? `<p class="text-muted text-sm mt-3">Most productive hours: ${tp.mostProductiveHours.map((h) => `${h}:00`).join(", ")}</p>`
          : ""
      }
    </div>
  `;

  const content = `
    <h1 class="text-2xl font-heading font-semibold mb-6">${escapeHtml(USER_TERMS.profile)}</h1>
    ${decisionStyleHtml}
    ${domainHtml}
    ${patternsHtml}
    ${tradeOffsHtml}
    ${temporalHtml}
    ${
      lastUpdated
        ? `<p class="text-muted text-xs mt-4">Last updated: ${escapeHtml(lastUpdated)}</p>`
        : ""
    }
  `;

  return c.html(layout(USER_TERMS.profile, content));
});
