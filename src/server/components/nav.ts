// Phase 15 component: sidebar navigation with 4-layer grouping
// Observe → Understand → Identity → System

export interface NavItemDef {
  path: string;
  label: string;
  icon: string;
  badge?: number;
}

export interface NavGroupDef {
  label: string;
  items: NavItemDef[];
  collapsed?: boolean;
}

export function navItem(item: NavItemDef): string {
  const badgeHtml =
    item.badge && item.badge > 0
      ? `<span class="nav-label inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[11px] font-semibold bg-accent text-white">${item.badge > 9 ? "9+" : item.badge}</span>`
      : "";

  return `<a href="${item.path}" data-path="${item.path}" class="nav-item">
    <span class="nav-icon" style="flex-shrink:0">${item.icon}</span>
    <span class="nav-label">${item.label}</span>
    ${badgeHtml}
  </a>`;
}

export function navGroup(group: NavGroupDef): string {
  const itemsHtml = group.items.map(navItem).join("\n");
  if (group.collapsed) {
    return `<div class="nav-group-collapsed">
      <button onclick="this.parentElement.classList.toggle('expanded')" class="divider-label mt-4 mb-2 px-3 text-[11px] uppercase tracking-wider text-muted font-medium w-full text-left bg-transparent border-none cursor-pointer hover:text-foreground" style="font:inherit;color:inherit">
        ${group.label} <span class="text-[10px]">▸</span>
      </button>
      <div class="nav-group-items hidden">
        ${itemsHtml}
      </div>
    </div>`;
  }
  return `<div>
    <div class="divider-label mt-4 mb-2 px-3 text-[11px] uppercase tracking-wider text-muted font-medium">${group.label}</div>
    ${itemsHtml}
  </div>`;
}

export function sidebarNav(groups: NavGroupDef[]): string {
  return groups.map(navGroup).join("\n");
}
