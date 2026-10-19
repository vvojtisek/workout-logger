import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

type ToastVariant = "info" | "success" | "error";

interface ToastAction {
  label: string;
  onClick: () => void;
}

interface ToastOptions {
  action?: ToastAction;
}

interface Toast {
  id: number;
  message: string;
  variant: ToastVariant;
  action?: ToastAction;
}

let nextId = 1;
let toasts: Toast[] = [];
const listeners = new Set<() => void>();

function emit() {
  for (const fn of listeners) fn();
}

export function toast(message: string, variant: ToastVariant = "info", options: ToastOptions = {}) {
  toasts = [...toasts, { id: nextId++, message, variant, action: options.action }];
  emit();
}

toast.success = (message: string, options?: ToastOptions) => toast(message, "success", options);
toast.error = (message: string, options?: ToastOptions) => toast(message, "error", options);

function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

function useToasts(): Toast[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => toasts,
  );
}

const VARIANT_CLASS: Record<ToastVariant, string> = {
  info: "bg-elevated border-line text-main",
  success: "bg-success-soft border-success text-success",
  error: "bg-danger-soft border-danger text-danger",
};

function ToastItem({ item }: { item: Toast }) {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef(0);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
    // A toast with an action (Undo) stays longer so there is time to tap it.
    timerRef.current = window.setTimeout(() => dismiss(item.id), item.action ? 8000 : 4000);
    return () => window.clearTimeout(timerRef.current);
  }, [item.id, item.action]);

  const handleDismiss = useCallback(() => {
    setVisible(false);
    setTimeout(() => dismiss(item.id), 150);
  }, [item.id]);

  return (
    <div
      role="status"
      aria-live="polite"
      className={`rounded-[var(--radius-md)] border px-4 py-3 text-sm font-medium shadow-md transition-all duration-150 ${VARIANT_CLASS[item.variant]} ${visible ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"}`}
    >
      <div className="flex items-center justify-between gap-3">
        <span>{item.message}</span>
        {item.action ? (
          <button
            type="button"
            onClick={() => {
              dismiss(item.id);
              item.action?.onClick();
            }}
            className="shrink-0 rounded-[var(--radius-sm)] px-2 py-1 font-semibold underline underline-offset-2"
          >
            {item.action.label}
          </button>
        ) : null}
        <button
          type="button"
          onClick={handleDismiss}
          className="shrink-0 text-current opacity-60 hover:opacity-100"
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

export function Toaster() {
  const items = useToasts();
  if (items.length === 0) return null;
  return (
    <div
      aria-label="Notifications"
      className="fixed bottom-20 right-4 z-[60] flex flex-col gap-2 lg:bottom-4"
    >
      {items.map((item) => (
        <ToastItem key={item.id} item={item} />
      ))}
    </div>
  );
}
