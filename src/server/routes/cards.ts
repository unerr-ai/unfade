// FILE: src/server/routes/cards.ts
// UF-061: Card API routes.
// POST /api/cards/generate — generate card PNG for a date.
// GET /api/cards/image/:date — serve generated card PNG.

import { existsSync, readdirSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Hono } from "hono";
import { CardGenerateInputSchema } from "../../schemas/card.js";
import { generateCard } from "../../services/card/generator.js";
import { logger } from "../../utils/logger.js";
import { getCardsDir } from "../../utils/paths.js";

export const cardsRoutes = new Hono();

cardsRoutes.post("/cards/generate", async (c) => {
  const start = performance.now();

  try {
    const body = await c.req.json().catch(() => ({}));
    const parsed = CardGenerateInputSchema.safeParse(body);

    if (!parsed.success) {
      return c.json(
        {
          data: null,
          _meta: {
            tool: "unfade-cards",
            durationMs: Math.round(performance.now() - start),
            degraded: true,
            degradedReason: "Invalid input. Provide { date: 'YYYY-MM-DD' }",
            lastUpdated: null,
          },
        },
        400,
      );
    }

    const { date } = parsed.data;
    const pngBuffer = await generateCard(date);

    return c.json({
      data: {
        status: "generated",
        date,
        size: pngBuffer.length,
        path: `cards/${date}.png`,
      },
      _meta: {
        tool: "unfade-cards",
        durationMs: Math.round(performance.now() - start),
        degraded: false,
        lastUpdated: new Date().toISOString(),
      },
    });
  } catch (err) {
    logger.error("Card generation failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return c.json(
      {
        data: null,
        _meta: {
          tool: "unfade-cards",
          durationMs: Math.round(performance.now() - start),
          degraded: true,
          degradedReason: err instanceof Error ? err.message : "Card generation failed",
          lastUpdated: null,
        },
      },
      500,
    );
  }
});

cardsRoutes.get("/cards/list", async (c) => {
  const cardsDir = getCardsDir();
  if (!existsSync(cardsDir)) return c.json({ cards: [] });

  const files = readdirSync(cardsDir)
    .filter((f) => f.endsWith(".png") && /^\d{4}-\d{2}-\d{2}\.png$/.test(f))
    .sort()
    .reverse();

  const cards = files.map((f) => {
    const date = f.replace(".png", "");
    const stat = statSync(join(cardsDir, f));
    return { date, size: stat.size, createdAt: stat.mtime.toISOString() };
  });

  return c.json({ cards });
});

cardsRoutes.get("/cards/image/:date", async (c) => {
  const date = c.req.param("date");

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return c.json({ error: "Invalid date format. Use YYYY-MM-DD" }, 400);
  }

  const cardsDir = getCardsDir();
  const pngPath = join(cardsDir, `${date}.png`);

  if (!existsSync(pngPath)) {
    return c.json({ error: `No card found for ${date}` }, 404);
  }

  const png = await readFile(pngPath);
  return new Response(png, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=3600",
    },
  });
});
