import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { IconLoader2 } from "@tabler/icons-react";

function joinClasses(
  ...classes: Array<string | false | null | undefined>
): string {
  return classes.filter(Boolean).join(" ");
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export function Button({
  className,
  variant = "primary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  const variants: Record<ButtonVariant, string> = {
    primary:
      "border-ctp-lavender bg-ctp-lavender text-ctp-crust hover:bg-ctp-blue hover:border-ctp-blue",
    secondary:
      "border-ctp-surface-1 bg-ctp-surface-0 text-ctp-text hover:border-ctp-lavender",
    ghost:
      "border-transparent bg-transparent text-ctp-subtext-1 hover:bg-ctp-surface-0 hover:text-ctp-text",
    danger:
      "border-ctp-red bg-ctp-red text-ctp-crust hover:bg-ctp-maroon hover:border-ctp-maroon",
  };

  return (
    <button
      className={joinClasses(
        "inline-flex min-h-10 items-center justify-center gap-2 rounded border px-4 py-2 text-sm font-semibold transition-colors",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="text-xs text-ctp-overlay-1">{hint}</span> : null}
    </label>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input className={joinClasses("control", props.className)} {...props} />
  );
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={joinClasses("control", props.className)} {...props} />
  );
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={joinClasses(
        "control min-h-36 resize-y font-mono text-sm",
        props.className,
      )}
      {...props}
    />
  );
}

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={joinClasses(
        "rounded border border-ctp-surface-1 bg-ctp-mantle",
        className,
      )}
    >
      {children}
    </section>
  );
}

export function Alert({
  tone = "info",
  children,
}: {
  tone?: "info" | "success" | "warning" | "error";
  children: ReactNode;
}) {
  const tones = {
    info: "border-ctp-blue/50 bg-ctp-blue/10 text-ctp-blue",
    success: "border-ctp-green/50 bg-ctp-green/10 text-ctp-green",
    warning: "border-ctp-yellow/50 bg-ctp-yellow/10 text-ctp-yellow",
    error: "border-ctp-red/50 bg-ctp-red/10 text-ctp-red",
  };
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={joinClasses("rounded border px-4 py-3 text-sm", tones[tone])}
    >
      {children}
    </div>
  );
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <div
      className="flex items-center gap-2 py-6 text-sm text-ctp-subtext-0"
      role="status"
    >
      <IconLoader2 className="size-5 animate-spin" aria-hidden="true" />
      {label}
    </div>
  );
}

export function PageHeading({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 border-b border-ctp-surface-0 pb-5 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h1 className="font-mono text-2xl font-bold text-ctp-text">{title}</h1>
        {description ? (
          <p className="mt-2 max-w-2xl text-sm leading-6 text-ctp-subtext-0">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 gap-2">{actions}</div> : null}
    </header>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <p className="rounded border border-dashed border-ctp-surface-1 px-4 py-10 text-center text-sm text-ctp-overlay-1">
      {children}
    </p>
  );
}
