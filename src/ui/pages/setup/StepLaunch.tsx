import { useMutation } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { Brain, Check, ChevronDown, Fingerprint, Layers, Radio, Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type {
  Discovery,
  InsightPreview,
  LaunchProgress,
  NarrativePhase,
  NarrativePhaseConfig,
} from "@/types/setup";

interface StepLaunchProps {
  onBack?: () => void;
}

// ---------------------------------------------------------------------------
// Narrative phase configuration
// ---------------------------------------------------------------------------

const NARRATIVE_PHASES: NarrativePhaseConfig[] = [
  {
    id: "capturing",
    title: "Capturing Signals",
    description: "Scanning your git history and AI collaboration sessions",
    messages: [
      "Scanning your git history...",
      "Finding AI collaboration sessions...",
      "Reading your development timeline...",
    ],
  },
  {
    id: "understanding",
    title: "Understanding Patterns",
    description: "Building context from your development activity",
    messages: [
      "Building your reasoning timeline...",
      "Connecting related decisions...",
      "Mapping your work streams...",
    ],
  },
  {
    id: "building",
    title: "Building Intelligence",
    description: "Analyzing your collaboration patterns and expertise",
    messages: [
      "Measuring how you collaborate with AI...",
      "Mapping your expertise domains...",
      "Analyzing your development velocity...",
      "Detecting your prompt patterns...",
    ],
  },
  {
    id: "forming",
    title: "Forming Identity",
    description: "Synthesizing your developer intelligence profile",
    messages: [
      "Computing your comprehension score...",
      "Weaving insights into your identity...",
      "Finalizing your intelligence profile...",
    ],
  },
  {
    id: "ready",
    title: "Ready",
    description: "Your intelligence system is alive",
    messages: [],
  },
];

const PHASE_ICONS = {
  capturing: Radio,
  understanding: Layers,
  building: Brain,
  forming: Fingerprint,
  ready: Sparkles,
} as const;

const PHASE_ORDER: NarrativePhase[] = [
  "capturing",
  "understanding",
  "building",
  "forming",
  "ready",
];

function phaseIdx(p: NarrativePhase): number {
  return PHASE_ORDER.indexOf(p);
}

// ---------------------------------------------------------------------------
// Map backend state → narrative phase
// ---------------------------------------------------------------------------

function deriveNarrativePhase(progress: LaunchProgress): NarrativePhase {
  if (progress.phase === "complete") return "ready";
  if (progress.phase === "analyzing") {
    return progress.intelligencePercent >= 70 ? "forming" : "building";
  }
  if (progress.phase === "materializing") {
    return progress.materializationPercent >= 30 ? "understanding" : "capturing";
  }
  return "capturing";
}

/** Compute 0-100 progress within the current narrative phase. */
function phaseLocalProgress(progress: LaunchProgress, phase: NarrativePhase): number {
  switch (phase) {
    case "capturing":
      return Math.min(100, Math.round((progress.materializationPercent / 30) * 100));
    case "understanding":
      return Math.min(100, Math.round(((progress.materializationPercent - 30) / 70) * 100));
    case "building":
      return Math.min(100, Math.round((progress.intelligencePercent / 70) * 100));
    case "forming":
      return Math.min(100, Math.round(((progress.intelligencePercent - 70) / 30) * 100));
    case "ready":
      return 100;
  }
}

// ---------------------------------------------------------------------------
// Pre-launch teasers
// ---------------------------------------------------------------------------

const TEASERS = [
  { icon: "🧠", label: "Your collaboration patterns" },
  { icon: "🚀", label: "Your coding velocity" },
  { icon: "🗺️", label: "Your expertise map" },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function StepLaunch({ onBack }: StepLaunchProps) {
  const navigate = useNavigate();
  const [launched, setLaunched] = useState(false);
  const [progress, setProgress] = useState<LaunchProgress>({
    percent: 0,
    phase: "pending",
    materializationPercent: 0,
    intelligencePercent: 0,
    coreFilesComplete: 0,
    coreFilesTotal: 7,
  });
  const [discoveries, setDiscoveries] = useState<Discovery[]>([]);
  const [insights, setInsights] = useState<InsightPreview[]>([]);
  const [showTechnical, setShowTechnical] = useState(false);
  const [milestoneQueue, setMilestoneQueue] = useState<InsightPreview[]>([]);
  const [activeMilestone, setActiveMilestone] = useState<InsightPreview | null>(null);

  // Forward-only narrative phase tracking
  const maxPhaseRef = useRef<number>(-1);
  const [narrativePhase, setNarrativePhase] = useState<NarrativePhase>("capturing");
  const minPhaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Rotating message index
  const [messageIdx, setMessageIdx] = useState(0);

  const feedRef = useRef<HTMLDivElement>(null);

  const launch = useMutation({
    mutationFn: () => api.setup.complete(),
    onSuccess: () => setLaunched(true),
  });

  // SSE connection
  useEffect(() => {
    if (!launched) return;

    const es = new EventSource("/api/setup/launch-stream");

    es.addEventListener("progress", (e) => {
      try {
        setProgress(JSON.parse(e.data) as LaunchProgress);
      } catch {
        /* ignore */
      }
    });

    es.addEventListener("discovery", (e) => {
      try {
        const d = JSON.parse(e.data) as Discovery;
        setDiscoveries((prev) => [d, ...prev]);
      } catch {
        /* ignore */
      }
    });

    es.addEventListener("insight", (e) => {
      try {
        const ins = JSON.parse(e.data) as InsightPreview;
        setInsights((prev) => {
          const filtered = prev.filter((p) => p.analyzer !== ins.analyzer);
          return [...filtered, ins];
        });
        // Queue milestone toast
        setMilestoneQueue((prev) => [...prev, ins]);
      } catch {
        /* ignore */
      }
    });

    es.addEventListener("complete", () => {
      setProgress((prev) => ({ ...prev, phase: "complete", percent: 100 }));
    });

    return () => es.close();
  }, [launched]);

  // Forward-only phase transitions with minimum display time
  useEffect(() => {
    if (!launched) return;
    const derived = deriveNarrativePhase(progress);
    const derivedIdx = phaseIdx(derived);

    if (derivedIdx > maxPhaseRef.current) {
      // Clear any pending minimum-time timer
      if (minPhaseTimerRef.current) clearTimeout(minPhaseTimerRef.current);

      const advance = () => {
        maxPhaseRef.current = derivedIdx;
        setNarrativePhase(derived);
        setMessageIdx(0);
      };

      // Ensure minimum 1.5s display per phase (skip for initial and ready phases)
      if (maxPhaseRef.current >= 0 && derived !== "ready") {
        minPhaseTimerRef.current = setTimeout(advance, 1500);
      } else {
        advance();
      }
    }

    return () => {
      if (minPhaseTimerRef.current) clearTimeout(minPhaseTimerRef.current);
    };
  }, [launched, progress]);

  // Rotate narrative messages every 3s
  useEffect(() => {
    if (!launched || narrativePhase === "ready") return;
    const config = NARRATIVE_PHASES.find((p) => p.id === narrativePhase);
    if (!config || config.messages.length === 0) return;

    const interval = setInterval(() => {
      setMessageIdx((prev) => (prev + 1) % config.messages.length);
    }, 3000);

    return () => clearInterval(interval);
  }, [launched, narrativePhase]);

  // Milestone toast queue processor
  useEffect(() => {
    if (activeMilestone || milestoneQueue.length === 0) return;
    const [next, ...rest] = milestoneQueue;
    setActiveMilestone(next);
    setMilestoneQueue(rest);
    const timer = setTimeout(() => setActiveMilestone(null), 4000);
    return () => clearTimeout(timer);
  }, [activeMilestone, milestoneQueue]);

  // Auto-scroll technical feed
  useEffect(() => {
    if (feedRef.current) feedRef.current.scrollTop = 0;
  }, [discoveries.length]);

  const handleGo = useCallback(() => navigate("/"), [navigate]);

  const isComplete = narrativePhase === "ready";
  const currentConfig = NARRATIVE_PHASES.find((p) => p.id === narrativePhase) ?? NARRATIVE_PHASES[0];
  const CurrentIcon = PHASE_ICONS[narrativePhase];
  const localProgress = phaseLocalProgress(progress, narrativePhase);

  // -------------------------------------------------------------------------
  // Pre-launch screen
  // -------------------------------------------------------------------------
  if (!launched) {
    return (
      <div className="space-y-6">
        <div className="rounded-xl border border-accent/20 bg-accent/5 p-6 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-accent/10">
            <Sparkles size={24} className="text-accent" />
          </div>
          <h2 className="mb-2 text-lg font-heading font-semibold text-foreground">
            Your intelligence is about to come alive
          </h2>
          <p className="text-sm text-muted">
            We'll scan your development history, analyze your patterns, and build your intelligence
            profile.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {TEASERS.map((t) => (
            <div
              key={t.label}
              className="rounded-lg border border-border bg-surface p-3 text-center"
            >
              <span className="text-xl">{t.icon}</span>
              <div className="mt-1.5 text-[11px] font-medium text-muted">{t.label}</div>
            </div>
          ))}
        </div>

        <div className="flex gap-3">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="rounded-lg border border-border px-4 py-2.5 text-sm font-medium text-muted transition-colors hover:bg-raised hover:text-foreground"
            >
              Back
            </button>
          )}
          <button
            type="button"
            onClick={() => launch.mutate()}
            disabled={launch.isPending}
            className="flex-1 rounded-lg bg-gradient-to-r from-accent to-[#8B5CF6] px-6 py-3 text-base font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            Begin Awakening
          </button>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Post-launch: System Awakening experience
  // -------------------------------------------------------------------------
  return (
    <div className="space-y-6">
      {/* Phase Timeline — horizontal 5-dot stepper */}
      <div className="flex items-center">
        {NARRATIVE_PHASES.map((phase, i) => {
          const done = phaseIdx(narrativePhase) > i || isComplete;
          const active = phase.id === narrativePhase && !isComplete;
          const Icon = PHASE_ICONS[phase.id];
          return (
            <div key={phase.id} className="flex flex-1 items-center">
              <div className="flex flex-col items-center gap-1.5 flex-1">
                <div
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-full transition-all duration-300",
                    done
                      ? "bg-accent text-white"
                      : active
                        ? "bg-accent text-white ring-4 ring-accent/20 animate-pulse"
                        : "bg-raised text-muted",
                  )}
                >
                  {done ? <Check size={14} /> : <Icon size={14} />}
                </div>
                <span
                  className={cn(
                    "text-[10px] font-medium leading-tight text-center",
                    done ? "text-accent" : active ? "text-foreground" : "text-muted",
                  )}
                >
                  {phase.title}
                </span>
              </div>
              {i < NARRATIVE_PHASES.length - 1 && (
                <div
                  className={cn(
                    "h-0.5 w-full -mt-5 transition-colors duration-500",
                    done ? "bg-accent" : "bg-raised",
                  )}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Active Phase Card */}
      {!isComplete && (
        <motion.div
          key={narrativePhase}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
          className="rounded-xl border border-border bg-surface p-6"
        >
          <div className="flex items-center gap-3 mb-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/10">
              <CurrentIcon size={20} className="text-accent" />
            </div>
            <div>
              <h3 className="text-base font-heading font-semibold text-foreground">
                {currentConfig.title}
              </h3>
              <p className="text-sm text-muted">{currentConfig.description}</p>
            </div>
          </div>

          {/* Phase progress bar */}
          <div className="flex items-center gap-3 mb-3">
            <div className="flex-1 h-2 rounded-full bg-raised overflow-hidden">
              <motion.div
                className="h-full rounded-full bg-gradient-to-r from-accent to-[#8B5CF6]"
                initial={{ width: "0%" }}
                animate={{ width: `${localProgress}%` }}
                transition={{ duration: 0.5, ease: "easeOut" }}
              />
            </div>
            <span className="text-xs font-mono text-muted w-10 text-right">{localProgress}%</span>
          </div>

          {/* Rotating narrative message */}
          {currentConfig.messages.length > 0 && (
            <div className="flex items-center gap-2 h-6">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent animate-pulse shrink-0" />
              <AnimatePresence mode="wait">
                <motion.span
                  key={`${narrativePhase}-${messageIdx}`}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.2 }}
                  className="text-sm text-foreground/70"
                >
                  {currentConfig.messages[messageIdx]}
                </motion.span>
              </AnimatePresence>
            </div>
          )}

          {/* Milestone Toast */}
          <AnimatePresence>
            {activeMilestone && (
              <motion.div
                key={activeMilestone.analyzer}
                initial={{ opacity: 0, y: 12, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ type: "spring", stiffness: 300, damping: 25 }}
                className="mt-4 rounded-lg border border-accent/20 bg-accent/5 p-3"
              >
                <div className="flex items-center gap-2">
                  <span className="text-base">{activeMilestone.icon}</span>
                  <div>
                    <div className="text-[11px] font-medium text-accent">
                      {activeMilestone.title}
                    </div>
                    <div className="text-sm text-foreground">{activeMilestone.headline}</div>
                  </div>
                </div>
                {/* Auto-dismiss timer bar */}
                <motion.div
                  className="mt-2 h-0.5 rounded-full bg-accent/30"
                  initial={{ width: "100%" }}
                  animate={{ width: "0%" }}
                  transition={{ duration: 4, ease: "linear" }}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}

      {/* Overall progress */}
      <div className="flex items-center gap-3">
        <div className="flex-1 h-2.5 rounded-full bg-raised overflow-hidden">
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-accent to-[#8B5CF6]"
            initial={{ width: "0%" }}
            animate={{ width: `${progress.percent}%` }}
            transition={{ duration: 0.5, ease: "easeOut" }}
          />
        </div>
        <span className="text-sm font-mono font-medium text-foreground w-12 text-right">
          {progress.percent}%
        </span>
      </div>

      {/* Insight Gallery */}
      {insights.length > 0 && (
        <div className="space-y-2">
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted">
            Discoveries
          </span>
          <div className="grid grid-cols-2 gap-2">
            <AnimatePresence>
              {insights.slice(0, 7).map((ins) => (
                <motion.div
                  key={ins.analyzer}
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.3 }}
                  className="rounded-lg border border-border bg-surface p-3"
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="text-sm">{ins.icon}</span>
                    <span className="text-[11px] font-medium text-muted">{ins.title}</span>
                  </div>
                  <div className="text-sm font-medium text-foreground">{ins.headline}</div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>
      )}

      {/* Technical Detail — collapsible */}
      {discoveries.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowTechnical((v) => !v)}
            className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted hover:text-foreground transition-colors"
          >
            <motion.span
              animate={{ rotate: showTechnical ? 180 : 0 }}
              transition={{ duration: 0.2 }}
            >
              <ChevronDown size={12} />
            </motion.span>
            {showTechnical ? "Hide" : "Show"} technical details
          </button>
          <AnimatePresence>
            {showTechnical && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div
                  ref={feedRef}
                  className="mt-2 max-h-[200px] overflow-y-auto rounded-lg border border-border bg-raised/50 p-2 space-y-0.5"
                >
                  {discoveries.map((d, i) => (
                    <div
                      key={`${d.ts}-${i}`}
                      className="flex items-center gap-2 px-2 py-1.5 rounded text-sm"
                    >
                      <span className="text-base shrink-0">{d.icon}</span>
                      <span className="text-foreground/70">{d.message}</span>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Action area */}
      <div className="pt-2">
        {isComplete ? (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="space-y-4"
          >
            <div className="rounded-xl border border-accent/20 bg-accent/5 p-5 text-center">
              <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-accent/10">
                <Sparkles size={20} className="text-accent" />
              </div>
              <h3 className="text-lg font-heading font-semibold text-foreground">
                Your intelligence system is alive
              </h3>
              <p className="mt-1 text-sm text-muted">
                {insights.length} dimension{insights.length !== 1 ? "s" : ""} analyzed across your
                codebase
              </p>
            </div>

            <div className="h-px bg-gradient-to-r from-transparent via-accent/30 to-transparent" />

            <button
              type="button"
              onClick={handleGo}
              className="w-full rounded-lg bg-gradient-to-r from-accent to-[#8B5CF6] px-6 py-3 text-base font-medium text-white transition-opacity ring-2 ring-accent/30 hover:opacity-90"
            >
              Go to Dashboard
            </button>
          </motion.div>
        ) : (
          <div className="flex items-center justify-center gap-2 rounded-lg bg-raised px-6 py-3 text-sm text-muted">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
            Building your intelligence...
          </div>
        )}
      </div>
    </div>
  );
}
