// FILE: src/components/DashboardView.tsx
// UF-021 + UF-086c: Main TUI dashboard component.
// Shows capture status, event count, distill summary, personalization level,
// and quick action bar with keypress handling.
// All output goes to stderr (Ink render target is stderr).

import { Box, Text, useApp, useInput } from "ink";
import type React from "react";
import { useCallback, useState } from "react";
import { USER_TERMS } from "../constants/terminology.js";
import type { DailyDistill } from "../schemas/distill.js";
import type { ReasoningModelV2 } from "../schemas/profile.js";
import type { StateDetails } from "../state/detector.js";
import { DistillView } from "./DistillView.js";
import { ProfileCard } from "./ProfileCard.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type View = "dashboard" | "distilling" | "distill-result";

interface DashboardViewProps {
  state: StateDetails;
  todayEventCount: number;
  latestDistill: DailyDistill | null;
  personalizationLevel: PersonalizationLevel;
  reasoningProfile: ReasoningModelV2 | null;
  onDistill: () => Promise<DailyDistill | null>;
  onOpenWeb: () => void;
}

export interface PersonalizationLevel {
  level: number; // 0-5
  label: string;
  distillCount: number;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatusBadge({ daemonRunning }: { daemonRunning: boolean }): React.ReactElement {
  if (daemonRunning) {
    return (
      <Text>
        <Text color="green">{"● "}</Text>
        <Text color="green">{USER_TERMS.daemonRunning}</Text>
      </Text>
    );
  }
  return (
    <Text>
      <Text color="yellow">{"⚠ "}</Text>
      <Text color="yellow">{USER_TERMS.daemonStopped}</Text>
    </Text>
  );
}

function EventCounter({ count }: { count: number }): React.ReactElement {
  return (
    <Text>
      <Text dimColor>Today: </Text>
      <Text bold>{count}</Text>
      <Text dimColor> event{count === 1 ? "" : "s"}</Text>
    </Text>
  );
}

function PersonalizationIndicator({ level }: { level: PersonalizationLevel }): React.ReactElement {
  const filled = "█".repeat(level.level);
  const empty = "░".repeat(5 - level.level);
  return (
    <Text>
      <Text dimColor>{USER_TERMS.profile}: </Text>
      <Text color="cyan">{filled}</Text>
      <Text dimColor>{empty}</Text>
      <Text dimColor> {level.label}</Text>
      <Text dimColor>
        {" "}
        ({level.distillCount} distill{level.distillCount === 1 ? "" : "s"})
      </Text>
    </Text>
  );
}

function DistillSummary({ distill }: { distill: DailyDistill | null }): React.ReactElement {
  if (!distill) {
    return (
      <Box marginTop={1} flexDirection="column">
        <Text dimColor>No distills yet. Press </Text>
        <Text bold color="cyan">
          [d]
        </Text>
        <Text dimColor> to generate your first.</Text>
      </Box>
    );
  }

  const topDecisions = distill.decisions.slice(0, 3);
  return (
    <Box marginTop={1} flexDirection="column">
      <Text bold>
        Latest {USER_TERMS.distill} — {distill.date}
      </Text>
      <Text dimColor>{distill.summary}</Text>
      {topDecisions.length > 0 && (
        <Box flexDirection="column" marginTop={0} marginLeft={1}>
          {topDecisions.map((d, _i) => (
            <Text key={`d-${d.decision}`}>
              <Text color="green">{"● "}</Text>
              <Text>{d.decision}</Text>
              {d.domain && <Text dimColor> [{d.domain}]</Text>}
            </Text>
          ))}
          {distill.decisions.length > 3 && (
            <Text dimColor> ...and {distill.decisions.length - 3} more</Text>
          )}
        </Box>
      )}
    </Box>
  );
}

function QuickActions(): React.ReactElement {
  return (
    <Box marginTop={1}>
      <Text dimColor>
        <Text bold color="cyan">
          [d]
        </Text>
        <Text>istill now </Text>
        <Text bold color="cyan">
          [o]
        </Text>
        <Text>pen web </Text>
        <Text bold color="cyan">
          [q]
        </Text>
        <Text>uit</Text>
      </Text>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function DashboardView({
  state,
  todayEventCount,
  latestDistill,
  personalizationLevel,
  reasoningProfile,
  onDistill,
  onOpenWeb,
}: DashboardViewProps): React.ReactElement {
  const { exit } = useApp();
  const [view, setView] = useState<View>("dashboard");
  const [distillResult, setDistillResult] = useState<DailyDistill | null>(null);

  const handleDistill = useCallback(async () => {
    setView("distilling");
    const result = await onDistill();
    if (result) {
      setDistillResult(result);
      setView("distill-result");
    } else {
      setView("dashboard");
    }
  }, [onDistill]);

  useInput((input, key) => {
    if (view !== "dashboard") {
      // In distill-result view, any key returns to dashboard
      if (view === "distill-result") {
        setView("dashboard");
        return;
      }
      return;
    }

    if (input === "q" || (key.ctrl && input === "c")) {
      exit();
      return;
    }

    if (input === "d") {
      handleDistill();
      return;
    }

    if (input === "o") {
      onOpenWeb();
      return;
    }
  });

  // Distilling state
  if (view === "distilling") {
    return (
      <Box paddingX={1} paddingY={1}>
        <Text>
          <Text color="cyan">{"◌ "}</Text>
          <Text>{USER_TERMS.distilling}...</Text>
        </Text>
      </Box>
    );
  }

  // Distill result view
  if (view === "distill-result" && distillResult) {
    return (
      <Box flexDirection="column">
        <DistillView distill={distillResult} />
        <Box paddingX={1} marginTop={1}>
          <Text dimColor>Press any key to return to dashboard</Text>
        </Box>
      </Box>
    );
  }

  // Main dashboard view
  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      {/* Header */}
      <Box>
        <Text bold color="cyan">
          Unfade
        </Text>
      </Box>

      {/* Status row */}
      <Box marginTop={1} gap={2}>
        <StatusBadge daemonRunning={state.checks.daemonRunning} />
        <EventCounter count={todayEventCount} />
      </Box>

      {/* Personalization */}
      <Box marginTop={0}>
        <PersonalizationIndicator level={personalizationLevel} />
      </Box>

      {/* Reasoning profile card */}
      <ProfileCard profile={reasoningProfile} />

      {/* Latest distill summary */}
      <DistillSummary distill={latestDistill} />

      {/* Quick actions */}
      <QuickActions />
    </Box>
  );
}
