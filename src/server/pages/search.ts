// FILE: src/server/pages/search.ts
// UF-069 + UF-076: Search web UI page — similar decision search with htmx.
// GET /search renders the search interface with personalization context.
// Results fetched via htmx from GET /unfade/similar.
// UF-076: Shows personalization indicator when profile enhances results.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";
import type { ReasoningModelV2 } from "../../schemas/profile.js";
import { getProfileDir } from "../../utils/paths.js";
import { escapeHtml, layout } from "./layout.js";

export const searchPage = new Hono();

/**
 * Check if a v2 profile exists for personalization context display.
 */
function hasPersonalizationProfile(cwd?: string): { hasProfile: boolean; topDomains: string[] } {
  const profilePath = join(getProfileDir(cwd), "reasoning_model.json");
  if (!existsSync(profilePath)) return { hasProfile: false, topDomains: [] };
  try {
    const parsed = JSON.parse(readFileSync(profilePath, "utf-8"));
    if (parsed.version === 2 && parsed.dataPoints >= 2) {
      const profile = parsed as ReasoningModelV2;
      const topDomains = [...profile.domainDistribution]
        .sort((a, b) => b.frequency - a.frequency)
        .slice(0, 3)
        .map((d) => d.domain);
      return { hasProfile: true, topDomains };
    }
    return { hasProfile: false, topDomains: [] };
  } catch {
    return { hasProfile: false, topDomains: [] };
  }
}

searchPage.get("/search", (c) => {
  const { hasProfile, topDomains } = hasPersonalizationProfile();

  const personalizationBanner = hasProfile
    ? `<div style="display:flex;align-items:center;gap:0.5rem;padding:0.5rem 0.75rem;background:rgba(0,153,255,0.08);border:1px solid rgba(0,153,255,0.2);border-radius:var(--radius);margin-bottom:1rem;font-size:0.85rem;">
        <span style="color:var(--accent);">&#9679;</span>
        <span style="color:var(--text-dim);">Personalized search active</span>
        ${topDomains.length > 0 ? `<span style="color:var(--text-dim);margin-left:0.5rem;">Top domains: ${topDomains.map((d) => `<span class="badge" style="background:var(--bg-input);color:var(--accent);font-size:0.75rem;">${escapeHtml(d)}</span>`).join(" ")}</span>` : ""}
      </div>`
    : "";

  const content = `
    <h1>Search Reasoning History</h1>
    <p style="color: var(--text-dim); margin-bottom: 1.5rem;">
      Describe a problem or decision to find analogous past reasoning.
    </p>

    ${personalizationBanner}

    <div class="card" style="margin-bottom: 1.5rem;">
      <input
        type="text"
        name="problem"
        placeholder="e.g., choosing a cache backend, auth token refresh strategy..."
        hx-get="/unfade/similar"
        hx-trigger="keyup changed delay:300ms"
        hx-target="#results"
        hx-include="this"
        style="width: 100%; padding: 0.75rem 1rem; font-size: 1rem; background: var(--bg-input); border: 1px solid var(--border); border-radius: var(--radius); color: var(--text); font-family: var(--sans); outline: none;"
      />
      <span class="htmx-indicator" style="margin-left: 0.5rem; color: var(--text-dim);">Searching...</span>
    </div>

    <div id="results">
      <div class="empty">
        <p>Type a problem description to search for similar past decisions.</p>
      </div>
    </div>

    <script>
      document.addEventListener('htmx:afterRequest', function(e) {
        if (e.detail.target && e.detail.target.id === 'results') {
          try {
            var data = JSON.parse(e.detail.xhr.responseText);
            var results = data.data && data.data.results ? data.data.results : [];
            var meta = data._meta || {};
            var html = '';
            if (results.length === 0) {
              html = '<div class="empty"><p>No similar decisions found.</p></div>';
            } else {
              for (var i = 0; i < results.length; i++) {
                var r = results[i];
                html += '<div class="card" style="margin-bottom: 0.75rem;">';
                html += '<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">';
                html += '<span style="font-family: var(--mono); color: var(--accent); font-size: 0.85rem;">' + escapeStr(r.date) + '</span>';
                html += '<span class="badge badge-ok" style="font-size: 0.75rem;">' + Math.round(r.relevance * 100) + '% match</span>';
                html += '</div>';
                html += '<p style="font-weight: 600; margin-bottom: 0.25rem;">' + escapeStr(r.decision) + '</p>';
                if (r.rationale) {
                  html += '<p style="color: var(--text-dim); font-size: 0.9rem; font-style: italic;">' + escapeStr(r.rationale) + '</p>';
                }
                if (r.domain) {
                  html += '<span class="badge" style="background: var(--bg-input); color: var(--text-dim); margin-top: 0.5rem;">' + escapeStr(r.domain) + '</span>';
                }
                if (r.alternativesConsidered != null) {
                  html += '<span style="color: var(--text-dim); font-size: 0.8rem; margin-left: 0.5rem;">' + r.alternativesConsidered + ' alternatives evaluated</span>';
                }
                html += '</div>';
              }
              var footer = data.data.total + ' total matches (showing top ' + results.length + ')';
              if (meta.personalizationLevel === 'personalized') {
                footer += ' &middot; <span style="color:var(--accent);">&#9679;</span> personalized';
              }
              html += '<p style="color: var(--text-dim); font-size: 0.8rem; margin-top: 0.5rem;">' + footer + '</p>';
            }
            e.detail.target.innerHTML = html;
          } catch(ex) {
            e.detail.target.innerHTML = '<div class="empty"><p>Error parsing results.</p></div>';
          }
        }
      });
      function escapeStr(s) {
        if (!s) return '';
        var d = document.createElement('div');
        d.textContent = s;
        return d.innerHTML;
      }
    </script>
  `;

  return c.html(layout("Search", content));
});
