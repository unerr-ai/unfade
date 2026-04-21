// FILE: src/commands/publish.ts
// UF-083: `unfade publish` — orchestrate Thinking Graph static site generation.
// Generates .unfade/site/ with index.html, style.css, data.json, assets/og-card.png.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { theme } from "../cli/ui.js";
import { renderHeatmapSvg } from "../services/site/heatmap.js";
import { generateSiteData } from "../services/site/site-generator.js";
import { renderSiteCss, renderSiteHtml } from "../services/site/template.js";
import { localToday } from "../utils/date.js";
import { logger } from "../utils/logger.js";
import { getProjectDataDir, getSiteDir } from "../utils/paths.js";

/**
 * Generate the Thinking Graph static site.
 * Output: index.html, style.css, data.json, assets/og-card.png
 */
export async function publishCommand(opts: { output?: string } = {}): Promise<void> {
  const dataDir = getProjectDataDir();

  if (!existsSync(dataDir)) {
    process.stderr.write(
      `${theme.error("Error:")} No ${theme.bold(".unfade/")} directory found. Run ${theme.bold("unfade")} first.\n`,
    );
    process.exitCode = 1;
    return;
  }

  const outputDir = resolve(opts.output ?? getSiteDir());
  const assetsDir = resolve(outputDir, "assets");

  process.stderr.write(`${theme.muted("Generating Thinking Graph...")}\n`);

  // Step 1: Generate site data
  const siteData = generateSiteData();
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(resolve(outputDir, "data.json"), JSON.stringify(siteData, null, 2));
  process.stderr.write(`${theme.muted("  data.json")} ${theme.success("OK")}\n`);

  // Step 2: Render heatmap SVG
  const heatmapSvg = renderHeatmapSvg(siteData.heatmap);

  // Step 3: Generate OG card image (reuse Phase 3 card generator)
  mkdirSync(assetsDir, { recursive: true });
  let ogCardGenerated = false;
  try {
    const { generateCard } = await import("../services/card/generator.js");
    // Use the most recent distill date, or today
    const cardDate =
      siteData.distills.length > 0
        ? siteData.distills[0].date
        : localToday();
    const pngBuffer = await generateCard(cardDate);
    writeFileSync(resolve(assetsDir, "og-card.png"), pngBuffer);
    ogCardGenerated = true;
    process.stderr.write(`${theme.muted("  assets/og-card.png")} ${theme.success("OK")}\n`);
  } catch (err) {
    logger.debug("OG card generation failed, skipping", {
      error: err instanceof Error ? err.message : String(err),
    });
    process.stderr.write(
      `${theme.muted("  assets/og-card.png")} ${theme.warning("SKIP")} (font/satori unavailable)\n`,
    );
  }

  // Step 4: Render HTML
  const html = renderSiteHtml(
    siteData,
    heatmapSvg,
    ogCardGenerated ? "assets/og-card.png" : undefined,
  );
  writeFileSync(resolve(outputDir, "index.html"), html);
  process.stderr.write(`${theme.muted("  index.html")} ${theme.success("OK")}\n`);

  // Step 5: Write CSS
  const css = renderSiteCss();
  writeFileSync(resolve(outputDir, "style.css"), css);
  process.stderr.write(`${theme.muted("  style.css")} ${theme.success("OK")}\n`);

  // Summary
  const fileCount = ogCardGenerated ? 4 : 3;
  process.stderr.write(
    `\n${theme.success("Done!")} Generated ${fileCount} files in ${theme.bold(outputDir)}\n`,
  );

  // Deploy instructions
  process.stderr.write(`\n${theme.bold("Deploy:")}\n`);
  process.stderr.write(`  ${theme.muted("Vercel:")}   npx vercel ${outputDir}\n`);
  process.stderr.write(`  ${theme.muted("Netlify:")}  npx netlify deploy --dir ${outputDir}\n`);
  process.stderr.write(
    `  ${theme.muted("GitHub Pages:")} Copy ${outputDir} contents to your gh-pages branch\n`,
  );
}
