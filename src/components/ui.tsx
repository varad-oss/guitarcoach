"use client";

import Link from "next/link";
import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
import { Icon, type IconName } from "./icons";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const variantClass: Record<Variant, string> = {
  primary: "bg-accent text-accent-ink hover:bg-accent-strong font-semibold",
  secondary: "bg-surface-2 text-text border border-line hover:bg-surface-3",
  ghost: "text-text-2 hover:text-text hover:bg-surface-2",
  danger: "bg-bad-wash text-bad border border-bad/40 hover:bg-bad/20",
};
const sizeClass: Record<Size, string> = {
  sm: "h-8 px-3 text-sm gap-1.5 rounded-lg",
  md: "h-10 px-4 text-[15px] gap-2 rounded-lg",
  lg: "h-12 px-5 text-base gap-2.5 rounded-xl",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: IconName;
  iconRight?: IconName;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", icon, iconRight, className, children, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx(
        "inline-flex items-center justify-center whitespace-nowrap transition-colors disabled:opacity-45 disabled:pointer-events-none select-none",
        variantClass[variant],
        sizeClass[size],
        className,
      )}
      {...rest}
    >
      {icon && <Icon name={icon} size={size === "lg" ? 20 : size === "sm" ? 15 : 18} />}
      {children}
      {iconRight && <Icon name={iconRight} size={size === "sm" ? 15 : 18} />}
    </button>
  );
});

export function ButtonLink({
  href,
  variant = "secondary",
  size = "md",
  icon,
  className,
  children,
  ...rest
}: { href: string; variant?: Variant; size?: Size; icon?: IconName; className?: string; children: ReactNode } & Omit<
  React.AnchorHTMLAttributes<HTMLAnchorElement>,
  "href"
>) {
  return (
    <Link
      href={href}
      className={cx("inline-flex items-center justify-center whitespace-nowrap transition-colors", variantClass[variant], sizeClass[size], className)}
      {...rest}
    >
      {icon && <Icon name={icon} size={size === "lg" ? 20 : 18} />}
      {children}
    </Link>
  );
}

