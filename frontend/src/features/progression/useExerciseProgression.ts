import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { apiFetch } from "@/api/client";
import type { ExerciseStatsResponse, OneRepMaxFormula } from "@/api/types";
import type { StatsRange } from "@/lib/exercise-stats";

export function useExerciseProgression(
  exerciseNames: string[],
  { sessionId, enableFilters = true, enabled = true }: {
    sessionId?: string;
    enableFilters?: boolean;
    enabled?: boolean;
  } = {},
) {
  const [formula, setFormula] = useState<OneRepMaxFormula>("epley");
  const [historyRange, setHistoryRange] = useState<{
    range: StatsRange;
    from?: string;
    to?: string;
  }>({ range: "all" });
  const statsFormula = enableFilters ? formula : "epley";
  const { from, to } = enableFilters ? historyRange : {};
  const { data, status } = useQuery({
    queryKey: ["exercise-stats", sessionId, statsFormula, from, to, ...exerciseNames],
    queryFn: () => {
      const params = new URLSearchParams();
      for (const name of exerciseNames) params.append("name", name);
      if (statsFormula !== "epley") params.set("formula", statsFormula);
      if (from && to) {
        params.set("date_from", from);
        params.set("date_to", to);
      }
      return apiFetch<ExerciseStatsResponse>(`/exercise-stats?${params.toString()}`);
    },
    enabled: enabled && exerciseNames.length > 0,
    staleTime: sessionId ? Infinity : 0,
    retry: false,
  });

  function changeHistoryRange(range: StatsRange) {
    if (range === "all") {
      setHistoryRange({ range });
      return;
    }
    const now = Date.now();
    setHistoryRange({
      range,
      from: new Date(now - Number(range) * 86_400_000).toISOString(),
      to: new Date(now).toISOString(),
    });
  }

  return {
    stats: new Map((data?.items ?? []).map((item) => [item.exercise_name, item])),
    status,
    formula,
    range: historyRange.range,
    onFormulaChange: setFormula,
    onRangeChange: changeHistoryRange,
  };
}
