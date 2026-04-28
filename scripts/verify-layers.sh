#!/usr/bin/env bash
# =============================================================================
# Unfade Layer 1, 2, & 3 Verification Script
# =============================================================================
#
# Layer 1 (Go Daemon): Binary, daemon lifecycle, JSONL events, capture modes,
#   AI parsers, historical ingest, event format, O_APPEND atomicity,
#   process runtime verification (args, CPU, memory), live event flow,
#   daemon resource health (budget warnings, goroutines)
#
# Layer 2 (Dual DB Materializer): CacheManager, SQLite (5+1 tables),
#   DuckDB (14 tables, ~46 typed columns), materializer cursor + liveness,
#   data consistency, VARCHAR[] columns, rebuild/repair, HTTP server health,
#   end-to-end flow validation (JSONL → SQLite pipeline integrity)
#
# Layer 2b (CozoDB Intelligence Graph): CozoManager, entity/edge/entity_source
#   relations, HNSW vector index, schema versioning, analyzer contributions,
#   graph density relative to event count
#
# Layer 3 (Intelligence Analysis & Substrate): 25 analyzer output files,
#   analyzer state persistence/watermarks, output freshness/validity,
#   substrate topology/trajectories, entity types (9), relationship types (14),
#   lifecycle distribution, confidence spread, distill outputs, profile/graph,
#   intelligence pipeline end-to-end flow, BigInt runtime error detection,
#   output content validation (field checks), state health (eventCount/watermarks),
#   DuckDB typed column data, silent failure detection, cross-layer consistency,
#   summary.json coherence
#
# Run:  bash scripts/verify-layers.sh
# Prereq: `unfade` must have been started at least once
# =============================================================================

set -euo pipefail

UNFADE_HOME="${UNFADE_HOME:-$HOME/.unfade}"
PASS=0
FAIL=0
WARN=0
SKIP=0

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
DIM='\033[2m'
BOLD='\033[1m'
NC='\033[0m'

pass()    { PASS=$((PASS + 1));  echo -e "  ${GREEN}✓${NC} $1"; }
fail()    { FAIL=$((FAIL + 1));  echo -e "  ${RED}✗${NC} $1"; }
warn()    { WARN=$((WARN + 1));  echo -e "  ${YELLOW}⚠${NC} $1"; }
skip()    { SKIP=$((SKIP + 1));  echo -e "  ${DIM}○${NC} $1 ${DIM}(skipped)${NC}"; }
section() { echo -e "\n${BOLD}${CYAN}[$1]${NC} $2"; }
detail()  { echo -e "    ${DIM}$1${NC}"; }

# ═══════════════════════════════════════════════════════════════════════════════
#  LAYER 1: GO DAEMON
# ═══════════════════════════════════════════════════════════════════════════════

echo -e "\n${BOLD}╔═══════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║        LAYER 1: GO CAPTURE DAEMON                 ║${NC}"
echo -e "${BOLD}╚═══════════════════════════════════════════════════╝${NC}"

# =============================================================================
section "1.1" "Go Binary (~/.unfade/bin/unfaded)"
# =============================================================================

BINARY="$UNFADE_HOME/bin/unfaded"
if [[ -f "$BINARY" ]]; then
  pass "unfaded binary exists"
  if [[ -x "$BINARY" ]]; then
    pass "unfaded binary is executable"
  else
    fail "unfaded binary is NOT executable"
  fi

  ARCH=$(file "$BINARY" 2>/dev/null || echo "unknown")
  if echo "$ARCH" | grep -q "Mach-O\|ELF"; then
    pass "Valid binary: $(echo "$ARCH" | sed 's|.*: ||' | head -c 80)"
  else
    fail "Invalid binary format: $ARCH"
  fi

  # Check version/help and expected flags
  HELP_OUT=$("$BINARY" --help 2>&1 || true)
  if [[ -n "$HELP_OUT" ]]; then
    pass "unfaded responds to --help"
    # Verify expected flags
    for flag in "-capture-mode" "-coordinator" "-project-dir" "-verbose"; do
      if echo "$HELP_OUT" | grep -qF -- "$flag"; then
        pass "  Flag $flag present"
      else
        fail "  Flag $flag missing"
      fi
    done
  else
    skip "unfaded --help not available"
  fi
else
  fail "unfaded binary missing at $BINARY"
fi

# =============================================================================
section "1.2" "Layer 1 Directory Structure"
# =============================================================================

# Directories owned/written by Layer 1
L1_DIRS=(
  "events"            # JSONL event files (O_APPEND writes)
  "state/daemons"     # Per-daemon state dirs (PID, socket, log, health)
)

for dir in "${L1_DIRS[@]}"; do
  target="$UNFADE_HOME/$dir"
  if [[ -d "$target" ]]; then
    pass "$target exists"
  else
    fail "$target missing"
  fi
done

