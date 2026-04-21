// FILE: src/server/pages/components/lineage-drillthrough.ts
// 11E.5: "Why?" UI affordance — expandable "Based on N events" component.
// Click-triggered only (no preloading). Fetches /api/intelligence/lineage/:insightId.
// Shared component used across efficiency, comprehension, coach, and home pages.

/**
 * Render the "Based on N events" expandable component.
 * @param insightId - The insight ID for lineage lookup
 * @param eventCount - Number of source events (shown in collapsed state)
 */
export function lineageDrillthrough(insightId: string, eventCount?: number): string {
  const countLabel = eventCount != null ? `${eventCount} events` : "source events";
  const uniqueId = `lineage-${insightId.slice(0, 8)}`;

  return `
    <div class="lineage-drillthrough mt-2" id="${uniqueId}">
      <button
        class="text-xs text-muted hover:text-accent cursor-pointer underline underline-offset-2 bg-transparent border-none p-0"
        onclick="toggleLineage('${insightId}', '${uniqueId}')"
      >
        Based on ${countLabel} →
      </button>
      <div class="lineage-detail hidden mt-2 pl-3 border-l-2 border-border" id="${uniqueId}-detail">
        <div class="text-xs text-muted">Loading…</div>
      </div>
    </div>
  `;
}

/**
 * Client-side JS for lineage drillthrough. Include once in the page layout.
 */
export function lineageDrillthroughScript(): string {
  return `
    <script>
      const _lineageCache = {};

      async function toggleLineage(insightId, containerId) {
        const detail = document.getElementById(containerId + '-detail');
        if (!detail) return;

        // Toggle visibility
        if (!detail.classList.contains('hidden')) {
          detail.classList.add('hidden');
          return;
        }
        detail.classList.remove('hidden');

        // Already fetched?
        if (_lineageCache[insightId]) {
          renderLineage(detail, _lineageCache[insightId]);
          return;
        }

        // Fetch lineage data
        detail.innerHTML = '<div class="text-xs text-muted">Loading…</div>';
        try {
          const resp = await fetch('/api/intelligence/lineage/' + encodeURIComponent(insightId));
          if (!resp.ok) throw new Error('HTTP ' + resp.status);
          const json = await resp.json();
          const data = json.data;
          _lineageCache[insightId] = data;
          renderLineage(detail, data);
        } catch (err) {
          detail.innerHTML = '<div class="text-xs text-red-400">Failed to load lineage</div>';
        }
      }

      function renderLineage(container, data) {
        if (!data || !data.sourceEvents || data.sourceEvents.length === 0) {
          container.innerHTML = '<div class="text-xs text-muted">No source events found</div>';
          return;
        }

        const analyzers = (data.analyzerChain || []).join(' → ');
        let html = '';

        if (analyzers) {
          html += '<div class="text-xs text-muted mb-2">Analyzer chain: <span class="text-accent">' + analyzers + '</span></div>';
        }

        html += '<div class="space-y-1">';
        for (const evt of data.sourceEvents.slice(0, 10)) {
          const date = evt.ts ? evt.ts.slice(0, 16) : '';
          const src = evt.source ? '<span class="text-accent">[' + evt.source + ']</span>' : '';
          const domain = evt.domain ? ' <span class="text-muted">(' + evt.domain + ')</span>' : '';
          html += '<div class="text-xs">';
          html += '<span class="text-muted">' + date + '</span> ' + src + domain;
          html += '<div class="text-foreground pl-2">' + (evt.summary || 'No summary') + '</div>';
          html += '</div>';
        }
        html += '</div>';

        if (data.sourceEvents.length > 10) {
          html += '<div class="text-xs text-muted mt-1">+ ' + (data.sourceEvents.length - 10) + ' more events</div>';
        }

        container.innerHTML = html;
      }
    </script>
  `;
}
