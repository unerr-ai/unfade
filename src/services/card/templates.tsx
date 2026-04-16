// FILE: src/services/card/templates.tsx
// UF-059: Unfade Card JSX template for satori rendering.
// Dark theme, 1200x630 OG-compatible dimensions.
// satori supports flexbox only — no CSS grid, variables, or pseudo-elements.

import type { CardData } from "../../schemas/card.js";

// --- Domain-to-color mapping (deterministic) ---

const DOMAIN_COLORS = [
  "#ff6b6b",
  "#ffa94d",
  "#ffd43b",
  "#69db7c",
  "#38d9a9",
  "#4dabf7",
  "#748ffc",
  "#da77f2",
  "#f06595",
  "#20c997",
];

function domainColor(domain: string): string {
  let hash = 0;
  for (let i = 0; i < domain.length; i++) {
    hash = ((hash << 5) - hash + domain.charCodeAt(i)) | 0;
  }
  return DOMAIN_COLORS[
    ((hash % DOMAIN_COLORS.length) + DOMAIN_COLORS.length) % DOMAIN_COLORS.length
  ];
}

// --- Card template ---

export function cardTemplate(data: CardData): React.ReactElement {
  const depthPct = Math.min(data.reasoningDepth / 5, 1);
  const filledSegments = Math.round(depthPct * 10);
  const emptySegments = 10 - filledSegments;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: 1200,
        height: 630,
        backgroundColor: "#1a1a2e",
        padding: "48px 56px",
        fontFamily: "Inter, Arial",
        color: "#e0e0e0",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
        }}
      >
        <div
          style={{
            display: "flex",
            fontSize: 36,
            fontWeight: 700,
            color: "#0099ff",
            letterSpacing: "0.08em",
          }}
        >
          UNFADE
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 24,
            color: "#8892a4",
            fontWeight: 400,
          }}
        >
          {data.date}
        </div>
      </div>

      {/* Separator */}
      <div
        style={{
          display: "flex",
          width: "100%",
          height: 2,
          backgroundColor: "#2a2a4a",
          marginBottom: 32,
        }}
      />

      {/* Decisions */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 14,
          flexGrow: 1,
          marginBottom: 28,
        }}
      >
        {data.decisions.length > 0 ? (
          data.decisions.map((decision) => (
            <div
              key={decision}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 12,
                fontSize: 22,
                lineHeight: 1.4,
              }}
            >
              <div
                style={{
                  display: "flex",
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  backgroundColor: "#0099ff",
                  marginTop: 10,
                  flexShrink: 0,
                }}
              />
              <div style={{ display: "flex", color: "#e0e0e0" }}>{decision}</div>
            </div>
          ))
        ) : (
          <div
            style={{
              display: "flex",
              fontSize: 22,
              color: "#8892a4",
              fontStyle: "italic",
            }}
          >
            No decisions recorded yet
          </div>
        )}
      </div>

      {/* Domain pills */}
      {data.domains.length > 0 && (
        <div
          style={{
            display: "flex",
            gap: 10,
            marginBottom: 28,
          }}
        >
          {data.domains.map((domain) => (
            <div
              key={domain}
              style={{
                display: "flex",
                padding: "6px 16px",
                borderRadius: 999,
                fontSize: 15,
                fontWeight: 600,
                letterSpacing: "0.04em",
                color: domainColor(domain),
                backgroundColor: `${domainColor(domain)}22`,
                border: `1px solid ${domainColor(domain)}44`,
              }}
            >
              {domain}
            </div>
          ))}
        </div>
      )}

      {/* Reasoning depth bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 16,
          fontSize: 16,
          color: "#8892a4",
        }}
      >
        <div style={{ display: "flex" }}>Reasoning Depth:</div>
        <div style={{ display: "flex", gap: 3 }}>
          {Array.from({ length: filledSegments }, (_, i) => `filled-${i}`).map((key) => (
            <div
              key={key}
              style={{
                display: "flex",
                width: 20,
                height: 12,
                backgroundColor: "#0099ff",
                borderRadius: 2,
              }}
            />
          ))}
          {Array.from({ length: emptySegments }, (_, i) => `empty-${i}`).map((key) => (
            <div
              key={key}
              style={{
                display: "flex",
                width: 20,
                height: 12,
                backgroundColor: "#2a2a4a",
                borderRadius: 2,
              }}
            />
          ))}
        </div>
        <div style={{ display: "flex" }}>{data.reasoningDepth.toFixed(1)} alt/decision</div>
      </div>

      {/* Stats footer */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div
          style={{
            display: "flex",
            gap: 32,
            fontSize: 16,
            color: "#8892a4",
          }}
        >
          <div style={{ display: "flex" }}>
            Dead Ends:{" "}
            <span style={{ color: "#e0e0e0", fontWeight: 600, marginLeft: 6 }}>
              {data.deadEnds}
            </span>
          </div>
          <div style={{ display: "flex" }}>
            Decisions:{" "}
            <span style={{ color: "#e0e0e0", fontWeight: 600, marginLeft: 6 }}>
              {data.decisionCount}
            </span>
          </div>
          <div style={{ display: "flex" }}>
            AI Modified:{" "}
            <span style={{ color: "#e0e0e0", fontWeight: 600, marginLeft: 6 }}>
              {Math.round(data.aiModifiedPct)}%
            </span>
          </div>
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 16,
            color: "#0099ff",
            fontWeight: 600,
          }}
        >
          unfade.dev
        </div>
      </div>
    </div>
  );
}
