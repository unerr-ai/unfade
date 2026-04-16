// FILE: src/server/pages/layout.ts
// UF-051a-layout: Base HTML layout — dark theme, htmx, nav bar.
// Export layout(title, content) that returns a complete HTML page.

const CSS = `
  :root {
    --bg: #1a1a2e;
    --bg-card: #16213e;
    --bg-input: #0f3460;
    --text: #e0e0e0;
    --text-dim: #8892a4;
    --accent: #0099ff;
    --accent-dim: #006bb3;
    --success: #00c853;
    --warning: #ffab00;
    --error: #ff5252;
    --border: #2a2a4a;
    --mono: 'SF Mono', 'Fira Code', 'Cascadia Code', 'JetBrains Mono', monospace;
    --sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    --radius: 8px;
  }

  * { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: var(--sans);
    background: var(--bg);
    color: var(--text);
    line-height: 1.6;
    min-height: 100vh;
  }

  nav {
    background: var(--bg-card);
    border-bottom: 1px solid var(--border);
    padding: 0 1.5rem;
    display: flex;
    align-items: center;
    height: 52px;
    gap: 0.25rem;
  }

  nav .brand {
    font-family: var(--mono);
    font-weight: 700;
    font-size: 1.1rem;
    color: var(--accent);
    margin-right: 2rem;
    text-decoration: none;
  }

  nav a {
    color: var(--text-dim);
    text-decoration: none;
    padding: 0.5rem 0.75rem;
    border-radius: var(--radius);
    font-size: 0.875rem;
    transition: color 0.15s, background 0.15s;
  }

  nav a:hover, nav a.active {
    color: var(--text);
    background: var(--bg-input);
  }

  main {
    max-width: 960px;
    margin: 0 auto;
    padding: 2rem 1.5rem;
  }

  h1 {
    font-size: 1.5rem;
    font-weight: 600;
    margin-bottom: 1.5rem;
    color: var(--text);
  }

  h2 {
    font-size: 1.15rem;
    font-weight: 600;
    margin: 1.5rem 0 0.75rem;
    color: var(--text);
  }

  .card {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 1.25rem;
    margin-bottom: 1rem;
  }

  .stat-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 1rem;
    margin-bottom: 1.5rem;
  }

  .stat {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 1rem;
    text-align: center;
  }

  .stat .value {
    font-family: var(--mono);
    font-size: 1.75rem;
    font-weight: 700;
    color: var(--accent);
  }

  .stat .label {
    font-size: 0.8rem;
    color: var(--text-dim);
    margin-top: 0.25rem;
  }

  .badge {
    display: inline-block;
    padding: 0.2rem 0.6rem;
    border-radius: 999px;
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .badge-ok { background: rgba(0,200,83,0.15); color: var(--success); }
  .badge-warn { background: rgba(255,171,0,0.15); color: var(--warning); }
  .badge-error { background: rgba(255,82,82,0.15); color: var(--error); }

  .empty {
    text-align: center;
    padding: 3rem 1rem;
    color: var(--text-dim);
  }

  .empty p { margin-bottom: 0.5rem; }

  pre, code {
    font-family: var(--mono);
    font-size: 0.85rem;
  }

  pre {
    background: var(--bg-input);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 1rem;
    overflow-x: auto;
    margin: 0.75rem 0;
    line-height: 1.5;
  }

  code {
    background: var(--bg-input);
    padding: 0.15rem 0.35rem;
    border-radius: 4px;
  }

  pre code {
    background: none;
    padding: 0;
  }

  button, .btn {
    font-family: var(--sans);
    font-size: 0.875rem;
    padding: 0.5rem 1rem;
    border-radius: var(--radius);
    border: 1px solid var(--border);
    background: var(--bg-input);
    color: var(--text);
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
  }

  button:hover, .btn:hover {
    background: var(--accent-dim);
    border-color: var(--accent);
  }

  .btn-primary {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }

  .btn-primary:hover {
    background: var(--accent-dim);
  }

  a { color: var(--accent); }
  a:hover { color: var(--text); }

  .date-nav {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-bottom: 1.5rem;
  }

  .date-nav .current {
    font-family: var(--mono);
    font-size: 1rem;
    color: var(--text);
  }

  .domain-list {
    list-style: none;
    padding: 0;
  }

  .domain-list li {
    display: flex;
    justify-content: space-between;
    padding: 0.5rem 0;
    border-bottom: 1px solid var(--border);
    font-size: 0.9rem;
  }

  .domain-list li:last-child { border-bottom: none; }

  .domain-list .freq {
    font-family: var(--mono);
    color: var(--accent);
  }

  .pattern-list {
    list-style: none;
    padding: 0;
  }

  .pattern-list li {
    padding: 0.5rem 0.75rem;
    margin-bottom: 0.5rem;
    background: var(--bg-input);
    border-radius: var(--radius);
    font-size: 0.9rem;
  }

  .config-section { margin-bottom: 2rem; }

  .config-section h3 {
    font-size: 1rem;
    font-weight: 600;
    margin-bottom: 0.5rem;
    color: var(--text-dim);
  }

  .distill-content h1 { font-size: 1.25rem; margin: 1.25rem 0 0.5rem; }
  .distill-content h2 { font-size: 1.1rem; margin: 1rem 0 0.5rem; }
  .distill-content h3 { font-size: 0.95rem; margin: 0.75rem 0 0.5rem; }
  .distill-content p { margin-bottom: 0.75rem; }
  .distill-content ul, .distill-content ol { margin: 0.5rem 0 0.75rem 1.5rem; }
  .distill-content li { margin-bottom: 0.25rem; }
  .distill-content blockquote {
    border-left: 3px solid var(--accent);
    padding-left: 1rem;
    margin: 0.75rem 0;
    color: var(--text-dim);
    font-style: italic;
  }
  .distill-content strong { color: var(--text); font-weight: 600; }
  .distill-content em { color: var(--text-dim); }

  .htmx-indicator { opacity: 0; transition: opacity 0.2s; }
  .htmx-request .htmx-indicator { opacity: 1; }
`;

