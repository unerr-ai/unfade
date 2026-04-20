// FILE: src/server/icons.ts
// UF-301: Lucide SVG icon library — inline SVG functions for the global shell.
// Each returns a complete <svg> string. Default size 18×18, viewBox 0 0 24 24.
// Lucide icons (MIT license), stroke-based.

interface IconOpts {
  size?: number;
  className?: string;
}

function svg(paths: string, opts?: IconOpts): string {
  const s = opts?.size ?? 18;
  const cls = opts?.className ? ` class="${opts.className}"` : "";
  return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"${cls}>${paths}</svg>`;
}

export const iconHome = (o?: IconOpts) =>
  svg(
    '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    o,
  );
export const iconZap = (o?: IconOpts) =>
  svg(
    '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
    o,
  );
export const iconBarChart = (o?: IconOpts) =>
  svg(
    '<line x1="12" x2="12" y1="20" y2="10"/><line x1="18" x2="18" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="16"/>',
    o,
  );
export const iconDollarSign = (o?: IconOpts) =>
  svg(
    '<line x1="12" x2="12" y1="2" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
    o,
  );
export const iconBrain = (o?: IconOpts) =>
  svg(
    '<path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/><path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4"/><path d="M17.599 6.5a3 3 0 0 0 .399-1.375"/><path d="M6.003 5.125A3 3 0 0 0 6.401 6.5"/><path d="M3.477 10.896a4 4 0 0 1 .585-.396"/><path d="M19.938 10.5a4 4 0 0 1 .585.396"/><path d="M6 18a4 4 0 0 1-1.967-.516"/><path d="M19.967 17.484A4 4 0 0 1 18 18"/>',
    o,
  );
export const iconTarget = (o?: IconOpts) =>
  svg(
    '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
    o,
  );
export const iconAlertTriangle = (o?: IconOpts) =>
  svg(
    '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    o,
  );
export const iconRefreshCw = (o?: IconOpts) =>
  svg(
    '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
    o,
  );
export const iconGitBranch = (o?: IconOpts) =>
  svg(
    '<line x1="6" x2="6" y1="3" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
    o,
  );
export const iconSparkles = (o?: IconOpts) =>
  svg(
    '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/>',
    o,
  );
export const iconTerminalSquare = (o?: IconOpts) =>
  svg(
    '<path d="m7 11 2-2-2-2"/><path d="M11 13h4"/><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/>',
    o,
  );
export const iconEyeOff = (o?: IconOpts) =>
  svg(
    '<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/>',
    o,
  );
export const iconSearch = (o?: IconOpts) =>
  svg('<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>', o);
export const iconSettings = (o?: IconOpts) =>
  svg(
    '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
    o,
  );
export const iconChevronLeft = (o?: IconOpts) => svg('<path d="m15 18-6-6 6-6"/>', o);
export const iconChevronRight = (o?: IconOpts) => svg('<path d="m9 18 6-6-6-6"/>', o);
export const iconX = (o?: IconOpts) => svg('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>', o);
export const iconArrowUp = (o?: IconOpts) =>
  svg('<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>', o);
export const iconArrowDown = (o?: IconOpts) =>
  svg('<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>', o);
export const iconMinus = (o?: IconOpts) => svg('<path d="M5 12h14"/>', o);
export const iconClock = (o?: IconOpts) =>
  svg('<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>', o);
export const iconFolder = (o?: IconOpts) =>
  svg(
    '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
    o,
  );
export const iconCopy = (o?: IconOpts) =>
  svg(
    '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    o,
  );
export const iconExternalLink = (o?: IconOpts) =>
  svg(
    '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    o,
  );
export const iconMoon = (o?: IconOpts) => svg('<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>', o);
export const iconSun = (o?: IconOpts) =>
  svg(
    '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
    o,
  );
export const iconMenu = (o?: IconOpts) =>
  svg(
    '<line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="18" y2="18"/>',
    o,
  );
export const iconMoreHorizontal = (o?: IconOpts) =>
  svg(
    '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
    o,
  );
export const iconPlus = (o?: IconOpts) => svg('<path d="M5 12h14"/><path d="M12 5v14"/>', o);
export const iconCheck = (o?: IconOpts) => svg('<path d="M20 6 9 17l-5-5"/>', o);
export const iconCalendar = (o?: IconOpts) =>
  svg(
    '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>',
    o,
  );
export const iconUser = (o?: IconOpts) =>
  svg('<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>', o);
export const iconCards = (o?: IconOpts) =>
  svg('<rect width="18" height="12" x="3" y="6" rx="2"/><path d="m2 10 20-4"/>', o);
export const iconTrendingUp = (o?: IconOpts) =>
  svg('<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>', o);
