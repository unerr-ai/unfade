// FILE: src/services/site/template.ts
// UF-082: Site HTML template — single-page Thinking Graph with inline CSS.
// Dark theme, responsive (min 320px), OG meta tags, "Powered by Unfade" footer.

import type { DistillExcerpt, DomainSummary, ProfileSummary, SiteData } from "./site-generator.js";

// ---------------------------------------------------------------------------
// Domain color palette (deterministic hash)
// ---------------------------------------------------------------------------

const DOMAIN_COLORS = [
  "#ff6b6b",
  "#ffa94d",
  "#ffd43b",
  "#69db7c",
  "#38d9a9",
  "#4dabf7",
  "#748ffc",
  "#da77f2",
  "#f06595",
  "#20c997",
];

function domainColor(domain: string): string {
  let hash = 0;
  for (let i = 0; i < domain.length; i++) {
    hash = ((hash << 5) - hash + domain.charCodeAt(i)) | 0;
  }
  return DOMAIN_COLORS[
    ((hash % DOMAIN_COLORS.length) + DOMAIN_COLORS.length) % DOMAIN_COLORS.length
  ];
}

// ---------------------------------------------------------------------------
// CSS
// ---------------------------------------------------------------------------

function generateCss(): string {
  return `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html{font-size:16px;-webkit-text-size-adjust:100%}
body{background:#0d1117;color:#c9d1d9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;line-height:1.6;min-width:320px}
.container{max-width:960px;margin:0 auto;padding:24px 16px}
h1{font-size:1.75rem;font-weight:700;color:#f0f6fc;margin-bottom:4px}
h2{font-size:1.25rem;font-weight:600;color:#f0f6fc;margin-bottom:12px;border-bottom:1px solid #21262d;padding-bottom:8px}
.subtitle{color:#8b949e;font-size:0.875rem;margin-bottom:32px}
.section{margin-bottom:32px}
.heatmap-container{overflow-x:auto;padding:8px 0}
.heatmap-container svg{display:block}
.grid-2{display:grid;grid-template-columns:1fr 1fr;gap:24px}
@media(max-width:640px){.grid-2{grid-template-columns:1fr}}
.domain-bar{display:flex;align-items:center;margin-bottom:8px}
.domain-name{width:100px;font-size:0.875rem;color:#c9d1d9;flex-shrink:0}
.domain-track{flex:1;height:20px;background:#161b22;border-radius:4px;overflow:hidden;position:relative}
.domain-fill{height:100%;border-radius:4px;transition:width 0.3s}
.domain-pct{font-size:0.75rem;color:#8b949e;width:48px;text-align:right;flex-shrink:0;margin-left:8px}
.depth-badge{font-size:0.625rem;color:#8b949e;background:#21262d;padding:1px 6px;border-radius:8px;margin-left:8px}
.stat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:16px}
.stat-card{background:#161b22;border:1px solid #21262d;border-radius:8px;padding:16px;text-align:center}
.stat-value{font-size:1.5rem;font-weight:700;color:#f0f6fc}
.stat-label{font-size:0.75rem;color:#8b949e;margin-top:4px}
.pattern-text{font-style:italic;color:#8b949e;font-size:0.875rem;margin-top:12px;padding:8px 12px;border-left:3px solid #30363d}
.distill-list{list-style:none}
.distill-item{padding:12px 0;border-bottom:1px solid #21262d}
.distill-item:last-child{border-bottom:none}
.distill-date{font-weight:600;color:#58a6ff;font-size:0.875rem}
.distill-summary{color:#c9d1d9;font-size:0.875rem;margin-top:4px}
.distill-meta{font-size:0.75rem;color:#8b949e;margin-top:4px}
.distill-domain-tag{display:inline-block;font-size:0.625rem;padding:1px 6px;border-radius:8px;margin-right:4px;color:#fff}
footer{text-align:center;padding:24px 16px;color:#484f58;font-size:0.75rem;border-top:1px solid #21262d;margin-top:48px}
footer a{color:#58a6ff;text-decoration:none}
footer a:hover{text-decoration:underline}
.empty-state{text-align:center;padding:48px 16px;color:#484f58}
.empty-state p{margin-bottom:8px}
`;
}

// ---------------------------------------------------------------------------
// HTML component builders
// ---------------------------------------------------------------------------

