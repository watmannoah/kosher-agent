/** Shared primitives. Hairlines and monospace labels do the structural work. */

import type { ReactNode } from 'react';

export function Section({
  index,
  title,
  blurb,
  children,
  id,
}: {
  index: string;
  title: string;
  blurb?: ReactNode;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section id={id} className="border-t border-hairline px-5 py-9 sm:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="flex items-baseline gap-3">
          <span className="telemetry text-[11px] text-faint">{index}</span>
          <h2 className="text-sm font-medium uppercase tracking-[0.14em] text-bone">{title}</h2>
        </div>
        {blurb && <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted">{blurb}</p>}
        <div className="mt-6">{children}</div>
      </div>
    </section>
  );
}

export function Pill({
  children,
  tone = 'neutral',
  title,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'live' | 'warn' | 'danger' | 'info';
  title?: string;
}) {
  const tones = {
    neutral: 'border-hairline-bright text-muted',
    live: 'border-live/50 text-live bg-live-dim/40',
    warn: 'border-warn/40 text-warn',
    danger: 'border-danger/40 text-danger',
    info: 'border-info/40 text-info',
  };
  return (
    <span
      title={title}
      className={`telemetry inline-flex items-center rounded-sm border px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function Label({ children }: { children: ReactNode }) {
  return (
    <span className="telemetry text-[10px] uppercase tracking-[0.14em] text-faint">{children}</span>
  );
}

/**
 * The synthetic-data notice.
 *
 * BRIEF 12 requires this visible in the lookup UI itself rather than buried in
 * the footer, because someone skimming a certification answer is exactly the
 * person who might act on it.
 */
export function SyntheticNotice({ compact = false }: { compact?: boolean }) {
  return (
    <p
      className={`telemetry border border-warn/30 bg-warn/5 text-warn ${
        compact ? 'px-2 py-1 text-[10px]' : 'px-3 py-2 text-[11px]'
      } leading-relaxed`}
    >
      Synthetic demonstration data. Not a kosher certification reference — do not rely on any
      status shown here.
    </p>
  );
}

/** Collapsible, used everywhere a trace can be expanded. */
export function Disclosure({
  summary,
  children,
  defaultOpen = false,
}: {
  summary: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details open={defaultOpen} className="group">
      <summary className="cursor-pointer list-none">
        <div className="flex items-center gap-2">
          <span className="telemetry text-faint transition-transform group-open:rotate-90">▸</span>
          <div className="min-w-0 flex-1">{summary}</div>
        </div>
      </summary>
      <div className="mt-2 pl-4">{children}</div>
    </details>
  );
}

export function KeyValue({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className="telemetry text-[10px] uppercase tracking-wider text-faint">{k}</span>
      <span className="telemetry text-[11px] text-bone">{v}</span>
    </div>
  );
}

export function formatUsd(amount: number): string {
  if (amount === 0) return '$0';
  if (amount < 0.01) return `$${amount.toFixed(5)}`;
  if (amount < 1) return `$${amount.toFixed(4)}`;
  return `$${amount.toFixed(2)}`;
}

export function ms(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return `${Math.round(value)}ms`;
}
