"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import type { HostCheck, ReportState, SystemStatus } from "@cloud/shared";
import { useFormat, useLocale, useT } from "../../lib/i18n/provider";
import {
  formatCelsius,
  formatDuration,
  formatNumber,
  formatRelative,
  formatTime,
  secondsSince,
  share,
} from "../../lib/system-format";
import { useSystemStatus } from "../../lib/use-system-status";
import { useSession } from "../../lib/session";
import { NotFoundState } from "../not-found-state";

const NOTICE_MS = 5000;

function StateIcon({ state }: { state: ReportState }) {
  return (
    <svg
      className="state-icon"
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="8" cy="8" r="7" />
      {state === "ok" ? <path d="M4.5 8.2l2.3 2.3 4.7-5" /> : null}
      {state === "failing" ? <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" /> : null}
      {state === "stale" ? <path d="M8 4.5V8l2.5 1.5" /> : null}
      {state === "unknown" ? (
        <>
          <path d="M6.2 6.3a1.9 1.9 0 1 1 2.7 1.7c-.6.3-.9.7-.9 1.4" />
          <circle cx="8" cy="11.6" r=".6" fill="currentColor" />
        </>
      ) : null}
    </svg>
  );
}

function StateBadge({ state }: { state: ReportState }) {
  const t = useT().system.checks;
  return (
    <span className={`state-badge state-${state}`}>
      <StateIcon state={state} />
      <span>{t.state[state]}</span>
    </span>
  );
}

function Facts({ rows }: { rows: readonly (readonly [string, ReactNode])[] }) {
  return (
    <dl className="facts">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Meter({
  label,
  text,
  used,
  total,
  extra,
}: {
  label: string;
  text: string;
  used: number;
  total: number;
  extra: string;
}) {
  return (
    <div className="usage">
      <p className="usage-text">
        <strong>{label}:</strong> {text}
      </p>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={Math.max(total, 1)}
        aria-valuenow={Math.min(used, Math.max(total, 1))}
        aria-valuetext={text}
        className="meter"
      >
        <span
          className="meter-fill"
          style={{ inlineSize: `${Math.round(share(used, total) * 100)}%` }}
        />
      </div>
      <p className="note">{extra}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="stack">
      <h2 id={id}>{title}</h2>
      {children}
    </section>
  );
}

function ServerSection({ status }: { status: SystemStatus }) {
  const t = useT().system;
  const locale = useLocale();
  const { cpu } = status;
  const load = [cpu.load1, cpu.load5, cpu.load15]
    .map((v) => formatNumber(v, locale, 2))
    .join(" / ");
  return (
    <Section title={t.server.title}>
      <Facts
        rows={[
          [t.server.version, status.version],
          [t.server.uptime, formatDuration(status.uptimeSeconds, locale)],
          [t.server.cores, formatNumber(cpu.cores, locale, 0)],
          [t.server.load, load],
          [
            t.server.temperature,
            cpu.temperatureC === null ? t.unknown : formatCelsius(cpu.temperatureC, locale),
          ],
        ]}
      />
    </Section>
  );
}

function MemorySection({ status }: { status: SystemStatus }) {
  const t = useT().system.memory;
  const format = useFormat();
  const { totalBytes, availableBytes } = status.memory;
  const used = Math.max(totalBytes - availableBytes, 0);
  return (
    <Section title={t.title}>
      <Meter
        label={t.label}
        text={t.usedOf(format.bytes(used), format.bytes(totalBytes))}
        used={used}
        total={totalBytes}
        extra={t.available(format.bytes(availableBytes))}
      />
    </Section>
  );
}

function StorageSection({ status }: { status: SystemStatus }) {
  const t = useT().system.storage;
  const format = useFormat();
  const { storage } = status;
  if (storage === null) {
    return (
      <Section title={t.title}>
        <p>{t.unknown}</p>
      </Section>
    );
  }
  const used = Math.max(storage.totalBytes - storage.freeBytes, 0);
  return (
    <Section title={t.title}>
      <Meter
        label={t.label}
        text={t.usedOf(format.bytes(used), format.bytes(storage.totalBytes))}
        used={used}
        total={storage.totalBytes}
        extra={t.free(format.bytes(storage.freeBytes))}
      />
    </Section>
  );
}

function CheckCard({ title, check, now }: { title: string; check: HostCheck; now: number }) {
  const t = useT().system.checks;
  const format = useFormat();
  const locale = useLocale();
  const id = useId();
  const labels: Record<string, string> = t.facts;
  const facts = Object.entries(check.facts);
  let help: string | null = null;
  if (check.state === "failing") {
    help = t.help.failing;
  } else if (check.state === "stale" && check.checkedAt !== null) {
    help = t.help.stale(formatDuration(secondsSince(check.checkedAt, now), locale));
  } else if (check.state === "unknown") {
    help = t.help.unknown;
  }
  return (
    <article aria-labelledby={id} className="card host-check stack">
      <div className="check-head">
        <h3 id={id}>{title}</h3>
        <StateBadge state={check.state} />
      </div>
      <p className="note">
        {check.checkedAt === null
          ? t.neverReported
          : t.checked(
              formatRelative(check.checkedAt, now, locale),
              format.dateTime(check.checkedAt),
            )}
      </p>
      {help ? <p>{help}</p> : null}
      {facts.length > 0 ? (
        <Facts
          rows={facts.map(([key, value]) => [
            Object.hasOwn(labels, key) ? (labels[key] ?? key) : key,
            value,
          ])}
        />
      ) : check.state === "unknown" ? null : (
        <p className="note">{t.noFacts}</p>
      )}
    </article>
  );
}

function ChecksSection({ status, now }: { status: SystemStatus; now: number }) {
  const t = useT().system.checks;
  return (
    <Section title={t.title}>
      <p className="note">{t.intro}</p>
      <div className="checks-grid">
        <CheckCard title={t.backup} check={status.backup} now={now} />
        <CheckCard title={t.restoreTest} check={status.restoreTest} now={now} />
        <CheckCard title={t.health} check={status.health} now={now} />
      </div>
    </Section>
  );
}

function SystemDashboard() {
  const all = useT();
  const t = all.system;
  const locale = useLocale();
  const { data, updatedAt, error, refresh } = useSystemStatus();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!notice) {
      return;
    }
    const timer = setTimeout(() => {
      setNotice("");
    }, NOTICE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [notice]);

  async function onRefresh() {
    setBusy(true);
    setNotice("");
    const result = await refresh();
    setBusy(false);
    if (result === "ok") {
      setNotice(t.updatedNotice);
    }
  }

  if (data === null && error === "not_found") {
    return <NotFoundState />;
  }

  const time = updatedAt === null ? "" : formatTime(updatedAt, locale);
  return (
    <>
      <div className="page-head">
        <h1>{t.title}</h1>
      </div>
      <div className="toolbar">
        <button
          type="button"
          className="button"
          aria-busy={busy}
          onClick={() => {
            void onRefresh();
          }}
        >
          {busy ? t.refreshing : t.refresh}
        </button>
        <p role="status" aria-live="polite" className="note refresh-notice">
          {notice}
        </p>
      </div>
      {data !== null && updatedAt !== null ? (
        <p className="note">
          {t.lastUpdated(time)}
          {error ? <span className="badge">{t.outdatedBadge}</span> : null}
          <br />
          {t.autoRefresh}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="alert">
          {data === null ? null : <>{t.refreshFailed(time)} </>}
          {all.errors[error]}
        </p>
      ) : null}
      {data === null ? (
        error ? null : (
          <p role="status">{t.loading}</p>
        )
      ) : (
        <>
          <ServerSection status={data} />
          <MemorySection status={data} />
          <StorageSection status={data} />
          <ChecksSection status={data} now={updatedAt ?? Date.now()} />
        </>
      )}
    </>
  );
}

export function SystemView() {
  const { user } = useSession();
  if (user.role !== "admin") {
    return <NotFoundState />;
  }
  return <SystemDashboard />;
}
