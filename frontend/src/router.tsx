import { createBrowserRouter, Navigate } from "react-router-dom";

import { AppLayout } from "@/AppLayout";

export const router = createBrowserRouter([
  {
    element: <AppLayout />,
    children: [
      { index: true, element: <Navigate to="/plans" replace /> },
      {
        path: "settings",
        lazy: () => import("@/features/settings/SettingsView").then((m) => ({ Component: m.SettingsView })),
      },
      {
        path: "plans",
        lazy: () => import("@/features/plans/PlansView").then((m) => ({ Component: m.PlansView })),
      },
      {
        path: "plans/new",
        lazy: () => import("@/features/plans/PlanBuilder").then((m) => ({ Component: m.PlanBuilder })),
      },
      {
        path: "plans/:planId/edit",
        lazy: () => import("@/features/plans/PlanBuilder").then((m) => ({ Component: m.PlanBuilder })),
      },
      {
        path: "exercises",
        lazy: () => import("@/features/exercises/ExercisesView").then((m) => ({ Component: m.ExercisesView })),
      },
      {
        path: "exercises/new",
        lazy: () => import("@/features/exercises/ExerciseBuilder").then((m) => ({ Component: m.ExerciseBuilder })),
      },
      {
        path: "exercises/:exerciseId/edit",
        lazy: () => import("@/features/exercises/ExerciseBuilder").then((m) => ({ Component: m.ExerciseBuilder })),
      },
      {
        path: "exercises/:exerciseId",
        lazy: () => import("@/features/exercises/ExerciseDetailView").then((m) => ({ Component: m.ExerciseDetailView })),
      },
      {
        path: "calendar",
        lazy: () => import("@/features/calendar/CalendarView").then((m) => ({ Component: m.CalendarView })),
      },
      {
        path: "programs",
        lazy: () => import("@/features/programs/ProgramsView").then((m) => ({ Component: m.ProgramsView })),
      },
      {
        path: "programs/new",
        lazy: () => import("@/features/programs/ProgramBuilder").then((m) => ({ Component: m.ProgramBuilder })),
      },
      {
        path: "programs/:programId/edit",
        lazy: () => import("@/features/programs/ProgramBuilder").then((m) => ({ Component: m.ProgramBuilder })),
      },
      {
        path: "log/new",
        lazy: () => import("@/features/logs/NewLogView").then((m) => ({ Component: m.NewLogView })),
      },
      {
        path: "history",
        lazy: () => import("@/features/history/HistoryView").then((m) => ({ Component: m.HistoryView })),
      },
      {
        path: "history/:logId",
        lazy: () => import("@/features/history/LogDetailView").then((m) => ({ Component: m.LogDetailView })),
      },
      {
        path: "workout",
        lazy: () =>
          import("@/features/active-workout/ActiveWorkoutView").then((m) => ({
            Component: m.ActiveWorkoutView,
          })),
      },
    ],
  },
]);