export function IconButton({
  icon,
  label,
  active,
  size = 40,
  className,
  ...rest
}: { icon: IconName; label: string; active?: boolean; size?: number } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={cx(
        "inline-flex items-center justify-center rounded-lg transition-colors disabled:opacity-40",
        active ? "bg-accent-wash text-accent" : "text-text-2 hover:text-text hover:bg-surface-2",
        className,
      )}
      style={{ width: size, height: size }}
      {...rest}
    >
      <Icon name={icon} size={Math.round(size * 0.5)} />
    </button>
  );
}

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm text-text-2">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-text-3">{hint}</p>}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return (
    <input
      ref={ref}
      className={cx(
        "h-10 rounded-lg bg-sunk border border-line px-3 text-text placeholder:text-text-3 focus:border-accent focus:outline-none",
        className,
      )}
      {...rest}
    />
  );
});

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cx("h-10 rounded-lg bg-sunk border border-line px-2.5 text-text focus:border-accent focus:outline-none", className)}
      {...rest}
    >
      {children}
    </select>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
  id,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
  id?: string;
}) {
  const auto = useId();
  const tid = id ?? auto;
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <label htmlFor={tid} className="text-[15px] text-text cursor-pointer">
          {label}
        </label>
        {description && <p className="text-sm text-text-3">{description}</p>}
      </div>
      <button
        id={tid}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cx(
          "relative shrink-0 w-11 h-6 rounded-full transition-colors border",
          checked ? "bg-accent border-accent" : "bg-surface-3 border-line",
        )}
      >
        <span
          className={cx(
            "absolute top-0.5 left-0.5 h-[18px] w-[18px] rounded-full transition-transform",
            checked ? "translate-x-5 bg-accent-ink" : "bg-text-2",
          )}
        />
      </button>
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  size = "md",
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string; icon?: IconName }>;
  label: string;
  size?: "sm" | "md";
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex self-start flex-wrap rounded-lg bg-sunk border border-line p-0.5 gap-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            "inline-flex items-center gap-1.5 rounded-md transition-colors",
            size === "sm" ? "h-7 px-2.5 text-sm" : "h-9 px-3.5 text-[15px]",
            value === o.value ? "bg-surface-3 text-text" : "text-text-2 hover:text-text",
          )}
        >
          {o.icon && <Icon name={o.icon} size={16} />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Pill({ tone = "neutral", children, title }: { tone?: "neutral" | "good" | "warn" | "bad" | "info"; children: ReactNode; title?: string }) {
  const tones = {
    neutral: "bg-surface-2 text-text-2 border-line",
    good: "bg-accent-wash text-accent border-accent/30",
    warn: "bg-warn-wash text-warn border-warn/30",
    bad: "bg-bad-wash text-bad border-bad/30",
    info: "bg-info-wash text-info border-info/30",
  };
  return (
    <span title={title} className={cx("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs leading-none whitespace-nowrap", tones[tone])}>
      {children}
    </span>
  );
}

export function Panel({ children, className, as: As = "section" }: { children: ReactNode; className?: string; as?: "section" | "div" | "aside" }) {
  return <As className={cx("rounded-xl border border-line-soft bg-surface", className)}>{children}</As>;
}

export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className={cx(
        "rounded-2xl border border-line bg-surface text-text p-0 shadow-2xl backdrop:bg-black/60 m-auto",
        wide ? "w-[min(720px,calc(100vw-32px))]" : "w-[min(460px,calc(100vw-32px))]",
      )}
      aria-labelledby="dialog-title"
    >
      {open && (
        <div className="flex flex-col max-h-[85vh]">
          <div className="flex items-center justify-between px-5 pt-4 pb-2">
            <h2 id="dialog-title" className="text-lg font-semibold">
              {title}
            </h2>
            <IconButton icon="x" label="Close" onClick={onClose} size={34} />
          </div>
          <div className="px-5 pb-4 overflow-y-auto scroll-thin">{children}</div>
          {footer && <div className="flex justify-end gap-2 px-5 py-3 border-t border-line-soft">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  onConfirm,
  onClose,
  danger,
}: {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
  danger?: boolean;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={danger ? "danger" : "primary"}
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-text-2">{body}</div>
    </Dialog>
  );
}

export function Notice({ tone = "info", title, children, action }: { tone?: "info" | "warn" | "bad" | "good"; title?: string; children?: ReactNode; action?: ReactNode }) {
  const tones = {
    info: "border-info/30 bg-info-wash",
    warn: "border-warn/35 bg-warn-wash",
    bad: "border-bad/35 bg-bad-wash",
    good: "border-accent/30 bg-accent-wash",
  };
  const icon: Record<string, IconName> = { info: "alert", warn: "alert", bad: "alert", good: "check" };
  const iconColor = { info: "text-info", warn: "text-warn", bad: "text-bad", good: "text-accent" };
  return (
    <div role={tone === "bad" ? "alert" : "status"} className={cx("flex gap-3 rounded-xl border px-4 py-3", tones[tone])}>
      <Icon name={icon[tone]} size={18} className={cx("mt-0.5 shrink-0", iconColor[tone])} />
      <div className="min-w-0 flex-1 text-[15px]">
        {title && <p className="font-semibold text-text">{title}</p>}
        {children && <div className="text-text-2">{children}</div>}
        {action && <div className="mt-2.5 flex flex-wrap gap-2">{action}</div>}
      </div>
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 mb-6">
      <div className="min-w-0">
        <h1 className="text-[28px] leading-tight font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-text-2 max-w-[62ch]">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export function Meter({ value, tone = "good", label }: { value: number; tone?: "good" | "warn" | "bad" | "info"; label: string }) {
  const color = { good: "bg-accent", warn: "bg-warn", bad: "bg-bad", info: "bg-info" }[tone];
  return (
    <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={1} aria-valuenow={Math.round(value * 100) / 100} className="h-1.5 rounded-full bg-surface-3 overflow-hidden">
      <div className={cx("h-full rounded-full transition-[width] duration-150", color)} style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
    </div>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-text-2">
      <span className="h-4 w-4 rounded-full border-2 border-line border-t-accent animate-spin" aria-hidden="true" />
      <span className="text-sm">{label}</span>
    </span>
  );
}
