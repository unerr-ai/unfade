// FILE: src/server/pages/profile.ts
// UF-074: Profile visualization page v2 (GET /profile) —
// decision style radar, domain distribution with depth/trend,
// patterns with confidence bars, trade-off preferences,
// temporal activity, AI interaction summary.
// Reads ReasoningModelV2 directly for rich rendering.
// Falls back to v1 ProfileOutput for pre-migration profiles.

import { existsSync, readFileSync, statSync } from "node:fs";
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
function loadProfileV2(cwd?: string): {
  profile: ReasoningModelV2 | null;
  lastUpdated: string | null;
} {
  const profilePath = join(getProfileDir(cwd), "reasoning_model.json");
  if (!existsSync(profilePath)) return { profile: null, lastUpdated: null };
  try {
    const raw = readFileSync(profilePath, "utf-8");
    const parsed = JSON.parse(raw);
    const lastUpdated = statSync(profilePath).mtime.toISOString();
    if (parsed.version === 2) return { profile: parsed as ReasoningModelV2, lastUpdated };
    return { profile: null, lastUpdated };
  } catch {
    return { profile: null, lastUpdated: null };
  }
}

/**
 * Render a confidence bar as HTML (0–1 scale, accent-colored fill).
 */
function confidenceBar(confidence: number): string {
  const pct = Math.round(confidence * 100);
  return `<div style="display:flex;align-items:center;gap:0.5rem;width:100%;">
    <div style="flex:1;background:var(--bg-input);border-radius:4px;height:8px;overflow:hidden;">
      <div style="width:${pct}%;height:100%;background:var(--accent);border-radius:4px;"></div>
    </div>
    <span style="font-family:var(--mono);font-size:0.8rem;color:var(--text-dim);min-width:3ch;">${pct}%</span>
  </div>`;
}

/**
 * Render a percentage bar for domain frequency.
 */
function domainBar(percentage: number): string {
  const pct = Math.round(percentage * 100);
  return `<div style="flex:1;background:var(--bg-input);border-radius:4px;height:6px;overflow:hidden;min-width:80px;">
    <div style="width:${pct}%;height:100%;background:var(--accent);border-radius:4px;"></div>
  </div>`;
}

/**
 * Depth badge with color.
 */
function depthBadge(depth: string): string {
  const colors: Record<string, string> = {
    deep: "var(--success)",
    moderate: "var(--warning)",
    shallow: "var(--text-dim)",
  };
  const color = colors[depth] ?? "var(--text-dim)";
  return `<span style="font-size:0.75rem;color:${color};font-weight:600;text-transform:uppercase;">${escapeHtml(depth)}</span>`;
}

/**
 * Trend arrow icon.
 */
function trendArrow(trend: string): string {
  if (trend === "deepening")
    return `<span style="color:var(--success);" title="Deepening">↑</span>`;
  if (trend === "broadening")
    return `<span style="color:var(--accent);" title="Broadening">→</span>`;
  return `<span style="color:var(--text-dim);" title="Stable">—</span>`;
}

