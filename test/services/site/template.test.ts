// T-218, T-219, T-220: Site template tests
import { describe, expect, it } from "vitest";
import type { SiteData } from "../../../src/services/site/site-generator.js";
import { renderSiteCss, renderSiteHtml } from "../../../src/services/site/template.js";

function makeSiteData(overrides?: Partial<SiteData>): SiteData {
  return {
    generatedAt: "2026-04-16T12:00:00Z",
    heatmap: [
      { date: "2026-04-15", decisions: 3, tradeOffs: 1, deadEnds: 0, intensity: 4.5 },
      { date: "2026-04-14", decisions: 1, tradeOffs: 0, deadEnds: 0, intensity: 1 },
    ],
    domains: [
      { domain: "backend", frequency: 15, percentage: 0.5, depth: "deep" },
      { domain: "frontend", frequency: 9, percentage: 0.3, depth: "moderate" },
    ],
    profile: {
      avgAlternatives: 3.2,
      aiAcceptanceRate: 0.65,
      aiModificationRate: 0.25,
      avgDecisionsPerDay: 3.5,
      topPattern: "Explores multiple alternatives before committing",
      dataPoints: 10,
    },
    distills: [
      {
        date: "2026-04-15",
        summary: "Chose Redis for session cache, evaluated 3 alternatives",
        decisionCount: 3,
        domains: ["backend"],
      },
      {
        date: "2026-04-14",
        summary: "Debugged JWT validation order",
        decisionCount: 1,
        domains: ["auth"],
      },
    ],
    ...overrides,
  };
}

const MOCK_SVG = '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="#0e4429"/></svg>';

describe("Site template (UF-082)", () => {
  // T-218: Generates valid HTML
  it("T-218: generates valid HTML document", () => {
    const data = makeSiteData();
    const html = renderSiteHtml(data, MOCK_SVG);

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain('<html lang="en">');
    expect(html).toContain("<head>");
    expect(html).toContain("</head>");
    expect(html).toContain("<body>");
    expect(html).toContain("</body>");
    expect(html).toContain("</html>");
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain("viewport");
    expect(html).toContain("<style>");
  });

  // T-219: Includes OG meta tags
  it("T-219: includes OG meta tags for social sharing", () => {
    const data = makeSiteData();
    const html = renderSiteHtml(data, MOCK_SVG);

    expect(html).toContain("og:title");
    expect(html).toContain("og:description");
    expect(html).toContain("og:image");
    expect(html).toContain("og:type");
    expect(html).toContain("twitter:card");
    expect(html).toContain("twitter:title");
    expect(html).toContain("twitter:image");
    expect(html).toContain("Thinking Graph");
  });

  it("T-219b: uses custom OG image path when provided", () => {
    const data = makeSiteData();
    const html = renderSiteHtml(data, MOCK_SVG, "https://example.com/card.png");
    expect(html).toContain("https://example.com/card.png");
  });

  // T-220: Includes all visual components
  it("T-220: includes all visual components", () => {
    const data = makeSiteData();
    const html = renderSiteHtml(data, MOCK_SVG);

    // Heatmap section
    expect(html).toContain("Decision Density Heatmap");
    expect(html).toContain(MOCK_SVG);

    // Domain Distribution
    expect(html).toContain("Domain Distribution");
    expect(html).toContain("backend");
    expect(html).toContain("frontend");
    expect(html).toContain("50%"); // backend percentage
    expect(html).toContain("deep"); // depth badge

    // Reasoning Profile
    expect(html).toContain("Reasoning Profile");
    expect(html).toContain("3.2"); // avgAlternatives
    expect(html).toContain("65%"); // aiAcceptanceRate
    expect(html).toContain("Explores multiple alternatives before committing");

    // Recent Distills
    expect(html).toContain("Recent Distills");
    expect(html).toContain("2026-04-15");
    expect(html).toContain("Chose Redis for session cache");
    expect(html).toContain("2026-04-14");

    // Footer
    expect(html).toContain("Powered by");
    expect(html).toContain("Unfade");
    expect(html).toContain("unfade.dev");
  });

  it("renders gracefully with empty data", () => {
    const data = makeSiteData({
      heatmap: [],
      domains: [],
      profile: null,
      distills: [],
    });
    const html = renderSiteHtml(data, MOCK_SVG);

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("No domain data yet");
    expect(html).toContain("No reasoning profile yet");
    expect(html).toContain("No distills yet");
  });

  it("generates CSS", () => {
    const css = renderSiteCss();
    expect(css).toContain("background:#0d1117");
    expect(css).toContain("min-width:320px");
    expect(css).toContain("@media");
  });

  it("renders responsive layout with grid-2 class", () => {
    const data = makeSiteData();
    const html = renderSiteHtml(data, MOCK_SVG);
    expect(html).toContain("grid-2");
  });
});
