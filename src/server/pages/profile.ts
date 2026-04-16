// FILE: src/server/pages/profile.ts
// UF-051a-profile: Profile visualization page (GET /profile) —
// decision style metrics, domain distribution, patterns.

import { Hono } from "hono";
import { USER_TERMS } from "../../constants/terminology.js";
import { getProfile } from "../../tools/unfade-profile.js";
import { escapeHtml, layout } from "./layout.js";

export const profilePage = new Hono();

profilePage.get("/profile", (c) => {
  const result = getProfile();
  const p = result.data;
  const degraded = result._meta.degraded;

  const content = `
    <h1>${escapeHtml(USER_TERMS.profile)}</h1>

    ${
      degraded
        ? `<div class="card">
             <div class="empty">
               <p>Not enough data to build a reasoning profile yet.</p>
               <p>The profile builds automatically as the ${escapeHtml(USER_TERMS.daemon)} captures ${escapeHtml(USER_TERMS.events)} and distills are generated.</p>
             </div>
           </div>`
        : ""
    }

    <div class="stat-grid">
      <div class="stat">
        <div class="value">${p.distillCount}</div>
        <div class="label">Distills analyzed</div>
      </div>
      <div class="stat">
        <div class="value">${p.avgDecisionsPerDay.toFixed(1)}</div>
        <div class="label">Decisions / day</div>
      </div>
      <div class="stat">
        <div class="value">${p.avgAlternativesEvaluated.toFixed(1)}</div>
        <div class="label">Alternatives evaluated</div>
      </div>
      <div class="stat">
        <div class="value">${p.avgDeadEndsPerDay.toFixed(1)}</div>
        <div class="label">Dead ends / day</div>
      </div>
    </div>

    <div class="stat-grid">
      <div class="stat">
        <div class="value">${Math.round(p.aiAcceptanceRate * 100)}%</div>
        <div class="label">AI acceptance rate</div>
      </div>
      <div class="stat">
        <div class="value">${Math.round(p.aiModificationRate * 100)}%</div>
        <div class="label">AI modification rate</div>
      </div>
    </div>

    <div class="card">
      <h2>Domain Distribution</h2>
      ${
        p.domainDistribution.length > 0
          ? `<ul class="domain-list">
               ${p.domainDistribution
                 .map(
                   (d) =>
                     `<li>
                       <span>${escapeHtml(d.domain)}</span>
                       <span class="freq">${d.frequency}</span>
                     </li>`,
                 )
                 .join("")}
             </ul>`
          : `<p style="color: var(--text-dim);">No domain data yet.</p>`
      }
    </div>

    <div class="card">
      <h2>Detected Patterns</h2>
      ${
        p.patterns.length > 0
          ? `<ul class="pattern-list">
               ${p.patterns.map((pat) => `<li>${escapeHtml(pat)}</li>`).join("")}
             </ul>`
          : `<p style="color: var(--text-dim);">No patterns detected yet.</p>`
      }
    </div>

    ${
      result._meta.lastUpdated
        ? `<p style="color: var(--text-dim); font-size: 0.8rem; margin-top: 1rem;">
             Last updated: ${escapeHtml(result._meta.lastUpdated)}
           </p>`
        : ""
    }
  `;

  return c.html(layout(USER_TERMS.profile, content));
});
