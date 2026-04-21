// FILE: src/server/pages/distill.ts
// Distill viewer page (GET /distill) — date navigation,
// markdown rendered as HTML, re-generate button via htmx.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { Hono } from "hono";
import { USER_TERMS } from "../../constants/terminology.js";
import { localToday } from "../../utils/date.js";
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
  const today = localToday();
  const requestedDate = c.req.query("date") ?? today;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) {
    return c.html(
      layout(
        USER_TERMS.distill,
        `<h1 class="text-2xl font-heading font-semibold mb-6">${escapeHtml(USER_TERMS.distill)}</h1><p class="text-error">Invalid date format. Use YYYY-MM-DD.</p>`,
      ),
    );
  }

  const dates = getAvailableDates();
  const md = readDistillContent(requestedDate);

  const dateIdx = dates.indexOf(requestedDate);
  const prevDate = dateIdx >= 0 && dateIdx < dates.length - 1 ? dates[dateIdx + 1] : null;
  const nextDate = dateIdx > 0 ? dates[dateIdx - 1] : null;

  const prevLink = prevDate
    ? `<a href="/distill?date=${prevDate}" class="px-3 py-1.5 text-sm bg-raised text-foreground border border-border rounded hover:bg-overlay no-underline">&larr; ${escapeHtml(prevDate)}</a>`
    : `<span class="px-3 py-1.5 text-sm bg-raised text-muted border border-border rounded opacity-40">&larr; prev</span>`;

  const nextLink = nextDate
    ? `<a href="/distill?date=${nextDate}" class="px-3 py-1.5 text-sm bg-raised text-foreground border border-border rounded hover:bg-overlay no-underline">${escapeHtml(nextDate)} &rarr;</a>`
    : `<span class="px-3 py-1.5 text-sm bg-raised text-muted border border-border rounded opacity-40">next &rarr;</span>`;

  const content = `
    <h1 class="text-2xl font-heading font-semibold mb-6">${escapeHtml(USER_TERMS.distill)}</h1>

    <div class="flex items-center gap-4 mb-6">
      ${prevLink}
      <span class="font-mono text-base text-foreground">${escapeHtml(requestedDate)}</span>
      ${nextLink}
    </div>

    ${
      md
        ? `<div class="bg-surface border border-border rounded p-5">
             <div class="prose-unfade">
               ${markdownToHtml(md)}
             </div>
           </div>`
        : `<div class="bg-surface border border-border rounded p-5">
             <div class="text-center py-8 text-muted">
               <p class="mb-2">No ${escapeHtml(USER_TERMS.distill)} for ${escapeHtml(requestedDate)}.</p>
               <p class="text-sm">Click re-generate to create one, or navigate to a date with existing distills.</p>
               ${dates.length > 0 ? `<p class="mt-2"><a href="/distill?date=${dates[0]}" class="text-accent hover:text-accent-dim text-sm">Jump to latest (${escapeHtml(dates[0])})</a></p>` : ""}
             </div>
           </div>`
    }

    <div class="mt-4 flex items-center gap-4">
      <button
        class="px-4 py-2 text-sm rounded bg-accent text-white font-semibold hover:bg-accent-dim border-none cursor-pointer"
        hx-post="/unfade/distill"
        hx-vals='${escapeHtml(JSON.stringify({ date: requestedDate }))}'
        hx-target="#distill-status"
        hx-swap="innerHTML"
      >
        Re-generate ${escapeHtml(USER_TERMS.distill)}
      </button>
      <span id="distill-status" class="htmx-indicator text-muted text-sm">
        ${escapeHtml(USER_TERMS.distilling)}...
      </span>
    </div>
  `;

  return c.html(layout(USER_TERMS.distill, content));
});
