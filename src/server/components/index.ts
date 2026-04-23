// Phase 15 component library — re-exports all components

export type { ConfidenceBadgeProps, DataFreshnessBadgeProps, SessionAutonomyBadgeProps } from "./badges.js";
export {
  confidenceBadge,
  dataFreshnessBadge,
  estimateBadge,
  projectBadge,
  sessionAutonomyBadge,
  sourceBadge,
} from "./badges.js";
export type {
  DependencyHeatmapEntry,
  DependencyHeatmapProps,
  IndependenceGaugeProps,
  SkillTrajectoryChartProps,
  SkillTrajectoryPoint,
} from "./autonomy-viz.js";
export { dependencyHeatmap, independenceGauge, skillTrajectoryChart } from "./autonomy-viz.js";
export type {
  IdentityNarrativeProps,
  KnowledgeRetainedCardProps,
  VehicleHealthSummaryProps,
} from "./narrative-card.js";
export {
  identityNarrative,
  knowledgeRetainedCard,
  vehicleHealthSummary,
} from "./narrative-card.js";
export type { BarChartSvgProps, GaugeSvgProps, SparklineSvgProps } from "./charts.js";
export { barChartSvg, gaugeSvg, heatmapCell, sparklineSvg, trendArrow } from "./charts.js";
export type { EmptyStateProps } from "./empty-state.js";
export { emptyState } from "./empty-state.js";
export type { HeroMetricCardProps, KpiCardProps } from "./metric-card.js";
export { heroMetricCard, kpiCard, kpiStrip } from "./metric-card.js";
export type { NavGroupDef, NavItemDef } from "./nav.js";
export { navGroup, navItem, sidebarNav } from "./nav.js";
export type { ProjectCardProps, ProjectSelectorProps } from "./project-selector.js";
export { projectCard, projectSelector } from "./project-selector.js";
export { activationSection } from "./system-reveal.js";
export type { TabBarProps, TabItem } from "./tabs.js";
export { tabBar, tabPanel } from "./tabs.js";
