import { useEffect, useId, useRef } from "react";
import { Link } from "react-router-dom";

import { WORKOUT_PATH } from "@/lib/navigation";

interface Entry {
  to: string;
  title: string;
  hint: string;
}

/** The phone's quick-entry sheet behind the central Log button. Each entry is
 * a link, so it closes by navigating; the backdrop and Escape close it too. */
export function LogSheet({
  open,
  onClose,
  sessionActive,
}: {
  open: boolean;
  onClose: () => void;
  sessionActive: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const hintPrefix = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  const entries: Entry[] = [
    { to: "/nutrition/meals/new", title: "Food", hint: "A meal or a snack" },
    { to: "/sleep/new", title: "Sleep", hint: "With all the details" },
    { to: "/activity/new", title: "Activity", hint: "Hockey, swim, ride, hike" },
    { to: "/biometrics/new", title: "Weight", hint: "And body measurements" },
    sessionActive
      ? { to: WORKOUT_PATH, title: "Resume workout", hint: "Back to the live session" }
      : { to: "/plans", title: "Start a workout", hint: "From one of your plans" },
    { to: "/log/new", title: "Past workout", hint: "One you already finished" },
  ];

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(event) => {
        // A click on the backdrop lands on the dialog element itself.
        if (event.target === event.currentTarget) onClose();
      }}
      aria-labelledby={titleId}
      className="mx-0 mt-auto mb-0 w-full max-w-none rounded-t-[var(--radius-lg)] border border-line-muted bg-surface p-0 text-main shadow-elevated backdrop:bg-black/50"
    >
      <div className="flex flex-col gap-3 px-4 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <h2 id={titleId} className="text-sm font-semibold text-muted">
          Log
        </h2>
        <div className="grid grid-cols-2 gap-2">
          {entries.map((entry, index) => (
            <Link
              key={entry.to}
              to={entry.to}
              onClick={onClose}
              aria-describedby={`${hintPrefix}-${index}`}
              className="flex min-h-16 flex-col justify-center gap-0.5 rounded-[var(--radius-md)] border border-line bg-elevated px-3 py-2.5"
            >
              <span className="text-base font-semibold">{entry.title}</span>
              <span id={`${hintPrefix}-${index}`} aria-hidden="true" className="text-xs text-muted">
                {entry.hint}
              </span>
            </Link>
          ))}
        </div>
      </div>
    </dialog>
  );
}
