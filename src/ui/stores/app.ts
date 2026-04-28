import { create } from "zustand";
import { persist } from "zustand/middleware";

type Persona = "developer" | "lead" | "executive";
type Theme = "dark" | "light";

interface AppState {
  theme: Theme;
  sidebarCollapsed: boolean;
  activeProjectId: string;
  persona: Persona;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
  toggleSidebar: () => void;
  setActiveProject: (id: string) => void;
  setPersona: (p: Persona) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      theme: "dark",
      sidebarCollapsed: false,
      activeProjectId: "",
      persona: "developer",
      setTheme: (theme) => set({ theme }),
      toggleTheme: () => set((s) => ({ theme: s.theme === "dark" ? "light" : "dark" })),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setActiveProject: (id) => set({ activeProjectId: id }),
      setPersona: (persona) => set({ persona }),
    }),
    { name: "unfade-app" },
  ),
);

/** Sync theme class on <html> whenever store changes. Runs outside React. */
function applyThemeToDOM(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.classList.toggle("light", theme === "light");
}

// Apply on initial load (persisted state rehydration)
applyThemeToDOM(useAppStore.getState().theme);

// Subscribe to future changes
useAppStore.subscribe((state, prev) => {
  if (state.theme !== prev.theme) applyThemeToDOM(state.theme);
});
