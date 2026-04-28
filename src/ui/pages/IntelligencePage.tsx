import { lazy, Suspense, useState } from "react";
import { CorrelationPanel } from "@/components/shared/CorrelationPanel";
import { IntelligenceCard } from "@/components/shared/IntelligenceCard";
import {
  useAutonomy,
  useComprehension,
  useCosts,
  useEfficiency,
  useMaturity,
  useNarratives,
  usePromptPatterns,
  useVelocity,
} from "@/hooks/useIntelligence";
import { getPhaseInfo } from "@/lib/maturity";

const ComprehensionTab = lazy(() =>
  import("./intelligence/ComprehensionTab").then((m) => ({ default: m.ComprehensionTab })),
);
const VelocityTab = lazy(() =>
  import("./intelligence/VelocityTab").then((m) => ({ default: m.VelocityTab })),
);
const CostTab = lazy(() => import("./intelligence/CostTab").then((m) => ({ default: m.CostTab })));
const PatternsTab = lazy(() =>
  import("./intelligence/PatternsTab").then((m) => ({ default: m.PatternsTab })),
);
const AutonomyTab = lazy(() =>
  import("./intelligence/AutonomyTab").then((m) => ({ default: m.AutonomyTab })),
);
const MaturityTab = lazy(() =>
  import("./intelligence/MaturityTab").then((m) => ({ default: m.MaturityTab })),
);
const GitExpertiseTab = lazy(() =>
  import("./intelligence/GitExpertiseTab").then((m) => ({ default: m.GitExpertiseTab })),
);
const NarrativesTab = lazy(() =>
  import("./intelligence/NarrativesTab").then((m) => ({ default: m.NarrativesTab })),
);
const EfficiencyTab = lazy(() =>
  import("./intelligence/EfficiencyTab").then((m) => ({ default: m.EfficiencyTab })),
);
const SubstrateExplorerTab = lazy(() =>
  import("./intelligence/SubstrateExplorerTab").then((m) => ({ default: m.SubstrateExplorerTab })),
);

interface CardDef {
  id: string;
  title: string;
  icon: string;
  useData: (options?: { enabled?: boolean }) => { data: unknown; isLoading: boolean };
  extract: (data: unknown) => { value: string | number; interpretation: string };
  detail: React.LazyExoticComponent<React.ComponentType<{ enabled?: boolean }>>;
  span?: "1" | "2";
}

