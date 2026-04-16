// FILE: src/server/pages/distill.ts
// UF-051a-distill: Distill viewer page (GET /distill) — date navigation,
// markdown rendered as HTML, re-generate button via htmx.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { Hono } from "hono";
import { USER_TERMS } from "../../constants/terminology.js";
import { getDistillsDir } from "../../utils/paths.js";
import { escapeHtml, layout, markdownToHtml } from "./layout.js";

export const distillPage = new Hono();

/**
 * Read a distill file for the given date.
 */
function readDistillContent(date: string): string | null {
  const dir = getDistillsDir();
  const filePath = `${dir}/${date}.md`;
  if (!existsSync(filePath)) return null;
  try {
    return readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

/**
 * Get sorted list of available distill dates (most recent first).
 */
function getAvailableDates(): string[] {
  const dir = getDistillsDir();
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
      .map((f) => f.replace(".md", ""))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

distillPage.get("/distill", (c) => {
  const today = new Date().toISOString().slice(0, 10);
  const requestedDate = c.req.query("date") ?? today;

  // Validate date format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) {
    return c.html(
      layout(
        `${USER_TERMS.distill}`,
        `<h1>${escapeHtml(USER_TERMS.distill)}</h1><p>Invalid date format. Use YYYY-MM-DD.</p>`,
      ),
    );
  }

  const dates = getAvailableDates();
  const md = readDistillContent(requestedDate);

  // Compute prev/next dates
  const dateIdx = dates.indexOf(requestedDate);
  const prevDate = dateIdx >= 0 && dateIdx < dates.length - 1 ? dates[dateIdx + 1] : null;
  const nextDate = dateIdx > 0 ? dates[dateIdx - 1] : null;

  // If date is not in the list but we still have content, just show it without nav context
  // If no content and not in list, show empty state with available dates navigation
  const prevLink = prevDate
    ? `<a href="/distill?date=${prevDate}" class="btn">&larr; ${prevDate}</a>`
    : `<span class="btn" style="opacity:0.3;">&larr; prev</span>`;

  const nextLink = nextDate
    ? `<a href="/distill?date=${nextDate}" class="btn">${nextDate} &rarr;</a>`
    : `<span class="btn" style="opacity:0.3;">next &rarr;</span>`;

  const content = `
    <h1>${escapeHtml(USER_TERMS.distill)}</h1>

    <div class="date-nav">
      ${prevLink}
      <span class="current">${escapeHtml(requestedDate)}</span>
      ${nextLink}
    </div>

    ${
      md
        ? `<div class="card">
             <div class="distill-content">
               ${markdownToHtml(md)}
             </div>
           </div>`
        : `<div class="card">
             <div class="empty">
               <p>No ${escapeHtml(USER_TERMS.distill)} for ${escapeHtml(requestedDate)}.</p>
               <p>Click re-generate to create one, or navigate to a date with existing distills.</p>
               ${dates.length > 0 ? `<p style="margin-top: 0.5rem;"><a href="/distill?date=${dates[0]}">Jump to latest (${escapeHtml(dates[0])})</a></p>` : ""}
             </div>
           </div>`
    }

    <div style="margin-top: 1rem; display: flex; align-items: center; gap: 1rem;">
      <button
        class="btn-primary"
        hx-post="/unfade/distill"
        hx-vals='${escapeHtml(JSON.stringify({ date: requestedDate }))}'
        hx-target="#distill-status"
        hx-swap="innerHTML"
      >
        Re-generate ${escapeHtml(USER_TERMS.distill)}
      </button>
      <span id="distill-status" class="htmx-indicator" style="color: var(--text-dim); font-size: 0.875rem;">
        ${escapeHtml(USER_TERMS.distilling)}...
      </span>
    </div>
  `;

  return c.html(layout(USER_TERMS.distill, content));
});
