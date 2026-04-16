// T-150: Web UI — layout includes htmx script tag and dark theme CSS
import { describe, expect, it } from "vitest";
import { escapeHtml, layout, markdownToHtml } from "../../../src/server/pages/layout.js";

describe("layout", () => {
  it("returns complete HTML page with doctype", () => {
    const html = layout("Test", "<p>hello</p>");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<html");
    expect(html).toContain("</html>");
  });

  it("includes htmx script tag", () => {
    const html = layout("Test", "");
    expect(html).toContain("https://unpkg.com/htmx.org@2.0.4");
    expect(html).toContain("<script");
  });

  it("includes dark theme CSS with expected vars", () => {
    const html = layout("Test", "");
    expect(html).toContain("<style>");
    expect(html).toContain("--bg: #1a1a2e");
    expect(html).toContain("--text: #e0e0e0");
    expect(html).toContain("--accent: #0099ff");
  });

  it("includes nav bar with all 4 links", () => {
    const html = layout("Test", "");
    expect(html).toContain('href="/"');
    expect(html).toContain('href="/distill"');
    expect(html).toContain('href="/profile"');
    expect(html).toContain('href="/settings"');
  });

  it("includes title in <title> tag", () => {
    const html = layout("My Page", "");
    expect(html).toContain("<title>My Page — Unfade</title>");
  });

  it("includes content in main", () => {
    const html = layout("Test", "<p>custom content</p>");
    expect(html).toContain("<main>");
    expect(html).toContain("<p>custom content</p>");
    expect(html).toContain("</main>");
  });

  it("includes responsive viewport meta", () => {
    const html = layout("Test", "");
    expect(html).toContain('name="viewport"');
    expect(html).toContain("width=device-width");
  });

  it("includes charset meta", () => {
    const html = layout("Test", "");
    expect(html).toContain('charset="utf-8"');
  });
});

describe("escapeHtml", () => {
  it("escapes HTML special characters", () => {
    expect(escapeHtml('<script>"alert"</script>')).toBe(
      "&lt;script&gt;&quot;alert&quot;&lt;/script&gt;",
    );
  });

  it("escapes ampersands", () => {
    expect(escapeHtml("foo & bar")).toBe("foo &amp; bar");
  });
});

describe("markdownToHtml", () => {
  it("converts headings", () => {
    expect(markdownToHtml("# Title")).toContain("<h1>Title</h1>");
    expect(markdownToHtml("## Sub")).toContain("<h2>Sub</h2>");
  });

  it("converts bold and italic", () => {
    const html = markdownToHtml("**bold** and *italic*");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
  });

  it("converts unordered lists", () => {
    const html = markdownToHtml("- item 1\n- item 2");
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>item 1</li>");
    expect(html).toContain("<li>item 2</li>");
    expect(html).toContain("</ul>");
  });

  it("converts code blocks", () => {
    const html = markdownToHtml("```\ncode here\n```");
    expect(html).toContain("<pre><code>");
    expect(html).toContain("code here");
    expect(html).toContain("</code></pre>");
  });

  it("converts blockquotes", () => {
    const html = markdownToHtml("> quote text");
    expect(html).toContain("<blockquote>quote text</blockquote>");
  });

  it("escapes HTML in markdown content", () => {
    const html = markdownToHtml("# <script>alert</script>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
