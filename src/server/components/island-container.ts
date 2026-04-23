// FILE: src/server/components/island-container.ts
// UF-476: SSR container for React islands.
// Renders a <div> with data attributes for client-side hydration.
// Usage in SSR pages: islandContainer("my-chart", "ChartComponent", { data: [...] })

import { escapeHtml } from "../pages/layout.js";

/**
 * Renders an island container div that the client-side mount helper will hydrate.
 *
 * @param id - Unique DOM id for this island instance
 * @param component - Registered component name (must match client-side registry)
 * @param props - Serializable props to pass to the React component
 * @param fallback - Optional HTML to show before hydration (loading state)
 */
export function islandContainer(
  id: string,
  component: string,
  props: Record<string, unknown>,
  fallback?: string,
): string {
  const serialized = escapeHtml(JSON.stringify(props));
  return `<div id="${escapeHtml(id)}" data-island="${escapeHtml(component)}" data-island-props="${serialized}">${fallback ?? ""}</div>`;
}
