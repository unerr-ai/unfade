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
      setTheme: (theme) => {
        document.documentElement.classList.toggle("dark", theme === "dark");
        document.documentElement.classList.toggle("light", theme === "light");
        set({ theme });
      },
      toggleTheme: () =>
        set((s) => {
          const next = s.theme === "dark" ? "light" : "dark";
          document.documentElement.classList.toggle("dark", next === "dark");
          document.documentElement.classList.toggle("light", next === "light");
          return { theme: next };
        }),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setActiveProject: (id) => set({ activeProjectId: id }),
      setPersona: (persona) => set({ persona }),
    }),
    { name: "unfade-app" },
  ),
);
