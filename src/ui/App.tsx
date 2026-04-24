import { lazy, Suspense } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import {
  DecisionsSkeleton,
  GenericSkeleton,
  HomeSkeleton,
  IntelligenceSkeleton,
  LiveSkeleton,
  ProfileSkeleton,
} from "@/components/shared/Skeletons";

const HomePage = lazy(() => import("@/pages/HomePage"));
const LivePage = lazy(() => import("@/pages/LivePage"));
const DistillPage = lazy(() => import("@/pages/DistillPage"));
const IntelligencePage = lazy(() => import("@/pages/IntelligencePage"));
const DecisionsPage = lazy(() => import("@/pages/DecisionsPage"));
const ProfilePage = lazy(() => import("@/pages/ProfilePage"));
const CardsPage = lazy(() => import("@/pages/CardsPage"));
const ProjectsPage = lazy(() => import("@/pages/ProjectsPage"));
const SettingsPage = lazy(() => import("@/pages/SettingsPage"));
const IntegrationsPage = lazy(() => import("@/pages/IntegrationsPage"));
const LogsPage = lazy(() => import("@/pages/LogsPage"));
const SetupWizard = lazy(() => import("@/pages/setup/SetupWizard"));

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/setup"
          element={
            <Suspense fallback={<GenericSkeleton />}>
              <SetupWizard />
            </Suspense>
          }
        />
        <Route element={<AppShell />}>
          <Route
            index
            element={
              <Suspense fallback={<HomeSkeleton />}>
                <HomePage />
              </Suspense>
            }
          />
          <Route
            path="live"
            element={
              <Suspense fallback={<LiveSkeleton />}>
                <LivePage />
              </Suspense>
            }
          />
          <Route
            path="distill"
            element={
              <Suspense fallback={<GenericSkeleton />}>
                <DistillPage />
              </Suspense>
            }
          />
          <Route
            path="intelligence"
            element={
              <Suspense fallback={<IntelligenceSkeleton />}>
                <IntelligencePage />
              </Suspense>
            }
          />
          <Route
            path="decisions"
            element={
              <Suspense fallback={<DecisionsSkeleton />}>
                <DecisionsPage />
              </Suspense>
            }
          />
          <Route
            path="profile"
            element={
              <Suspense fallback={<ProfileSkeleton />}>
                <ProfilePage />
              </Suspense>
            }
          />
          <Route
            path="cards"
            element={
              <Suspense fallback={<GenericSkeleton />}>
                <CardsPage />
              </Suspense>
            }
          />
          <Route
            path="projects"
            element={
              <Suspense fallback={<GenericSkeleton />}>
                <ProjectsPage />
              </Suspense>
            }
          />
          <Route
            path="settings"
            element={
              <Suspense fallback={<GenericSkeleton />}>
                <SettingsPage />
              </Suspense>
            }
          />
          <Route
            path="integrations"
            element={
              <Suspense fallback={<GenericSkeleton />}>
                <IntegrationsPage />
              </Suspense>
            }
          />
          <Route
            path="logs"
            element={
              <Suspense fallback={<GenericSkeleton />}>
                <LogsPage />
              </Suspense>
            }
          />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