const CARDS: CardDef[] = [
  {
    id: "maturity",
    title: "Vehicle Maturity",
    icon: "🏎",
    useData: useMaturity,
    extract: (d: any) => {
      const phase = getPhaseInfo(d?.phase ?? 1);
      return { value: phase?.label ?? "—", interpretation: phase?.diagnostic ?? "Assessing maturity" };
    },
    detail: MaturityTab,
  },
  {
    id: "efficiency",
    title: "Efficiency (AES)",
    icon: "⚡",
    useData: useEfficiency,
    extract: (d: any) => ({
      value: d?.aes ?? 0,
      interpretation: d?.interpretation ?? "—",
    }),
    detail: EfficiencyTab,
  },
  {
    id: "comprehension",
    title: "Comprehension",
    icon: "🧠",
    useData: useComprehension,
    extract: (d: any) => ({
      value: `${d?.overall ?? 0}%`,
      interpretation: d?.interpretation ?? "—",
    }),
    detail: ComprehensionTab,
  },
  {
    id: "autonomy",
    title: "Steering (Autonomy)",
    icon: "🎯",
    useData: useAutonomy,
    extract: (d: any) => ({
      value: d?.independenceIndex ?? 0,
      interpretation:
        (d?.independenceIndex ?? 0) > 75 ? "Steering with precision"
        : (d?.independenceIndex ?? 0) > 40 ? "Transmission engaging"
        : "Engine running without steering",
    }),
    detail: AutonomyTab,
  },
  {
    id: "velocity",
    title: "Velocity",
    icon: "🚀",
    useData: useVelocity,
    extract: (d: any) => ({
      value: `${Math.abs((d?.overallMagnitude as number) ?? 0)}%`,
      interpretation: `${(d?.overallTrend as string) === "accelerating" ? "↑ Accelerating" : (d?.overallTrend as string) === "decelerating" ? "↓ Decelerating" : "→ Stable"}`,
    }),
    detail: VelocityTab,
  },
  {
    id: "cost",
    title: "Cost",
    icon: "💰",
    useData: useCosts,
    extract: (d: any) => ({
      value: `$${((d?.costPerDirectedDecision as number) ?? 0).toFixed(2)}`,
      interpretation:
        ((d?.costPerDirectedDecision as number) ?? 0) < 0.3 ? "Running lean"
        : ((d?.costPerDirectedDecision as number) ?? 0) <= 1.0 ? "Nominal fuel consumption"
        : "Running rich",
    }),
    detail: CostTab,
  },
  {
    id: "patterns",
    title: "Patterns",
    icon: "🔧",
    useData: usePromptPatterns,
    extract: (d: any) => {
      const top = (d?.effectivePatterns ?? [])[0];
      return {
        value: top?.pattern ?? "—",
        interpretation: top ? `${Math.round((top.acceptanceRate ?? top.avgDirectionScore ?? 0) * 100)}% effectiveness` : "No patterns detected yet",
      };
    },
    detail: PatternsTab,
  },
  {
    id: "git-expertise",
    title: "Git & Expertise",
    icon: "📂",
    useData: useEfficiency,
    extract: () => ({ value: "—", interpretation: "Expand for file ownership details" }),
    detail: GitExpertiseTab,
  },
  {
    id: "narratives",
    title: "Narratives",
    icon: "📖",
    useData: useNarratives,
    extract: (d: any) => {
      const count = (d?.narratives ?? []).length;
      return {
        value: count,
        interpretation: count > 5 ? "Rich intelligence" : count > 0 ? "Threads emerging" : "Signal building",
      };
    },
    detail: NarrativesTab,
    span: "2",
  },
  {
    id: "substrate",
    title: "Knowledge Graph",
    icon: "🕸",
    useData: useEfficiency,
    extract: () => ({ value: "Explore", interpretation: "Browse entities, paths, and evidence" }),
    detail: SubstrateExplorerTab,
  },
];

function DetailSkeleton() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="h-32 rounded-lg bg-raised" />
      <div className="grid grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 rounded-lg bg-raised" />
        ))}
      </div>
    </div>
  );
}

export default function IntelligencePage() {
  const [expanded, setExpanded] = useState<string | null>(null);

  const toggle = (id: string) => setExpanded((prev) => (prev === id ? null : id));
  const expandedCard = expanded ? CARDS.find((c) => c.id === expanded) : null;

  return (
    <div>
      <h1 className="mb-6 font-heading text-2xl font-semibold">Intelligence Hub</h1>

      <CorrelationPanel maxVisible={3} />

      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-3">
        {CARDS.map((card) => (
          <IntelligenceCard
            key={card.id}
            id={card.id}
            title={card.title}
            icon={card.icon}
            useData={card.useData}
            extract={card.extract}
            isExpanded={expanded === card.id}
            onToggle={() => toggle(card.id)}
            span={card.span}
          />
        ))}
      </div>

      {expandedCard && (
        <div className="mt-6 rounded-lg border border-border bg-surface p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-heading text-lg font-semibold">
              {expandedCard.icon} {expandedCard.title}
            </h2>
            <button
              type="button"
              onClick={() => setExpanded(null)}
              className="text-sm text-muted hover:text-foreground"
            >
              ✕ Close
            </button>
          </div>
          <Suspense fallback={<DetailSkeleton />}>
            <expandedCard.detail enabled />
          </Suspense>
        </div>
      )}
    </div>
  );
}