/**
 * Wrap page content in the base HTML layout.
 * Returns a complete HTML document string.
 */
export function layout(title: string, content: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} — Unfade</title>
  <style>${CSS}</style>
  <script src="https://unpkg.com/htmx.org@2.0.4"></script>
</head>
<body>
  <nav>
    <a class="brand" href="/">unfade</a>
    <a href="/">Dashboard</a>
    <a href="/distill">Distill</a>
    <a href="/profile">Profile</a>
    <a href="/settings">Settings</a>
  </nav>
  <main>
    ${content}
  </main>
</body>
</html>`;
}

/**
 * Escape HTML special characters to prevent XSS.
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Convert basic markdown to HTML.
 * Handles: headings, bold, italic, code blocks, inline code, blockquotes, lists, paragraphs.
 */
export function markdownToHtml(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  let inCodeBlock = false;
  let inList = false;
  let listType: "ul" | "ol" = "ul";

  for (const line of lines) {
    // Fenced code block
    if (line.startsWith("```")) {
      if (inCodeBlock) {
        out.push("</code></pre>");
        inCodeBlock = false;
      } else {
        if (inList) {
          out.push(listType === "ul" ? "</ul>" : "</ol>");
          inList = false;
        }
        out.push("<pre><code>");
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      out.push(escapeHtml(line));
      continue;
    }

    const trimmed = line.trim();

    // Empty line — close list if open
    if (!trimmed) {
      if (inList) {
        out.push(listType === "ul" ? "</ul>" : "</ol>");
        inList = false;
      }
      continue;
    }

    // Headings
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      if (inList) {
        out.push(listType === "ul" ? "</ul>" : "</ol>");
        inList = false;
      }
      const level = headingMatch[1].length;
      out.push(`<h${level}>${inlineMarkdown(headingMatch[2])}</h${level}>`);
      continue;
    }

    // Blockquote
    if (trimmed.startsWith("> ")) {
      if (inList) {
        out.push(listType === "ul" ? "</ul>" : "</ol>");
        inList = false;
      }
      out.push(`<blockquote>${inlineMarkdown(trimmed.slice(2))}</blockquote>`);
      continue;
    }

    // Unordered list
    if (/^[-*]\s+/.test(trimmed)) {
      if (!inList || listType !== "ul") {
        if (inList) out.push(listType === "ul" ? "</ul>" : "</ol>");
        out.push("<ul>");
        inList = true;
        listType = "ul";
      }
      out.push(`<li>${inlineMarkdown(trimmed.replace(/^[-*]\s+/, ""))}</li>`);
      continue;
    }

    // Ordered list
    if (/^\d+\.\s+/.test(trimmed)) {
      if (!inList || listType !== "ol") {
        if (inList) out.push(listType === "ul" ? "</ul>" : "</ol>");
        out.push("<ol>");
        inList = true;
        listType = "ol";
      }
      out.push(`<li>${inlineMarkdown(trimmed.replace(/^\d+\.\s+/, ""))}</li>`);
      continue;
    }

    // Paragraph
    if (inList) {
      out.push(listType === "ul" ? "</ul>" : "</ol>");
      inList = false;
    }
    out.push(`<p>${inlineMarkdown(trimmed)}</p>`);
  }

  if (inList) out.push(listType === "ul" ? "</ul>" : "</ol>");
  if (inCodeBlock) out.push("</code></pre>");

  return out.join("\n");
}

/**
 * Process inline markdown: bold, italic, inline code, links.
 */
function inlineMarkdown(text: string): string {
  let result = escapeHtml(text);
  // Inline code (before bold/italic to avoid conflicts)
  result = result.replace(/`([^`]+)`/g, "<code>$1</code>");
  // Bold
  result = result.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  // Italic
  result = result.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<em>$1</em>");
  result = result.replace(/_([^_]+)_/g, "<em>$1</em>");
  return result;
}
