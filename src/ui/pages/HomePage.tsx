import { Lightbulb } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { AreaChart } from "@/components/charts/AreaChart";
import { EmptyState } from "@/components/shared/EmptyState";
import { EventList } from "@/components/shared/EventList";
import { HeroMetric } from "@/components/shared/HeroMetric";
import { InsightCard } from "@/components/shared/InsightCard";
import { KpiCard, KpiStrip } from "@/components/shared/KpiCard";
import { NarrativeHeadline } from "@/components/shared/NarrativeHeadline";
import { ProjectCard } from "@/components/shared/ProjectCard";
import { useInsights, useLiveEvents } from "@/hooks/useEvents";
import { useMaturity, useNarratives } from "@/hooks/useIntelligence";
import { useRepos } from "@/hooks/useProjects";
import { useSummary } from "@/hooks/useSummary";
import { useAppStore } from "@/stores/app";

function HomeSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-16 rounded-lg bg-raised" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-28 rounded-lg bg-raised" />
        ))}
      </div>
      <div className="h-64 rounded-lg bg-raised" />
    </div>
  );
}

export default function HomePage() {
  const { activeProjectId, persona } = useAppStore();
  const { data: summary, isLoading } = useSummary();

  if (isLoading) return <HomeSkeleton />;

  return activeProjectId ? (
    <HomeProject projectId={activeProjectId} summary={summary} persona={persona} />
  ) : (
    <HomeGlobal summary={summary} persona={persona} />
  );
}

interface ModeProps {
  summary: ReturnType<typeof useSummary>["data"];
  persona: string;
}

function HomeGlobal({ summary, persona }: ModeProps) {
  const { data: repos } = useRepos();
  const { data: insights } = useInsights();
  const { data: narratives } = useNarratives();
  const { setActiveProject } = useAppStore();
  const navigate = useNavigate();

  const firstNarrative =
    narratives?.narratives?.[0]?.claim ?? "Capture active — intelligence warming up";
  const eventCount = summary?.eventCount24h ?? 0;
  const direction = summary?.directionDensity24h ?? 0;
  const cost = summary?.todaySpendProxy ?? 0;

  return (
    <div className="space-y-6">
      <NarrativeHeadline
        text={firstNarrative}
        copyable={persona !== "developer"}
        prominent={persona !== "developer"}
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-5">
        <KpiCard
          label="Active Projects"
          value={repos?.length ?? 0}
          interpretation="with registered activity"
          confidence={{ level: "high", basis: "direct count" }}
          freshness={summary?.freshness}
          href="/projects"
        />
        <KpiCard
          label="Events Today"
          value={eventCount}
          interpretation={
            eventCount > 20 ? "Busy day" : eventCount > 5 ? "Moderate activity" : "Quiet so far"
          }
          freshness={summary?.freshness}
          confidence={{ level: "high", basis: "direct count" }}
        />
        <KpiCard
          label="Direction Density"
          value={`${Math.round(direction)}%`}
          interpretation={summary?.interpretation ?? ""}
          freshness={summary?.freshness}
          href="/intelligence"
        />
        <KpiCard
          label="Cost Today"
          value={`~$${cost.toFixed(2)}`}
          interpretation="estimated AI spend"
          badge="estimate"
          freshness={summary?.freshness}
          confidence={{ level: "medium", basis: "proxy estimate" }}
          href="/intelligence"
        />
        <KpiCard
          label="Top Domain"
          value={summary?.topDomain ?? "—"}
          interpretation="most active area today"
          freshness={summary?.freshness}
        />
      </div>

      {persona !== "executive" && repos && repos.length > 0 && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {repos.map((repo) => (
            <ProjectCard key={repo.id} repo={repo} onClick={() => setActiveProject(repo.id)} />
          ))}
        </div>
      )}

      <div className="rounded-lg border border-border bg-surface p-5">
        <h2 className="mb-3 text-sm font-heading font-semibold">Recent Insights</h2>
        {insights && insights.length > 0 ? (
          <div className="space-y-3">
            {insights.slice(0, 5).map((ins, i) => (
              <InsightCard
                key={i}
                text={ins.claim}
                confidence={ins.confidence}
                action={{ label: "Investigate", href: "/intelligence" }}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={Lightbulb}
            title="No insights yet"
            description="Keep working — insights emerge after 10+ sessions"
            action={{ label: "View Intelligence Hub", onClick: () => navigate("/intelligence") }}
          />
        )}
      </div>
    </div>
  );
}

function HomeProject({ projectId, summary, persona }: ModeProps & { projectId: string }) {
  const { data: maturity } = useMaturity();
  const { data: insights } = useInsights();
  const { data: liveEvents } = useLiveEvents();

  const direction = summary?.directionDensity24h ?? 0;
  const eventCount = summary?.eventCount24h ?? 0;
  const comprehension = summary?.comprehensionScore;
  const topDomain = summary?.topDomain ?? "—";
  const cost = summary?.todaySpendProxy ?? 0;

  // Filter live events for this project
  const projectEvents = (liveEvents ?? []).filter((ev) => ev.content?.project === projectId);
  const activityData = Array.from({ length: 24 }, (_, i) => ({
    label: `${i}:00`,
    value: (liveEvents ?? []).filter((ev) => {
      const h = new Date(ev.timestamp).getHours();
      return h === i && (!projectId || ev.content?.project === projectId);
    }).length,
  }));

  return (
    <div className="space-y-6">
      <HeroMetric
        label="Direction Density"
        value={`${Math.round(direction)}%`}
        interpretation={summary?.interpretation}
        freshness={summary?.freshness}
        maturityPhase={maturity ? { phase: maturity.phase, label: maturity.phaseLabel } : undefined}
      />

      <KpiStrip
        metrics={[
          { label: "Events Today", value: eventCount, freshness: summary?.freshness },
          {
            label: "Comprehension",
            value: comprehension != null ? `${comprehension}%` : "—",
            freshness: summary?.freshness,
          },
          { label: "Top Domain", value: topDomain, interpretation: "most active area" },
          {
            label: "Cost",
            value: `~$${cost.toFixed(2)}`,
            badge: "estimate",
            freshness: summary?.freshness,
          },
        ]}
      />

      {persona !== "executive" && (
        <>
          <div className="rounded-lg border border-border bg-surface p-5">
            <h2 className="mb-3 text-sm font-heading font-semibold">Activity</h2>
            <AreaChart data={activityData} height={200} />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-lg border border-border bg-surface p-5">
              <h2 className="mb-3 text-sm font-heading font-semibold">Recent Events</h2>
              <EventList events={projectEvents} maxItems={10} />
            </div>
            <div className="rounded-lg border border-border bg-surface p-5">
              <h2 className="mb-3 text-sm font-heading font-semibold">Latest Insights</h2>
              {insights && insights.length > 0 ? (
                <div className="space-y-3">
                  {insights.slice(0, 5).map((ins, i) => (
                    <InsightCard key={i} text={ins.claim} confidence={ins.confidence} />
                  ))}
                </div>
              ) : (
                <div className="py-6 text-center text-sm text-muted">
                  Keep working to generate insights
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
