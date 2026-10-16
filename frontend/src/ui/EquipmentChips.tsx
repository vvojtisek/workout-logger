import type { EquipmentTag } from "@/api/types";
import { EQUIPMENT_TAGS } from "@/api/types";
import { EQUIPMENT_LABELS } from "@/lib/equipment";

/** Toggle chips for equipment tags. `hideBodyweight` for places, which
 * always have it. */
export function EquipmentChips({
  label,
  selected,
  onToggle,
  hideBodyweight = false,
}: {
  label: string;
  selected: readonly EquipmentTag[];
  onToggle: (tag: EquipmentTag) => void;
  hideBodyweight?: boolean;
}) {
  const tags = hideBodyweight ? EQUIPMENT_TAGS.filter((tag) => tag !== "bodyweight") : EQUIPMENT_TAGS;
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label={label}>
      {tags.map((tag) => {
        const active = selected.includes(tag);
        return (
          <button
            key={tag}
            type="button"
            aria-pressed={active}
            onClick={() => onToggle(tag)}
            className={`rounded-full border px-3 py-1.5 text-sm font-medium ${
              active
                ? "border-accent bg-accent text-on-accent"
                : "border-line-muted bg-surface text-muted hover:text-main"
            }`}
            style={{ minHeight: "var(--touch)" }}
          >
            {EQUIPMENT_LABELS[tag]}
          </button>
        );
      })}
    </div>
  );
}
