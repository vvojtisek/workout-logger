import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: "btn-primary",
  secondary: "btn-secondary",
  danger: "btn-danger",
  ghost: "btn-ghost",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** Enforces the 48x48px minimum for controls used mid-set. */
  touch?: boolean;
}

export function Button({
  variant = "secondary",
  touch = false,
  className = "",
  type = "button",
  ...rest
}: ButtonProps) {
  const classes = ["btn", VARIANT_CLASS[variant], touch ? "btn-touch" : "", className]
    .filter(Boolean)
    .join(" ");
  return <button type={type} className={classes} {...rest} />;
}

export function Card({ className = "", children }: { className?: string; children: ReactNode }) {
  return <div className={`card ${className}`.trim()}>{children}</div>;
}

/** A section without a box: separated from its neighbours by a hairline. */
export function Block({ className = "", children }: { className?: string; children: ReactNode }) {
  return <div className={`block-flat ${className}`.trim()}>{children}</div>;
}

export function Input({ className = "", inputMode, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  if (inputMode === undefined && rest.type === "number") {
    const fractional = rest.step === "any" || !Number.isInteger(Number(rest.step ?? 1));
    inputMode = fractional ? "decimal" : "numeric";
  }
  return <input className={`input ${className}`.trim()} inputMode={inputMode} {...rest} />;
}

export function PageHeading({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mb-5">
      <h2 className="text-xl font-semibold tracking-tight">{children}</h2>
      {hint ? <p className="mt-1 text-sm text-muted">{hint}</p> : null}
    </div>
  );
}

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="card px-4 py-10 text-center">
      <p className="font-medium">{title}</p>
      {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
    </div>
  );
}

/** Editors keep their domain validation for both the Save button and Enter. */
export function EntryForm({ onSave, id, className, children }: {
  onSave: () => void;
  id?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <form id={id} className={className} noValidate onSubmit={(event) => {
      event.preventDefault();
      onSave();
    }}>
      {children}
    </form>
  );
}