# Registry file
REGISTRY="$UNFADE_HOME/state/registry.v1.json"
if [[ -f "$REGISTRY" ]]; then
  REPO_COUNT=$(node -e "
    const r = JSON.parse(require('fs').readFileSync('$REGISTRY','utf8'));
    console.log((r.repos || []).length);
  " 2>/dev/null || true)
  pass "Registry exists: $REPO_COUNT repo(s) registered"
else
  fail "Registry missing at $REGISTRY"
fi

# Setup status file
SETUP_STATUS="$UNFADE_HOME/state/setup-status.json"
if [[ -f "$SETUP_STATUS" ]]; then
  SETUP_DONE=$(node -e "
    const s = JSON.parse(require('fs').readFileSync('$SETUP_STATUS','utf8'));
    console.log(s.setupCompleted ? 'yes' : 'no');
  " 2>/dev/null || echo "no")
  if [[ "$SETUP_DONE" == "yes" ]]; then
    pass "Setup completed (onboarding done)"
  else
    warn "Setup status exists but not completed"
  fi
else
  warn "Setup status file missing — onboarding may not have completed"
fi

# Ingest state file
INGEST_JSON="$UNFADE_HOME/state/ingest.json"
if [[ -f "$INGEST_JSON" ]]; then
  pass "ingest.json exists"
else
  skip "ingest.json (created after first historical ingest)"
fi

# =============================================================================
section "1.3" "Daemon State Directories & Process Liveness"
# =============================================================================

DAEMONS_DIR="$UNFADE_HOME/state/daemons"
GIT_DAEMON_COUNT=0
AI_DAEMON_COUNT=0

if [[ -d "$DAEMONS_DIR" ]]; then
  for dir in "$DAEMONS_DIR"/*/; do
    [[ -d "$dir" ]] || continue
    DAEMON_ID=$(basename "$dir")
    PID_FILE="$dir/daemon.pid"
    HEALTH_FILE="$dir/health.json"
    LOG_FILE="$dir/daemon.log"

    echo -e "    ${BOLD}Daemon: $DAEMON_ID${NC}"

    # Determine capture mode from daemon ID
    if [[ "$DAEMON_ID" == *"ai-global"* ]]; then
      AI_DAEMON_COUNT=$((AI_DAEMON_COUNT + 1))
      detail "Mode: ai-global (singleton)"
    else
      GIT_DAEMON_COUNT=$((GIT_DAEMON_COUNT + 1))
      detail "Mode: git-only (per-repo)"
    fi

    # PID file & process liveness + runtime details
    if [[ -f "$PID_FILE" ]]; then
      PID=$(cat "$PID_FILE" 2>/dev/null)
      if kill -0 "$PID" 2>/dev/null; then
        pass "  PID $PID is alive"
        # Process runtime info: command-line args, CPU, memory, elapsed time
        PS_INFO=$(ps -p "$PID" -o %cpu,%mem,etime,command 2>/dev/null | tail -1 || echo "")
        if [[ -n "$PS_INFO" ]]; then
          PS_CPU=$(echo "$PS_INFO" | awk '{print $1}')
          PS_MEM=$(echo "$PS_INFO" | awk '{print $2}')
          PS_ETIME=$(echo "$PS_INFO" | awk '{print $3}')
          PS_CMD=$(echo "$PS_INFO" | awk '{for(i=4;i<=NF;i++) printf "%s ", $i; print ""}' | head -c 200)
          detail "CPU: ${PS_CPU}%  MEM: ${PS_MEM}%  Elapsed: ${PS_ETIME}"
          detail "Cmd: ${PS_CMD}"
          # Verify expected flags in command line
          if [[ "$DAEMON_ID" == *"ai-global"* ]]; then
            if echo "$PS_CMD" | grep -qF -- "-capture-mode"; then
              ACTUAL_MODE=$(echo "$PS_CMD" | sed -n 's/.*-capture-mode[= ]*\([^ ]*\).*/\1/p' || echo "")
              if [[ "$ACTUAL_MODE" == "ai-global" || "$ACTUAL_MODE" == "full" ]]; then
                pass "  Process running with correct capture-mode: $ACTUAL_MODE"
              else
                warn "  Process capture-mode mismatch: expected ai-global, got $ACTUAL_MODE"
              fi
            else
              warn "  No -capture-mode flag found in process command line"
            fi
          else
            if echo "$PS_CMD" | grep -qF -- "-capture-mode"; then
              ACTUAL_MODE=$(echo "$PS_CMD" | sed -n 's/.*-capture-mode[= ]*\([^ ]*\).*/\1/p' || echo "")
              if [[ "$ACTUAL_MODE" == "git-only" || "$ACTUAL_MODE" == "full" ]]; then
                pass "  Process running with correct capture-mode: $ACTUAL_MODE"
              else
                warn "  Process capture-mode mismatch: expected git-only, got $ACTUAL_MODE"
              fi
            else
              warn "  No -capture-mode flag found in process command line"
            fi
          fi
          # High CPU warning
          CPU_INT=$(echo "$PS_CPU" | cut -d. -f1)
          if [[ "${CPU_INT:-0}" -gt 50 ]]; then
            warn "  High CPU usage: ${PS_CPU}% — daemon may be stuck in a loop"
          fi
        fi
      else
        warn "  PID $PID is dead (stale PID file)"
      fi
    else
      warn "  No PID file"
    fi

    # health.json (written by Go daemon periodically)
    if [[ -f "$HEALTH_FILE" ]]; then
      HEALTH_INFO=$(node -e "
        const h = JSON.parse(require('fs').readFileSync('$HEALTH_FILE','utf8'));
        const status = h.status ?? 'unknown';
        const events = h.events_today ?? 0;
        const uptime = h.uptime_seconds ?? 0;
        const mode = h.capture_mode ?? 'unknown';
        console.log(status + '|' + events + '|' + uptime + '|' + mode);
      " 2>/dev/null || echo "error|0|0|unknown")

      IFS='|' read -r H_STATUS H_EVENTS H_UPTIME H_MODE <<< "$HEALTH_INFO"
      if [[ "$H_STATUS" == "running" ]]; then
        pass "  Health: running, ${H_EVENTS} events today, uptime ${H_UPTIME}s"
      elif [[ "$H_STATUS" == "error" ]]; then
        fail "  Health: error reading health.json"
      else
        warn "  Health: $H_STATUS"
      fi
    else
      warn "  No health.json"
    fi

    # daemon.log — scan for errors/panics
    if [[ -f "$LOG_FILE" ]]; then
      ERROR_COUNT=$( (grep -ci "error\|fatal\|panic" "$LOG_FILE" 2>/dev/null || true) | tr -d '[:space:]')
      LOG_LINES=$(wc -l < "$LOG_FILE" 2>/dev/null | tr -d ' ')
      if [[ "$ERROR_COUNT" -gt 0 ]]; then
        warn "  Log: $LOG_LINES lines, $ERROR_COUNT error(s)"
        grep -i "error\|fatal\|panic" "$LOG_FILE" 2>/dev/null | tail -3 | while read -r line; do
          echo -e "      ${RED}${line:0:120}${NC}"
        done
      else
        pass "  Log: $LOG_LINES lines, no errors"
      fi
    else
      skip "  No daemon.log"
    fi

    # Unix domain socket (optional — for IPC)
    SOCK_FILE="$dir/daemon.sock"
    if [[ -S "$SOCK_FILE" ]]; then
      pass "  Unix socket present"
    else
      skip "  No daemon.sock (IPC socket)"
    fi
  done

  # Capture mode verification
  if [[ "$GIT_DAEMON_COUNT" -gt 0 ]]; then
    pass "$GIT_DAEMON_COUNT git-only daemon(s) (one per repo)"
  else
    warn "No git-only daemons found"
  fi

  if [[ "$AI_DAEMON_COUNT" -eq 1 ]]; then
    pass "Exactly 1 ai-global daemon (singleton — correct)"
  elif [[ "$AI_DAEMON_COUNT" -eq 0 ]]; then
    warn "No ai-global daemon found"
  else
    fail "$AI_DAEMON_COUNT ai-global daemons (should be exactly 1)"
  fi
else
  warn "No daemon state directories at $DAEMONS_DIR"
fi

# Orphan process detection
ORPHAN_COUNT=$( (pgrep -f unfaded 2>/dev/null || true) | wc -l | tr -d ' ')
KNOWN_PIDS=$( (cat "$DAEMONS_DIR"/*/daemon.pid 2>/dev/null || true) | wc -l | tr -d ' ')
if [[ "$ORPHAN_COUNT" -gt "$KNOWN_PIDS" ]]; then
  warn "$((ORPHAN_COUNT - KNOWN_PIDS)) orphan unfaded process(es) without PID files"
else
  pass "No orphan unfaded processes"
fi

# =============================================================================
section "1.4" "JSONL Events (Source of Truth)"
# =============================================================================

EVENTS_DIR="$UNFADE_HOME/events"
TOTAL_LINES=0

if [[ -d "$EVENTS_DIR" ]]; then
  JSONL_COUNT=$(find "$EVENTS_DIR" -name "*.jsonl" 2>/dev/null | wc -l | tr -d ' ')
  if [[ "$JSONL_COUNT" -gt 0 ]]; then
    pass "$JSONL_COUNT JSONL file(s) in events/"
    TOTAL_LINES=$(cat "$EVENTS_DIR"/*.jsonl 2>/dev/null | wc -l | tr -d ' ')
    pass "$TOTAL_LINES total event lines"
    TOTAL_SIZE=$(du -sh "$EVENTS_DIR" 2>/dev/null | awk '{print $1}')
    detail "Events directory size: $TOTAL_SIZE"

    # Date range (files are YYYY-MM-DD.jsonl)
    OLDEST=$(ls "$EVENTS_DIR"/*.jsonl 2>/dev/null | head -1 | xargs basename 2>/dev/null | sed 's/.jsonl//')
    NEWEST=$(ls "$EVENTS_DIR"/*.jsonl 2>/dev/null | tail -1 | xargs basename 2>/dev/null | sed 's/.jsonl//')
    pass "Date range: $OLDEST → $NEWEST"

    # Validate event format: required fields per CaptureEvent schema
    NEWEST_FILE=$(ls "$EVENTS_DIR"/*.jsonl 2>/dev/null | tail -1)
    FORMAT_RESULT=$(head -20 "$NEWEST_FILE" 2>/dev/null | node -e "
      const lines = require('fs').readFileSync('/dev/stdin','utf8').split('\n').filter(Boolean);
      let ok = 0, bad = 0;
      const missingFields = new Set();
      const required = ['id', 'timestamp', 'source', 'type', 'content'];
      for (const l of lines) {
        try {
          const e = JSON.parse(l);
          const missing = required.filter(f => !(f in e));
          if (missing.length === 0) { ok++; }
          else { bad++; missing.forEach(f => missingFields.add(f)); }
        } catch { bad++; }
      }
      console.log(ok + '|' + bad + '|' + [...missingFields].join(','));
    " 2>/dev/null || echo "0|0|parse-error")

    IFS='|' read -r FMT_OK FMT_BAD FMT_MISSING <<< "$FORMAT_RESULT"
    if [[ "$FMT_BAD" -eq 0 && "$FMT_OK" -gt 0 ]]; then
      pass "Event format valid: all $FMT_OK sampled events have required fields (id, timestamp, source, type, content)"
    elif [[ "$FMT_BAD" -gt 0 ]]; then
      fail "$FMT_BAD event(s) missing fields: $FMT_MISSING"
    else
      warn "Could not validate event format"
    fi

    # Event source distribution (across all files, sample first 500 lines)
    SOURCE_DIST=$(head -500 "$EVENTS_DIR"/*.jsonl 2>/dev/null | node -e "
      const lines = require('fs').readFileSync('/dev/stdin','utf8').split('\n').filter(Boolean);
      const sources = {};
      for (const l of lines) {
        try { const e = JSON.parse(l); sources[e.source] = (sources[e.source]||0)+1; } catch {}
      }
      console.log(JSON.stringify(sources));
    " 2>/dev/null || echo "{}")
    detail "Event source distribution (sampled): $SOURCE_DIST"

    # Verify O_APPEND atomicity: no truncated JSON lines
    TRUNC_COUNT=$(head -100 "$NEWEST_FILE" 2>/dev/null | node -e "
      const lines = require('fs').readFileSync('/dev/stdin','utf8').split('\n').filter(Boolean);
      let bad = 0;
      for (const l of lines) { try { JSON.parse(l); } catch { bad++; } }
      console.log(bad);
    " 2>/dev/null || true)
    if [[ "$TRUNC_COUNT" -eq 0 ]]; then
      pass "No truncated/corrupt JSONL lines (O_APPEND atomicity OK)"
    else
      fail "$TRUNC_COUNT truncated/corrupt lines found — possible write interleaving"
    fi

    # Check for metadata and gitContext fields (expected for git events)
    META_CHECK=$(head -50 "$EVENTS_DIR"/*.jsonl 2>/dev/null | node -e "
      const lines = require('fs').readFileSync('/dev/stdin','utf8').split('\n').filter(Boolean);
      let hasMeta = 0, hasGit = 0, total = 0;
      for (const l of lines) {
        try {
          const e = JSON.parse(l);
          total++;
          if (e.metadata && typeof e.metadata === 'object') hasMeta++;
          if (e.gitContext && typeof e.gitContext === 'object') hasGit++;
        } catch {}
      }
      console.log(hasMeta + '|' + hasGit + '|' + total);
    " 2>/dev/null || echo "0|0|0")
    IFS='|' read -r M_META M_GIT M_TOTAL <<< "$META_CHECK"
    if [[ "$M_META" -gt 0 ]]; then
      pass "$M_META/$M_TOTAL events have metadata object"
    else
      warn "No events with metadata found (sampled $M_TOTAL)"
    fi
    if [[ "$M_GIT" -gt 0 ]]; then
      pass "$M_GIT/$M_TOTAL events have gitContext"
    else
      skip "No events with gitContext (may be AI-only events)"
    fi
  else
    fail "No JSONL files in events/"
  fi
else
  fail "Events directory missing"
fi

# =============================================================================
section "1.5" "Historical Ingest State Machine"
# =============================================================================

if [[ -f "$INGEST_JSON" ]]; then
  INGEST_INFO=$(node -e "
    const s = JSON.parse(require('fs').readFileSync('$INGEST_JSON','utf8'));
    const sources = Object.keys(s.sources || {});
    let total = 0, completed = 0;
    for (const src of sources) {
      const info = s.sources[src];
      total++;
      if (info.status === 'completed' || info.completed) completed++;
    }
    const phase = s.phase || s.status || 'unknown';
    console.log(phase + '|' + total + '|' + completed + '|' + sources.join(','));
  " 2>/dev/null || echo "error|0|0|")

  IFS='|' read -r ING_PHASE ING_TOTAL ING_DONE ING_SOURCES <<< "$INGEST_INFO"
  if [[ "$ING_PHASE" != "error" ]]; then
    pass "Ingest state: phase=$ING_PHASE, $ING_DONE/$ING_TOTAL sources complete"
    detail "Sources: $ING_SOURCES"
  else
    warn "Could not parse ingest.json"
  fi
else
  skip "No ingest.json — historical ingest not started"
fi

# =============================================================================
section "1.6" "Daemon Lifecycle (Kill/Restart)"
# =============================================================================

# Verify reset command can find and kill daemons
detail "Checking that PID files match live processes..."
STALE_PIDS=0
LIVE_PIDS=0
if [[ -d "$DAEMONS_DIR" ]]; then
  for pidfile in "$DAEMONS_DIR"/*/daemon.pid; do
    [[ -f "$pidfile" ]] || continue
    PID=$(cat "$pidfile" 2>/dev/null)
    if kill -0 "$PID" 2>/dev/null; then
      LIVE_PIDS=$((LIVE_PIDS + 1))
    else
      STALE_PIDS=$((STALE_PIDS + 1))
    fi
  done
fi

if [[ "$STALE_PIDS" -eq 0 ]]; then
  pass "No stale PID files ($LIVE_PIDS live daemon(s))"
else
  warn "$STALE_PIDS stale PID file(s) — reset should clean these"
fi

# =============================================================================
section "1.7" "Live Event Flow (Active Capture Verification)"
# =============================================================================

TODAY=$(date +%Y-%m-%d)
TODAY_FILE="$UNFADE_HOME/events/${TODAY}.jsonl"

if [[ -f "$TODAY_FILE" ]]; then
  # Check file modification time — recent means active capture
  if [[ "$(uname)" == "Darwin" ]]; then
    FILE_MTIME=$(stat -f%m "$TODAY_FILE" 2>/dev/null || true)
  else
    FILE_MTIME=$(stat -c%Y "$TODAY_FILE" 2>/dev/null || true)
  fi
  NOW=$(date +%s)
  AGE_SECS=$((NOW - FILE_MTIME))
  AGE_MINS=$((AGE_SECS / 60))

  if [[ "$AGE_SECS" -lt 300 ]]; then
    pass "Today's JSONL modified ${AGE_SECS}s ago — active capture confirmed"
  elif [[ "$AGE_SECS" -lt 3600 ]]; then
    warn "Today's JSONL last modified ${AGE_MINS}m ago — capture may be stalled"
  else
    fail "Today's JSONL last modified ${AGE_MINS}m ago — no recent capture activity"
  fi

  # Count today's events
  TODAY_LINES=$(wc -l < "$TODAY_FILE" 2>/dev/null | tr -d ' ')
  TODAY_SIZE=$(du -sh "$TODAY_FILE" 2>/dev/null | awk '{print $1}')
  pass "Today's events: $TODAY_LINES lines ($TODAY_SIZE)"

  # Cross-check with daemon health.json events_today
  if [[ -d "$DAEMONS_DIR" ]]; then
    HEALTH_EVENTS_TOTAL=0
    for dir in "$DAEMONS_DIR"/*/; do
      [[ -d "$dir" ]] || continue
      HFILE="$dir/health.json"
      if [[ -f "$HFILE" ]]; then
        HE=$(node -e "const h=JSON.parse(require('fs').readFileSync('$HFILE','utf8')); console.log(h.events_today??0);" 2>/dev/null || true)
        HEALTH_EVENTS_TOTAL=$((HEALTH_EVENTS_TOTAL + HE))
      fi
    done
    if [[ "$HEALTH_EVENTS_TOTAL" -gt 0 ]]; then
      pass "Daemon health.json reports $HEALTH_EVENTS_TOTAL events today"
    else
      if [[ "$TODAY_LINES" -gt 0 ]]; then
        warn "Daemons report events_today=0 but JSONL has $TODAY_LINES lines — counter may not reset correctly"
      else
        skip "No events today (both JSONL and health agree)"
      fi
    fi
  fi

  # Event source breakdown for today
  TODAY_SOURCES=$(head -200 "$TODAY_FILE" 2>/dev/null | node -e "
    const lines = require('fs').readFileSync('/dev/stdin','utf8').split('\n').filter(Boolean);
    const sources = {};
    for (const l of lines) {
      try { const e = JSON.parse(l); sources[e.source] = (sources[e.source]||0)+1; } catch {}
    }
    console.log(Object.entries(sources).map(([k,v]) => k+'='+v).join(', '));
  " 2>/dev/null || echo "parse error")
  detail "Today's event sources (sampled): $TODAY_SOURCES"
else
  warn "No JSONL file for today ($TODAY) — no events captured today"
fi

# =============================================================================
section "1.8" "Daemon Resource Health"
# =============================================================================

if [[ -d "$DAEMONS_DIR" ]]; then
  for dir in "$DAEMONS_DIR"/*/; do
    [[ -d "$dir" ]] || continue
    DAEMON_ID=$(basename "$dir")
    HEALTH_FILE="$dir/health.json"
    LOG_FILE="$dir/daemon.log"

    # Check health.json for goroutines, memory, watchers
    if [[ -f "$HEALTH_FILE" ]]; then
      RESOURCE_INFO=$(node -e "
        const h = JSON.parse(require('fs').readFileSync('$HEALTH_FILE','utf8'));
        const goroutines = h.goroutines ?? 0;
        const heapMB = ((h.heap_bytes ?? 0) / 1048576).toFixed(1);
        const rssMB = ((h.rss_bytes ?? 0) / 1048576).toFixed(1);
        const watchers = h.watchers ?? h.watcher_count ?? 0;
        const memLimit = ((h.memory_limit ?? 0) / 1048576).toFixed(0);
        console.log(goroutines + '|' + heapMB + '|' + rssMB + '|' + watchers + '|' + memLimit);
      " 2>/dev/null || echo "0|0|0|0|0")

      IFS='|' read -r R_GOROUTINES R_HEAP R_RSS R_WATCHERS R_MEMLIMIT <<< "$RESOURCE_INFO"
      detail "$DAEMON_ID: goroutines=$R_GOROUTINES heap=${R_HEAP}MB rss=${R_RSS}MB watchers=$R_WATCHERS"

      # RSS vs memory limit check
      if [[ "$R_MEMLIMIT" != "0" ]]; then
        RSS_INT=$(echo "$R_RSS" | cut -d. -f1)
        if [[ "${RSS_INT:-0}" -gt "${R_MEMLIMIT:-999}" ]]; then
          warn "$DAEMON_ID: RSS (${R_RSS}MB) exceeds memory limit (${R_MEMLIMIT}MB)"
        else
          pass "$DAEMON_ID: RSS (${R_RSS}MB) within memory limit (${R_MEMLIMIT}MB)"
        fi
      fi
    fi

    # Scan daemon.log for resource budget warnings
    if [[ -f "$LOG_FILE" ]]; then
      BUDGET_WARNS=$(grep -c "resource budget exceeded" "$LOG_FILE" 2>/dev/null || true)
      if [[ "${BUDGET_WARNS:-0}" -gt 0 ]]; then
        warn "$DAEMON_ID: $BUDGET_WARNS 'resource budget exceeded' warnings in log"
        grep "resource budget exceeded" "$LOG_FILE" 2>/dev/null | tail -2 | while read -r line; do
          echo -e "      ${YELLOW}${line:0:140}${NC}"
        done
      else
        pass "$DAEMON_ID: no resource budget warnings"
      fi

      # Check for repeated restart/crash patterns
      RESTART_COUNT=$(grep -c "starting\|restarting\|recovered" "$LOG_FILE" 2>/dev/null || true)
      if [[ "${RESTART_COUNT:-0}" -gt 5 ]]; then
        warn "$DAEMON_ID: $RESTART_COUNT start/restart entries — may be crash-looping"
      fi
    fi
  done
else
  skip "No daemon directories for resource health check"
fi

# ═══════════════════════════════════════════════════════════════════════════════
#  LAYER 2: DUAL DB MATERIALIZER
# ═══════════════════════════════════════════════════════════════════════════════

echo -e "\n${BOLD}╔═══════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║    LAYER 2: DUAL DB MATERIALIZER                  ║${NC}"
echo -e "${BOLD}╚═══════════════════════════════════════════════════╝${NC}"

# =============================================================================
section "2.1" "Layer 2 Directory Structure"
# =============================================================================

CACHE_DIR="$UNFADE_HOME/cache"
if [[ -d "$CACHE_DIR" ]]; then
  pass "$CACHE_DIR exists"
else
  fail "$CACHE_DIR missing"
fi

STATE_DIR="$UNFADE_HOME/state"
if [[ -d "$STATE_DIR" ]]; then
  pass "$STATE_DIR exists"
else
  fail "$STATE_DIR missing"
fi

# =============================================================================
section "2.2" "Materializer Cursor"
# =============================================================================

CURSOR="$UNFADE_HOME/state/materializer.json"
if [[ -f "$CURSOR" ]]; then
  pass "Materializer cursor exists"

  CURSOR_INFO=$(node -e "
    const c = JSON.parse(require('fs').readFileSync('$CURSOR','utf8'));
    const streams = Object.entries(c.streams || {});
    let processed = 0, total = 0, fullyDone = 0;
    let hasHash = 0;
    let hasEpoch = 0;
    for (const [name, s] of streams) {
      processed += s.byteOffset || 0;
      total += s.fileSize || s.byteOffset || 0;
      if (s.fileSize && s.byteOffset >= s.fileSize) fullyDone++;
      if (s.lastLineHash) hasHash++;
      if (s.epoch) hasEpoch++;
    }
    const pct = total > 0 ? Math.round(processed / total * 100) : 0;
    const ver = c.schemaVersion || 0;
    console.log(streams.length + '|' + processed + '|' + total + '|' + pct + '|' + fullyDone + '|' + hasHash + '|' + hasEpoch + '|' + ver);
  " 2>/dev/null || echo "0|0|0|0|0|0")

  IFS='|' read -r C_STREAMS C_PROCESSED C_TOTAL C_PCT C_DONE C_HASHES C_EPOCHS C_VER <<< "$CURSOR_INFO"

  if [[ "$C_VER" -eq 1 ]]; then
    pass "Cursor schema version: $C_VER"
  elif [[ "$C_VER" -gt 0 ]]; then
    warn "Cursor schema version: $C_VER (expected 1)"
  else
    fail "Cursor schema version missing"
  fi

  pass "Tracking $C_STREAMS stream(s), $C_DONE fully processed"

  PROCESSED_MB=$((C_PROCESSED / 1048576))
  TOTAL_MB=$((C_TOTAL / 1048576))
  if [[ "$C_PCT" -ge 100 ]]; then
    pass "Materialization: 100% complete (${PROCESSED_MB}MB / ${TOTAL_MB}MB)"
  elif [[ "$C_PCT" -gt 0 ]]; then
    warn "Materialization: ${C_PCT}% (${PROCESSED_MB}MB / ${TOTAL_MB}MB) — not fully caught up"
  else
    fail "Materialization: 0% — materializer may not be running"
  fi

  # lastLineHash integrity validation
  if [[ "$C_HASHES" -gt 0 ]]; then
    pass "Cursor has $C_HASHES lastLineHash(es) for integrity validation"
  else
    warn "No lastLineHash values in cursor — integrity checks disabled"
  fi

  # Epoch file validation
  if [[ "$C_EPOCHS" -gt 0 ]]; then
    pass "Cursor has $C_EPOCHS epoch marker(s) for file-replacement detection"
  else
    skip "No epoch markers in cursor"
  fi

  # Materializer liveness: compare cursor offset vs actual file size for today
  if [[ -f "$TODAY_FILE" ]]; then
    CURSOR_GAP=$(node -e "
      const c = JSON.parse(require('fs').readFileSync('$CURSOR','utf8'));
      const fs = require('fs');
      const path = require('path');
      const todayKey = Object.keys(c.streams || {}).find(k => k.includes('$TODAY'));
      if (!todayKey) { console.log('no-stream'); process.exit(0); }
      const s = c.streams[todayKey];
      const actualSize = fs.statSync('$TODAY_FILE').size;
      const gap = actualSize - (s.byteOffset || 0);
      const pct = actualSize > 0 ? Math.round(s.byteOffset / actualSize * 100) : 100;
      console.log(gap + '|' + s.byteOffset + '|' + actualSize + '|' + pct);
    " 2>/dev/null || echo "error")

    if [[ "$CURSOR_GAP" == "no-stream" ]]; then
      warn "Materializer has no cursor entry for today's stream — new events not being processed"
    elif [[ "$CURSOR_GAP" != "error" ]]; then
      IFS='|' read -r MG_GAP MG_OFFSET MG_ACTUAL MG_PCT <<< "$CURSOR_GAP"
      if [[ "$MG_GAP" -le 0 ]]; then
        pass "Materializer fully caught up on today's stream (${MG_PCT}%)"
      elif [[ "$MG_GAP" -lt 50000 ]]; then
        warn "Materializer ${MG_GAP} bytes behind on today's stream (${MG_PCT}%)"
        detail "Cursor: ${MG_OFFSET} / Actual: ${MG_ACTUAL}"
      else
        GAP_KB=$((MG_GAP / 1024))
        fail "Materializer ${GAP_KB}KB behind on today's stream (${MG_PCT}%) — events not being processed"
        detail "Cursor: ${MG_OFFSET} / Actual: ${MG_ACTUAL}"
      fi
    fi
  fi
else
  fail "Materializer cursor missing — materializer never ran"
fi

# =============================================================================
section "2.3" "SQLite Operational Cache"
# =============================================================================

SQLITE_DB="$UNFADE_HOME/cache/unfade.db"
SQLITE_EVENT_COUNT=0

if [[ -f "$SQLITE_DB" ]]; then
  SQLITE_SIZE=$(du -sh "$SQLITE_DB" 2>/dev/null | awk '{print $1}')
  pass "SQLite cache exists ($SQLITE_SIZE)"

  # Required tables per Layer 2 spec: events, events_fts, event_insight_map, features, event_features, event_links
  SQLITE_TABLES=$(sqlite3 "$SQLITE_DB" ".tables" 2>/dev/null || echo "error")
  if [[ "$SQLITE_TABLES" == "error" ]]; then
    fail "Cannot query SQLite database"
  else
    EXPECTED_TABLES=("events" "events_fts" "event_insight_map" "features" "event_features" "event_links")
    for tbl in "${EXPECTED_TABLES[@]}"; do
      if echo "$SQLITE_TABLES" | grep -qw "$tbl"; then
        pass "SQLite table: $tbl"
      else
        fail "SQLite table missing: $tbl"
      fi
    done
  fi

  # Event count
  SQLITE_EVENT_COUNT=$(sqlite3 "$SQLITE_DB" "SELECT COUNT(*) FROM events" 2>/dev/null || true)
  if [[ "$SQLITE_EVENT_COUNT" -gt 0 ]]; then
    pass "SQLite events: $SQLITE_EVENT_COUNT rows"
  else
    fail "SQLite events table is empty"
  fi

  # FTS index health
  FTS_COUNT=$(sqlite3 "$SQLITE_DB" "SELECT COUNT(*) FROM events_fts" 2>/dev/null || true)
  if [[ "$FTS_COUNT" -gt 0 ]]; then
    pass "SQLite FTS index: $FTS_COUNT entries"
  else
    warn "SQLite FTS index empty"
  fi

  # Verify metadata is stored as JSON blob (Layer 2 spec: SQLite keeps metadata as JSON blob)
  META_SAMPLE=$(sqlite3 "$SQLITE_DB" "SELECT metadata FROM events WHERE metadata IS NOT NULL LIMIT 1" 2>/dev/null || echo "")
  if [[ -n "$META_SAMPLE" ]]; then
    IS_JSON=$(echo "$META_SAMPLE" | node -e "try{JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));console.log('yes')}catch{console.log('no')}" 2>/dev/null || echo "no")
    if [[ "$IS_JSON" == "yes" ]]; then
      pass "SQLite metadata stored as JSON blob (correct)"
    else
      warn "SQLite metadata may not be valid JSON"
    fi
  else
    skip "No metadata to validate"
  fi

  # Check project_id column exists and has values (global-first model)
  PID_COUNT=$(sqlite3 "$SQLITE_DB" "SELECT COUNT(DISTINCT project_id) FROM events WHERE project_id IS NOT NULL AND project_id != ''" 2>/dev/null || true)
  if [[ "$PID_COUNT" -gt 0 ]]; then
    pass "SQLite: $PID_COUNT distinct project_id(s) — global-first model OK"
  else
    warn "SQLite: no project_id values found"
  fi
else
  fail "SQLite cache missing at $SQLITE_DB"
fi

# =============================================================================
section "2.4" "DuckDB Analytics Cache"
# =============================================================================

DUCKDB_FILE="$UNFADE_HOME/cache/unfade.duckdb"
DUCK_EVENT_COUNT=0
DUCK_QUERIED="no"

if [[ -f "$DUCKDB_FILE" ]]; then
  DUCKDB_SIZE=$(du -sh "$DUCKDB_FILE" 2>/dev/null | awk '{print $1}')
  DUCKDB_BYTES=$(stat -f%z "$DUCKDB_FILE" 2>/dev/null || stat -c%s "$DUCKDB_FILE" 2>/dev/null || true)
  pass "DuckDB file exists ($DUCKDB_SIZE)"

  if [[ "$DUCKDB_BYTES" -lt 100000 ]]; then
    fail "DuckDB suspiciously small (${DUCKDB_BYTES} bytes) — likely empty"
    detail "Fix: run 'node dist/cli.mjs doctor --rebuild-cache'"
  else
    pass "DuckDB size looks healthy (${DUCKDB_BYTES} bytes)"
  fi

  # Query DuckDB: event count + table list + typed column check
  # NOTE: DuckDB only allows one writer. If unfade server is running, READ_ONLY
  # may still fail due to the lock. We detect this and report it as a skip, not fail.
  DUCK_RESULT=$(node --input-type=module -e "
    import { DuckDBInstance } from '@duckdb/node-api';
    const inst = await DuckDBInstance.create('$DUCKDB_FILE', { access_mode: 'READ_ONLY' });
    const conn = await inst.connect();

    // Event count
    const evtR = await conn.runAndReadAll('SELECT COUNT(*) FROM events');
    const evtCount = Number(evtR.getRows()[0][0]);

    // All tables
    const tabR = await conn.runAndReadAll(\"SELECT table_name FROM information_schema.tables WHERE table_schema='main' ORDER BY table_name\");
    const tables = tabR.getRows().map(r => String(r[0]));

    // Column count on events table (should be ~37)
    const colR = await conn.runAndReadAll(\"SELECT COUNT(*) FROM information_schema.columns WHERE table_name='events' AND table_schema='main'\");
    const colCount = Number(colR.getRows()[0][0]);

    // Check VARCHAR[] columns have data
    const listR = await conn.runAndReadAll(\"SELECT COUNT(*) as total, COUNT(CASE WHEN content_files IS NOT NULL AND len(content_files) > 0 THEN 1 END) as has_files, COUNT(CASE WHEN files_referenced IS NOT NULL AND len(files_referenced) > 0 THEN 1 END) as has_ref, COUNT(CASE WHEN files_modified IS NOT NULL AND len(files_modified) > 0 THEN 1 END) as has_mod FROM events\");
    const listRow = listR.getRows()[0];
    const listTotal = Number(listRow[0]);
    const listFiles = Number(listRow[1]);
    const listRef = Number(listRow[2]);
    const listMod = Number(listRow[3]);

    // Session count
    let sessCount = 0;
    try {
      const sessR = await conn.runAndReadAll('SELECT COUNT(*) FROM sessions');
      sessCount = Number(sessR.getRows()[0][0]);
    } catch {}

    conn.closeSync();
    console.log(JSON.stringify({
      evtCount, tables, colCount,
      listTotal, listFiles, listRef, listMod,
      sessCount
    }));
  " 2>/dev/null || echo '{"error":true}')

  if echo "$DUCK_RESULT" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); process.exit(d.error ? 1 : 0)" 2>/dev/null; then
    DUCK_QUERIED="yes"
    DUCK_INFO=$(echo "$DUCK_RESULT" | node -e "
      const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));

      // Event count
      console.log('EVT|' + d.evtCount);

      // Tables
      console.log('TABLES|' + d.tables.join(','));

      // Column count
      console.log('COLS|' + d.colCount);

      // VARCHAR[] columns
      console.log('LIST|' + d.listTotal + '|' + d.listFiles + '|' + d.listRef + '|' + d.listMod);

      // Sessions
      console.log('SESS|' + d.sessCount);
    " 2>/dev/null)

    while IFS='|' read -r key rest; do
      case "$key" in
        EVT)
          DUCK_EVENT_COUNT=$rest
          if [[ "$DUCK_EVENT_COUNT" -gt 0 ]]; then
            pass "DuckDB events: $DUCK_EVENT_COUNT rows"
          else
            fail "DuckDB events table is empty"
          fi
          ;;
        TABLES)
          # Expected 14 tables per duckdb-schema.ts ALL_DUCKDB_DDL
          EXPECTED_DUCK_TABLES=(
            "events" "sessions" "direction_windows" "comprehension_proxy"
            "comprehension_by_module" "direction_by_file" "token_proxy_spend"
            "metric_snapshots" "decisions" "decision_edges" "event_links"
            "feature_registry" "prompt_response_correlations" "prompt_chains"
          )
          for tbl in "${EXPECTED_DUCK_TABLES[@]}"; do
            if echo ",$rest," | grep -q ",$tbl,"; then
              pass "DuckDB table: $tbl"
            else
              fail "DuckDB table missing: $tbl"
            fi
          done
          ;;
        COLS)
          if [[ "$rest" -ge 44 ]]; then
            pass "DuckDB events table: $rest typed columns (expected ~46)"
          elif [[ "$rest" -gt 0 ]]; then
            warn "DuckDB events table: only $rest columns (expected ~46)"
          else
            fail "DuckDB events table: 0 columns"
          fi
          ;;
        LIST)
          IFS='|' read -r L_TOTAL L_FILES L_REF L_MOD <<< "$rest"
          detail "VARCHAR[] column population ($L_TOTAL total events):"
          if [[ "$L_FILES" -gt 0 ]]; then
            pass "  content_files: $L_FILES events have data"
          else
            warn "  content_files: all empty (may be OK for AI-only events)"
          fi
          if [[ "$L_REF" -gt 0 ]]; then
            pass "  files_referenced: $L_REF events have data"
          else
            warn "  files_referenced: all empty"
          fi
          if [[ "$L_MOD" -gt 0 ]]; then
            pass "  files_modified: $L_MOD events have data"
          else
            warn "  files_modified: all empty"
          fi
          ;;
        SESS)
          if [[ "$rest" -gt 0 ]]; then
            pass "DuckDB sessions: $rest rows"
          else
            skip "DuckDB sessions: empty (populated by session materializer)"
          fi
          ;;
      esac
    done <<< "$DUCK_INFO"
  else
    # Check if it's a lock error (unfade server is holding the write lock)
    DUCK_ERR=$(node --input-type=module -e "
      import { DuckDBInstance } from '@duckdb/node-api';
      try {
        await DuckDBInstance.create('$DUCKDB_FILE', { access_mode: 'READ_ONLY' });
        console.log('ok');
      } catch (e) {
        if (e.message && e.message.includes('lock')) {
          console.log('locked');
        } else {
          console.log('error:' + e.message);
        }
      }
    " 2>/dev/null || echo "error:node-failed")

    if [[ "$DUCK_ERR" == "locked" ]]; then
      skip "DuckDB locked by running unfade server — stop server to verify DuckDB contents"
      detail "This is expected while the server is running (DuckDB single-writer lock)"
    else
      warn "DuckDB: cannot query (${DUCK_ERR})"
      detail "Try: node --input-type=module -e \"import {DuckDBInstance} from '@duckdb/node-api'; ...\""
    fi
  fi
else
  fail "DuckDB file missing at $DUCKDB_FILE"
fi

# =============================================================================
section "2.5" "Data Consistency: JSONL ↔ SQLite ↔ DuckDB"
# =============================================================================

# JSONL vs SQLite
if [[ "$TOTAL_LINES" -gt 0 && "$SQLITE_EVENT_COUNT" -gt 0 ]]; then
  if [[ "$SQLITE_EVENT_COUNT" -ge "$TOTAL_LINES" ]]; then
    pass "SQLite ($SQLITE_EVENT_COUNT) >= JSONL lines ($TOTAL_LINES) — all materialized"
  else
    MISSING=$((TOTAL_LINES - SQLITE_EVENT_COUNT))
    PCT_DONE=$((SQLITE_EVENT_COUNT * 100 / TOTAL_LINES))
    if [[ "$MISSING" -lt 100 ]]; then
      warn "SQLite ($SQLITE_EVENT_COUNT) < JSONL ($TOTAL_LINES) — $MISSING pending (${PCT_DONE}%)"
    else
      fail "SQLite ($SQLITE_EVENT_COUNT) << JSONL ($TOTAL_LINES) — $MISSING events not materialized"
    fi
  fi
else
  skip "JSONL vs SQLite comparison (insufficient data)"
fi

# SQLite vs DuckDB
# DUCK_QUERIED is "yes" if we were able to query DuckDB, "no" if locked/unavailable
if [[ "$DUCK_QUERIED" != "yes" ]]; then
  skip "SQLite vs DuckDB comparison (DuckDB not queryable — likely locked by server)"
elif [[ "$SQLITE_EVENT_COUNT" -gt 0 && "$DUCK_EVENT_COUNT" -gt 0 ]]; then
  if [[ "$SQLITE_EVENT_COUNT" -eq "$DUCK_EVENT_COUNT" ]]; then
    pass "SQLite ($SQLITE_EVENT_COUNT) = DuckDB ($DUCK_EVENT_COUNT) — databases in sync"
  else
    DIFF=$((SQLITE_EVENT_COUNT - DUCK_EVENT_COUNT))
    ABS_DIFF=${DIFF#-}
    if [[ "$ABS_DIFF" -lt 100 ]]; then
      warn "SQLite ($SQLITE_EVENT_COUNT) ≠ DuckDB ($DUCK_EVENT_COUNT) — minor drift ($DIFF)"
    else
      fail "SQLite ($SQLITE_EVENT_COUNT) ≠ DuckDB ($DUCK_EVENT_COUNT) — significant drift ($DIFF)"
      detail "Fix: run 'node dist/cli.mjs doctor --rebuild-cache'"
    fi
  fi
elif [[ "$SQLITE_EVENT_COUNT" -gt 0 && "$DUCK_EVENT_COUNT" -eq 0 ]]; then
  fail "SQLite has $SQLITE_EVENT_COUNT events but DuckDB is empty — DuckDB writes failing"
  detail "This was a known bug (VARCHAR[] binding). Fix: run 'node dist/cli.mjs doctor --rebuild-cache'"
else
  skip "SQLite vs DuckDB comparison (insufficient data)"
fi

# =============================================================================
section "2.6" "DuckDB Typed Column Extraction"
# =============================================================================

# Verify that metadata fields are promoted to typed columns (not stored as json_extract)
if [[ "$DUCK_EVENT_COUNT" -gt 0 ]]; then
  TYPED_CHECK=$(node --input-type=module -e "
    import { DuckDBInstance } from '@duckdb/node-api';
    const inst = await DuckDBInstance.create('$DUCKDB_FILE', { access_mode: 'READ_ONLY' });
    const conn = await inst.connect();

    // Key typed columns from DuckDB events table (base + Sprint 16B)
    const checks = [
      { col: 'project_id', type: 'VARCHAR' },
      { col: 'session_id', type: 'VARCHAR' },
      { col: 'ai_tool', type: 'VARCHAR' },
      { col: 'git_commit_hash', type: 'VARCHAR' },
      { col: 'tokens_in', type: 'INTEGER' },
      { col: 'tokens_out', type: 'INTEGER' },
      { col: 'human_direction_score', type: 'FLOAT' },
      { col: 'content_files', type: 'VARCHAR[]' },
      { col: 'files_referenced', type: 'VARCHAR[]' },
      { col: 'files_modified', type: 'VARCHAR[]' },
      { col: 'prompt_type', type: 'VARCHAR' },
      { col: 'chain_pattern', type: 'VARCHAR' },
    ];

    const results = [];
    for (const { col } of checks) {
      try {
        const r = await conn.runAndReadAll(
          'SELECT COUNT(*) FROM events WHERE ' + col + ' IS NOT NULL'
        );
        results.push({ col, nonNull: Number(r.getRows()[0][0]) });
      } catch (e) {
        results.push({ col, error: e.message });
      }
    }

    conn.closeSync();
    console.log(JSON.stringify(results));
  " 2>/dev/null || echo "[]")

  if [[ "$TYPED_CHECK" != "[]" ]]; then
    echo "$TYPED_CHECK" | node -e "
      const results = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
      for (const r of results) {
        if (r.error) {
          console.log('FAIL|' + r.col + '|column missing or error: ' + r.error);
        } else if (r.nonNull > 0) {
          console.log('PASS|' + r.col + '|' + r.nonNull + ' non-null values');
        } else {
          console.log('WARN|' + r.col + '|all null (may be OK depending on event types)');
        }
      }
    " 2>/dev/null | while IFS='|' read -r verdict col msg; do
      case "$verdict" in
        PASS) pass "DuckDB typed column $col: $msg" ;;
        WARN) warn "DuckDB typed column $col: $msg" ;;
        FAIL) fail "DuckDB typed column $col: $msg" ;;
      esac
    done
  else
    skip "Could not verify typed columns"
  fi
elif [[ "$DUCK_QUERIED" != "yes" ]]; then
  skip "DuckDB typed column check (DuckDB not queryable — likely locked by server)"
else
  skip "DuckDB typed column check (no events)"
fi

# =============================================================================
section "2.7" "Rebuild/Repair (doctor --rebuild-cache)"
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CLI_BUNDLE="$SCRIPT_DIR/dist/cli.mjs"

if [[ -f "$CLI_BUNDLE" ]]; then
  pass "CLI bundle exists (needed for doctor --rebuild-cache)"
  detail "To rebuild both caches from JSONL: node $CLI_BUNDLE doctor --rebuild-cache"
else
  warn "CLI bundle missing — cannot verify rebuild capability (run 'pnpm build')"
fi


# =============================================================================
section "2.8" "HTTP Server Health"
# =============================================================================

SERVER_PORT="${UNFADE_PORT:-7654}"
SERVER_URL="http://127.0.0.1:${SERVER_PORT}"

# Check if unfade server process is running
UNFADE_SERVER_PID=$( (pgrep -f "unfade.*server|node.*unfade|node.*cli.mjs" 2>/dev/null || true) | head -1)
if [[ -n "$UNFADE_SERVER_PID" ]]; then
  pass "Unfade server process found (PID: $UNFADE_SERVER_PID)"
  # Process details
  SERVER_PS=$(ps -p "$UNFADE_SERVER_PID" -o %cpu,%mem,etime 2>/dev/null | tail -1 || echo "")
  if [[ -n "$SERVER_PS" ]]; then
    S_CPU=$(echo "$SERVER_PS" | awk '{print $1}')
    S_MEM=$(echo "$SERVER_PS" | awk '{print $2}')
    S_ETIME=$(echo "$SERVER_PS" | awk '{print $3}')
    detail "Server: CPU ${S_CPU}%  MEM ${S_MEM}%  Elapsed: ${S_ETIME}"
    S_CPU_INT=$(echo "$S_CPU" | cut -d. -f1)
    if [[ "${S_CPU_INT:-0}" -gt 80 ]]; then
      warn "Server at high CPU (${S_CPU}%) — may be stuck or under heavy load"
    fi
  fi
else
  warn "No unfade server process detected"
fi

# HTTP health check (follow redirects with -L)
HTTP_STATUS=$(curl -sL -o /dev/null -w "%{http_code}" --connect-timeout 3 "$SERVER_URL/" 2>/dev/null || echo "000")
if [[ "$HTTP_STATUS" == "200" ]]; then
  pass "HTTP server responding at $SERVER_URL (status $HTTP_STATUS)"
elif [[ "$HTTP_STATUS" == "000" ]]; then
  fail "HTTP server not reachable at $SERVER_URL — connection refused or timed out"
else
  warn "HTTP server at $SERVER_URL returned unexpected status $HTTP_STATUS"
fi

# System health API check (/api/system/health is the canonical path)
HEALTH_JSON=$(curl -sL --connect-timeout 3 "$SERVER_URL/api/system/health" 2>/dev/null || echo "")
HEALTH_STATUS=$(echo "$HEALTH_JSON" | node -e "
  try {
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const s = d.data?.status ?? 'unknown';
    const ir = d.data?.intelligenceReady ?? false;
    const repos = d.data?.repos?.length ?? 0;
    const lag = d.data?.repos?.[0]?.materializerLagMs ?? -1;
    const reasons = (d.data?.degradedReasons ?? []).join('; ');
    console.log(s + '|' + ir + '|' + repos + '|' + lag + '|' + reasons);
  } catch { console.log('error|false|0|-1|'); }
" 2>/dev/null || echo "error|false|0|-1|")
IFS='|' read -r H_STATUS H_INTL_READY H_REPOS H_LAG H_REASONS <<< "$HEALTH_STATUS"
if [[ "$H_STATUS" == "ok" ]]; then
  pass "System health: ok (intelligenceReady=$H_INTL_READY, repos=$H_REPOS)"
elif [[ "$H_STATUS" == "degraded" ]]; then
  warn "System health: degraded — $H_REASONS"
  detail "intelligenceReady=$H_INTL_READY  repos=$H_REPOS  materializerLagMs=$H_LAG"
elif [[ "$H_STATUS" == "error" ]]; then
  fail "System health API not responding or unparseable"
else
  warn "System health: $H_STATUS"
fi

# API endpoint health check
API_STATUS=$(curl -sL -o /dev/null -w "%{http_code}" --connect-timeout 3 "$SERVER_URL/api/setup/progress" 2>/dev/null || echo "000")
if [[ "$API_STATUS" == "200" ]]; then
  pass "API endpoint /api/setup/progress responding (status $API_STATUS)"

  # Parse progress response
  PROGRESS_JSON=$(curl -sL --connect-timeout 3 "$SERVER_URL/api/setup/progress" 2>/dev/null || echo "{}")
  PROG_INFO=$(echo "$PROGRESS_JSON" | node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    console.log((d.phase??'unknown') + '|' + (d.percent??0) + '|' + (d.processedEvents??0) + '|' + (d.totalEvents??0));
  " 2>/dev/null || echo "error|0|0|0")
  IFS='|' read -r SP_PHASE SP_PCT SP_PROC SP_TOTAL <<< "$PROG_INFO"
  if [[ "$SP_PHASE" != "error" ]]; then
    detail "Synthesis: phase=$SP_PHASE, ${SP_PCT}%, ${SP_PROC}/${SP_TOTAL} events"
    if [[ "$SP_PHASE" == "complete" ]]; then
      pass "Synthesis phase: complete"
    elif [[ "$SP_PHASE" == "materializing" ]]; then
      warn "Synthesis phase: still materializing (${SP_PCT}%)"
    else
      detail "Synthesis phase: $SP_PHASE"
    fi
  fi
elif [[ "$API_STATUS" == "000" ]]; then
  skip "API not reachable (server may not be running)"
else
  warn "API endpoint returned status $API_STATUS"
fi

# PID file check (server PID)
SERVER_PID_FILE="$UNFADE_HOME/state/server.pid"
if [[ -f "$SERVER_PID_FILE" ]]; then
  STORED_PID=$(cat "$SERVER_PID_FILE" 2>/dev/null)
  if kill -0 "$STORED_PID" 2>/dev/null; then
    pass "Server PID file matches live process ($STORED_PID)"
  else
    warn "Server PID file stale (PID $STORED_PID not running)"
  fi
else
  skip "No server PID file at $SERVER_PID_FILE"
fi

# =============================================================================
section "2.9" "End-to-End Flow Validation (JSONL → SQLite)"
# =============================================================================

# Pick the last event from JSONL and verify it exists in SQLite
if [[ -f "$SQLITE_DB" && "$TOTAL_LINES" -gt 0 ]]; then
  NEWEST_JSONL=$(ls "$EVENTS_DIR"/*.jsonl 2>/dev/null | tail -1)
  LAST_EVENT_ID=$(tail -1 "$NEWEST_JSONL" 2>/dev/null | node -e "
    try {
      const e = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
      console.log(e.id ?? '');
    } catch { console.log(''); }
  " 2>/dev/null || echo "")

  if [[ -n "$LAST_EVENT_ID" ]]; then
    FOUND_IN_SQLITE=$(sqlite3 "$SQLITE_DB" "SELECT COUNT(*) FROM events WHERE id='$LAST_EVENT_ID'" 2>/dev/null || true)
    if [[ "$FOUND_IN_SQLITE" -gt 0 ]]; then
      pass "End-to-end: last JSONL event ($LAST_EVENT_ID) found in SQLite"
    else
      # Check a slightly older event (last event may not be materialized yet)
      OLDER_EVENT_ID=$(tail -10 "$NEWEST_JSONL" 2>/dev/null | head -1 | node -e "
        try {
          const e = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
          console.log(e.id ?? '');
        } catch { console.log(''); }
      " 2>/dev/null || echo "")

      if [[ -n "$OLDER_EVENT_ID" ]]; then
        FOUND_OLDER=$(sqlite3 "$SQLITE_DB" "SELECT COUNT(*) FROM events WHERE id='$OLDER_EVENT_ID'" 2>/dev/null || true)
        if [[ "$FOUND_OLDER" -gt 0 ]]; then
          warn "End-to-end: latest event not yet in SQLite, but recent event ($OLDER_EVENT_ID) is — materializer slightly behind"
        else
          fail "End-to-end: neither latest nor recent JSONL events found in SQLite — pipeline broken"
        fi
      else
        fail "End-to-end: last JSONL event ($LAST_EVENT_ID) NOT in SQLite — materializer may be stalled"
      fi
    fi
  else
    warn "Could not extract event ID from last JSONL line"
  fi

  # Verify event content integrity: pick a random SQLite event and check it matches JSONL source
  SAMPLE_ID=$(sqlite3 "$SQLITE_DB" "SELECT id FROM events ORDER BY timestamp DESC LIMIT 1" 2>/dev/null || echo "")
  if [[ -n "$SAMPLE_ID" ]]; then
    SQLITE_SOURCE=$(sqlite3 "$SQLITE_DB" "SELECT source FROM events WHERE id='$SAMPLE_ID'" 2>/dev/null || echo "")
    JSONL_SOURCE=$( (grep -h "\"$SAMPLE_ID\"" "$EVENTS_DIR"/*.jsonl 2>/dev/null || true) | head -1 | node -e "
      try {
        const e = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
        console.log(e.source ?? '');
      } catch { console.log(''); }
    " 2>/dev/null || echo "")

    if [[ -n "$JSONL_SOURCE" && "$SQLITE_SOURCE" == "$JSONL_SOURCE" ]]; then
      pass "Event integrity: SQLite source='$SQLITE_SOURCE' matches JSONL for event $SAMPLE_ID"
    elif [[ -z "$JSONL_SOURCE" ]]; then
      skip "Could not locate event $SAMPLE_ID in JSONL for integrity check"
    else
      fail "Event integrity mismatch: SQLite source='$SQLITE_SOURCE' vs JSONL source='$JSONL_SOURCE'"
    fi
  fi
else
  skip "End-to-end validation (need both SQLite and JSONL)"
fi

# ═══════════════════════════════════════════════════════════════════════════════
#  LAYER 2b: CozoDB INTELLIGENCE GRAPH
# ═══════════════════════════════════════════════════════════════════════════════

echo -e "\n${BOLD}╔═══════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║    LAYER 2b: CozoDB INTELLIGENCE GRAPH             ║${NC}"
echo -e "${BOLD}╚═══════════════════════════════════════════════════╝${NC}"

# =============================================================================
section "2b.1" "CozoDB Database File"
# =============================================================================

INTEL_DIR="$UNFADE_HOME/intelligence"
COZO_DB="$INTEL_DIR/graph.db"

if [[ -d "$INTEL_DIR" ]]; then
  pass "Intelligence directory exists"
else
  fail "Intelligence directory missing at $INTEL_DIR"
fi

if [[ -f "$COZO_DB" ]]; then
  COZO_SIZE=$(du -sh "$COZO_DB" 2>/dev/null | awk '{print $1}')
  COZO_BYTES=$(stat -f%z "$COZO_DB" 2>/dev/null || stat -c%s "$COZO_DB" 2>/dev/null || true)
  pass "CozoDB graph.db exists ($COZO_SIZE)"

  if [[ "$COZO_BYTES" -lt 1000 ]]; then
    warn "CozoDB suspiciously small (${COZO_BYTES} bytes) — may be empty"
  else
    pass "CozoDB size looks healthy (${COZO_BYTES} bytes)"
  fi
else
  fail "CozoDB graph.db missing at $COZO_DB"
fi

# =============================================================================
section "2b.2" "CozoDB Schema & Relations"
# =============================================================================

COZO_RESULT=$(node --input-type=module -e "
  import { CozoDb } from 'cozo-node';

  let db;
  try {
    db = new CozoDb('sqlite', '$COZO_DB');
  } catch (e) {
    console.log(JSON.stringify({ error: 'open_failed', message: e.message }));
    process.exit(0);
  }

  // Health check
  let healthy = false;
  try {
    const r = await db.run('?[x] := x = 1');
    healthy = (r.rows ?? []).length === 1;
  } catch {}

  // Check relations exist
  const relations = ['entity', 'edge', 'entity_source', 'meta'];
  const relationStatus = {};
  for (const rel of relations) {
    try {
      const r = await db.run('?[count(id)] := *' + rel + '{id}');
      const count = Number((r.rows ?? [])[0]?.[0] ?? 0);
      relationStatus[rel] = { exists: true, count };
    } catch (e) {
      // Try without 'id' for relations with different key
      try {
        const r = await db.run('?[count(key)] := *' + rel + '{key}');
        const count = Number((r.rows ?? [])[0]?.[0] ?? 0);
        relationStatus[rel] = { exists: true, count };
      } catch {
        relationStatus[rel] = { exists: false, count: 0 };
      }
    }
  }

  // Entity type distribution
  let typeDistribution = {};
  try {
    const r = await db.run('?[type, count(id)] := *entity{id, type}');
    for (const row of r.rows ?? []) {
      typeDistribution[String(row[0])] = Number(row[1]);
    }
  } catch {}

  // Edge count
  let edgeCount = 0;
  try {
    const r = await db.run('?[count(src)] := *edge{src}');
    edgeCount = Number((r.rows ?? [])[0]?.[0] ?? 0);
  } catch {}

  // Schema version
  let schemaVersion = 0;
  try {
    const r = await db.run(\"?[value] := *meta{key: 'schema_version', value}\");
    schemaVersion = Number((r.rows ?? [])[0]?.[0] ?? 0);
  } catch {}

  // Entity source tracking (analyzer contributions)
  let analyzerContributions = {};
  try {
    const r = await db.run('?[analyzer, count(entity_id)] := *entity_source{entity_id, analyzer}');
    for (const row of r.rows ?? []) {
      analyzerContributions[String(row[0])] = Number(row[1]);
    }
  } catch {}

  // Project distribution
  let projectDistribution = {};
  try {
    const r = await db.run('?[project_id, count(id)] := *entity{id, project_id}');
    for (const row of r.rows ?? []) {
      projectDistribution[String(row[0])] = Number(row[1]);
    }
  } catch {}

  db.close();

  console.log(JSON.stringify({
    healthy,
    relationStatus,
    typeDistribution,
    edgeCount,
    schemaVersion,
    analyzerContributions,
    projectDistribution
  }));
" 2>/dev/null || echo '{"error":"node_failed"}')

if echo "$COZO_RESULT" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); process.exit(d.error ? 1 : 0)" 2>/dev/null; then
  # Parse results
  echo "$COZO_RESULT" | node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));

    // Health
    if (d.healthy) {
      console.log('PASS|CozoDB health check passed (Datalog query OK)');
    } else {
      console.log('FAIL|CozoDB health check failed');
    }

    // Schema version
    if (d.schemaVersion > 0) {
      console.log('PASS|Schema version: ' + d.schemaVersion);
    } else {
      console.log('WARN|Schema version not set');
    }

    // Relations
    const expectedRelations = ['entity', 'edge', 'entity_source', 'meta'];
    for (const rel of expectedRelations) {
      const status = d.relationStatus[rel];
      if (!status) {
        console.log('FAIL|Relation missing: ' + rel);
      } else if (status.exists) {
        console.log('PASS|Relation ' + rel + ': ' + status.count + ' rows');
      } else {
        console.log('FAIL|Relation ' + rel + ' does not exist');
      }
    }

    // Entity type distribution
    const types = Object.entries(d.typeDistribution);
    if (types.length > 0) {
      console.log('PASS|Entity types: ' + types.map(([t, c]) => t + '=' + c).join(', '));
    } else {
      console.log('WARN|No entities in graph (intelligence pipeline may not have run)');
    }

    // Edge count
    if (d.edgeCount > 0) {
      console.log('PASS|Graph edges: ' + d.edgeCount);
    } else {
      console.log('WARN|No edges in graph');
    }

    // Analyzer contributions
    const analyzers = Object.entries(d.analyzerContributions);
    if (analyzers.length > 0) {
      console.log('PASS|Analyzer contributions: ' + analyzers.map(([a, c]) => a + '=' + c).join(', '));
    } else {
      console.log('WARN|No analyzer contributions tracked');
    }

    // Project distribution
    const projects = Object.entries(d.projectDistribution);
    if (projects.length > 0) {
      console.log('PASS|Project coverage: ' + projects.length + ' project(s) in graph');
    } else {
      console.log('WARN|No project-tagged entities');
    }
  " 2>/dev/null | while IFS='|' read -r verdict msg; do
    case "$verdict" in
      PASS) pass "$msg" ;;
      WARN) warn "$msg" ;;
      FAIL) fail "$msg" ;;
    esac
  done
else
  if echo "$COZO_RESULT" | grep -q "open_failed"; then
    fail "CozoDB: cannot open graph.db (may be locked or corrupt)"
  else
    warn "CozoDB: cannot query (cozo-node not available or import error)"
    detail "Ensure 'cozo-node' is installed: pnpm list cozo-node"
  fi
fi

# =============================================================================
section "2b.3" "CozoDB Data Consistency"
# =============================================================================

# Check that entity count is reasonable relative to event count
if [[ "$DUCK_QUERIED" != "yes" ]]; then
  skip "CozoDB vs DuckDB consistency (DuckDB not queryable — use SQLite event count instead)"
  # Fall back to SQLite count for a rough comparison
  if [[ "$SQLITE_EVENT_COUNT" -gt 0 ]]; then
    ENTITY_COUNT=$(echo "$COZO_RESULT" | node -e "
      const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
      const total = Object.values(d.typeDistribution || {}).reduce((a,b) => a+b, 0);
      console.log(total);
    " 2>/dev/null || true)
    if [[ "$ENTITY_COUNT" -gt 0 ]]; then
      pass "Graph density: $ENTITY_COUNT entities from ~$SQLITE_EVENT_COUNT events (SQLite fallback)"
    else
      warn "No entities in CozoDB despite $SQLITE_EVENT_COUNT events in SQLite — intelligence pipeline may not have run"
    fi
  fi
elif [[ "$DUCK_EVENT_COUNT" -gt 0 ]]; then
  ENTITY_COUNT=$(echo "$COZO_RESULT" | node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const total = Object.values(d.typeDistribution || {}).reduce((a,b) => a+b, 0);
    console.log(total);
  " 2>/dev/null || true)

  if [[ "$ENTITY_COUNT" -gt 0 ]]; then
    RATIO=$((DUCK_EVENT_COUNT / ENTITY_COUNT))
    pass "Graph density: $ENTITY_COUNT entities from $DUCK_EVENT_COUNT events (ratio: ~${RATIO}:1)"
  else
    warn "No entities in CozoDB despite $DUCK_EVENT_COUNT events in DuckDB — intelligence pipeline may not have run"
  fi
else
  skip "CozoDB vs DuckDB consistency (no DuckDB events)"
fi


# ═══════════════════════════════════════════════════════════════════════════════
#  LAYER 3: INTELLIGENCE ANALYSIS & SUBSTRATE
# ═══════════════════════════════════════════════════════════════════════════════

echo -e "\n${BOLD}╔═══════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║    LAYER 3: INTELLIGENCE ANALYSIS & SUBSTRATE      ║${NC}"
echo -e "${BOLD}╚═══════════════════════════════════════════════════╝${NC}"

# =============================================================================
section "3.1" "Intelligence Directory & Analyzer Outputs"
# =============================================================================

INTEL_DIR="$UNFADE_HOME/intelligence"

# All 25 expected analyzer output files
ANALYZER_OUTPUTS=(
  "direction_by_file.json"
  "token-proxy-spend.json"
  "direction-windows.json"
  "efficiency.json"
  "comprehension.json"
  "cost-attribution.json"
  "rejections.json"
  "velocity.json"
  "prompt-patterns.json"
  "alerts.json"
  "decision-replay.json"
  "session-intelligence.json"
  "causality-chains.json"
  "commit-analysis.json"
  "file-churn.json"
  "ai-git-links.json"
  "expertise-map.json"
  "summary-writer.json"
  "intelligence-snapshots.json"
  "profile-accumulator.json"
  "efficiency-survival.json"
  "dual-velocity.json"
  "maturity-assessment.json"
  "maturity-ownership.json"
  "narratives.json"
)

if [[ -d "$INTEL_DIR" ]]; then
  pass "Intelligence directory exists"
else
  fail "Intelligence directory missing at $INTEL_DIR"
fi

PRESENT_COUNT=0
MISSING_LIST=""
for OUTPUT_FILE in "${ANALYZER_OUTPUTS[@]}"; do
  if [[ -f "$INTEL_DIR/$OUTPUT_FILE" ]]; then
    PRESENT_COUNT=$((PRESENT_COUNT + 1))
  else
    MISSING_LIST="$MISSING_LIST $OUTPUT_FILE"
  fi
done

EXPECTED_COUNT=${#ANALYZER_OUTPUTS[@]}
if [[ "$PRESENT_COUNT" -eq "$EXPECTED_COUNT" ]]; then
  pass "All $EXPECTED_COUNT analyzer output files present"
elif [[ "$PRESENT_COUNT" -gt 0 ]]; then
  warn "$PRESENT_COUNT/$EXPECTED_COUNT analyzer outputs present (missing:$MISSING_LIST)"
else
  fail "No analyzer output files found (expected $EXPECTED_COUNT in $INTEL_DIR)"
fi

# =============================================================================
section "3.2" "Analyzer State Persistence"
# =============================================================================

STATE_DIR="$INTEL_DIR/state"

# Expected state files (one per analyzer)
ANALYZER_NAMES=(
  "direction-by-file" "token-proxy" "window-aggregator"
  "efficiency" "comprehension-radar" "cost-attribution"
  "loop-detector" "velocity-tracker" "prompt-patterns"
  "blind-spot-detector" "decision-replay" "session-intelligence"
  "causality-chains" "commit-analysis" "file-churn"
  "ai-git-linker" "expertise-map" "summary-writer"
  "intelligence-snapshots" "profile-accumulator"
  "efficiency-survival" "dual-velocity" "maturity-model"
  "maturity-ownership" "narrative-engine"
)

if [[ -d "$STATE_DIR" ]]; then
  pass "Analyzer state directory exists"
  STATE_FILE_COUNT=$(ls "$STATE_DIR"/*.json 2>/dev/null | wc -l | tr -d ' ')
  EXPECTED_STATES=${#ANALYZER_NAMES[@]}

  if [[ "$STATE_FILE_COUNT" -eq "$EXPECTED_STATES" ]]; then
    pass "All $EXPECTED_STATES analyzer state files present"
  elif [[ "$STATE_FILE_COUNT" -gt 0 ]]; then
    warn "$STATE_FILE_COUNT/$EXPECTED_STATES analyzer state files present"
  else
    fail "No analyzer state files in $STATE_DIR"
  fi

  # Check watermarks are advancing (sample up to 5 state files)
  WATERMARK_OK=0
  WATERMARK_STALE=0
  WATERMARK_ZERO=0
  for SF in $(ls "$STATE_DIR"/*.json 2>/dev/null | head -5); do
    RESULT=$(node -e "
      const d = JSON.parse(require('fs').readFileSync('$SF', 'utf8'));
      const ec = d.eventCount || 0;
      const wm = d.watermark || '';
      const ua = d.updatedAt || '';
      if (ec === 0) { console.log('zero'); }
      else {
        const age = Date.now() - new Date(ua).getTime();
        if (age > 86400000 * 3) { console.log('stale'); }
        else { console.log('ok'); }
      }
    " 2>/dev/null || echo "error")
    case "$RESULT" in
      ok) WATERMARK_OK=$((WATERMARK_OK + 1)) ;;
      stale) WATERMARK_STALE=$((WATERMARK_STALE + 1)) ;;
      zero) WATERMARK_ZERO=$((WATERMARK_ZERO + 1)) ;;
    esac
  done

  SAMPLED=$((WATERMARK_OK + WATERMARK_STALE + WATERMARK_ZERO))
  if [[ "$SAMPLED" -gt 0 ]]; then
    if [[ "$WATERMARK_OK" -eq "$SAMPLED" ]]; then
      pass "Watermarks advancing: $WATERMARK_OK/$SAMPLED sampled analyzers are fresh"
    elif [[ "$WATERMARK_OK" -gt 0 ]]; then
      warn "Watermarks: $WATERMARK_OK fresh, $WATERMARK_STALE stale, $WATERMARK_ZERO zero-events (sampled $SAMPLED)"
    else
      fail "No analyzer watermarks are advancing ($WATERMARK_STALE stale, $WATERMARK_ZERO zero-events)"
    fi
  fi
else
  fail "Analyzer state directory missing at $STATE_DIR"
fi

# =============================================================================
section "3.3" "Analyzer Output Freshness & Validity"
# =============================================================================

if [[ -d "$INTEL_DIR" ]]; then
  # Check freshness: how old is the most recently modified output?
  NEWEST_OUTPUT=$(ls -t "$INTEL_DIR"/*.json 2>/dev/null | head -1)
  if [[ -n "$NEWEST_OUTPUT" ]]; then
    # macOS stat
    NEWEST_MTIME=$(stat -f%m "$NEWEST_OUTPUT" 2>/dev/null || stat -c%Y "$NEWEST_OUTPUT" 2>/dev/null || true)
    NOW_EPOCH=$(date +%s)
    AGE_SECS=$((NOW_EPOCH - NEWEST_MTIME))
    AGE_MINS=$((AGE_SECS / 60))
    NEWEST_NAME=$(basename "$NEWEST_OUTPUT")

    if [[ "$AGE_MINS" -lt 60 ]]; then
      pass "Most recent output: $NEWEST_NAME (${AGE_MINS}m ago)"
    elif [[ "$AGE_MINS" -lt 1440 ]]; then
      warn "Most recent output: $NEWEST_NAME (${AGE_MINS}m ago — older than 1h)"
    else
      AGE_DAYS=$((AGE_MINS / 1440))
      warn "Most recent output: $NEWEST_NAME (${AGE_DAYS}d ago — intelligence may be stale)"
    fi

    # Count how many outputs are older than 24h
    STALE_COUNT=0
    TOTAL_OUTPUTS=0
    for OF in "$INTEL_DIR"/*.json; do
      [[ -f "$OF" ]] || continue
      # Skip substrate and non-analyzer files
      BN=$(basename "$OF")
      [[ "$BN" == "substrate-"* ]] && continue
      TOTAL_OUTPUTS=$((TOTAL_OUTPUTS + 1))
      OF_MTIME=$(stat -f%m "$OF" 2>/dev/null || stat -c%Y "$OF" 2>/dev/null || true)
      OF_AGE=$((NOW_EPOCH - OF_MTIME))
      [[ "$OF_AGE" -gt 86400 ]] && STALE_COUNT=$((STALE_COUNT + 1))
    done

    if [[ "$TOTAL_OUTPUTS" -gt 0 ]]; then
      if [[ "$STALE_COUNT" -eq 0 ]]; then
        pass "All $TOTAL_OUTPUTS analyzer outputs updated within 24h"
      elif [[ "$STALE_COUNT" -lt "$TOTAL_OUTPUTS" ]]; then
        warn "$STALE_COUNT/$TOTAL_OUTPUTS analyzer outputs older than 24h"
      else
        fail "All $TOTAL_OUTPUTS analyzer outputs are older than 24h — pipeline not running"
      fi
    fi
  else
    fail "No analyzer output files found in $INTEL_DIR"
  fi

  # Validate JSON structure of a few output files
  VALID_JSON=0
  INVALID_JSON=0
  INVALID_LIST=""
  for OF in $(ls "$INTEL_DIR"/*.json 2>/dev/null | head -10); do
    BN=$(basename "$OF")
    if node -e "JSON.parse(require('fs').readFileSync('$OF','utf8'))" 2>/dev/null; then
      VALID_JSON=$((VALID_JSON + 1))
    else
      INVALID_JSON=$((INVALID_JSON + 1))
      INVALID_LIST="$INVALID_LIST $BN"
    fi
  done

  SAMPLED_JSON=$((VALID_JSON + INVALID_JSON))
  if [[ "$SAMPLED_JSON" -gt 0 ]]; then
    if [[ "$INVALID_JSON" -eq 0 ]]; then
      pass "JSON valid: $VALID_JSON/$SAMPLED_JSON sampled output files parse OK"
    else
      fail "Invalid JSON in:$INVALID_LIST ($INVALID_JSON/$SAMPLED_JSON failed)"
    fi
  fi
else
  skip "Analyzer output freshness check (intelligence directory missing)"
fi

# =============================================================================
section "3.4" "Substrate Output Files"
# =============================================================================

SUBSTRATE_TOPOLOGY="$INTEL_DIR/substrate-topology.json"
SUBSTRATE_TRAJECTORIES="$INTEL_DIR/substrate-trajectories.json"

if [[ -f "$SUBSTRATE_TOPOLOGY" ]]; then
  TOPO_SIZE=$(du -sh "$SUBSTRATE_TOPOLOGY" 2>/dev/null | awk '{print $1}')
  pass "substrate-topology.json exists ($TOPO_SIZE)"

  # Validate structure
  TOPO_RESULT=$(node -e "
    const d = JSON.parse(require('fs').readFileSync('$SUBSTRATE_TOPOLOGY','utf8'));
    const entities = (d.entities || []).length;
    const edges = (d.edges || []).length;
    const types = [...new Set((d.entities || []).map(e => e.type))];
    console.log(JSON.stringify({ entities, edges, types }));
  " 2>/dev/null || echo '{"error":true}')

  if echo "$TOPO_RESULT" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); process.exit(d.error ? 1 : 0)" 2>/dev/null; then
    TOPO_ENTITIES=$(echo "$TOPO_RESULT" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log(d.entities)" 2>/dev/null)
    TOPO_EDGES=$(echo "$TOPO_RESULT" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log(d.edges)" 2>/dev/null)
    TOPO_TYPES=$(echo "$TOPO_RESULT" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log(d.types.join(', '))" 2>/dev/null)

    if [[ "${TOPO_ENTITIES:-0}" -gt 0 ]]; then
      pass "Topology: $TOPO_ENTITIES entities, $TOPO_EDGES edges"
      detail "Entity types in topology: $TOPO_TYPES"
    else
      warn "Topology file exists but contains 0 entities"
    fi
  else
    warn "substrate-topology.json exists but failed to parse"
  fi
else
  fail "substrate-topology.json missing"
fi

if [[ -f "$SUBSTRATE_TRAJECTORIES" ]]; then
  TRAJ_SIZE=$(du -sh "$SUBSTRATE_TRAJECTORIES" 2>/dev/null | awk '{print $1}')
  pass "substrate-trajectories.json exists ($TRAJ_SIZE)"

  # Validate structure
  TRAJ_COUNT=$(node -e "
    const d = JSON.parse(require('fs').readFileSync('$SUBSTRATE_TRAJECTORIES','utf8'));
    const count = Array.isArray(d) ? d.length : (d.trajectories || []).length;
    console.log(count);
  " 2>/dev/null || true)

  if [[ "${TRAJ_COUNT:-0}" -gt 0 ]]; then
    pass "Trajectories: $TRAJ_COUNT trajectory record(s)"
  else
    warn "Trajectories file exists but contains 0 records"
  fi
else
  fail "substrate-trajectories.json missing"
fi

# =============================================================================
section "3.5" "Substrate Entity & Relationship Validation"
# =============================================================================

# Expected entity types (9) and relationship types (14)
EXPECTED_ENTITY_TYPES="work-unit decision feature pattern capability diagnostic maturity-assessment commit hotspot"
EXPECTED_REL_TYPES="produced-by targets demonstrates evidences revises accumulates-to depends-on applies-to learned-from assessed-at bottlenecked-by narrated-by part-of co-occurred-with"
EXPECTED_LIFECYCLES="emerging established confirmed decaying archived"

# This check uses the COZO_RESULT from Layer 2b if available
if echo "$COZO_RESULT" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); process.exit(d.error ? 1 : 0)" 2>/dev/null; then

  echo "$COZO_RESULT" | node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));

    // Entity type coverage against expected 9 types
    const expectedTypes = '$EXPECTED_ENTITY_TYPES'.split(' ');
    const foundTypes = Object.keys(d.typeDistribution || {});
    const missing = expectedTypes.filter(t => !foundTypes.includes(t));
    const unexpected = foundTypes.filter(t => !expectedTypes.includes(t));

    if (missing.length === 0) {
      console.log('PASS|All 9 expected entity types present');
    } else if (foundTypes.length > 0) {
      console.log('WARN|Entity types: ' + foundTypes.length + '/9 present (missing: ' + missing.join(', ') + ')');
    } else {
      console.log('WARN|No entity types found — substrate may not have been populated');
    }

    if (unexpected.length > 0) {
      console.log('DETAIL|Unexpected entity types: ' + unexpected.join(', '));
    }

    // Lifecycle distribution check
    // We need a separate query for this — use topology file if available
  " 2>/dev/null | while IFS='|' read -r verdict msg; do
    case "$verdict" in
      PASS) pass "$msg" ;;
      WARN) warn "$msg" ;;
      FAIL) fail "$msg" ;;
      DETAIL) detail "$msg" ;;
    esac
  done

  # Check relationship types via topology if available
  if [[ -f "$SUBSTRATE_TOPOLOGY" ]]; then
    node -e "
      const d = JSON.parse(require('fs').readFileSync('$SUBSTRATE_TOPOLOGY','utf8'));
      const expectedRels = '$EXPECTED_REL_TYPES'.split(' ');
      const foundRels = [...new Set((d.edges || []).map(e => e.type))];
      const missing = expectedRels.filter(t => !foundRels.includes(t));

      if (missing.length === 0) {
        console.log('PASS|All 14 expected relationship types present');
      } else if (foundRels.length > 0) {
        console.log('WARN|Relationship types: ' + foundRels.length + '/14 present (missing: ' + missing.join(', ') + ')');
      } else {
        console.log('WARN|No relationship types found in topology');
      }

      // Lifecycle distribution from topology entities
      const expectedLC = '$EXPECTED_LIFECYCLES'.split(' ');
      const lcDist = {};
      for (const e of (d.entities || [])) {
        const lc = e.lifecycle || 'unknown';
        lcDist[lc] = (lcDist[lc] || 0) + 1;
      }
      const lcEntries = Object.entries(lcDist);
      if (lcEntries.length > 0) {
        console.log('PASS|Lifecycle distribution: ' + lcEntries.map(([k,v]) => k + '=' + v).join(', '));
        const foundLC = Object.keys(lcDist);
        const missingLC = expectedLC.filter(l => !foundLC.includes(l));
        if (missingLC.length > 0 && missingLC.length < expectedLC.length) {
          console.log('DETAIL|Lifecycle stages not yet reached: ' + missingLC.join(', '));
        }
      } else {
        console.log('WARN|No lifecycle data in topology entities');
      }

      // Confidence distribution
      const confidences = (d.entities || []).map(e => e.confidence).filter(c => typeof c === 'number');
      if (confidences.length > 0) {
        const avg = (confidences.reduce((a,b) => a+b, 0) / confidences.length).toFixed(2);
        const low = confidences.filter(c => c < 0.5).length;
        const mid = confidences.filter(c => c >= 0.5 && c < 0.7).length;
        const high = confidences.filter(c => c >= 0.7).length;
        console.log('PASS|Confidence spread: avg=' + avg + ' (low(<0.5)=' + low + ' mid=' + mid + ' high(>=0.7)=' + high + ')');
      }
    " 2>/dev/null | while IFS='|' read -r verdict msg; do
      case "$verdict" in
        PASS) pass "$msg" ;;
        WARN) warn "$msg" ;;
        FAIL) fail "$msg" ;;
        DETAIL) detail "$msg" ;;
      esac
    done
  else
    skip "Relationship type and lifecycle checks (topology file missing)"
  fi

  # Schema version check (should be 2)
  SCHEMA_VER=$(echo "$COZO_RESULT" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log(d.schemaVersion || 0)" 2>/dev/null || true)
  if [[ "$SCHEMA_VER" -eq 2 ]]; then
    pass "CozoDB schema version: $SCHEMA_VER (expected: 2)"
  elif [[ "$SCHEMA_VER" -gt 0 ]]; then
    warn "CozoDB schema version: $SCHEMA_VER (expected: 2 — may need migration)"
  else
    skip "CozoDB schema version check (not set)"
  fi

  # Analyzer contribution diversity
  CONTRIB_COUNT=$(echo "$COZO_RESULT" | node -e "
    const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    console.log(Object.keys(d.analyzerContributions || {}).length);
  " 2>/dev/null || true)

  if [[ "$CONTRIB_COUNT" -ge 20 ]]; then
    pass "Analyzer diversity: $CONTRIB_COUNT analyzers contributing to substrate (≥20)"
  elif [[ "$CONTRIB_COUNT" -gt 0 ]]; then
    warn "Analyzer diversity: $CONTRIB_COUNT analyzers contributing (expected ~25)"
  else
    skip "Analyzer contribution diversity (no contributions)"
  fi

else
  skip "Substrate entity/relationship validation (CozoDB not queryable)"
fi

# =============================================================================
section "3.6" "Distill Outputs"
# =============================================================================

DISTILL_DIR="$UNFADE_HOME/distills"

if [[ -d "$DISTILL_DIR" ]]; then
  DISTILL_COUNT=$(ls "$DISTILL_DIR"/*.md 2>/dev/null | wc -l | tr -d ' ')
  if [[ "$DISTILL_COUNT" -gt 0 ]]; then
    pass "Distill directory: $DISTILL_COUNT daily distill(s)"

    # Check for today's or recent distills
    TODAY=$(date +%Y-%m-%d)
    YESTERDAY=$(date -v-1d +%Y-%m-%d 2>/dev/null || date -d "yesterday" +%Y-%m-%d 2>/dev/null || echo "")

    if [[ -f "$DISTILL_DIR/$TODAY.md" ]]; then
      DISTILL_SIZE=$(du -sh "$DISTILL_DIR/$TODAY.md" 2>/dev/null | awk '{print $1}')
      pass "Today's distill exists ($TODAY.md, $DISTILL_SIZE)"
    elif [[ -n "$YESTERDAY" && -f "$DISTILL_DIR/$YESTERDAY.md" ]]; then
      warn "No distill for today — most recent: $YESTERDAY.md"
    else
      MOST_RECENT=$(ls -t "$DISTILL_DIR"/*.md 2>/dev/null | head -1)
      if [[ -n "$MOST_RECENT" ]]; then
        warn "No recent distill — most recent: $(basename "$MOST_RECENT")"
      fi
    fi

    # Validate a distill file (check it's not empty/truncated)
    SAMPLE_DISTILL=$(ls -t "$DISTILL_DIR"/*.md 2>/dev/null | head -1)
    if [[ -n "$SAMPLE_DISTILL" ]]; then
      LINE_COUNT=$(wc -l < "$SAMPLE_DISTILL" | tr -d ' ')
      if [[ "$LINE_COUNT" -gt 5 ]]; then
        pass "Distill content valid: $(basename "$SAMPLE_DISTILL") ($LINE_COUNT lines)"
      else
        warn "Distill may be truncated: $(basename "$SAMPLE_DISTILL") ($LINE_COUNT lines)"
      fi
    fi
  else
    warn "Distill directory exists but no .md files found"
  fi
else
  warn "Distill directory missing at $DISTILL_DIR (run 'unfade distill' to generate)"
fi

# =============================================================================
section "3.7" "Profile & Graph Outputs"
# =============================================================================

PROFILE_FILE="$UNFADE_HOME/profile/reasoning_model.json"
DECISIONS_FILE="$UNFADE_HOME/graph/decisions.jsonl"
DOMAINS_FILE="$UNFADE_HOME/graph/domains.json"

# Reasoning profile
if [[ -f "$PROFILE_FILE" ]]; then
  PROFILE_SIZE=$(du -sh "$PROFILE_FILE" 2>/dev/null | awk '{print $1}')
  PROFILE_RESULT=$(node -e "
    const d = JSON.parse(require('fs').readFileSync('$PROFILE_FILE','utf8'));
    const ver = d.version || d.v || 'unknown';
    const patterns = (d.patterns || []).length;
    const domains = Object.keys(d.domains || d.domainExpertise || {}).length;
    console.log(JSON.stringify({ ver, patterns, domains }));
  " 2>/dev/null || echo '{"error":true}')

  if echo "$PROFILE_RESULT" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); process.exit(d.error ? 1 : 0)" 2>/dev/null; then
    PROF_VER=$(echo "$PROFILE_RESULT" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log(d.ver)" 2>/dev/null)
    PROF_PAT=$(echo "$PROFILE_RESULT" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log(d.patterns)" 2>/dev/null)
    PROF_DOM=$(echo "$PROFILE_RESULT" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log(d.domains)" 2>/dev/null)
    pass "Reasoning profile exists ($PROFILE_SIZE, v$PROF_VER, $PROF_PAT patterns, $PROF_DOM domains)"
  else
    warn "Reasoning profile exists but failed to parse"
  fi
else
  warn "Reasoning profile missing at $PROFILE_FILE"
fi

# Decisions graph
if [[ -f "$DECISIONS_FILE" ]]; then
  DECISION_COUNT=$(wc -l < "$DECISIONS_FILE" | tr -d ' ')
  if [[ "$DECISION_COUNT" -gt 0 ]]; then
    pass "Decisions graph: $DECISION_COUNT decision(s) in decisions.jsonl"
  else
    warn "Decisions graph file exists but is empty"
  fi
else
  warn "Decisions graph missing at $DECISIONS_FILE"
fi

# Domains
if [[ -f "$DOMAINS_FILE" ]]; then
  DOMAIN_COUNT=$(node -e "
    const d = JSON.parse(require('fs').readFileSync('$DOMAINS_FILE','utf8'));
    console.log(Object.keys(d).length);
  " 2>/dev/null || true)
  if [[ "${DOMAIN_COUNT:-0}" -gt 0 ]]; then
    pass "Domain map: $DOMAIN_COUNT domain(s) in domains.json"
  else
    warn "Domain map exists but contains no domains"
  fi
else
  warn "Domain map missing at $DOMAINS_FILE"
fi

# =============================================================================
section "3.8" "Intelligence Pipeline End-to-End"
# =============================================================================

# Cross-check: events exist → analyzer states populated → outputs generated → substrate populated
if [[ -d "$STATE_DIR" && -d "$INTEL_DIR" ]]; then
  # Count total events processed across all analyzers
  TOTAL_EVENTS_PROCESSED=$(node -e "
    const fs = require('fs');
    const path = require('path');
    const stateDir = '$STATE_DIR';
    let total = 0;
    try {
      const files = fs.readdirSync(stateDir).filter(f => f.endsWith('.json'));
      for (const f of files) {
        const d = JSON.parse(fs.readFileSync(path.join(stateDir, f), 'utf8'));
        total += d.eventCount || 0;
      }
    } catch {}
    console.log(total);
  " 2>/dev/null || true)

  if [[ "${TOTAL_EVENTS_PROCESSED:-0}" -gt 0 ]]; then
    pass "Intelligence pipeline active: $TOTAL_EVENTS_PROCESSED total events processed across analyzers"
  else
    fail "Intelligence pipeline inactive: no events processed by any analyzer"
  fi

  # Check DAG consistency: dependent analyzers should have watermarks ≤ their dependencies
  # (simplified: check that leaf analyzers have eventCount ≥ dependent analyzers)
  if [[ "$STATE_FILE_COUNT" -gt 5 ]]; then
    DAG_RESULT=$(node -e "
      const fs = require('fs');
      const path = require('path');
      const stateDir = '$STATE_DIR';
      const files = fs.readdirSync(stateDir).filter(f => f.endsWith('.json'));
      const states = {};
      for (const f of files) {
        const name = f.replace('.json', '');
        try {
          states[name] = JSON.parse(fs.readFileSync(path.join(stateDir, f), 'utf8'));
        } catch {}
      }
      // Check that dependent analyzers have processed events
      const dependents = ['summary-writer', 'intelligence-snapshots', 'profile-accumulator',
                          'maturity-model', 'narrative-engine'];
      const active = dependents.filter(d => states[d] && (states[d].eventCount || 0) > 0);
      console.log(active.length + '/' + dependents.length);
    " 2>/dev/null || echo "0/0")
    pass "DAG downstream coverage: $DAG_RESULT dependent analyzers have processed events"
  fi
else
  if [[ ! -d "$STATE_DIR" ]]; then
    fail "Cannot verify intelligence pipeline: state directory missing"
  fi
  if [[ ! -d "$INTEL_DIR" ]]; then
    fail "Cannot verify intelligence pipeline: intelligence directory missing"
  fi
fi


# =============================================================================
section "3.9" "Core Intelligence Files (Setup Gating)"
# =============================================================================

# These 7 files are required by CORE_INTELLIGENCE_FILES in setup-state.ts.
# Setup completion is blocked until ALL of these exist.
CORE_FILES=(
  "efficiency.json"
  "comprehension.json"
  "velocity.json"
  "prompt-patterns.json"
  "cost-attribution.json"
  "decision-replay.json"
  "rejections.json"
)

CORE_PRESENT=0
CORE_MISSING=""
for CF in "${CORE_FILES[@]}"; do
  if [[ -f "$INTEL_DIR/$CF" ]]; then
    CORE_PRESENT=$((CORE_PRESENT + 1))
    # Check file is non-empty and valid JSON
    CF_SIZE=$(stat -f%z "$INTEL_DIR/$CF" 2>/dev/null || stat -c%s "$INTEL_DIR/$CF" 2>/dev/null || true)
    if [[ "${CF_SIZE:-0}" -lt 5 ]]; then
      warn "  Core file $CF exists but is effectively empty ($CF_SIZE bytes)"
    fi
  else
    CORE_MISSING="$CORE_MISSING $CF"
  fi
done

CORE_TOTAL=${#CORE_FILES[@]}
if [[ "$CORE_PRESENT" -eq "$CORE_TOTAL" ]]; then
  pass "All $CORE_TOTAL core intelligence files present (setup gating satisfied)"
else
  fail "Core intelligence files: $CORE_PRESENT/$CORE_TOTAL present (MISSING:$CORE_MISSING)"
  detail "Missing files block setup completion and intelligence API endpoints"
fi

# =============================================================================
section "3.10" "Intelligence API Endpoints"
# =============================================================================

# Check key intelligence endpoints return actual data (not warming_up 202)
INTL_ENDPOINTS=(
  "/api/intelligence/efficiency"
  "/api/intelligence/comprehension"
  "/api/intelligence/velocity"
  "/api/intelligence/prompt-patterns"
  "/api/intelligence/costs"
  "/api/intelligence/decisions"
  "/api/intelligence/rejections"
)

INTL_OK=0
INTL_WARMING=0
INTL_ERR=0
for EP in "${INTL_ENDPOINTS[@]}"; do
  EP_CODE=$(curl -sL -o /dev/null -w "%{http_code}" --connect-timeout 3 "$SERVER_URL$EP" 2>/dev/null || echo "000")
  if [[ "$EP_CODE" == "200" ]]; then
    INTL_OK=$((INTL_OK + 1))
  elif [[ "$EP_CODE" == "202" ]]; then
    INTL_WARMING=$((INTL_WARMING + 1))
    detail "$EP → 202 warming_up"
  elif [[ "$EP_CODE" == "000" ]]; then
    INTL_ERR=$((INTL_ERR + 1))
  else
    INTL_ERR=$((INTL_ERR + 1))
    detail "$EP → $EP_CODE"
  fi
done

INTL_TOTAL=${#INTL_ENDPOINTS[@]}
if [[ "$INTL_OK" -eq "$INTL_TOTAL" ]]; then
  pass "All $INTL_TOTAL intelligence API endpoints returning data"
elif [[ "$INTL_OK" -gt 0 ]]; then
  warn "Intelligence API: $INTL_OK/$INTL_TOTAL ok, $INTL_WARMING warming_up, $INTL_ERR errors"
elif [[ "$INTL_WARMING" -gt 0 ]]; then
  warn "Intelligence API: all endpoints still warming up ($INTL_WARMING/$INTL_TOTAL)"
else
  skip "Intelligence API not reachable (server may not be running)"
fi

# =============================================================================
section "3.11" "Pipeline Logging & Correlation IDs"
# =============================================================================

# Check daemon logs for pipeline correlation IDs (tickId pattern)
DAEMON_LOG_FOUND=false
for DDIR in "$UNFADE_HOME/state/daemons"/*/; do
  [[ -d "$DDIR" ]] || continue
  DLOG="$DDIR/daemon.log"
  if [[ -f "$DLOG" ]]; then
    DAEMON_LOG_FOUND=true
    LOG_LINES=$(wc -l < "$DLOG" 2>/dev/null | tr -d ' ' || true)
    detail "$(basename "$(dirname "$DLOG")")/daemon.log: $LOG_LINES lines"

    # Check for pipeline tick correlation IDs (format: [pipeline:<8-hex-chars>])
    TICK_COUNT=$(grep -c '\[pipeline:[0-9a-f]\{8\}\]' "$DLOG" 2>/dev/null | tr -d ' ' || true)
    if [[ "${TICK_COUNT:-0}" -gt 0 ]]; then
      pass "  Pipeline correlation IDs found ($TICK_COUNT log lines with tickId)"
      # Show latest tick ID
      LATEST_TICK=$(grep -o '\[pipeline:[0-9a-f]\{8\}\]' "$DLOG" 2>/dev/null | tail -1 || echo "")
      if [[ -n "$LATEST_TICK" ]]; then
        detail "Latest: $LATEST_TICK"
      fi
    else
      warn "  No pipeline correlation IDs found — pipeline may not have run yet"
    fi

    # Check for errors/warnings in recent logs (last 100 lines)
    RECENT_ERRORS=$(tail -100 "$DLOG" 2>/dev/null | grep -ci '"level":50\|"level":40' | tr -d ' ' || true)
    if [[ "${RECENT_ERRORS:-0}" -gt 0 ]]; then
      warn "  $RECENT_ERRORS error/warn entries in last 100 lines of daemon log"
      # Show last error
      LAST_ERR=$(tail -100 "$DLOG" 2>/dev/null | grep '"level":50\|"level":40' | tail -1 | node -e "
        try {
          const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
          console.log((d.msg ?? '').substring(0, 120));
        } catch { console.log('(unparseable)'); }
      " 2>/dev/null || echo "")
      if [[ -n "$LAST_ERR" ]]; then
        detail "Last error: $LAST_ERR"
      fi
    else
      pass "  No recent errors in daemon log"
    fi
  fi
done

if [[ "$DAEMON_LOG_FOUND" == "false" ]]; then
  warn "No daemon log files found in $UNFADE_HOME/state/daemons/"
fi

# Check for server-level logs
if [[ -d "$UNFADE_HOME/logs" ]]; then
  SERVER_LOG_COUNT=$(ls "$UNFADE_HOME/logs/"*.log 2>/dev/null | wc -l || true)
  if [[ "${SERVER_LOG_COUNT:-0}" -gt 0 ]]; then
    pass "Server log directory exists with $SERVER_LOG_COUNT log file(s)"
  else
    warn "Server log directory exists but empty"
  fi
else
  detail "No server log directory at $UNFADE_HOME/logs/ (logs go to stderr)"
fi

# =============================================================================
section "3.12" "Distill Content & Decision Quality"
# =============================================================================

DISTILLS_DIR="$UNFADE_HOME/distills"
if [[ -d "$DISTILLS_DIR" ]]; then
  DISTILL_COUNT=$(ls "$DISTILLS_DIR"/*.md 2>/dev/null | wc -l || true)
  DISTILL_COUNT=$(echo "$DISTILL_COUNT" | tr -d ' ')
  if [[ "${DISTILL_COUNT:-0}" -gt 0 ]]; then
    pass "Distills directory has $DISTILL_COUNT summaries"
    # Check latest distill for decision section
    LATEST_DISTILL=$(ls -t "$DISTILLS_DIR"/*.md 2>/dev/null | head -1)
    if [[ -n "$LATEST_DISTILL" ]]; then
      DECISION_COUNT=$(grep -c '^- \*\*' "$LATEST_DISTILL" 2>/dev/null || true)
      detail "Latest distill ($(basename "$LATEST_DISTILL")): $DECISION_COUNT decision entries"
      if [[ "${DECISION_COUNT:-0}" -gt 20 ]]; then
        warn "  High decision count ($DECISION_COUNT) — may indicate quality filtering issue"
      fi
    fi
  else
    warn "Distills directory exists but no .md files"
  fi

  # Check graph/decisions.jsonl
  DECISIONS_JSONL="$UNFADE_HOME/graph/decisions.jsonl"
  if [[ -f "$DECISIONS_JSONL" ]]; then
    DJSONL_LINES=$(wc -l < "$DECISIONS_JSONL" 2>/dev/null || true)
    DJSONL_LINES=$(echo "$DJSONL_LINES" | tr -d ' ')
    pass "decisions.jsonl exists: $DJSONL_LINES entries"
  else
    detail "No decisions.jsonl in graph/ (populated by distill pipeline)"
  fi
else
  warn "Distills directory missing at $DISTILLS_DIR"
fi

# =============================================================================
section "3.13" "Event Source Distribution"
# =============================================================================

# Check SQLite for event source distribution (quick sanity check)
SQLITE_DB="$UNFADE_HOME/cache/unfade.db"
if [[ -f "$SQLITE_DB" ]]; then
  SRC_DIST=$(sqlite3 "$SQLITE_DB" "SELECT source, COUNT(*) as cnt FROM events GROUP BY source ORDER BY cnt DESC" 2>/dev/null || echo "")
  if [[ -n "$SRC_DIST" ]]; then
    pass "Event source distribution from SQLite:"
    echo "$SRC_DIST" | while IFS='|' read -r SRC CNT; do
      detail "  $SRC: $CNT events"
    done

    # Check if ai-session events exist (needed by efficiency analyzer)
    AI_SESSION_CNT=$(sqlite3 "$SQLITE_DB" "SELECT COUNT(*) FROM events WHERE source='ai-session'" 2>/dev/null || true)
    if [[ "${AI_SESSION_CNT:-0}" -ge 5 ]]; then
      pass "ai-session events: $AI_SESSION_CNT (≥5 needed for efficiency analyzer)"
    elif [[ "${AI_SESSION_CNT:-0}" -gt 0 ]]; then
      warn "ai-session events: $AI_SESSION_CNT (<5, efficiency analyzer needs minDataPoints=5)"
    else
      warn "No ai-session events — efficiency analyzer will not produce output"
    fi
  else
    warn "Could not query event source distribution"
  fi
else
  skip "SQLite DB not found for event distribution check"
fi


# =============================================================================
section "3.14" "BigInt Error Detection (DuckDB Runtime Safety)"
# =============================================================================

# DuckDB returns BigInt for COUNT/SUM aggregates. Unhandled BigInt causes:
#   - "Cannot mix BigInt and other types" — arithmetic with plain numbers
#   - "Do not know how to serialize a BigInt" — JSON.stringify without replacer
# Both are silent runtime failures that prevent analyzer output generation.

BIGINT_CHECKED=false
BIGINT_ERRORS=0

# Check server stderr log (if running via redirect)
SERVER_LOG="/tmp/unfade-server.log"
if [[ -f "$SERVER_LOG" ]]; then
  BIGINT_CHECKED=true
  BIGINT_MIX=$(grep -c "Cannot mix BigInt" "$SERVER_LOG" 2>/dev/null || true)
  BIGINT_SERIALIZE=$(grep -c "Do not know how to serialize a BigInt" "$SERVER_LOG" 2>/dev/null || true)
  BIGINT_ERRORS=$(( ${BIGINT_MIX:-0} + ${BIGINT_SERIALIZE:-0} ))

  if [[ "$BIGINT_ERRORS" -eq 0 ]]; then
    pass "No BigInt runtime errors in server log"
  else
    fail "BigInt errors detected: $BIGINT_MIX 'Cannot mix' + $BIGINT_SERIALIZE 'serialize' errors"
    detail "Fix: wrap DuckDB results with Number() — see src/services/intelligence/"
    # Show first occurrence for context
    FIRST_BIGINT=$(grep -m1 "Cannot mix BigInt\|Do not know how to serialize a BigInt" "$SERVER_LOG" 2>/dev/null | head -c 200 || echo "")
    if [[ -n "$FIRST_BIGINT" ]]; then
      detail "First: $FIRST_BIGINT"
    fi
  fi
fi

# Check daemon logs for BigInt errors too
for DDIR in "$UNFADE_HOME/state/daemons"/*/; do
  [[ -d "$DDIR" ]] || continue
  DLOG="$DDIR/daemon.log"
  [[ -f "$DLOG" ]] || continue
  BIGINT_CHECKED=true
  D_BIGINT=$(grep -c "Cannot mix BigInt\|serialize a BigInt" "$DLOG" 2>/dev/null || true)
  if [[ "${D_BIGINT:-0}" -gt 0 ]]; then
    BIGINT_ERRORS=$(( ${BIGINT_ERRORS:-0} + ${D_BIGINT:-0} ))
    warn "BigInt errors in $(basename "$(dirname "$DLOG")")/daemon.log: $D_BIGINT occurrences"
  fi
done

if [[ "$BIGINT_CHECKED" == "false" ]]; then
  skip "BigInt error check (no server/daemon logs found)"
fi

# =============================================================================
section "3.15" "Analyzer Output Content Validation"
# =============================================================================

# Validate that core intelligence files contain expected fields and non-trivial data.
# A file that exists but has empty/default data means the analyzer ran but produced nothing.

CONTENT_OK=0
CONTENT_WARN=0
CONTENT_FAIL=0

validate_output() {
  local FILE="$1"
  local EXPECTED_FIELDS="$2"
  local BN=$(basename "$FILE")

  if [[ ! -f "$FILE" ]]; then
    return
  fi

  VRESULT=$(node -e "
    const d = JSON.parse(require('fs').readFileSync('$FILE','utf8'));
    const fields = '$EXPECTED_FIELDS'.split(',');
    const missing = fields.filter(f => !(f in d));
    const hasNaN = JSON.stringify(d).includes('NaN') || JSON.stringify(d).includes('Infinity');
    const hasBigInt = JSON.stringify(d).includes('BigInt');
    console.log(JSON.stringify({
      missing: missing,
      hasNaN: hasNaN,
      hasBigInt: hasBigInt,
      keys: Object.keys(d).length
    }));
  " 2>/dev/null || echo '{"error":true}')

  if echo "$VRESULT" | grep -q '"error":true'; then
    CONTENT_FAIL=$((CONTENT_FAIL + 1))
    fail "  $BN: failed to parse/validate"
    return
  fi

  VMISSING=$(echo "$VRESULT" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log(d.missing.length)" 2>/dev/null || true)
  VNAN=$(echo "$VRESULT" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log(d.hasNaN)" 2>/dev/null || echo "false")
  VBIGINT=$(echo "$VRESULT" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log(d.hasBigInt)" 2>/dev/null || echo "false")
  VKEYS=$(echo "$VRESULT" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log(d.keys)" 2>/dev/null || true)

  if [[ "$VNAN" == "true" ]]; then
    CONTENT_WARN=$((CONTENT_WARN + 1))
    warn "  $BN: contains NaN/Infinity values (likely unhandled Number() conversion)"
  elif [[ "$VBIGINT" == "true" ]]; then
    CONTENT_FAIL=$((CONTENT_FAIL + 1))
    fail "  $BN: contains BigInt string (serialization issue)"
  elif [[ "${VMISSING:-0}" -gt 0 ]]; then
    CONTENT_WARN=$((CONTENT_WARN + 1))
    MLIST=$(echo "$VRESULT" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log(d.missing.join(', '))" 2>/dev/null || echo "?")
    warn "  $BN: missing expected fields: $MLIST"
  else
    CONTENT_OK=$((CONTENT_OK + 1))
  fi
}

# Validate core intelligence files with expected fields
if [[ -d "$INTEL_DIR" ]]; then
  validate_output "$INTEL_DIR/efficiency.json" "aes,confidence,subMetrics,trend,updatedAt"
  validate_output "$INTEL_DIR/comprehension.json" "overallScore,byModule,updatedAt"
  validate_output "$INTEL_DIR/velocity.json" "currentVelocity,trend,updatedAt"
  validate_output "$INTEL_DIR/prompt-patterns.json" "patterns,updatedAt"
  validate_output "$INTEL_DIR/cost-attribution.json" "totalCost,byModel,updatedAt"
  validate_output "$INTEL_DIR/decision-replay.json" "decisions,updatedAt"
  validate_output "$INTEL_DIR/rejections.json" "rejections,updatedAt"
  validate_output "$INTEL_DIR/summary-writer.json" "schemaVersion,updatedAt,directionDensity24h"

  CONTENT_TOTAL=$((CONTENT_OK + CONTENT_WARN + CONTENT_FAIL))
  if [[ "$CONTENT_TOTAL" -gt 0 ]]; then
    if [[ "$CONTENT_FAIL" -eq 0 && "$CONTENT_WARN" -eq 0 ]]; then
      pass "All $CONTENT_OK validated output files have correct structure"
    elif [[ "$CONTENT_FAIL" -eq 0 ]]; then
      warn "Output content: $CONTENT_OK ok, $CONTENT_WARN warnings"
    else
      fail "Output content: $CONTENT_OK ok, $CONTENT_WARN warnings, $CONTENT_FAIL failures"
    fi
  fi
else
  skip "Output content validation (intelligence directory missing)"
fi

# =============================================================================
section "3.16" "Analyzer State Health (Event Counts & Watermarks)"
# =============================================================================

# Verify ALL analyzer state files have non-zero eventCount, valid watermarks,
# and no BigInt residue in serialized state.

STATE_DIR="$INTEL_DIR/state"
if [[ -d "$STATE_DIR" ]]; then
  STATE_HEALTHY=0
  STATE_ZERO=0
  STATE_CORRUPT=0
  STATE_ZERO_LIST=""

  for SF in "$STATE_DIR"/*.state.json; do
    [[ -f "$SF" ]] || continue
    BN=$(basename "$SF" .state.json)

    SRESULT=$(node -e "
      const raw = require('fs').readFileSync('$SF', 'utf8');
      // Check for BigInt residue (raw 'n' suffix on numbers)
      const hasBigIntResidue = /\"[0-9]+n\"/.test(raw) || /: [0-9]+n[,}]/.test(raw);
      const d = JSON.parse(raw);
      const ec = typeof d.eventCount === 'number' ? d.eventCount : 0;
      const wm = d.watermark || '';
      const ua = d.updatedAt || '';
      const hasValue = d.value != null && Object.keys(d.value || {}).length > 0;
      console.log(JSON.stringify({ ec, wm, ua, hasValue, hasBigIntResidue }));
    " 2>/dev/null || echo '{"error":true}')

    if echo "$SRESULT" | grep -q '"error":true'; then
      STATE_CORRUPT=$((STATE_CORRUPT + 1))
      detail "  $BN: corrupt/unparseable state file"
      continue
    fi

    S_EC=$(echo "$SRESULT" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log(d.ec)" 2>/dev/null || true)
    S_BIGINT=$(echo "$SRESULT" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log(d.hasBigIntResidue)" 2>/dev/null || echo "false")
    S_HAS_VALUE=$(echo "$SRESULT" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log(d.hasValue)" 2>/dev/null || echo "false")

    if [[ "$S_BIGINT" == "true" ]]; then
      STATE_CORRUPT=$((STATE_CORRUPT + 1))
      fail "  $BN: BigInt residue in serialized state"
    elif [[ "${S_EC:-0}" -eq 0 ]]; then
      STATE_ZERO=$((STATE_ZERO + 1))
      STATE_ZERO_LIST="$STATE_ZERO_LIST $BN"
    elif [[ "$S_HAS_VALUE" == "false" ]]; then
      STATE_CORRUPT=$((STATE_CORRUPT + 1))
      warn "  $BN: eventCount=$S_EC but value is empty"
    else
      STATE_HEALTHY=$((STATE_HEALTHY + 1))
    fi
  done

  STATE_TOTAL=$((STATE_HEALTHY + STATE_ZERO + STATE_CORRUPT))
  if [[ "$STATE_TOTAL" -gt 0 ]]; then
    if [[ "$STATE_CORRUPT" -eq 0 && "$STATE_ZERO" -eq 0 ]]; then
      pass "All $STATE_HEALTHY analyzer states healthy (non-zero eventCount, valid structure)"
    elif [[ "$STATE_CORRUPT" -eq 0 ]]; then
      warn "Analyzer states: $STATE_HEALTHY healthy, $STATE_ZERO zero-events"
      if [[ -n "$STATE_ZERO_LIST" ]]; then
        detail "Zero-event analyzers:$STATE_ZERO_LIST"
      fi
    else
      fail "Analyzer states: $STATE_HEALTHY healthy, $STATE_ZERO zero, $STATE_CORRUPT corrupt"
    fi
  fi
else
  skip "Analyzer state health (state directory missing)"
fi

# =============================================================================
section "3.17" "DuckDB Typed Column Data Validation"
# =============================================================================

# Verify DuckDB events table has data in typed columns (not all NULL).
# If typed columns are empty, intelligence analyzers will produce empty results.

DUCKDB_PATH="$UNFADE_HOME/cache/unfade.duckdb"
if [[ -f "$DUCKDB_PATH" ]]; then
  # DuckDB may be locked by running server — try via API first, then direct
  if [[ -n "${SERVER_URL:-}" ]]; then
    # Query via intelligence endpoint to verify DuckDB is responsive
    DUCK_CHECK=$(curl -s --connect-timeout 3 "$SERVER_URL/api/intelligence/efficiency" 2>/dev/null || echo "")
    if [[ -n "$DUCK_CHECK" ]]; then
      # Check if response has actual data (not warming up)
      DUCK_STATUS=$(echo "$DUCK_CHECK" | node -e "
        try {
          const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
          if (d.warming_up) console.log('warming');
          else if (d.aes != null || (d.data && d.data.aes != null)) console.log('ok');
          else console.log('empty');
        } catch { console.log('error'); }
      " 2>/dev/null || echo "error")

      case "$DUCK_STATUS" in
        ok)     pass "DuckDB responding with typed data via intelligence API" ;;
        warming) warn "DuckDB intelligence still warming up" ;;
        empty)   warn "DuckDB intelligence API returned empty data" ;;
        error)   warn "DuckDB intelligence API response unparseable" ;;
      esac
    else
      skip "DuckDB validation via API (server not responding)"
    fi
  fi

  # Check DuckDB file size as a sanity check
  DUCK_SIZE=$(du -sh "$DUCKDB_PATH" 2>/dev/null | awk '{print $1}')
  if [[ -n "$DUCK_SIZE" ]]; then
    detail "DuckDB file size: $DUCK_SIZE"
    # If file is tiny (<100KB), likely has no data
    DUCK_BYTES=$(stat -f%z "$DUCKDB_PATH" 2>/dev/null || stat -c%s "$DUCKDB_PATH" 2>/dev/null || true)
    if [[ "${DUCK_BYTES:-0}" -lt 102400 ]]; then
      warn "DuckDB file very small ($DUCK_SIZE) — may not have materialized data"
    else
      pass "DuckDB file size reasonable ($DUCK_SIZE)"
    fi
  fi
else
  skip "DuckDB typed column check (file not found)"
fi

# =============================================================================
section "3.18" "Intelligence Pipeline Silent Failure Detection"
# =============================================================================

# Check for analyzer failures in logs — these are caught by the DAG scheduler
# but may prevent individual output files from being generated.

ANALYZER_FAILURES=0
ANALYZER_FAILURE_NAMES=""

# Check server log for analyzer failure patterns
SERVER_LOG="/tmp/unfade-server.log"
if [[ -f "$SERVER_LOG" ]]; then
  # Pattern: "[intelligence] Analyzer <name> failed (non-fatal)"
  FAIL_LINES=$(grep -c '\[intelligence\] Analyzer .* failed' "$SERVER_LOG" 2>/dev/null || true)
  if [[ "${FAIL_LINES:-0}" -gt 0 ]]; then
    ANALYZER_FAILURES=$FAIL_LINES
    # Extract unique analyzer names that failed
    ANALYZER_FAILURE_NAMES=$(grep -o '\[intelligence\] Analyzer [^ ]* failed' "$SERVER_LOG" 2>/dev/null | sed 's/.*Analyzer \(.*\) failed/\1/' | sort -u | tr '\n' ', ' || echo "")
    fail "Analyzer failures in server log: $FAIL_LINES occurrences"
    detail "Failed analyzers: ${ANALYZER_FAILURE_NAMES%, }"
    # Show most recent failure's error message
    LAST_FAIL=$(grep '\[intelligence\] Analyzer .* failed' "$SERVER_LOG" 2>/dev/null | tail -1 | head -c 200 || echo "")
    if [[ -n "$LAST_FAIL" ]]; then
      detail "Latest: $LAST_FAIL"
    fi
  else
    pass "No analyzer failures in server log"
  fi

  # Check for initialization failures
  INIT_FAIL_COUNT=$(grep -c 'Failed to initialize' "$SERVER_LOG" 2>/dev/null || true)
  if [[ "${INIT_FAIL_COUNT:-0}" -gt 0 ]]; then
    warn "Analyzer initialization failures: $INIT_FAIL_COUNT"
    INIT_FAIL_LAST=$(grep 'Failed to initialize' "$SERVER_LOG" 2>/dev/null | tail -1 | head -c 200 || echo "")
    detail "Latest: $INIT_FAIL_LAST"
  else
    pass "No analyzer initialization failures"
  fi

  # Check pipeline throughput — how many events were processed in last run?
  LAST_BATCH=$(grep '\[intelligence\] Event batch built' "$SERVER_LOG" 2>/dev/null | tail -1 || echo "")
  if [[ -n "$LAST_BATCH" ]]; then
    BATCH_EVENTS=$(echo "$LAST_BATCH" | grep -o '"events":[0-9]*' | grep -o '[0-9]*' || echo "?")
    BATCH_MS=$(echo "$LAST_BATCH" | grep -o '"buildMs":[0-9]*' | grep -o '[0-9]*' || echo "?")
    detail "Last batch: $BATCH_EVENTS events, built in ${BATCH_MS}ms"
  fi

  # Check for cascade activity (shows DAG is working)
  LAST_COMPLETE=$(grep '\[intelligence\].*complete in' "$SERVER_LOG" 2>/dev/null | tail -3 || echo "")
  if [[ -n "$LAST_COMPLETE" ]]; then
    ANALYZERS_RAN=$(grep -c '\[intelligence\].*complete in' "$SERVER_LOG" 2>/dev/null || true)
    pass "Intelligence pipeline active: $ANALYZERS_RAN analyzer runs recorded"
  else
    warn "No analyzer completion records in server log — pipeline may not have run"
  fi
else
  skip "Pipeline failure detection (no server log at $SERVER_LOG)"
fi

# =============================================================================
section "3.19" "Cross-Layer Consistency"
# =============================================================================

# Verify data flows correctly across layers:
# Layer 1 (events/) → Layer 2 (SQLite+DuckDB) → Layer 3 (intelligence/)
# If events exist but intelligence doesn't, something is broken in the pipeline.

EVENTS_DIR="$UNFADE_HOME/events"
SQLITE_DB="$UNFADE_HOME/cache/unfade.db"

if [[ -d "$EVENTS_DIR" && -f "$SQLITE_DB" && -d "$INTEL_DIR" ]]; then
  # Count JSONL event files
  JSONL_COUNT=$(find "$EVENTS_DIR" -name "*.jsonl" -type f 2>/dev/null | wc -l | tr -d ' ')

  # Count SQLite events
  SQLITE_EVENTS=$(sqlite3 "$SQLITE_DB" "SELECT COUNT(*) FROM events" 2>/dev/null || true)

  # Count intelligence outputs
  INTEL_OUTPUTS=$(ls "$INTEL_DIR"/*.json 2>/dev/null | wc -l | tr -d ' ')

  if [[ "${JSONL_COUNT:-0}" -gt 0 && "${SQLITE_EVENTS:-0}" -gt 0 && "${INTEL_OUTPUTS:-0}" -gt 0 ]]; then
    pass "Cross-layer data flow: $JSONL_COUNT JSONL files → $SQLITE_EVENTS SQLite events → $INTEL_OUTPUTS intelligence outputs"
  elif [[ "${JSONL_COUNT:-0}" -gt 0 && "${SQLITE_EVENTS:-0}" -gt 0 && "${INTEL_OUTPUTS:-0}" -eq 0 ]]; then
    fail "Layer 2→3 broken: $SQLITE_EVENTS events materialized but 0 intelligence outputs"
    detail "Intelligence pipeline may be failing silently — check for BigInt or analyzer errors"
  elif [[ "${JSONL_COUNT:-0}" -gt 0 && "${SQLITE_EVENTS:-0}" -eq 0 ]]; then
    fail "Layer 1→2 broken: $JSONL_COUNT JSONL files but 0 SQLite events"
    detail "Materializer may not have run — check 'unfade doctor --rebuild-cache'"
  else
    skip "Cross-layer consistency (no JSONL events yet)"
  fi

  # Verify per-source event coverage for intelligence analyzers
  if [[ "${SQLITE_EVENTS:-0}" -gt 0 ]]; then
    AI_EVENTS=$(sqlite3 "$SQLITE_DB" "SELECT COUNT(*) FROM events WHERE source IN ('ai-session','mcp-active')" 2>/dev/null || true)
    GIT_EVENTS=$(sqlite3 "$SQLITE_DB" "SELECT COUNT(*) FROM events WHERE source='git'" 2>/dev/null || true)

    detail "Source breakdown: ai-session/mcp=$AI_EVENTS, git=$GIT_EVENTS"

    if [[ "${AI_EVENTS:-0}" -lt 5 ]]; then
      warn "Insufficient AI events ($AI_EVENTS) — efficiency/comprehension analyzers need ≥5"
    fi
    if [[ "${GIT_EVENTS:-0}" -eq 0 ]]; then
      detail "No git events — commit-analysis/file-churn analyzers will be empty"
    fi
  fi
else
  skip "Cross-layer consistency (missing components)"
fi

# =============================================================================
section "3.20" "Summary.json Coherence"
# =============================================================================

# summary.json is the primary data source for the dashboard home page.
# It must exist, be fresh, and have coherent values.

SUMMARY_FILE="$UNFADE_HOME/state/summary.json"
if [[ -f "$SUMMARY_FILE" ]]; then
  SUMM_RESULT=$(node -e "
    const d = JSON.parse(require('fs').readFileSync('$SUMMARY_FILE','utf8'));
    const age = Date.now() - new Date(d.updatedAt || '1970-01-01').getTime();
    const ageMin = Math.round(age / 60000);
    const hasSchema = d.schemaVersion === 1;
    const dirDensity = d.directionDensity24h ?? -1;
    const eventCount = d.eventCount24h ?? -1;
    const comprehension = d.comprehensionScore;
    const topDomain = d.topDomain;
    const firstRun = d.firstRunComplete;
    console.log(JSON.stringify({
      ageMin, hasSchema, dirDensity, eventCount,
      comprehension, topDomain, firstRun
    }));
  " 2>/dev/null || echo '{"error":true}')

  if echo "$SUMM_RESULT" | grep -q '"error":true'; then
    fail "summary.json exists but failed to parse/validate"
  else
    S_AGE=$(echo "$SUMM_RESULT" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log(d.ageMin)" 2>/dev/null || echo "999")
    S_SCHEMA=$(echo "$SUMM_RESULT" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log(d.hasSchema)" 2>/dev/null || echo "false")
    S_EVENTS=$(echo "$SUMM_RESULT" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log(d.eventCount)" 2>/dev/null || echo "-1")
    S_FIRST_RUN=$(echo "$SUMM_RESULT" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log(d.firstRun)" 2>/dev/null || echo "false")

    if [[ "$S_SCHEMA" == "true" ]]; then
      pass "summary.json: schemaVersion=1"
    else
      fail "summary.json: unexpected schemaVersion"
    fi

    if [[ "${S_AGE:-999}" -lt 60 ]]; then
      pass "summary.json: fresh (${S_AGE}m ago)"
    elif [[ "${S_AGE:-999}" -lt 1440 ]]; then
      warn "summary.json: ${S_AGE}m old (older than 1h)"
    else
      warn "summary.json: ${S_AGE}m old (stale — older than 24h)"
    fi

    detail "eventCount24h=$S_EVENTS, firstRunComplete=$S_FIRST_RUN"
  fi
else
  warn "summary.json not found at $SUMMARY_FILE (summary-writer may not have run)"
fi


# ═══════════════════════════════════════════════════════════════════════════════
#  SUMMARY
# ═══════════════════════════════════════════════════════════════════════════════

echo ""
echo -e "${BOLD}═══════════════════════════════════════════════════════${NC}"
TOTAL=$((PASS + FAIL + WARN + SKIP))
echo -e "  ${GREEN}$PASS passed${NC}  ${RED}$FAIL failed${NC}  ${YELLOW}$WARN warnings${NC}  ${DIM}$SKIP skipped${NC}  ($TOTAL checks)"

if [[ "$FAIL" -eq 0 && "$WARN" -eq 0 ]]; then
  echo -e "  ${GREEN}${BOLD}Layer 1 + Layer 2 + Layer 3: All checks passed.${NC}"
elif [[ "$FAIL" -eq 0 ]]; then
  echo -e "  ${GREEN}${BOLD}Layer 1 + Layer 2 + Layer 3: All critical checks passed.${NC} ${YELLOW}($WARN warnings)${NC}"
else
  echo -e "  ${RED}${BOLD}$FAIL critical failure(s) — see above.${NC}"
  echo -e "  ${DIM}Common fixes:${NC}"
  echo -e "  ${DIM}  - Rebuild cache: node dist/cli.mjs doctor --rebuild-cache${NC}"
  echo -e "  ${DIM}  - BigInt errors: wrap DuckDB results with Number()${NC}"
  echo -e "  ${DIM}  - Missing intelligence: restart server and wait for pipeline tick${NC}"
fi
echo -e "${BOLD}═══════════════════════════════════════════════════════${NC}"
echo ""

exit "$FAIL"
