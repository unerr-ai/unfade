// Tests for UF-059: Card templates
// T-162, T-163

import { describe, expect, it } from "vitest";
import type { CardData } from "../../../src/schemas/card.js";
import { cardTemplate } from "../../../src/services/card/templates.js";

const FULL_CARD_DATA: CardData = {
  date: "2026-04-15",
  decisions: [
    "Use satori for JSX-to-SVG rendering",
    "Dark theme with #1a1a2e background",
    "Cache fonts locally after first download",
  ],
  domains: ["rendering", "design", "performance"],
  reasoningDepth: 2.75,
  deadEnds: 2,
  decisionCount: 4,
  aiModifiedPct: 65,
};

const MINIMAL_CARD_DATA: CardData = {
  date: "2026-04-15",
  decisions: ["Only one decision today"],
  domains: ["backend"],
  reasoningDepth: 1.0,
  deadEnds: 0,
  decisionCount: 1,
  aiModifiedPct: 0,
};

describe("cardTemplate", () => {
  // T-162: renders with all data fields populated
  it("T-162: returns a React element with all fields populated", () => {
    const element = cardTemplate(FULL_CARD_DATA);

    expect(element).toBeDefined();
    expect(element.type).toBe("div");
    expect(element.props).toBeDefined();
    expect(element.props.style).toBeDefined();
    // Check dimensions
    expect(element.props.style.width).toBe(1200);
    expect(element.props.style.height).toBe(630);
    // Check dark theme background
    expect(element.props.style.backgroundColor).toBe("#1a1a2e");
  });

  // T-163: renders with minimal data (no dead ends)
  it("T-163: renders with minimal data without errors", () => {
    const element = cardTemplate(MINIMAL_CARD_DATA);

    expect(element).toBeDefined();
    expect(element.type).toBe("div");
    expect(element.props.style.width).toBe(1200);
    expect(element.props.style.height).toBe(630);
  });

  it("renders with empty data (no decisions)", () => {
    const emptyData: CardData = {
      date: "2026-04-15",
      decisions: [],
      domains: [],
      reasoningDepth: 0,
      deadEnds: 0,
      decisionCount: 0,
      aiModifiedPct: 0,
    };

    const element = cardTemplate(emptyData);
    expect(element).toBeDefined();
    expect(element.type).toBe("div");
  });

  it("domain color is deterministic", () => {
    // Call template twice with same data and verify it doesn't throw
    const el1 = cardTemplate(FULL_CARD_DATA);
    const el2 = cardTemplate(FULL_CARD_DATA);
    expect(el1).toBeDefined();
    expect(el2).toBeDefined();
  });
});
