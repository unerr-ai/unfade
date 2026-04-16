// FILE: src/server/pages/cards.ts
// UF-061: Cards web UI page (GET /cards).
// Date picker, generate button (htmx), card preview, download link.

import { existsSync, readdirSync } from "node:fs";
import { Hono } from "hono";
import { getCardsDir } from "../../utils/paths.js";
import { escapeHtml, layout } from "./layout.js";

export const cardsPage = new Hono();

cardsPage.get("/cards", (c) => {
  const today = new Date().toISOString().slice(0, 10);

  // List existing cards
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

  const content = `
    <h1>Unfade Cards</h1>

    <div class="card">
      <h2>Generate Card</h2>
      <p style="color: var(--text-dim); font-size: 0.9rem; margin-bottom: 1rem;">
        Generate a visual summary card from a daily distill.
      </p>
      <div style="display: flex; align-items: center; gap: 1rem;">
        <input type="date" id="card-date" value="${escapeHtml(today)}"
          style="font-family: var(--mono); font-size: 0.9rem; padding: 0.5rem 0.75rem;
                 background: var(--bg-input); color: var(--text); border: 1px solid var(--border);
                 border-radius: var(--radius);" />
        <button class="btn-primary"
          hx-post="/unfade/cards/generate"
          hx-target="#card-result"
          hx-vals="js:{date: document.getElementById('card-date').value}"
          hx-indicator="#card-spinner">
          Generate Card
        </button>
        <span id="card-spinner" class="htmx-indicator" style="color: var(--text-dim);">
          Generating...
        </span>
      </div>
      <div id="card-result" style="margin-top: 1rem;"></div>
    </div>

    ${
      existingCards.length > 0
        ? `<div class="card">
             <h2>Generated Cards</h2>
             <ul class="domain-list">
               ${existingCards
                 .map(
                   (date) =>
                     `<li>
                       <span style="font-family: var(--mono);">${escapeHtml(date)}</span>
                       <span>
                         <a href="/unfade/cards/image/${escapeHtml(date)}" target="_blank">View</a>
                         &middot;
                         <a href="/unfade/cards/image/${escapeHtml(date)}" download="unfade-${escapeHtml(date)}.png">Download</a>
                       </span>
                     </li>`,
                 )
                 .join("")}
             </ul>
           </div>`
        : `<div class="card">
             <div class="empty">
               <p>No cards generated yet.</p>
               <p>Generate your first card using the form above.</p>
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
              el.innerHTML = '<div style="margin-top: 1rem;">' +
                '<p style="color: var(--success);">Card generated (' + (resp.data.size / 1024).toFixed(1) + ' KB)</p>' +
                '<img src="/unfade/cards/image/' + d + '?t=' + Date.now() + '" ' +
                'style="max-width: 100%; border-radius: var(--radius); margin-top: 0.75rem; border: 1px solid var(--border);" />' +
                '<div style="margin-top: 0.75rem;">' +
                '<a href="/unfade/cards/image/' + d + '" download="unfade-' + d + '.png" class="btn">Download PNG</a>' +
                '</div></div>';
            } else if (resp._meta && resp._meta.degraded) {
              el.innerHTML = '<p style="color: var(--error);">' + (resp._meta.degradedReason || 'Generation failed') + '</p>';
            }
          } catch(e) { /* ignore parse errors */ }
        }
      });
    </script>
  `;

  return c.html(layout("Cards", content));
});
