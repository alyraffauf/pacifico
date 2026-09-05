import type {
  ButtonHTMLAttributes,
  ComponentPropsWithRef,
  HTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TableHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { useId } from "react";
import { IconLoader2 } from "@tabler/icons-react";

function joinClasses(
  ...classes: Array<string | false | null | undefined>
): string {
  return classes.filter(Boolean).join(" ");
}

type ButtonVariant =
  "primary" | "secondary" | "ghost" | "danger" | "dangerOutline";
type ButtonSize = "default" | "compact";

const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    "border-ctp-lavender bg-ctp-lavender text-ctp-crust hover:border-ctp-blue hover:bg-ctp-blue",
  secondary:
    "border-ctp-surface1 bg-ctp-surface0 text-ctp-text hover:border-ctp-lavender",
  ghost:
    "border-transparent bg-transparent text-ctp-subtext1 hover:bg-ctp-surface0 hover:text-ctp-text",
  danger:
    "border-ctp-red bg-ctp-red text-ctp-crust hover:border-ctp-maroon hover:bg-ctp-maroon",
  dangerOutline:
    "border-ctp-red/60 bg-transparent text-ctp-red hover:border-ctp-red hover:bg-ctp-red/10",
};

export function buttonClasses(
  variant: ButtonVariant = "primary",
  className?: string,
  size: ButtonSize = "default",
): string {
  return joinClasses(
    "inline-flex items-center justify-center gap-2 rounded border font-semibold transition-colors",
    size === "compact"
      ? "min-h-9 px-3 py-1.5 text-xs"
      : "min-h-10 px-4 py-2 text-sm",
    buttonVariants[variant],
    className,
  );
}

export function Button({
  className,
  variant = "primary",
  size = "default",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return (
    <button className={buttonClasses(variant, className, size)} {...props} />
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
    <label className="grid gap-2">
      <span className="text-sm font-semibold text-ctp-subtext1">{label}</span>
      {children}
      {hint ? <span className="text-xs text-ctp-overlay1">{hint}</span> : null}
    </label>
  );
}

export function Input({ className, ...props }: ComponentPropsWithRef<"input">) {
  return (
    <input
      className={joinClasses(
        "w-full rounded border border-ctp-surface1 bg-ctp-mantle px-3 py-3 text-ctp-text placeholder:text-ctp-overlay0 hover:border-ctp-overlay0 focus:border-ctp-lavender focus:outline-2 focus:outline-offset-0 focus:outline-ctp-lavender/30",
        className,
      )}
      {...props}
    />
  );
}

export function Select({
  className,
  compact = false,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { compact?: boolean }) {
  return (
    <select
      className={joinClasses(
        "w-full rounded border border-ctp-surface1 bg-ctp-mantle px-3 text-ctp-text hover:border-ctp-overlay0 focus:border-ctp-lavender focus:outline-2 focus:outline-offset-0 focus:outline-ctp-lavender/30",
        compact ? "py-2 text-sm" : "py-3",
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={joinClasses(
        "min-h-36 w-full resize-y rounded border border-ctp-surface1 bg-ctp-mantle px-3 py-3 font-mono text-sm text-ctp-text placeholder:text-ctp-overlay0 hover:border-ctp-overlay0 focus:border-ctp-lavender focus:outline-2 focus:outline-offset-0 focus:outline-ctp-lavender/30",
        className,
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

export function SettingsSection({
  title,
  description,
  tone = "default",
  children,
}: {
  title: string;
  description?: string;
  tone?: "default" | "danger";
  children: ReactNode;
}) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId}>
      <header className="mb-2 px-1">
        <h2
          id={titleId}
          className={joinClasses(
            "font-mono text-sm font-semibold",
            tone === "danger" ? "text-ctp-red" : "text-ctp-text",
          )}
        >
          {title}
        </h2>
        {description ? (
          <p className="mt-1 text-xs leading-5 text-ctp-subtext0">
            {description}
          </p>
        ) : null}
      </header>
      <div className="divide-y divide-ctp-surface0 overflow-hidden rounded border border-ctp-surface1 bg-ctp-mantle">
        {children}
      </div>
    </section>
  );
}

export function SettingsRow({
  label,
  value,
  description,
  action,
  children,
  technical = false,
}: {
  label: string;
  value?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  technical?: boolean;
}) {
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 px-4 py-3.5 sm:grid-cols-[8.5rem_minmax(0,1fr)_auto] sm:items-center sm:px-5">
      <div className="text-sm font-medium text-ctp-subtext0">{label}</div>
      <div className="col-start-1 min-w-0 sm:col-start-2 sm:row-start-1">
        {value ? (
          <div
            className={joinClasses(
              "text-sm break-words text-ctp-text",
              technical && "font-mono",
            )}
          >
            {value}
          </div>
        ) : null}
        {description ? (
          <div className="mt-1 text-xs leading-5 text-ctp-overlay1">
            {description}
          </div>
        ) : null}
      </div>
      {action ? (
        <div className="col-start-2 row-span-2 row-start-1 shrink-0 self-center sm:col-start-3 sm:row-span-1">
          {action}
        </div>
      ) : null}
      {children ? (
        <div className="col-span-2 mt-3 min-w-0 rounded border border-ctp-surface0 bg-ctp-crust/30 p-4 sm:col-start-2 sm:col-end-4">
          {children}
        </div>
      ) : null}
    </div>
  );
}

export function SegmentedControl<Value extends string>({
  label,
  value,
  choices,
  disabled,
  onChange,
}: {
  label: string;
  value: Value;
  choices: ReadonlyArray<{ value: Value; label: string }>;
  disabled?: boolean;
  onChange: (value: Value) => void;
}) {
  return (
    <fieldset className="inline-flex max-w-full rounded border border-ctp-surface1 bg-ctp-crust p-1">
      <legend className="sr-only">{label}</legend>
      {choices.map((choice) => (
        <button
          key={choice.value}
          type="button"
          aria-pressed={choice.value === value}
          disabled={disabled}
          className={joinClasses(
            "min-h-9 rounded px-3 py-1.5 font-mono text-xs font-semibold transition-colors",
            choice.value === value
              ? "bg-ctp-surface1 text-ctp-text"
              : "text-ctp-subtext0 hover:bg-ctp-surface0 hover:text-ctp-text",
          )}
          onClick={() => onChange(choice.value)}
        >
          {choice.label}
        </button>
      ))}
    </fieldset>
  );
}

export function SettingsSwitch({
  label,
  checked,
  disabled,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      disabled={disabled}
      className={joinClasses(
        "relative inline-flex h-6 w-11 rounded-full border transition-colors",
        checked
          ? "border-ctp-lavender bg-ctp-lavender"
          : "border-ctp-overlay0 bg-ctp-surface0",
      )}
      onClick={() => onCheckedChange(!checked)}
    >
      <span
        aria-hidden="true"
        className={joinClasses(
          "absolute top-0.5 size-[1.125rem] rounded-full bg-ctp-crust shadow-sm transition-transform",
          checked ? "translate-x-[1.25rem]" : "translate-x-0.5",
        )}
      />
    </button>
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
