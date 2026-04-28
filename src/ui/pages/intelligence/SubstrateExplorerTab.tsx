import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { EvidenceDrawer } from "@/components/shared/EvidenceDrawer";
import { ShowMore } from "@/components/shared/ShowMore";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { EntityExploreResult } from "@/types/intelligence";

// ─── Types ──────────────────────────────────────────────────────────────────

interface TopologyEntity {
  id: string;
  type?: string;
  state?: Record<string, unknown>;
  confidence?: number;
  neighbors?: Array<{ id: string; type: string; weight: number }>;
}

// ─── Entity Type Colors ─────────────────────────────────────────────────────

const TYPE_COLORS: Record<string, string> = {
  technology: "bg-violet-500/20 text-violet-400",
  feature: "bg-cyan-500/20 text-cyan-400",
  "work-unit": "bg-amber-500/20 text-amber-400",
  decision: "bg-emerald-500/20 text-emerald-400",
  commit: "bg-orange-500/20 text-orange-400",
  hotspot: "bg-error/20 text-error",
  diagnostic: "bg-warning/20 text-warning",
  capability: "bg-accent/20 text-accent",
};

// ─── Component ──────────────────────────────────────────────────────────────

export function SubstrateExplorerTab({ enabled = true }: { enabled?: boolean }) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [drawerState, setDrawerState] = useState<{
    open: boolean;
    title: string;
    items: Array<{ timestamp: string; source: string; summary: string }>;
  }>({ open: false, title: "", items: [] });

  const { data: topology, isLoading: loadingTopology } = useQuery({
    queryKey: ["substrate", "topology"],
    queryFn: api.substrate.topology,
    staleTime: 60_000,
    enabled,
  });

  const { data: exploreResult } = useQuery({
    queryKey: ["substrate", "explore", selectedEntityId],
    queryFn: () => selectedEntityId ? api.substrate.explore(selectedEntityId) : null,
    staleTime: 30_000,
    enabled: !!selectedEntityId,
  });

  const entities: TopologyEntity[] = (() => {
    if (!topology || typeof topology !== "object") return [];
    const t = topology as Record<string, unknown>;
    return (t.entities as TopologyEntity[]) ?? [];
  })();

  const filteredEntities = searchQuery.length >= 2
    ? entities.filter((e) => {
        const name = ((e.state?.name as string) ?? e.id).toLowerCase();
        const type = (e.type ?? "").toLowerCase();
        const q = searchQuery.toLowerCase();
        return name.includes(q) || type.includes(q) || e.id.toLowerCase().includes(q);
      })
    : [];

  const hubEntities = [...entities]
    .sort((a, b) => (b.neighbors?.length ?? 0) - (a.neighbors?.length ?? 0))
    .slice(0, 10);

  const selectedDetail = (exploreResult as { data?: EntityExploreResult } | null)?.data ?? null;

  const openEvidence = (title: string, eventIds: string[]) => {
    setDrawerState({
      open: true,
      title,
      items: eventIds.map((id) => ({
        timestamp: new Date().toISOString(),
        source: "ai-session",
        summary: `Event ${id}`,
      })),
    });
  };

  if (loadingTopology) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-12 rounded-lg bg-raised" />
        <div className="h-64 rounded-lg bg-raised" />
      </div>
    );
  }

  if (entities.length === 0) {
    return (
      <div className="py-12 text-center text-muted">
        <p className="text-lg">Knowledge graph is empty</p>
        <p className="text-sm mt-2">Entities will appear as you use AI tools and the extraction pipeline processes your sessions.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Search */}
      <div>
        <input
          type="text"
          placeholder="Search entities by name, type, or ID..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full rounded-lg border border-border bg-surface px-4 py-2.5 text-sm text-foreground placeholder:text-muted focus:border-accent focus:outline-none"
        />
      </div>

      {/* Search Results */}
      {searchQuery.length >= 2 && (
        <div className="rounded-lg border border-border bg-surface p-4">
          <h3 className="mb-3 text-sm font-heading font-semibold">
            Search Results
            <span className="ml-2 text-xs font-normal text-muted">({filteredEntities.length})</span>
          </h3>
          {filteredEntities.length === 0 ? (
            <p className="text-sm text-muted">No entities match "{searchQuery}"</p>
          ) : (
            <ShowMore
              items={filteredEntities}
              initialCount={10}
              label="entities"
              renderItem={(entity) => (
                <EntityRow
                  key={entity.id}
                  entity={entity}
                  isSelected={selectedEntityId === entity.id}
                  onSelect={() => setSelectedEntityId(entity.id)}
                />
              )}
            />
          )}
        </div>
      )}

      {/* Selected Entity Detail */}
      {selectedDetail?.entity && (
        <div className="rounded-lg border border-accent/30 bg-accent/5 p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className={cn("rounded px-1.5 py-0.5 text-xs", TYPE_COLORS[selectedDetail.entity.type] ?? "bg-muted/20 text-muted")}>
                {selectedDetail.entity.type}
              </span>
              <h3 className="text-sm font-heading font-semibold">{selectedDetail.entity.name}</h3>
            </div>
            <button
              type="button"
              onClick={() => setSelectedEntityId(null)}
              className="text-xs text-muted hover:text-foreground"
            >
              ✕ Close
            </button>
          </div>

          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="rounded bg-raised px-3 py-2">
              <span className="text-[10px] text-muted block">Domain</span>
              <span className="text-sm font-mono">{selectedDetail.entity.domain}</span>
            </div>
            <div className="rounded bg-raised px-3 py-2">
              <span className="text-[10px] text-muted block">Confidence</span>
              <span className="text-sm font-mono">{Math.round(selectedDetail.entity.confidence * 100)}%</span>
            </div>
            <div className="rounded bg-raised px-3 py-2">
              <span className="text-[10px] text-muted block">Evidence</span>
              <span className="text-sm font-mono">{selectedDetail.evidenceEventIds.length} events</span>
            </div>
          </div>

          {selectedDetail.evidenceEventIds.length > 0 && (
            <button
              type="button"
              onClick={() => openEvidence(
                `${selectedDetail.entity!.name} — evidence`,
                selectedDetail.evidenceEventIds,
              )}
              className="text-xs text-accent hover:text-accent/80 mb-4 inline-block"
            >
              View {selectedDetail.evidenceEventIds.length} source events →
            </button>
          )}

          {/* Neighborhood */}
          {selectedDetail.neighbors.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-muted mb-2">
                Connections ({selectedDetail.neighbors.length})
              </h4>
              <ShowMore
                items={selectedDetail.neighbors}
                initialCount={8}
                label="connections"
                renderItem={(n) => (
                  <button
                    type="button"
                    onClick={() => setSelectedEntityId(n.id)}
                    className="flex w-full items-center gap-3 py-1.5 text-xs hover:bg-raised/50 rounded border-b border-border last:border-b-0"
                  >
                    <span className="font-mono text-accent">{n.id}</span>
                    <span className="rounded bg-raised px-1.5 py-0.5 text-[10px] text-muted">{n.type}</span>
                    <span className="ml-auto font-mono text-muted">{n.weight.toFixed(2)}</span>
                  </button>
                )}
              />
            </div>
          )}
        </div>
      )}

      {/* Hub Entities */}
      <div className="rounded-lg border border-border bg-surface p-5">
        <h3 className="mb-3 text-sm font-heading font-semibold">
          Hub Entities
          <span className="ml-2 text-xs font-normal text-muted">Most connected concepts</span>
        </h3>
        {hubEntities.length === 0 ? (
          <p className="text-sm text-muted">No hub entities detected yet</p>
        ) : (
          <ShowMore
            items={hubEntities}
            initialCount={5}
            label="hub entities"
            renderItem={(entity) => (
              <EntityRow
                key={entity.id}
                entity={entity}
                isSelected={selectedEntityId === entity.id}
                onSelect={() => setSelectedEntityId(entity.id)}
                showConnections
              />
            )}
          />
        )}
      </div>

      {/* All Entity Types */}
      <div className="rounded-lg border border-border bg-surface p-5">
        <h3 className="mb-3 text-sm font-heading font-semibold">
          Entity Overview
          <span className="ml-2 text-xs font-normal text-muted">{entities.length} total</span>
        </h3>
        <div className="flex flex-wrap gap-2">
          {Object.entries(
            entities.reduce<Record<string, number>>((acc, e) => {
              const t = e.type ?? "unknown";
              acc[t] = (acc[t] ?? 0) + 1;
              return acc;
            }, {}),
          )
            .sort(([, a], [, b]) => b - a)
            .map(([type, count]) => (
              <span
                key={type}
                className={cn("rounded px-2 py-1 text-xs", TYPE_COLORS[type] ?? "bg-muted/20 text-muted")}
              >
                {type}: {count}
              </span>
            ))}
        </div>
      </div>

      <EvidenceDrawer
        open={drawerState.open}
        onClose={() => setDrawerState((s) => ({ ...s, open: false }))}
        title={drawerState.title}
        items={drawerState.items}
      />
    </div>
  );
}

// ─── Entity Row Component ───────────────────────────────────────────────────

function EntityRow({
  entity,
  isSelected,
  onSelect,
  showConnections,
}: {
  entity: TopologyEntity;
  isSelected: boolean;
  onSelect: () => void;
  showConnections?: boolean;
}) {
  const name = (entity.state?.name as string) ?? entity.id;
  const type = entity.type ?? "unknown";
  const confidence = entity.confidence ?? 0;
  const connections = entity.neighbors?.length ?? 0;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-3 py-2 text-sm border-b border-border last:border-b-0 rounded transition-colors",
        isSelected ? "bg-accent/10" : "hover:bg-raised/50",
      )}
    >
      <span className={cn("rounded px-1.5 py-0.5 text-[10px] shrink-0", TYPE_COLORS[type] ?? "bg-muted/20 text-muted")}>
        {type}
      </span>
      <span className="font-medium text-foreground truncate text-left">{name}</span>
      <span className="ml-auto text-xs font-mono text-muted shrink-0">
        {Math.round(confidence * 100)}%
      </span>
      {showConnections && connections > 0 && (
        <span className="text-[10px] text-accent shrink-0">{connections} links</span>
      )}
    </button>
  );
}
