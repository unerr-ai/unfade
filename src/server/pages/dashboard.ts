// FILE: src/server/pages/dashboard.ts
// UF-051a-dash: Dashboard page (GET /) — status, event count, decisions,
// latest distill preview, profile quick stats.

import { Hono } from "hono";
import { USER_TERMS } from "../../constants/terminology.js";
import { getRecentContext } from "../../tools/unfade-context.js";
import { getDecisions } from "../../tools/unfade-decisions.js";
import { getProfile } from "../../tools/unfade-profile.js";
import { escapeHtml, layout } from "./layout.js";

export const dashboardPage = new Hono();

dashboardPage.get("/", (c) => {
  const context = getRecentContext({ scope: "today" });
  const profile = getProfile();
  const decisions = getDecisions({ limit: 5 });

  const eventCount = context.data.eventCount;
  const decisionCount = decisions.data.total;
  const distillSummary = context.data.distillSummary;

  // Status badge
  const isCapturing = !context._meta.degraded;
  const statusBadge = isCapturing
    ? `<span class="badge badge-ok">${escapeHtml(USER_TERMS.daemonRunning)}</span>`
    : `<span class="badge badge-warn">${escapeHtml(USER_TERMS.daemonStopped)}</span>`;

  // Profile quick stats
  const pd = profile.data;
  const topDomains =
    pd.domainDistribution
      .slice(0, 3)
      .map((d) => escapeHtml(d.domain))
      .join(", ") || "None yet";

  const content = `
    <h1>Dashboard</h1>

    <div style="margin-bottom: 1.5rem;">
      ${statusBadge}
    </div>

    <div class="stat-grid">
      <div class="stat">
        <div class="value">${eventCount}</div>
        <div class="label">${escapeHtml(USER_TERMS.events)} today</div>
      </div>
      <div class="stat">
        <div class="value">${decisionCount}</div>
        <div class="label">Decisions</div>
      </div>
      <div class="stat">
        <div class="value">${pd.distillCount}</div>
        <div class="label">Distills</div>
      </div>
      <div class="stat">
        <div class="value">${Math.round(pd.aiAcceptanceRate * 100)}%</div>
        <div class="label">AI acceptance</div>
      </div>
    </div>

    <div class="card">
      <h2>Latest ${escapeHtml(USER_TERMS.distill)}</h2>
      ${
        distillSummary
          ? `<p>${escapeHtml(distillSummary.length > 200 ? `${distillSummary.slice(0, 200)}...` : distillSummary)}</p>
             <a href="/distill">View full distill</a>`
          : `<div class="empty">
               <p>No distill for today yet.</p>
               <p>Distills are generated after the ${escapeHtml(USER_TERMS.daemon)} captures enough ${escapeHtml(USER_TERMS.events)}.</p>
             </div>`
      }
    </div>

    <div class="card">
      <h2>${escapeHtml(USER_TERMS.profile)}</h2>
      <p style="color: var(--text-dim); font-size: 0.9rem; margin-bottom: 0.75rem;">
        Top domains: ${topDomains}
      </p>
      <p style="color: var(--text-dim); font-size: 0.9rem;">
        ${pd.avgDecisionsPerDay.toFixed(1)} decisions/day &middot;
        ${pd.avgAlternativesEvaluated.toFixed(1)} alternatives evaluated &middot;
        ${pd.patterns.length} patterns detected
      </p>
      <a href="/profile" style="display: inline-block; margin-top: 0.5rem;">View full profile</a>
    </div>

    ${
      decisions.data.decisions.length > 0
        ? `<div class="card">
             <h2>Recent Decisions</h2>
             <ul class="domain-list">
               ${decisions.data.decisions
                 .map(
                   (d) =>
                     `<li>
                       <span><strong>${escapeHtml(d.decision)}</strong>${d.domain ? ` <span style="color: var(--text-dim);">[${escapeHtml(d.domain)}]</span>` : ""}</span>
                       <span class="freq">${escapeHtml(d.date)}</span>
                     </li>`,
                 )
                 .join("")}
             </ul>
           </div>`
        : ""
    }
  `;

  return c.html(layout("Dashboard", content));
});
