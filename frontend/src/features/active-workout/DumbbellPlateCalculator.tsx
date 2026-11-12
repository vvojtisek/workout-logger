import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";

import type { DumbbellProfile } from "@/api/types";
import { solvePlateLoad } from "@/lib/plate-calculator";
import type { ProfilePlateLoad } from "@/lib/plate-calculator";

const DEFAULT_DUMBBELL: DumbbellProfile = {
  name: "Default inventory",
  handle_kg: 2.5,
  collars_kg: 0,
  plates: [
    { weight_kg: 5, pairs: 2 },
    { weight_kg: 2.5, pairs: 2 },
    { weight_kg: 1.25, pairs: 2 },
    { weight_kg: 0.5, pairs: 2 },
  ],
};

function stackText(load: ProfilePlateLoad): string {
  return load.perSide.length
    ? load.perSide.map(({ weight_kg, count }) => `${count} × ${weight_kg} kg`).join(" + ")
    : "No plates";
}

export function DumbbellPlateCalculator({
  weight,
  profiles,
  selectedProfile,
  onProfileChange,
}: {
  weight: string;
  profiles: DumbbellProfile[];
  selectedProfile: DumbbellProfile | null;
  onProfileChange: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const inventory = selectedProfile ?? DEFAULT_DUMBBELL;
  const load = useMemo(() => open && weight !== "" ? solvePlateLoad(Number(weight), {
    base_kg: inventory.handle_kg,
    collars_kg: inventory.collars_kg,
    plates: inventory.plates,
  }) : null, [inventory, open, weight]);

  return (
    <details className="group rounded-[var(--radius-md)] border border-line" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="flex min-h-touch cursor-pointer list-none items-center justify-between gap-2 px-3 text-sm font-medium">
        Dumbbell plates
        <ChevronDown aria-hidden="true" size={16} className="group-open:rotate-180" />
      </summary>
      <div className="grid gap-1 border-t border-line px-3 py-2 text-sm" aria-live="polite">
        {profiles.length ? (
          <label className="grid gap-1 text-muted" htmlFor="active-dumbbell-profile">
            Dumbbell profile
            <select id="active-dumbbell-profile" className="input" value={selectedProfile?.name ?? "default"}
              onChange={(event) => onProfileChange(event.target.value === "default" ? "" : event.target.value)}>
              <option value="default">Default inventory</option>
              {profiles.map((profile) => <option key={profile.name} value={profile.name}>{profile.name}</option>)}
            </select>
          </label>
        ) : null}
        <p className="text-muted">
          {selectedProfile ? `${selectedProfile.name} · ` : "Default inventory · "}
          Handle {inventory.handle_kg} kg · Collars {inventory.collars_kg} kg
        </p>
        {load?.exact ? (
          <p data-numeric>Per dumbbell: {stackText(load.exact)} on each side</p>
        ) : load ? (
          <>
            <p className="text-warn">{Number(weight)} kg per dumbbell is unavailable with these plates.</p>
            {load.lower ? <p data-numeric>Nearest below: {load.lower.totalKg} kg · {stackText(load.lower)} on each side</p> : null}
            {load.upper ? <p data-numeric>Nearest above: {load.upper.totalKg} kg · {stackText(load.upper)} on each side</p> : null}
          </>
        ) : (
          <p className="text-muted">Enter total kilograms per dumbbell with up to three decimal places.</p>
        )}
      </div>
    </details>
  );
}
