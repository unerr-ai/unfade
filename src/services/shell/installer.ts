// FILE: src/services/shell/installer.ts
// Step 4 of init: detect active shell and install preexec/precmd hooks.
// Installed WITHOUT confirmation — inform with single line.
// Hooks send terminal commands to daemon via unfade-send.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { logger } from "../../utils/logger.js";

const HOOK_MARKER = "# unfade-hook";
const HOOK_END_MARKER = "# /unfade-hook";

/**
 * Detect the user's active shell.
 */
export function detectShell(): "zsh" | "bash" | "fish" | "unknown" {
  const shell = process.env.SHELL ?? "";
  if (shell.endsWith("/zsh") || shell.endsWith("/zsh.exe")) return "zsh";
  if (shell.endsWith("/bash") || shell.endsWith("/bash.exe")) return "bash";
  if (shell.endsWith("/fish") || shell.endsWith("/fish.exe")) return "fish";
  return "unknown";
}

/**
 * Get the RC file path for a given shell.
 */
function rcFilePath(shell: "zsh" | "bash" | "fish"): string {
  const home = homedir();
  switch (shell) {
    case "zsh":
      return join(home, ".zshrc");
    case "bash":
      // Prefer .bashrc for interactive shells, fall back to .bash_profile on macOS.
      if (existsSync(join(home, ".bashrc"))) return join(home, ".bashrc");
      return join(home, ".bash_profile");
    case "fish":
      return join(home, ".config", "fish", "config.fish");
  }
}

/**
 * Generate shell hook code for zsh.
 * Uses add-zsh-hook for clean preexec/precmd integration.
 */
function zshHook(sendBin: string): string {
  return `
${HOOK_MARKER}
unfade_preexec() {
  _unfade_cmd="$1"
  _unfade_cmd_start=$(date +%s)
}
unfade_precmd() {
  local exit_code=$?
  if [[ -n "$_unfade_cmd" ]]; then
    echo '{"cmd":"'"$_unfade_cmd"'","exit":'$exit_code',"duration":'$(($(date +%s)-_unfade_cmd_start))',"cwd":"'"$PWD"'"}' | ${sendBin} --raw &
    unset _unfade_cmd _unfade_cmd_start
  fi
}
autoload -Uz add-zsh-hook
add-zsh-hook preexec unfade_preexec
add-zsh-hook precmd unfade_precmd
${HOOK_END_MARKER}
`;
}

/**
 * Generate shell hook code for bash.
 * Uses PROMPT_COMMAND for precmd equivalent.
 */
function bashHook(sendBin: string): string {
  return `
${HOOK_MARKER}
_unfade_preexec() {
  _unfade_cmd="$BASH_COMMAND"
  _unfade_cmd_start=$(date +%s)
}
_unfade_precmd() {
  local exit_code=$?
  if [[ -n "$_unfade_cmd" ]]; then
    echo '{"cmd":"'"$_unfade_cmd"'","exit":'$exit_code',"duration":'$(($(date +%s)-_unfade_cmd_start))',"cwd":"'"$PWD"'"}' | ${sendBin} --raw &
    unset _unfade_cmd _unfade_cmd_start
  fi
}
trap '_unfade_preexec' DEBUG
PROMPT_COMMAND="_unfade_precmd;\${PROMPT_COMMAND}"
${HOOK_END_MARKER}
`;
}

/**
 * Generate shell hook code for fish.
 */
function fishHook(sendBin: string): string {
  return `
${HOOK_MARKER}
function __unfade_preexec --on-event fish_preexec
  set -g _unfade_cmd $argv[1]
  set -g _unfade_cmd_start (date +%s)
end
function __unfade_precmd --on-event fish_postexec
  set -l exit_code $status
  if test -n "$_unfade_cmd"
    echo '{"cmd":"'$_unfade_cmd'","exit":'$exit_code',"duration":'(math (date +%s) - $_unfade_cmd_start)',"cwd":"'$PWD'"}' | ${sendBin} --raw &
    set -e _unfade_cmd
    set -e _unfade_cmd_start
  end
end
${HOOK_END_MARKER}
`;
}

export interface ShellHookResult {
  shell: string;
  rcFile: string;
  installed: boolean;
  alreadyPresent: boolean;
}

/**
 * Install shell hooks for the detected shell.
 * Idempotent — checks for existing marker before appending.
 * Does NOT prompt for confirmation.
 */
export function installShellHooks(sendBinPath: string): ShellHookResult {
  const shell = detectShell();

  if (shell === "unknown") {
    logger.debug("Unknown shell, skipping hook installation");
    return { shell: "unknown", rcFile: "", installed: false, alreadyPresent: false };
  }

  const rcFile = rcFilePath(shell);

  // Check if already installed.
  if (existsSync(rcFile)) {
    const content = readFileSync(rcFile, "utf-8");
    if (content.includes(HOOK_MARKER)) {
      logger.debug("Shell hooks already installed", { rcFile });
      return { shell, rcFile, installed: false, alreadyPresent: true };
    }
  }

  let hookCode: string;
  switch (shell) {
    case "zsh":
      hookCode = zshHook(sendBinPath);
      break;
    case "bash":
      hookCode = bashHook(sendBinPath);
      break;
    case "fish":
      hookCode = fishHook(sendBinPath);
      break;
  }

  writeFileSync(rcFile, hookCode, { flag: "a", encoding: "utf-8" });
  logger.debug("Installed shell hooks", { shell, rcFile });

  return { shell, rcFile, installed: true, alreadyPresent: false };
}

/**
 * Remove shell hooks from the RC file.
 * Used for `unfade open → Settings → Disable shell hooks`.
 */
export function removeShellHooks(): boolean {
  const shell = detectShell();
  if (shell === "unknown") return false;

  const rcFile = rcFilePath(shell);
  if (!existsSync(rcFile)) return false;

  const content = readFileSync(rcFile, "utf-8");
  const startIdx = content.indexOf(HOOK_MARKER);
  const endIdx = content.indexOf(HOOK_END_MARKER);

  if (startIdx === -1 || endIdx === -1) return false;

  // Remove everything from marker start to end marker + newline.
  const before = content.slice(0, startIdx);
  const after = content.slice(endIdx + HOOK_END_MARKER.length + 1);
  writeFileSync(rcFile, before + after, "utf-8");

  logger.debug("Removed shell hooks", { rcFile });
  return true;
}
