import type { ComponentType } from "react";
import { createBrowserRouter, Navigate } from "react-router-dom";

import { AppLayout } from "@/AppLayout";
import { FULL_BLEED, MasterDetail } from "@/app/MasterDetail";
import { RouteErrorBoundary } from "@/app/RouteErrorBoundary";
import { RequireAuth } from "@/auth/RequireAuth";
import { useIsDesktop } from "@/lib/use-media-query";

/** Lazily loads a list page and wraps it in the list-and-detail layout. */
function masterDetail(
  base: string,
  placeholder: string,
  loadList: () => Promise<ComponentType>
): () => Promise<{ Component: ComponentType }> {
  return async () => {
    const List = await loadList();
    return {
      Component: function ListWithDetail() {
        return <MasterDetail base={base} list={<List />} placeholder={placeholder} />;
      },
    };
  };
}

/** The phone opens on Today; the desktop keeps opening on the plans. */
function HomeRedirect() {
  return <Navigate to={useIsDesktop() ? "/plans" : "/today"} replace />;
}

export const router = createBrowserRouter([
  {
    path: "login",
    errorElement: <RouteErrorBoundary />,
    lazy: () => import("@/features/auth/LoginView").then((m) => ({ Component: m.LoginView })),
  },
  {
    path: "accept-invite",
    errorElement: <RouteErrorBoundary />,
    lazy: () =>
      import("@/features/auth/AcceptInviteView").then((m) => ({ Component: m.AcceptInviteView })),
  },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppLayout />,
        errorElement: <RouteErrorBoundary />,
        children: [
          { index: true, element: <HomeRedirect /> },
          {
            path: "today",
            lazy: () => import("@/features/today/TodayView").then((m) => ({ Component: m.TodayView })),
          },
          {
            path: "locations",
            lazy: () =>
              import("@/features/locations/LocationsView").then((m) => ({
                Component: m.LocationsView,
              })),
          },
          {
            path: "schedule",
            lazy: () =>
              import("@/features/schedule/SportScheduleView").then((m) => ({
                Component: m.SportScheduleView,
              })),
          },
          {
            path: "settings",
            lazy: () =>
              import("@/features/settings/SettingsView").then((m) => ({
                Component: m.SettingsView,
              })),
          },
          {
            path: "plans",
            handle: FULL_BLEED,
            lazy: masterDetail("/plans", "Pick a plan to edit, or start a new one.", () =>
              import("@/features/plans/PlansView").then((m) => m.PlansView)
            ),
            children: [
              { index: true },
              {
                path: "new",
                lazy: () => import("@/features/plans/PlanBuilder").then((m) => ({ Component: m.PlanBuilder })),
              },
              {
                path: ":planId/edit",
                lazy: () => import("@/features/plans/PlanBuilder").then((m) => ({ Component: m.PlanBuilder })),
              },
            ],
          },
          {
            path: "exercises",
            handle: FULL_BLEED,
            lazy: masterDetail("/exercises", "Pick an exercise to see its details.", () =>
              import("@/features/exercises/ExercisesView").then((m) => m.ExercisesView)
            ),
            children: [
              { index: true },
              {
                path: "new",
                lazy: () => import("@/features/exercises/ExerciseBuilder").then((m) => ({ Component: m.ExerciseBuilder })),
              },
              {
                path: ":exerciseId",
                lazy: () => import("@/features/exercises/ExerciseDetailView").then((m) => ({ Component: m.ExerciseDetailView })),
              },
              {
                path: ":exerciseId/edit",
                lazy: () => import("@/features/exercises/ExerciseBuilder").then((m) => ({ Component: m.ExerciseBuilder })),
              },
            ],
          },
          {
            path: "calendar",
            lazy: () =>
              import("@/features/calendar/CalendarView").then((m) => ({
                Component: m.CalendarView,
              })),
          },
          {
            path: "programs",
            handle: FULL_BLEED,
            lazy: masterDetail("/programs", "Pick a program to edit, or start a new one.", () =>
              import("@/features/programs/ProgramsView").then((m) => m.ProgramsView)
            ),
            children: [
              { index: true },
              {
                path: "new",
                lazy: () => import("@/features/programs/ProgramBuilder").then((m) => ({ Component: m.ProgramBuilder })),
              },
              {
                path: ":programId/edit",
                lazy: () => import("@/features/programs/ProgramBuilder").then((m) => ({ Component: m.ProgramBuilder })),
              },
            ],
          },
          {
            path: "biometrics",
            handle: FULL_BLEED,
            lazy: masterDetail("/biometrics", "Pick an entry to edit, or log a new one.", () =>
              import("@/features/biometrics/BiometricsView").then((m) => m.BiometricsView)
            ),
            children: [
              { index: true },
              {
                path: "new",
                lazy: () => import("@/features/biometrics/BiometricEntryForm").then((m) => ({ Component: m.BiometricEntryForm })),
              },
              {
                path: ":metricId/edit",
                lazy: () => import("@/features/biometrics/BiometricEntryForm").then((m) => ({ Component: m.BiometricEntryForm })),
              },
            ],
          },
          {
            path: "nutrition",
            lazy: () =>
              import("@/features/nutrition/NutritionDashboardView").then((m) => ({
                Component: m.NutritionDashboardView,
              })),
          },
          {
            path: "nutrition/foods",
            handle: FULL_BLEED,
            lazy: masterDetail("/nutrition/foods", "Pick a food to edit, or add a new one.", () =>
              import("@/features/nutrition/FoodsView").then((m) => m.FoodsView)
            ),
            children: [
              { index: true },
              {
                path: "new",
                lazy: () => import("@/features/nutrition/FoodBuilder").then((m) => ({ Component: m.FoodBuilder })),
              },
              {
                path: ":foodId/edit",
                lazy: () => import("@/features/nutrition/FoodBuilder").then((m) => ({ Component: m.FoodBuilder })),
              },
            ],
          },
          {
            path: "nutrition/plans",
            handle: FULL_BLEED,
            lazy: masterDetail("/nutrition/plans", "Pick a nutrition plan to edit, or start a new one.", () =>
              import("@/features/nutrition/NutritionPlansView").then((m) => m.NutritionPlansView)
            ),
            children: [
              { index: true },
              {
                path: "new",
                lazy: () => import("@/features/nutrition/NutritionPlanBuilder").then((m) => ({ Component: m.NutritionPlanBuilder })),
              },
              {
                path: ":planId/edit",
                lazy: () => import("@/features/nutrition/NutritionPlanBuilder").then((m) => ({ Component: m.NutritionPlanBuilder })),
              },
            ],
          },
          {
            path: "nutrition/quick-add",
            lazy: () =>
              import("@/features/nutrition/QuickAddPresetsView").then((m) => ({
                Component: m.QuickAddPresetsView,
              })),
          },
          {
            path: "nutrition/meals",
            handle: FULL_BLEED,
            lazy: masterDetail("/nutrition/meals", "Pick a meal to edit, or log a new one.", () =>
              import("@/features/nutrition/MealLogView").then((m) => m.MealLogView)
            ),
            children: [
              { index: true },
              {
                path: "new",
                lazy: () => import("@/features/nutrition/MealEntryForm").then((m) => ({ Component: m.MealEntryForm })),
              },
              {
                path: ":entryId/edit",
                lazy: () => import("@/features/nutrition/MealEntryForm").then((m) => ({ Component: m.MealEntryForm })),
              },
            ],
          },
          {
            path: "sleep",
            handle: FULL_BLEED,
            lazy: masterDetail("/sleep", "Pick a night to edit, or log a new one.", () =>
              import("@/features/sleep/SleepView").then((m) => m.SleepView)
            ),
            children: [
              { index: true },
              {
                path: "new",
                lazy: () => import("@/features/sleep/SleepEntryForm").then((m) => ({ Component: m.SleepEntryForm })),
              },
              {
                path: ":entryId/edit",
                lazy: () => import("@/features/sleep/SleepEntryForm").then((m) => ({ Component: m.SleepEntryForm })),
              },
            ],
          },
          {
            path: "tokens",
            handle: FULL_BLEED,
            lazy: masterDetail("/tokens", "New token opens the form here.", () =>
              import("@/features/tokens/TokensView").then((m) => m.TokensView)
            ),
            children: [
              { index: true },
              {
                path: "new",
                lazy: () => import("@/features/tokens/TokenCreateForm").then((m) => ({ Component: m.TokenCreateForm })),
              },
            ],
          },
          {
            path: "log/new",
            lazy: () =>
              import("@/features/logs/NewLogView").then((m) => ({ Component: m.NewLogView })),
          },
          {
            path: "activity/new",
            lazy: () =>
              import("@/features/logs/LogActivityView").then((m) => ({
                Component: m.LogActivityView,
              })),
          },
          {
            path: "history",
            handle: FULL_BLEED,
            lazy: masterDetail("/history", "Pick a workout to see what was logged.", () =>
              import("@/features/history/HistoryView").then((m) => m.HistoryView)
            ),
            children: [
              { index: true },
              {
                path: ":logId",
                lazy: () => import("@/features/history/LogDetailView").then((m) => ({ Component: m.LogDetailView })),
              },
            ],
          },
          {
            path: "workout",
            handle: FULL_BLEED,
            lazy: () =>
              import("@/features/active-workout/ActiveWorkoutView").then((m) => ({
                Component: m.ActiveWorkoutView,
              })),
          },
        ],
      },
    ],
  },
]);
