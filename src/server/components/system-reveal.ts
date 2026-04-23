// FILE: src/server/components/system-reveal.ts
// Phase 15 / Home redesign: inline activation sequence (not an overlay).
// Renders inside the main shell; client wiring lives in `home.ts` (single script, __unfade only).

const EASE = "cubic-bezier(0.16, 1, 0.3, 1)";

/** Inline activation panel — same shell as app, centered column, enterprise tokens */
export function activationSection(): string {
  return `
  <style>
    .ua-panel { border: 1px solid rgba(255,255,255,0.06); background: var(--surface); border-radius: 8px; box-shadow: 0 1px 2px rgba(0,0,0,0.1), 0 0 0 1px rgba(255,255,255,0.04); }
    .ua-muted { font-size: 11px; letter-spacing: 0.05em; text-transform: uppercase; color: rgba(250,250,250,0.45); font-weight: 500; }
    .ua-body { font-size: 13px; line-height: 1.5; color: rgba(250,250,250,0.85); }
    .ua-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; transition: background 200ms ${EASE}, box-shadow 200ms ${EASE}; }
    .ua-dot.waiting { background: rgba(255,255,255,0.12); box-shadow: none; }
    .ua-dot.building { background: var(--warning); box-shadow: 0 0 0 2px rgba(245,158,11,0.2); animation: ua-pulse 1.4s ${EASE} infinite; }
    .ua-dot.ready { background: var(--success); box-shadow: 0 0 0 2px rgba(16,185,129,0.15); }
    .ua-dot.error { background: var(--error); box-shadow: 0 0 0 2px rgba(239,68,68,0.15); }
    @keyframes ua-pulse { 0%,100%{opacity:1} 50%{opacity:0.55} }
    .ua-row { display: flex; align-items: center; gap: 12px; padding: 12px 0; border-bottom: 1px solid rgba(255,255,255,0.05); flex-wrap: wrap; }
    .ua-row:last-child { border-bottom: none; }
    .ua-ctx { font-size: 12px; color: rgba(250,250,250,0.35); font-style: italic; width: 100%; padding-left: 20px; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ua-event { display: flex; align-items: baseline; gap: 12px; padding: 12px 16px; border-radius: 6px; background: var(--raised); border: 1px solid rgba(255,255,255,0.06); margin-bottom: 8px; }
    .ua-src { font-size: 11px; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; min-width: 40px; }
    .ua-mono { font-family: 'JetBrains Mono', monospace; font-variant-numeric: tabular-nums; }
    .ua-bar-track { height: 2px; border-radius: 9999px; background: rgba(255,255,255,0.06); overflow: hidden; }
    .ua-bar-fill { height: 100%; border-radius: 9999px; background: linear-gradient(90deg, var(--accent), var(--cyan)); transition: width 400ms ${EASE}; width: 0%; }
    .ua-metric-val { font-family: 'JetBrains Mono', monospace; font-size: 28px; font-weight: 700; line-height: 1; font-variant-numeric: tabular-nums; }
    .ua-skip { font-size: 13px; color: rgba(250,250,250,0.45); background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 8px 16px; cursor: pointer; transition: border-color 200ms ${EASE}, color 200ms ${EASE}, background 200ms ${EASE}; }
    .ua-skip:hover { color: rgba(250,250,250,0.85); border-color: rgba(255,255,255,0.12); background: rgba(255,255,255,0.08); }
  </style>

  <section id="home-activation" class="max-w-lg mx-auto w-full mb-8" aria-label="System activation">
    <div class="mb-8 text-center">
      <div class="font-mono text-2xl font-bold text-accent mb-2">unfade</div>
      <p class="ua-body" style="color:rgba(250,250,250,0.55)">Warming up capture and materialization. Live telemetry appears below.</p>
    </div>

    <p class="ua-muted mb-3">System status</p>
    <div class="ua-panel p-6 mb-8">
      <div class="ua-row">
        <span class="ua-dot building" id="ha-dot-sse" aria-hidden="true"></span>
        <span class="ua-body flex-1">Real-time connection</span>
        <span class="ua-body ua-mono" style="color:rgba(250,250,250,0.5)" id="ha-st-sse">Starting…</span>
        <span class="ua-ctx" id="ha-ctx-sse"></span>
      </div>
      <div class="ua-row">
        <span class="ua-dot waiting" id="ha-dot-capture" aria-hidden="true"></span>
        <span class="ua-body flex-1">Capture engine</span>
        <span class="ua-body ua-mono" style="color:rgba(250,250,250,0.5)" id="ha-st-capture">Waiting</span>
        <span class="ua-ctx" id="ha-ctx-capture"></span>
      </div>
      <div class="ua-row">
        <span class="ua-dot waiting" id="ha-dot-mat" aria-hidden="true"></span>
        <span class="ua-body flex-1">Data materializer</span>
        <span class="ua-body ua-mono" style="color:rgba(250,250,250,0.5)" id="ha-st-mat">Waiting</span>
        <span class="ua-ctx" id="ha-ctx-mat"></span>
      </div>
      <div class="ua-row">
        <span class="ua-dot waiting" id="ha-dot-intel" aria-hidden="true"></span>
        <span class="ua-body flex-1">Intelligence engine</span>
        <span class="ua-body ua-mono" style="color:rgba(250,250,250,0.5)" id="ha-st-intel">Waiting</span>
        <span class="ua-ctx" id="ha-ctx-intel"></span>
      </div>
    </div>

    <p class="ua-muted mb-3">Captured events</p>
    <div class="ua-panel p-4 mb-8" style="min-height:120px">
      <div id="ha-events" class="min-h-[80px]">
        <p id="ha-events-empty" class="ua-body text-center" style="color:rgba(250,250,250,0.3);padding:24px 0">Waiting for capture events…</p>
      </div>
      <div class="flex items-center justify-between mt-4 pt-4" style="border-top:1px solid rgba(255,255,255,0.05)">
        <span class="ua-muted" style="letter-spacing:0.04em">Progress</span>
        <span id="ha-event-count" class="ua-mono ua-body" style="color:var(--cyan)">0</span>
      </div>
      <p class="ua-body mt-2" style="font-size:12px;color:rgba(250,250,250,0.45)" id="ha-progress-label">0 of 5 events toward first insights</p>
      <div class="ua-bar-track mt-3">
        <div id="ha-bar" class="ua-bar-fill"></div>
      </div>
    </div>

    <div id="ha-metrics" class="hidden mb-8">
      <p class="ua-muted mb-3">Early signals</p>
      <div class="ua-panel p-6 grid grid-cols-3 gap-6 text-center">
        <div>
          <div class="ua-metric-val" style="color:var(--cyan)" id="ha-m-dir">—</div>
          <div class="ua-muted mt-2">Direction</div>
        </div>
        <div>
          <div class="ua-metric-val" style="color:var(--accent)" id="ha-m-comp">—</div>
          <div class="ua-muted mt-2">Comprehension</div>
        </div>
        <div>
          <div class="ua-metric-val" style="color:rgba(250,250,250,0.9)" id="ha-m-ev">—</div>
          <div class="ua-muted mt-2">Events (24h)</div>
        </div>
      </div>
    </div>

    <div class="text-center">
      <button type="button" id="ha-skip" class="ua-skip">Skip to dashboard →</button>
    </div>
  </section>`;
}
