import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";

import type { PlateProfile } from "@/api/types";
import { DEFAULT_BARBELL, solvePlateLoad } from "@/lib/plate-calculator";
import type { PlateLoad } from "@/lib/plate-calculator";

function plateStackText(load: PlateLoad): string {
  return load.perSide.length
    ? load.perSide.map(({ weight_kg, count }) => `${count} × ${weight_kg} kg`).join(" + ")
    : "No plates";
}

export function BarbellPlateCalculator({
  weight,
  profiles,
  selectedProfile,
  onProfileChange,
}: {
  weight: string;
  profiles: PlateProfile[];
  selectedProfile: PlateProfile | null;
  onProfileChange: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const inventory = selectedProfile ? {
    base_kg: selectedProfile.bar_kg,
    collars_kg: selectedProfile.collars_kg,
    plates: selectedProfile.plates,
  } : DEFAULT_BARBELL;
  const load = useMemo(() => open && weight !== "" ? solvePlateLoad(Number(weight), inventory) : null,
    [open, weight, inventory]);

  return (
    <details className="group rounded-[var(--radius-md)] border border-line" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="flex min-h-touch cursor-pointer list-none items-center justify-between gap-2 px-3 text-sm font-medium">
        Barbell plates
        <ChevronDown aria-hidden="true" size={16} className="group-open:rotate-180" />
      </summary>
      <div className="grid gap-1 border-t border-line px-3 py-2 text-sm" aria-live="polite">
        {profiles.length ? (
          <label className="grid gap-1 text-muted" htmlFor="active-barbell-profile">
            Bar profile
            <select id="active-barbell-profile" className="input" value={selectedProfile?.name ?? "default"}
              onChange={(event) => onProfileChange(event.target.value === "default" ? "" : event.target.value)}>
              <option value="default">Default inventory</option>
              {profiles.map((profile) => <option key={profile.name} value={profile.name}>{profile.name}</option>)}
            </select>
          </label>
        ) : null}
        <p className="text-muted">
          {selectedProfile ? `${selectedProfile.name} · ` : "Default inventory · "}
          Bar {inventory.base_kg} kg · Collars {inventory.collars_kg} kg
        </p>
        {load?.exact ? (
          <p data-numeric>Per side: {plateStackText(load.exact)}</p>
        ) : load ? (
          <>
            <p className="text-warn">{Number(weight)} kg is unavailable with these plates.</p>
            {load.lower ? <p data-numeric>Nearest below: {load.lower.totalKg} kg · {plateStackText(load.lower)} per side</p> : null}
            {load.upper ? <p data-numeric>Nearest above: {load.upper.totalKg} kg · {plateStackText(load.upper)} per side</p> : null}
          </>
        ) : (
          <p className="text-muted">Enter total kilograms with up to three decimal places.</p>
        )}
      </div>
    </details>
  );
}