function renderDomainBars(domains: DomainSummary[]): string {
  if (domains.length === 0) {
    return '<p class="empty-state">No domain data yet</p>';
  }

  return domains
    .map(
      (d) => `
      <div class="domain-bar">
        <span class="domain-name">${escapeHtml(d.domain)}</span>
        <div class="domain-track">
          <div class="domain-fill" style="width:${Math.round(d.percentage * 100)}%;background:${domainColor(d.domain)}"></div>
        </div>
        <span class="domain-pct">${Math.round(d.percentage * 100)}%</span>
        <span class="depth-badge">${escapeHtml(d.depth)}</span>
      </div>`,
    )
    .join("\n");
}

function renderProfileCard(profile: ProfileSummary | null): string {
  if (!profile) {
    return '<p class="empty-state">No reasoning profile yet. Run more distills to build your profile.</p>';
  }

  const stats = [
    { value: profile.avgAlternatives.toFixed(1), label: "Avg Alternatives" },
    { value: `${Math.round(profile.aiAcceptanceRate * 100)}%`, label: "AI Acceptance" },
    { value: `${Math.round(profile.aiModificationRate * 100)}%`, label: "AI Modification" },
    { value: profile.avgDecisionsPerDay.toFixed(1), label: "Decisions/Day" },
  ];

  const statsHtml = stats
    .map(
      (s) => `
      <div class="stat-card">
        <div class="stat-value">${s.value}</div>
        <div class="stat-label">${s.label}</div>
      </div>`,
    )
    .join("\n");

  const patternHtml = profile.topPattern
    ? `<div class="pattern-text">"${escapeHtml(profile.topPattern)}"</div>`
    : "";

  return `<div class="stat-grid">${statsHtml}</div>${patternHtml}`;
}

function renderDistillList(distills: DistillExcerpt[]): string {
  if (distills.length === 0) {
    return '<p class="empty-state">No distills yet. Run <code>unfade distill</code> to generate your first reasoning summary.</p>';
  }

  const items = distills.map((d) => {
    const domainTags = d.domains
      .map(
        (dom) =>
          `<span class="distill-domain-tag" style="background:${domainColor(dom)}">${escapeHtml(dom)}</span>`,
      )
      .join("");

    return `
      <li class="distill-item">
        <div class="distill-date">${escapeHtml(d.date)}</div>
        <div class="distill-summary">${escapeHtml(d.summary || `${d.decisionCount} decisions captured`)}</div>
        <div class="distill-meta">${d.decisionCount} decisions ${domainTags}</div>
      </li>`;
  });

  return `<ul class="distill-list">${items.join("\n")}</ul>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Generate the complete HTML page for the Thinking Graph static site. */
export function renderSiteHtml(data: SiteData, heatmapSvg: string, ogImagePath?: string): string {
  const title = "Thinking Graph — Unfade";
  const description =
    "Decision density, domain distribution, and reasoning profile — generated by Unfade";
  const ogImage = ogImagePath ?? "assets/og-card.png";
  const generatedDate = data.generatedAt.slice(0, 10);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <meta name="description" content="${description}">
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${description}">
  <meta property="og:image" content="${ogImage}">
  <meta property="og:type" content="website">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${title}">
  <meta name="twitter:description" content="${description}">
  <meta name="twitter:image" content="${ogImage}">
  <style>${generateCss()}</style>
</head>
<body>
  <div class="container">
    <h1>Thinking Graph</h1>
    <p class="subtitle">Generated ${generatedDate}${data.profile ? ` — ${data.profile.dataPoints} observations` : ""}</p>

    <div class="section">
      <h2>Decision Density Heatmap</h2>
      <div class="heatmap-container">
        ${heatmapSvg}
      </div>
    </div>

    <div class="grid-2">
      <div class="section">
        <h2>Domain Distribution</h2>
        ${renderDomainBars(data.domains)}
      </div>

      <div class="section">
        <h2>Reasoning Profile</h2>
        ${renderProfileCard(data.profile)}
      </div>
    </div>

    <div class="section">
      <h2>Recent Distills</h2>
      ${renderDistillList(data.distills)}
    </div>
  </div>

  <footer>
    Powered by <a href="https://github.com/anthropics/unfade">Unfade</a> — unfade.dev
  </footer>
</body>
</html>`;
}

/** Generate the standalone CSS file content. */
export function renderSiteCss(): string {
  return generateCss();
}
