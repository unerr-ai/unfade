// FILE: src/server/pages/search.ts
// Search web UI page — similar decision search with htmx.
// GET /search renders the search interface with personalization context.
// Results fetched via htmx from GET /unfade/similar.

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
      const domains = profile.domainDistribution ?? [];
      const topDomains = [...domains]
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
    ? `<div class="flex items-center gap-2 px-4 py-2.5 bg-accent/10 border border-accent/20 rounded mb-4 text-sm">
        <span class="text-accent">&#9679;</span>
        <span class="text-muted">Personalized search active</span>
        ${topDomains.length > 0 ? `<span class="text-muted ml-2">Top domains: ${topDomains.map((d) => `<span class="inline-block px-2 py-0.5 bg-raised text-accent text-xs rounded-full font-semibold">${escapeHtml(d)}</span>`).join(" ")}</span>` : ""}
      </div>`
    : "";

  const content = `
    <h1 class="text-2xl font-heading font-semibold mb-2">Search Reasoning History</h1>
    <p class="text-muted text-sm mb-6">Describe a problem or decision to find analogous past reasoning.</p>

    ${personalizationBanner}

    <div class="bg-surface border border-border rounded p-5 mb-6">
      <input
        type="text"
        name="problem"
        placeholder="e.g., choosing a cache backend, auth token refresh strategy..."
        hx-get="/unfade/similar"
        hx-trigger="keyup changed delay:300ms"
        hx-target="#results"
        hx-include="this"
        class="w-full px-4 py-3 text-base bg-raised text-foreground border border-border rounded outline-none focus:border-accent font-body"
      />
      <span class="htmx-indicator ml-2 text-muted text-sm">Searching...</span>
    </div>

    <div id="results">
      <div class="text-center py-8 text-muted">
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
              html = '<div class="text-center py-8 text-muted"><p>No similar decisions found.</p></div>';
            } else {
              for (var i = 0; i < results.length; i++) {
                var r = results[i];
                html += '<div class="bg-surface border border-border rounded p-4 mb-3">';
                html += '<div class="flex justify-between items-center mb-2">';
                html += '<span class="font-mono text-cyan text-sm">' + escapeStr(r.date) + '</span>';
                html += '<span class="inline-block px-2 py-0.5 rounded-full text-xs font-semibold bg-success/15 text-success">' + Math.round(r.relevance * 100) + '% match</span>';
                html += '</div>';
                html += '<p class="font-semibold text-sm mb-1">' + escapeStr(r.decision) + '</p>';
                if (r.rationale) {
                  html += '<p class="text-muted text-sm italic">' + escapeStr(r.rationale) + '</p>';
                }
                if (r.domain) {
                  html += '<span class="inline-block px-2 py-0.5 bg-raised text-muted text-xs rounded-full mt-2">' + escapeStr(r.domain) + '</span>';
                }
                if (r.alternativesConsidered != null) {
                  html += '<span class="text-muted text-xs ml-2">' + r.alternativesConsidered + ' alternatives evaluated</span>';
                }
                html += '</div>';
              }
              var footer = data.data.total + ' total matches (showing top ' + results.length + ')';
              if (meta.personalizationLevel === 'personalized') {
                footer += ' &middot; <span class="text-accent">&#9679;</span> personalized';
              }
              html += '<p class="text-muted text-xs mt-2">' + footer + '</p>';
            }
            e.detail.target.innerHTML = html;
          } catch(ex) {
            e.detail.target.innerHTML = '<div class="text-center py-8 text-muted"><p>Error parsing results.</p></div>';
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
