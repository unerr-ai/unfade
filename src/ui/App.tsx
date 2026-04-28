import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { ErrorBoundary } from "@/components/shared/ErrorBoundary";
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

function NotFoundPage() {
  return <Navigate to="/" replace />;
}

export function App() {
  return (
    <BrowserRouter>
      <ErrorBoundary>
        <Routes>
          <Route
            path="/setup"
            element={
              <ErrorBoundary>
                <Suspense fallback={<GenericSkeleton />}>
                  <SetupWizard />
                </Suspense>
              </ErrorBoundary>
            }
          />
          <Route element={<AppShell />}>
            <Route
              index
              element={
                <ErrorBoundary>
                  <Suspense fallback={<HomeSkeleton />}>
                    <HomePage />
                  </Suspense>
                </ErrorBoundary>
              }
            />
            <Route
              path="live"
              element={
                <ErrorBoundary>
                  <Suspense fallback={<LiveSkeleton />}>
                    <LivePage />
                  </Suspense>
                </ErrorBoundary>
              }
            />
            <Route
              path="distill"
              element={
                <ErrorBoundary>
                  <Suspense fallback={<GenericSkeleton />}>
                    <DistillPage />
                  </Suspense>
                </ErrorBoundary>
              }
            />
            <Route
              path="intelligence"
              element={
                <ErrorBoundary>
                  <Suspense fallback={<IntelligenceSkeleton />}>
                    <IntelligencePage />
                  </Suspense>
                </ErrorBoundary>
              }
            />
            <Route
              path="decisions"
              element={
                <ErrorBoundary>
                  <Suspense fallback={<DecisionsSkeleton />}>
                    <DecisionsPage />
                  </Suspense>
                </ErrorBoundary>
              }
            />
            <Route
              path="profile"
              element={
                <ErrorBoundary>
                  <Suspense fallback={<ProfileSkeleton />}>
                    <ProfilePage />
                  </Suspense>
                </ErrorBoundary>
              }
            />
            <Route
              path="cards"
              element={
                <ErrorBoundary>
                  <Suspense fallback={<GenericSkeleton />}>
                    <CardsPage />
                  </Suspense>
                </ErrorBoundary>
              }
            />
            <Route
              path="projects"
              element={
                <ErrorBoundary>
                  <Suspense fallback={<GenericSkeleton />}>
                    <ProjectsPage />
                  </Suspense>
                </ErrorBoundary>
              }
            />
            <Route
              path="settings"
              element={
                <ErrorBoundary>
                  <Suspense fallback={<GenericSkeleton />}>
                    <SettingsPage />
                  </Suspense>
                </ErrorBoundary>
              }
            />
            <Route
              path="integrations"
              element={
                <ErrorBoundary>
                  <Suspense fallback={<GenericSkeleton />}>
                    <IntegrationsPage />
                  </Suspense>
                </ErrorBoundary>
              }
            />
            <Route
              path="logs"
              element={
                <ErrorBoundary>
                  <Suspense fallback={<GenericSkeleton />}>
                    <LogsPage />
                  </Suspense>
                </ErrorBoundary>
              }
            />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </ErrorBoundary>
    </BrowserRouter>
  );
}
