// FILE: src/server/pages/cards.ts
// Cards web UI page (GET /cards).
// Date picker, generate button (htmx), card preview, download link.

import { existsSync, readdirSync } from "node:fs";
import { Hono } from "hono";
import { loadCardIdentityData } from "../../services/cards/identity.js";
import { localToday } from "../../utils/date.js";
import { getCardsDir } from "../../utils/paths.js";
import { escapeHtml, layout } from "./layout.js";

export const cardsPage = new Hono();

cardsPage.get("/cards", (c) => {
  const today = localToday();

  const cardsDir = getCardsDir();
  let existingCards: string[] = [];
  if (existsSync(cardsDir)) {
    try {
      existingCards = readdirSync(cardsDir)
        .filter((f) => /^\d{4}-\d{2}-\d{2}\.png$/.test(f))
        .map((f) => f.replace(".png", ""))
        .sort()
        .reverse();
    } catch {
      // Non-critical
    }
  }

  const identity = loadCardIdentityData();
  const identityBanner = identity.hasData
    ? `<div class="bg-surface border border-accent/30 rounded p-5 mb-4">
         <h2 class="text-lg font-heading font-semibold mb-2">Reasoning Identity</h2>
         <div class="flex items-center gap-4 mb-3">
           ${identity.rdi !== null ? `<span class="text-3xl font-bold text-accent">◆${identity.rdi}</span>` : ""}
           ${identity.identityLabel ? `<span class="text-lg text-foreground">${escapeHtml(identity.identityLabel)}</span>` : ""}
         </div>
         ${identity.averageHDS !== null ? `<p class="text-sm text-muted mb-2">Human Direction Score: ${identity.averageHDS.toFixed(2)}</p>` : ""}
         ${identity.topDomains.length > 0 ? `<p class="text-sm text-muted">Top domains: ${identity.topDomains.map((d) => `${escapeHtml(d.domain)} (${escapeHtml(d.depth)})`).join(", ")}</p>` : ""}
       </div>`
    : "";

  const content = `
    <h1 class="text-2xl font-heading font-semibold mb-6">Unfade Cards</h1>

    ${identityBanner}

    <div class="bg-surface border border-border rounded p-5 mb-4">
      <h2 class="text-lg font-heading font-semibold mb-2">Generate Card</h2>
      <p class="text-muted text-sm mb-4">Generate a visual summary card from a daily distill.</p>
      <div class="flex items-center gap-4">
        <input type="date" id="card-date" value="${escapeHtml(today)}"
          class="font-mono text-sm px-3 py-2 bg-raised text-foreground border border-border rounded outline-none focus:border-accent" />
        <button
          class="px-4 py-2 text-sm rounded bg-accent text-white font-semibold hover:bg-accent-dim border-none cursor-pointer"
          hx-post="/unfade/cards/generate"
          hx-target="#card-result"
          hx-vals="js:{date: document.getElementById('card-date').value}"
          hx-indicator="#card-spinner">
          Generate Card
        </button>
        <span id="card-spinner" class="htmx-indicator text-muted text-sm">Generating...</span>
      </div>
      <div id="card-result" class="mt-4"></div>
    </div>

    ${
      existingCards.length > 0
        ? `<div class="bg-surface border border-border rounded p-5">
             <h2 class="text-lg font-heading font-semibold mb-4">Generated Cards</h2>
             <ul class="divide-y divide-border">
               ${existingCards
                 .map(
                   (date) =>
                     `<li class="flex justify-between items-center py-3 text-sm">
                       <span class="font-mono text-foreground">${escapeHtml(date)}</span>
                       <span class="flex gap-3">
                         <a href="/unfade/cards/image/${escapeHtml(date)}" target="_blank" class="text-accent hover:text-accent-dim text-sm">View</a>
                         <a href="/unfade/cards/image/${escapeHtml(date)}" download="unfade-${escapeHtml(date)}.png" class="text-accent hover:text-accent-dim text-sm">Download</a>
                       </span>
                     </li>`,
                 )
                 .join("")}
             </ul>
           </div>`
        : `<div class="bg-surface border border-border rounded p-5">
             <div class="text-center py-8 text-muted">
               <p class="mb-2">No cards generated yet.</p>
               <p class="text-sm">Generate your first card using the form above.</p>
             </div>
           </div>`
    }

    <script>
      document.body.addEventListener('htmx:afterRequest', function(evt) {
        if (evt.detail.target.id === 'card-result') {
          try {
            var resp = JSON.parse(evt.detail.xhr.responseText);
            var el = document.getElementById('card-result');
            if (resp.data && resp.data.status === 'generated') {
              var d = resp.data.date;
              el.innerHTML = '<div class="mt-4">' +
                '<p class="text-success text-sm font-semibold">Card generated (' + (resp.data.size / 1024).toFixed(1) + ' KB)</p>' +
                '<img src="/unfade/cards/image/' + d + '?t=' + Date.now() + '" ' +
                'class="max-w-full rounded border border-border mt-3" />' +
                '<div class="mt-3">' +
                '<a href="/unfade/cards/image/' + d + '" download="unfade-' + d + '.png" ' +
                'class="inline-block px-4 py-2 text-sm bg-raised text-foreground border border-border rounded hover:bg-overlay no-underline">Download PNG</a>' +
                '</div></div>';
            } else if (resp._meta && resp._meta.degraded) {
              el.innerHTML = '<p class="text-error text-sm">' + (resp._meta.degradedReason || 'Generation failed') + '</p>';
            }
          } catch(e) { /* ignore parse errors */ }
        }
      });
    </script>
  `;

  return c.html(layout("Cards", content));
});
