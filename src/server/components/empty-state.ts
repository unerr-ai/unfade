// Phase 15 component: empty state with illustration + CTA
// Used when APIs return 202 (warming up) or data doesn't exist yet.

export interface EmptyStateProps {
  title: string;
  description: string;
  cta?: { label: string; href: string };
}

export function emptyState(props: EmptyStateProps): string {
  const ctaHtml = props.cta
    ? `<a href="${props.cta.href}" class="inline-flex items-center gap-2 mt-4 px-4 py-2 rounded-md bg-accent text-white text-sm font-medium hover:bg-accent-dim transition-colors no-underline">${props.cta.label}</a>`
    : "";

  return `<div class="flex flex-col items-center justify-center py-16 text-center">
    <div class="w-[120px] h-[120px] mb-6 rounded-full bg-surface border border-border flex items-center justify-center">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.5">
        <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
      </svg>
    </div>
    <h3 class="font-heading text-lg font-semibold text-foreground mb-2">${props.title}</h3>
    <p class="text-sm text-muted max-w-md">${props.description}</p>
    ${ctaHtml}
  </div>`;
}
