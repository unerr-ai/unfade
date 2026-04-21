// Phase 15 component: tabBar + tabPanel for Intelligence Hub
// htmx-powered tab switching with URL update.

export interface TabItem {
  id: string;
  label: string;
  badge?: number;
  active?: boolean;
}

export interface TabBarProps {
  tabs: TabItem[];
  baseUrl: string;
}

export function tabBar(props: TabBarProps): string {
  const items = props.tabs.map((tab) => {
    const active = tab.active
      ? "border-accent text-foreground"
      : "border-transparent text-muted hover:text-foreground hover:border-border";
    const badgeHtml =
      tab.badge && tab.badge > 0
        ? `<span class="ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[11px] font-semibold bg-accent text-white">${tab.badge > 9 ? "9+" : tab.badge}</span>`
        : "";
    return `<button
      class="px-4 py-2 text-sm font-medium border-b-2 transition-colors ${active}"
      hx-get="${props.baseUrl}/tab/${tab.id}"
      hx-target="#tab-content"
      hx-push-url="${props.baseUrl}?tab=${tab.id}"
      hx-indicator="#tab-spinner"
    >${tab.label}${badgeHtml}</button>`;
  });

  return `<div class="flex items-center gap-1 border-b border-border mb-6 relative">
    ${items.join("\n")}
    <div id="tab-spinner" class="htmx-indicator absolute right-0 top-2">
      <span class="text-xs text-muted">Loading...</span>
    </div>
  </div>
  <div id="tab-content"></div>`;
}

export function tabPanel(content: string): string {
  return `<div class="animate-in fade-in">${content}</div>`;
}
