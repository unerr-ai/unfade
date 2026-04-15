// FILE: src/components/DistillView.tsx
// UF-038: Formatted DailyDistill display in terminal.
// Section headers, decision cards, pattern highlights.
// Renders to stderr via Ink (stdout is sacred).

import { Box, Text } from "ink";
import type React from "react";
import type { DailyDistill } from "../schemas/distill.js";

interface DistillViewProps {
  distill: DailyDistill;
}

function SectionHeader({ title }: { title: string }): React.ReactElement {
  return (
    <Box marginTop={1}>
      <Text bold color="cyan">
        {title}
      </Text>
    </Box>
  );
}

function DecisionCard({
  decision,
  rationale,
  domain,
  alternativesConsidered,
}: {
  decision: string;
  rationale: string;
  domain?: string;
  alternativesConsidered?: number;
}): React.ReactElement {
  const domainTag = domain ? ` [${domain}]` : "";
  const altsTag = alternativesConsidered ? ` (${alternativesConsidered} alts)` : "";
  return (
    <Box flexDirection="column" marginLeft={2}>
      <Text>
        <Text color="green">{"● "}</Text>
        <Text bold>{decision}</Text>
        <Text dimColor>
          {domainTag}
          {altsTag}
        </Text>
      </Text>
      <Text dimColor>
        {"    "}
        {rationale}
      </Text>
    </Box>
  );
}

export function DistillView({ distill }: DistillViewProps): React.ReactElement {
  return (
    <Box flexDirection="column" paddingX={1}>
      {/* Header */}
      <Box>
        <Text bold>Daily Distill — {distill.date}</Text>
      </Box>
      <Box marginTop={0}>
        <Text dimColor>{distill.summary}</Text>
      </Box>
      <Box marginTop={0}>
        <Text dimColor>
          {distill.eventsProcessed} events · synthesized by {distill.synthesizedBy ?? "unknown"}
        </Text>
      </Box>

      {/* Decisions */}
      {distill.decisions.length > 0 && (
        <>
          <SectionHeader title="Decisions" />
          {distill.decisions.map((d, _i) => (
            <DecisionCard
              key={`dec-${d.decision}`}
              decision={d.decision}
              rationale={d.rationale}
              domain={d.domain}
              alternativesConsidered={d.alternativesConsidered}
            />
          ))}
        </>
      )}

      {/* Trade-offs */}
      {distill.tradeOffs && distill.tradeOffs.length > 0 && (
        <>
          <SectionHeader title="Trade-offs" />
          {distill.tradeOffs.map((t, _i) => (
            <Box key={`to-${t.tradeOff}`} flexDirection="column" marginLeft={2}>
              <Text>
                <Text color="yellow">{"⇄ "}</Text>
                <Text bold>{t.tradeOff}</Text>
              </Text>
              <Text dimColor>
                {"    "}Chose: {t.chose} · Rejected: {t.rejected}
              </Text>
            </Box>
          ))}
        </>
      )}

      {/* Dead Ends */}
      {distill.deadEnds && distill.deadEnds.length > 0 && (
        <>
          <SectionHeader title="Dead Ends" />
          {distill.deadEnds.map((de, _i) => (
            <Box key={`de-${de.description}`} marginLeft={2}>
              <Text>
                <Text color="red">{"✗ "}</Text>
                <Text>{de.description}</Text>
                {de.timeSpentMinutes != null && <Text dimColor> (~{de.timeSpentMinutes} min)</Text>}
              </Text>
            </Box>
          ))}
        </>
      )}

      {/* Breakthroughs */}
      {distill.breakthroughs && distill.breakthroughs.length > 0 && (
        <>
          <SectionHeader title="Breakthroughs" />
          {distill.breakthroughs.map((b, _i) => (
            <Box key={`bt-${b.description}`} marginLeft={2}>
              <Text>
                <Text color="green">{"★ "}</Text>
                <Text bold>{b.description}</Text>
              </Text>
            </Box>
          ))}
        </>
      )}

      {/* Patterns */}
      {distill.patterns && distill.patterns.length > 0 && (
        <>
          <SectionHeader title="Patterns" />
          {distill.patterns.map((p, _i) => (
            <Box key={`pat-${p}`} marginLeft={2}>
              <Text dimColor>
                {"→ "}
                {p}
              </Text>
            </Box>
          ))}
        </>
      )}

      {/* Domains */}
      {distill.domains && distill.domains.length > 0 && (
        <Box marginTop={1}>
          <Text dimColor>Domains: {distill.domains.join(", ")}</Text>
        </Box>
      )}
    </Box>
  );
}
