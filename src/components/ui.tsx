import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TableHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { IconLoader2 } from "@tabler/icons-react";

function joinClasses(
  ...classes: Array<string | false | null | undefined>
): string {
  return classes.filter(Boolean).join(" ");
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    "border-ctp-lavender bg-ctp-lavender text-ctp-crust hover:border-ctp-blue hover:bg-ctp-blue",
  secondary:
    "border-ctp-surface1 bg-ctp-surface0 text-ctp-text hover:border-ctp-lavender",
  ghost:
    "border-transparent bg-transparent text-ctp-subtext1 hover:bg-ctp-surface0 hover:text-ctp-text",
  danger:
    "border-ctp-red bg-ctp-red text-ctp-crust hover:border-ctp-maroon hover:bg-ctp-maroon",
};

export function buttonClasses(
  variant: ButtonVariant = "primary",
  className?: string,
): string {
  return joinClasses(
    "inline-flex min-h-10 items-center justify-center gap-2 rounded border px-4 py-2 text-sm font-semibold transition-colors",
    buttonVariants[variant],
    className,
  );
}

export function Button({
  className,
  variant = "primary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return <button className={buttonClasses(variant, className)} {...props} />;
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
    <label className="grid gap-2">
      <span className="text-sm font-semibold text-ctp-subtext1">{label}</span>
      {children}
      {hint ? <span className="text-xs text-ctp-overlay1">{hint}</span> : null}
    </label>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={joinClasses(
        "w-full rounded border border-ctp-surface1 bg-ctp-mantle px-3 py-3 text-ctp-text placeholder:text-ctp-overlay0 hover:border-ctp-overlay0 focus:border-ctp-lavender focus:outline-2 focus:outline-offset-0 focus:outline-ctp-lavender/30",
        props.className,
      )}
      {...props}
    />
  );
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={joinClasses(
        "w-full rounded border border-ctp-surface1 bg-ctp-mantle px-3 py-3 text-ctp-text hover:border-ctp-overlay0 focus:border-ctp-lavender focus:outline-2 focus:outline-offset-0 focus:outline-ctp-lavender/30",
        props.className,
      )}
      {...props}
    />
  );
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={joinClasses(
        "min-h-36 w-full resize-y rounded border border-ctp-surface1 bg-ctp-mantle px-3 py-3 font-mono text-sm text-ctp-text placeholder:text-ctp-overlay0 hover:border-ctp-overlay0 focus:border-ctp-lavender focus:outline-2 focus:outline-offset-0 focus:outline-ctp-lavender/30",
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
    <div
      className={joinClasses(
        "rounded border border-ctp-surface1 bg-ctp-mantle",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CodeBlock({
  className,
  ...props
}: HTMLAttributes<HTMLPreElement>) {
  return (
    <pre
      className={joinClasses(
        "overflow-auto rounded border border-ctp-surface0 bg-ctp-crust p-4 font-mono text-xs leading-6 whitespace-pre-wrap text-ctp-green",
        className,
      )}
      {...props}
    />
  );
}

export function DataTable({
  className,
  ...props
}: TableHTMLAttributes<HTMLTableElement>) {
  return (
    <table
      className={joinClasses(
        "w-full border-collapse text-left align-top text-sm [&_td]:border-b [&_td]:border-ctp-surface0 [&_td]:px-2 [&_td]:py-3 [&_th]:border-b [&_th]:border-ctp-surface0 [&_th]:px-2 [&_th]:py-3 [&_th]:text-xs [&_th]:font-semibold [&_th]:tracking-wide [&_th]:text-ctp-subtext0 [&_th]:uppercase",
        className,
      )}
      {...props}
    />
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
  if (tone === "error") {
    return (
      <div
        role="alert"
        className={joinClasses("rounded border px-4 py-3 text-sm", tones[tone])}
      >
        {children}
      </div>
    );
  }
  return (
    <output
      className={joinClasses("rounded border px-4 py-3 text-sm", tones[tone])}
    >
      {children}
    </output>
  );
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <output className="flex items-center gap-2 py-6 text-sm text-ctp-subtext0">
      <IconLoader2 className="size-5 animate-spin" aria-hidden="true" />
      {label}
    </output>
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
    <header className="flex flex-col gap-4 border-b border-ctp-surface0 pb-5 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h1 className="font-mono text-2xl font-bold text-ctp-text">{title}</h1>
        {description ? (
          <p className="mt-2 max-w-2xl text-sm leading-6 text-ctp-subtext0">
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
    <p className="rounded border border-dashed border-ctp-surface1 px-4 py-10 text-center text-sm text-ctp-overlay1">
      {children}
    </p>
  );
}