profilePage.get("/profile", (c) => {
  const { profile, lastUpdated } = loadProfileV2();

  // Degraded: no v2 profile
  if (!profile || profile.dataPoints < 2) {
    const content = `
      <h1>${escapeHtml(USER_TERMS.profile)}</h1>
      <div class="card">
        <div class="empty">
          <p>Not enough data to build a reasoning profile yet.</p>
          <p>The profile builds automatically as the ${escapeHtml(USER_TERMS.daemon)} captures ${escapeHtml(USER_TERMS.events)} and distills are generated.</p>
          <p style="margin-top:1rem;font-size:0.85rem;">Requires at least 2 distills to detect patterns.</p>
        </div>
      </div>
    `;
    return c.html(layout(USER_TERMS.profile, content));
  }

  const ds = profile.decisionStyle;

  // Decision Style section
  const decisionStyleHtml = `
    <div class="card">
      <h2>Decision Style</h2>
      <div class="stat-grid" style="margin-top:1rem;">
        <div class="stat">
          <div class="value">${ds.avgAlternativesEvaluated.toFixed(1)}</div>
          <div class="label">Avg alternatives evaluated</div>
        </div>
        <div class="stat">
          <div class="value">${ds.medianAlternativesEvaluated.toFixed(1)}</div>
          <div class="label">Median alternatives</div>
        </div>
        <div class="stat">
          <div class="value">${Math.round(ds.aiAcceptanceRate * 100)}%</div>
          <div class="label">AI acceptance rate</div>
        </div>
        <div class="stat">
          <div class="value">${Math.round(ds.aiModificationRate * 100)}%</div>
          <div class="label">AI modification rate</div>
        </div>
      </div>
      ${
        ds.explorationDepthMinutes.overall > 0
          ? `<p style="color:var(--text-dim);font-size:0.85rem;margin-top:0.5rem;">Exploration depth: ${ds.explorationDepthMinutes.overall.toFixed(0)} min average</p>`
          : ""
      }
    </div>
  `;

  // Domain Distribution section
  const sortedDomains = [...profile.domainDistribution].sort((a, b) => b.frequency - a.frequency);
  const domainHtml =
    sortedDomains.length > 0
      ? `<div class="card">
           <h2>Domain Distribution</h2>
           <div style="margin-top:0.75rem;">
             ${sortedDomains
               .map(
                 (d) => `
               <div style="display:flex;align-items:center;gap:0.75rem;padding:0.5rem 0;border-bottom:1px solid var(--border);">
                 <span style="min-width:120px;font-weight:600;">${escapeHtml(d.domain)}</span>
                 ${domainBar(d.percentageOfTotal)}
                 <span style="font-family:var(--mono);font-size:0.85rem;color:var(--accent);min-width:3ch;">${d.frequency}</span>
                 ${depthBadge(d.depth)}
                 ${trendArrow(d.depthTrend)}
                 <span style="font-size:0.8rem;color:var(--text-dim);">${d.avgAlternativesInDomain.toFixed(1)} avg alts</span>
               </div>`,
               )
               .join("")}
           </div>
         </div>`
      : "";

  // Patterns section (>0.7 confidence)
  const surfaceable = profile.patterns.filter((p) => p.confidence >= 0.7);
  const patternsHtml =
    surfaceable.length > 0
      ? `<div class="card">
           <h2>Detected Patterns</h2>
           <p style="color:var(--text-dim);font-size:0.85rem;margin-bottom:0.75rem;">Confidence &gt; 70% — based on ${profile.dataPoints} observations</p>
           ${surfaceable
             .map(
               (p) => `
             <div style="padding:0.75rem;margin-bottom:0.5rem;background:var(--bg-input);border-radius:var(--radius);">
               <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.25rem;">
                 <span style="font-size:0.9rem;">${escapeHtml(p.pattern)}</span>
                 <span class="badge" style="background:rgba(0,153,255,0.15);color:var(--accent);">${p.category}</span>
               </div>
               ${confidenceBar(p.confidence)}
               <div style="font-size:0.75rem;color:var(--text-dim);margin-top:0.25rem;">${p.examples} examples · since ${escapeHtml(p.observedSince)}</div>
             </div>`,
             )
             .join("")}
         </div>`
      : `<div class="card">
           <h2>Detected Patterns</h2>
           <p style="color:var(--text-dim);">No patterns detected yet (requires confidence &gt; 70%).</p>
         </div>`;

  // Trade-off Preferences section
  const tradeOffsHtml =
    profile.tradeOffPreferences.length > 0
      ? `<div class="card">
           <h2>Trade-off Preferences</h2>
           ${profile.tradeOffPreferences
             .map(
               (t) => `
             <div style="padding:0.5rem 0;border-bottom:1px solid var(--border);">
               <span style="font-weight:600;">${escapeHtml(t.preference)}</span>
               ${confidenceBar(t.confidence)}
               <span style="font-size:0.75rem;color:var(--text-dim);">${t.supportingDecisions} supporting · ${t.contradictingDecisions} contradicting</span>
             </div>`,
             )
             .join("")}
         </div>`
      : "";

  // Temporal Patterns section
  const tp = profile.temporalPatterns;
  const temporalHtml = `
    <div class="card">
      <h2>Activity Patterns</h2>
      <div class="stat-grid" style="margin-top:0.75rem;">
        <div class="stat">
          <div class="value">${tp.avgDecisionsPerDay.toFixed(1)}</div>
          <div class="label">Decisions / day</div>
        </div>
        <div class="stat">
          <div class="value">${profile.dataPoints}</div>
          <div class="label">Total observations</div>
        </div>
      </div>
      ${
        tp.mostProductiveHours.length > 0
          ? `<p style="color:var(--text-dim);font-size:0.85rem;margin-top:0.5rem;">Most productive hours: ${tp.mostProductiveHours.map((h) => `${h}:00`).join(", ")}</p>`
          : ""
      }
    </div>
  `;

  const content = `
    <h1>${escapeHtml(USER_TERMS.profile)}</h1>
    ${decisionStyleHtml}
    ${domainHtml}
    ${patternsHtml}
    ${tradeOffsHtml}
    ${temporalHtml}
    ${
      lastUpdated
        ? `<p style="color:var(--text-dim);font-size:0.8rem;margin-top:1rem;">Last updated: ${escapeHtml(lastUpdated)}</p>`
        : ""
    }
  `;

  return c.html(layout(USER_TERMS.profile, content));
});
