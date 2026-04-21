// FILE: src/utils/open.ts
// Open a URL in the user's default browser. Fire-and-forget, non-fatal.

import { exec } from "node:child_process";

export function openBrowser(url: string): void {
  const cmd =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "start"
        : "xdg-open";

  exec(`${cmd} ${url}`, () => {
    // Intentionally ignored — opening a browser is best-effort
  });
}
