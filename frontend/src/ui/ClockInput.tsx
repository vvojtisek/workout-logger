import { Clock } from "lucide-react";
import { useId, useState } from "react";

import { Button, Input } from "@/ui";
import { Dialog } from "@/ui/Dialog";

const options = (count: number) =>
  Array.from({ length: count }, (_, i) => String(i).padStart(2, "0"));
const hours = options(24);
const minutes = options(60);
const clockPattern = "([01]?[0-9]|2[0-3]):?[0-5][0-9]";

/** Accept 937, 0937, 9:37 and 09:37. Never infer a day period. */
export function canonicalClock(text: string): string | null {
  const match = /^([01]?\d|2[0-3]):?([0-5]\d)$/.exec(text);
  return match ? `${match[1].padStart(2, "0")}:${match[2]}` : null;
}

interface Props {
  id?: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  invalid?: boolean;
  describedBy?: string;
}

export function ClockInput({ id, label, value, onChange, required, invalid, describedBy }: Props) {
  const [typing, setTyping] = useState<string | null>(null);
  const [selection, setSelection] = useState<string[] | null>(null);
  const unique = useId();
  function openPicker() {
    const now = new Date();
    setSelection(
      canonicalClock(value)?.split(":") ?? [hours[now.getHours()], minutes[now.getMinutes()]],
    );
  }

  return (
    <div className="flex min-w-0 items-center rounded-[var(--radius-sm)] border border-line bg-input">
      <Input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        spellCheck={false}
        required={required}
        aria-label={label}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        placeholder="HH:mm"
        title="24-hour time, for example 19:30 or 1930"
        pattern={clockPattern}
        value={typing ?? value}
        className="min-w-0 flex-1 border-0 px-2 text-center text-base tabular-nums"
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => {
          const raw = event.target.value;
          setTyping(raw);
          onChange(canonicalClock(raw) ?? raw);
        }}
        onBlur={() => setTyping(null)}
      />
      <button
        type="button"
        aria-label={`Choose ${label.toLowerCase()}`}
        aria-haspopup="dialog"
        className="grid size-11 shrink-0 place-items-center rounded-[var(--radius-sm)] text-accent"
        onClick={openPicker}
      >
        <Clock size={18} aria-hidden="true" />
      </button>
      <Dialog
        open={selection !== null}
        onClose={() => setSelection(null)}
        title={`Choose ${label.toLowerCase()}`}
      >
        {selection && (
          <>
            <div className="grid grid-cols-2 gap-3">
              {([hours, minutes] as const).map((choices, index) => (
                <div key={index}>
                  <label htmlFor={`${unique}-${index}`} className="field-label">
                    {index === 0 ? "Hour" : "Minute"}
                  </label>
                  <select
                    id={`${unique}-${index}`}
                    className="input text-base tabular-nums"
                    value={selection[index]}
                    onChange={(e) =>
                      setSelection(
                        index === 0
                          ? [e.target.value, selection[1]]
                          : [selection[0], e.target.value],
                      )
                    }
                  >
                    {choices.map((item) => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <Button onClick={() => setSelection(null)}>Cancel</Button>
              <Button
                variant="primary"
                onClick={() => {
                  onChange(selection.join(":"));
                  setSelection(null);
                }}
              >
                Set time
              </Button>
            </div>
          </>
        )}
      </Dialog>
    </div>
  );
}
