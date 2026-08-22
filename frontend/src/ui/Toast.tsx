import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

type ToastVariant = "info" | "success" | "error";

interface Toast {
  id: number;
  message: string;
  variant: ToastVariant;
}

let nextId = 1;
let toasts: Toast[] = [];
const listeners = new Set<() => void>();

function emit() {
  for (const fn of listeners) fn();
}

export function toast(message: string, variant: ToastVariant = "info") {
  toasts = [...toasts, { id: nextId++, message, variant }];
  emit();
}

toast.success = (message: string) => toast(message, "success");
toast.error = (message: string) => toast(message, "error");

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
  info: "bg-surface-raised border-border-strong text-text",
  success: "bg-success-soft border-success text-success",
  error: "bg-danger-soft border-danger text-danger",
};

function ToastItem({ item }: { item: Toast }) {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef(0);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
    timerRef.current = window.setTimeout(() => dismiss(item.id), 4000);
    return () => window.clearTimeout(timerRef.current);
  }, [item.id]);

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
      className="fixed bottom-20 right-4 z-[60] flex flex-col gap-2 md:bottom-4"
    >
      {items.map((item) => (
        <ToastItem key={item.id} item={item} />
      ))}
    </div>
  );
}
