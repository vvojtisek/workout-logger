import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { apiFetch, errorMessage } from "@/api/client";
import type { MealEntry, QuickAddPreset } from "@/api/types";
import { presetLabel, presetMealPayload } from "@/lib/quick-add";
import { toast } from "@/ui/Toast";

export const QUICK_ADD_PRESETS_KEY = ["quick-add-presets"] as const;

export function useQuickAddPresets() {
  return useQuery({
    queryKey: QUICK_ADD_PRESETS_KEY,
    queryFn: () => apiFetch<{ items: QuickAddPreset[] }>("/quick-add-presets"),
  });
}

/** One-tap drink buttons: a tap logs the drink now, with an Undo toast. */
export function DrinkQuickAdd({ onChange }: { onChange?: () => void }) {
  const queryClient = useQueryClient();
  const presets = useQuickAddPresets();

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ["meal-entries"] });
    void queryClient.invalidateQueries({ queryKey: ["nutrition-daily"] });
    onChange?.();
  }

  async function undo(entry: MealEntry, name: string) {
    try {
      await apiFetch(`/meal-entries/${entry.id}`, { method: "DELETE" });
      toast(`Removed ${name}`);
      refresh();
    } catch (err) {
      toast.error(`Failed to undo: ${errorMessage(err)}`);
    }
  }

  const log = useMutation({
    mutationFn: (preset: QuickAddPreset) =>
      apiFetch<MealEntry>("/meal-entries", {
        method: "POST",
        body: JSON.stringify(presetMealPayload(preset, new Date())),
      }),
    onSuccess: (entry, preset) => {
      toast.success(`Logged ${preset.name}`, {
        action: { label: "Undo", onClick: () => void undo(entry, preset.name) },
      });
      refresh();
    },
    onError: (err, preset) => toast.error(`Failed to log ${preset.name}: ${errorMessage(err)}`),
  });

  const items = presets.data?.items ?? [];
  if (presets.isSuccess && items.length === 0) {
    return (
      <p className="text-sm text-muted">
        No quick-add drinks. <Link to="/nutrition/quick-add" className="underline">Add one</Link>
      </p>
    );
  }
  if (items.length === 0) return null;

  return (
    <div className="flex flex-col gap-1.5" data-testid="drink-quick-add">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm text-muted">Quick add a drink, one tap logs it.</p>
        <Link to="/nutrition/quick-add" className="shrink-0 text-xs text-muted underline">
          Edit drinks
        </Link>
      </div>
      <div role="group" aria-label="Quick add" className="flex flex-wrap gap-1.5">
        {items.map((preset) => (
          <button
            key={preset.id}
            type="button"
            disabled={log.isPending}
            onClick={() => log.mutate(preset)}
            aria-label={`Quick add ${preset.name}`}
            title={`${preset.quantity} ${preset.unit}`}
            className="min-h-11 rounded-full border border-line bg-elevated px-3.5 py-1.5 text-left text-sm disabled:opacity-50"
          >
            <span className="font-medium">{preset.name}</span>
            <span data-numeric className="ml-1.5 text-muted">
              {presetLabel(preset)}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
