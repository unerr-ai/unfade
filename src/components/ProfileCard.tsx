// FILE: src/components/ProfileCard.tsx
// UF-075: ProfileCard Ink component — visual reasoning profile
// for TUI dashboard. Shows domain bars, decision style,
// pattern count, trend arrows. All output to stderr via Ink.

import { Box, Text } from "ink";
import type React from "react";
import type { ReasoningModelV2 } from "../schemas/profile.js";

interface ProfileCardProps {
  profile: ReasoningModelV2 | null;
}

function DomainBar({ label, pct }: { label: string; pct: number }): React.ReactElement {
  const width = 20;
  const filled = Math.round(pct * width);
  const bar = "█".repeat(filled) + "░".repeat(width - filled);
  return (
    <Text>
      <Text dimColor>{`  ${label.padEnd(14)} `}</Text>
      <Text color="cyan">{bar.slice(0, filled)}</Text>
      <Text dimColor>{bar.slice(filled)}</Text>
      <Text dimColor>{` ${Math.round(pct * 100)}%`}</Text>
    </Text>
  );
}

function TrendIcon({ trend }: { trend: string }): React.ReactElement {
  if (trend === "deepening") return <Text color="green">{"↑"}</Text>;
  if (trend === "broadening") return <Text color="cyan">{"→"}</Text>;
  return <Text dimColor>{"—"}</Text>;
}

export function ProfileCard({ profile }: ProfileCardProps): React.ReactElement {
  if (!profile || profile.dataPoints < 2) {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text bold>Reasoning Profile</Text>
        <Text dimColor> Not enough data yet (need 2+ distills)</Text>
      </Box>
    );
  }

  const ds = profile.decisionStyle;
  const topDomains = [...profile.domainDistribution]
    .sort((a, b) => b.frequency - a.frequency)
    .slice(0, 3);
  const activePatterns = profile.patterns.filter((p) => p.confidence >= 0.7).length;

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>Reasoning Profile</Text>

      {/* Decision style summary */}
      <Box marginTop={0} marginLeft={1} flexDirection="column">
        <Text>
          <Text dimColor>Alternatives: </Text>
          <Text bold>{ds.avgAlternativesEvaluated.toFixed(1)}</Text>
          <Text dimColor> avg · AI accept: </Text>
          <Text bold>{Math.round(ds.aiAcceptanceRate * 100)}%</Text>
          <Text dimColor> · modify: </Text>
          <Text bold>{Math.round(ds.aiModificationRate * 100)}%</Text>
        </Text>
      </Box>

      {/* Top 3 domains with bars */}
      {topDomains.length > 0 && (
        <Box marginTop={0} flexDirection="column">
          {topDomains.map((d) => (
            <Box key={d.domain} gap={1}>
              <DomainBar label={d.domain} pct={d.percentageOfTotal} />
              <Text dimColor>{d.depth}</Text>
              <TrendIcon trend={d.depthTrend} />
            </Box>
          ))}
        </Box>
      )}

      {/* Pattern count + observations */}
      <Box marginTop={0} marginLeft={1}>
        <Text dimColor>
          {activePatterns} active pattern{activePatterns === 1 ? "" : "s"} · {profile.dataPoints}{" "}
          observations
        </Text>
      </Box>
    </Box>
  );
}
