// T-334: Feature tag binding tests
import { describe, expect, it } from "vitest";
import { applyFeatureTag } from "../../src/commands/tag.js";

function createMockTagDb() {
  const features: Array<{ id: string; name: string; event_count: number }> = [];
  const eventFeatures: Array<{ event_id: string; feature_id: string; source: string }> = [];

  return {
    run(sql: string, params?: unknown[]): void {
      if (sql.includes("INSERT INTO features")) {
        features.push({
          id: params![0] as string,
          name: params![2] as string,
          event_count: 0,
        });
      } else if (sql.includes("INSERT OR IGNORE INTO event_features")) {
        const existing = eventFeatures.find(
          (ef) => ef.event_id === params![0] && ef.feature_id === params![1],
        );
        if (!existing) {
          eventFeatures.push({
            event_id: params![0] as string,
            feature_id: params![1] as string,
            source: "user",
          });
        }
      } else if (sql.includes("UPDATE features SET event_count")) {
        const f = features.find((f) => f.id === params![1]);
        if (f) f.event_count += params![0] as number;
      }
    },
    exec(sql: string, params?: unknown[]): Array<{ columns: string[]; values: unknown[][] }> {
      if (sql.includes("SELECT id FROM features WHERE id = ?")) {
        const found = features.find((f) => f.id === params![0]);
        if (found) return [{ columns: ["id"], values: [[found.id]] }];
        return [];
      }
      return [];
    },
    // Test helpers
    getFeatures: () => features,
    getEventFeatures: () => eventFeatures,
  };
}

describe("applyFeatureTag", () => {
  it("T-334a: creates feature and tags events with source=user", () => {
    const db = createMockTagDb();
    const tagged = applyFeatureTag(db, "auth-refactor", ["ev-1", "ev-2", "ev-3"]);

    expect(tagged).toBe(3);
    expect(db.getFeatures()).toHaveLength(1);
    expect(db.getFeatures()[0].id).toBe("user-auth-refactor");
    expect(db.getFeatures()[0].name).toBe("auth-refactor");
    expect(db.getEventFeatures()).toHaveLength(3);
    expect(db.getEventFeatures()[0].source).toBe("user");
  });

  it("T-334b: reuses existing feature entry", () => {
    const db = createMockTagDb();
    // First call creates the feature
    applyFeatureTag(db, "login flow", ["ev-1"]);
    // Second call reuses it
    applyFeatureTag(db, "login flow", ["ev-2", "ev-3"]);

    expect(db.getFeatures()).toHaveLength(1);
    expect(db.getEventFeatures()).toHaveLength(3);
  });

  it("T-334c: feature ID normalizes spaces to hyphens and lowercases", () => {
    const db = createMockTagDb();
    applyFeatureTag(db, "My Feature Name", ["ev-1"]);

    expect(db.getFeatures()[0].id).toBe("user-my-feature-name");
  });

  it("T-334d: empty eventIds returns 0", () => {
    const db = createMockTagDb();
    const tagged = applyFeatureTag(db, "empty", []);
    expect(tagged).toBe(0);
  });
});
