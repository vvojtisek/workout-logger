import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { apiFetch, errorMessage } from "@/api/client";
import type { QuickAddPreset } from "@/api/types";
import { ConfirmDialog } from "@/ui/Dialog";
import { toast } from "@/ui/Toast";
import { Button, Card, Input, PageHeading } from "@/ui";
import { QUICK_ADD_PRESETS_KEY, useQuickAddPresets } from "./DrinkQuickAdd";

const FIELDS = [
  { key: "quantity", label: "Volume", unitKey: "unit" },
  { key: "energy_kcal", label: "Energy (kcal)" },
  { key: "protein_g", label: "Protein (g)" },
  { key: "carbohydrate_g", label: "Carbs (g)" },
  { key: "fat_g", label: "Fat (g)" },
] as const;

type NumberField = (typeof FIELDS)[number]["key"];

interface Draft {
  name: string;
  unit: string;
  values: Record<NumberField, string>;
}

function draftFrom(preset: QuickAddPreset | null): Draft {
  return {
    name: preset?.name ?? "",
    unit: preset?.unit ?? "ml",
    values: {
      quantity: preset ? String(preset.quantity) : "",
      energy_kcal: preset ? String(preset.energy_kcal) : "",
      protein_g: preset ? String(preset.protein_g) : "0",
      carbohydrate_g: preset ? String(preset.carbohydrate_g) : "0",
      fat_g: preset ? String(preset.fat_g) : "0",
    },
  };
}

function PresetForm({
  preset,
  position,
  onSaved,
  onDelete,
}: {
  preset: QuickAddPreset | null;
  position: number;
  onSaved: () => void;
  onDelete?: () => void;
}) {
  const [draft, setDraft] = useState(() => draftFrom(preset));
  const [saving, setSaving] = useState(false);
  const idBase = preset ? `preset-${preset.id}` : "preset-new";

  async function save() {
    const numbers = Object.fromEntries(
      FIELDS.map(({ key }) => [key, Number.parseFloat(draft.values[key].replace(",", "."))]),
    ) as Record<NumberField, number>;
    if (!draft.name.trim() || Object.values(numbers).some((value) => Number.isNaN(value))) {
      toast.error("Fill in a name and every number");
      return;
    }
    setSaving(true);
    try {
      const body = JSON.stringify({
        name: draft.name.trim(),
        unit: draft.unit.trim() || "ml",
        fiber_g: preset?.fiber_g ?? null,
        position: preset?.position ?? position,
        ...numbers,
      });
      await apiFetch(preset ? `/quick-add-presets/${preset.id}` : "/quick-add-presets", {
        method: preset ? "PUT" : "POST",
        body,
      });
      toast.success(`Saved ${draft.name.trim()}`);
      if (!preset) setDraft(draftFrom(null));
      onSaved();
    } catch (err) {
      toast.error(`Failed to save: ${errorMessage(err)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3 p-4">
      <form
        aria-label={preset ? `Drink ${preset.name}` : "New drink"}
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div>
          <label className="field-label" htmlFor={`${idBase}-name`}>
            Name
          </label>
          <Input
            id={`${idBase}-name`}
            value={draft.name}
            maxLength={100}
            placeholder={preset ? undefined : "e.g. Espresso"}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {FIELDS.map(({ key, label }) => (
            <div key={key}>
              <label className="field-label" htmlFor={`${idBase}-${key}`}>
                {key === "quantity" ? `${label} (${draft.unit || "ml"})` : label}
              </label>
              <Input
                id={`${idBase}-${key}`}
                inputMode="decimal"
                value={draft.values[key]}
                onChange={(e) => setDraft({ ...draft, values: { ...draft.values, [key]: e.target.value } })}
              />
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="primary" disabled={saving}>
            {preset ? "Save" : "Add drink"}
          </Button>
          {onDelete ? (
            <Button variant="ghost" onClick={onDelete}>
              Delete
            </Button>
          ) : null}
        </div>
      </form>
    </Card>
  );
}

export function QuickAddPresetsView() {
  const queryClient = useQueryClient();
  const presets = useQuickAddPresets();
  const [deleteTarget, setDeleteTarget] = useState<QuickAddPreset | null>(null);
  const items = presets.data?.items ?? [];
  const refresh = () => void queryClient.invalidateQueries({ queryKey: QUICK_ADD_PRESETS_KEY });

  async function deletePreset(preset: QuickAddPreset) {
    try {
      await apiFetch(`/quick-add-presets/${preset.id}`, { method: "DELETE" });
      toast.success(`Deleted ${preset.name}`);
      refresh();
    } catch (err) {
      toast.error(`Failed to delete: ${errorMessage(err)}`);
    }
  }

  return (
    <section id="quick-add-presets-view" className="flex flex-col gap-3">
      <PageHeading hint="One-tap drinks in the food logger. Values are for the whole cup. Changing one never changes drinks already logged.">
        Quick-add drinks
      </PageHeading>
      {presets.isError ? (
        <p className="text-sm text-danger">Failed to load drinks: {errorMessage(presets.error)}</p>
      ) : null}
      {items.map((preset) => (
        // Keyed on updated_at so a saved preset reloads its form from the server.
        <PresetForm
          key={`${preset.id}-${preset.updated_at}`}
          preset={preset}
          position={preset.position}
          onSaved={refresh}
          onDelete={() => setDeleteTarget(preset)}
        />
      ))}
      {presets.isSuccess ? (
        <PresetForm
          preset={null}
          position={items.reduce((max, preset) => Math.max(max, preset.position + 1), 0)}
          onSaved={refresh}
        />
      ) : null}

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) void deletePreset(deleteTarget);
        }}
        title="Delete drink"
        message="Remove this quick-add drink? Drinks already logged stay in your history."
        confirmLabel="Delete"
      />
    </section>
  );
}
