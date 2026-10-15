// Plain-language meanings for the numeric scales people rate things on.
// The stored and submitted values stay the integers; these are display only.

export interface Scale {
  max: number;
  /** Label for each whole value from 1 to max. */
  labels: Record<number, string>;
  /** One line on how to read the scale. */
  hint: string;
}

export const SLEEP_QUALITY_SCALE: Scale = {
  max: 5,
  labels: { 1: "Very poor", 2: "Poor", 3: "Fair", 4: "Good", 5: "Excellent" },
  hint: "How rested you felt. Higher is better.",
};

export const FEELING_SCALE: Scale = {
  max: 5,
  labels: { 1: "Very poor", 2: "Poor", 3: "OK", 4: "Good", 5: "Great" },
  hint: "How you felt overall. Higher is better.",
};

/** Session RPE on the CR-10 scale; the in-between values are filled in so every value has a name. */
export const EFFORT_SCALE: Scale = {
  max: 10,
  labels: {
    1: "Very easy",
    2: "Easy",
    3: "Moderate",
    4: "Somewhat hard",
    5: "Hard",
    6: "Hard to very hard",
    7: "Very hard",
    8: "Very, very hard",
    9: "Near maximal",
    10: "Maximal",
  },
  hint: "How hard the whole session was. Higher means harder, not better.",
};

export function scaleLabel(scale: Scale, value: number): string {
  return scale.labels[value] ?? "";
}

/** "4/5 (Good)"; an average gets "about" the nearest label; unknown values get no label. */
export function scaleText(scale: Scale, value: number | null | undefined): string {
  if (value == null) return "";
  const whole = Number.isInteger(value);
  const shown = whole ? String(value) : value.toFixed(1);
  const label = scaleLabel(scale, Math.round(value));
  if (!label) return `${shown}/${scale.max}`;
  return `${shown}/${scale.max} (${whole ? "" : "about "}${label})`;
}

export function scaleOptionText(scale: Scale, value: number): string {
  const label = scaleLabel(scale, value);
  return label ? `${value} · ${label}` : String(value);
}

export function scaleValues(scale: Scale): number[] {
  return Array.from({ length: scale.max }, (_, index) => index + 1);
}

/** Reps in reserve: how many more reps the set could have had. */
export function rirMeaning(rir: number | null | undefined): string {
  if (rir == null) return "";
  if (rir === 0) return "no reps left (failure)";
  return `${rir} more rep${rir === 1 ? "" : "s"} possible`;
}

export const RIR_HINT =
  "RIR = reps in reserve: how many more reps you could have done. 0 means failure; 2–3 is the usual target.";

/** Session-RPE training load: effort (1-10) times minutes. */
export const TRAINING_LOAD_HINT = "Training load = effort × minutes. Higher means more total stress.";
