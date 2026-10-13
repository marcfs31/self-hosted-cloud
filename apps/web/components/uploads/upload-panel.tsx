"use client";

import { useId } from "react";
import type { ErrorCode } from "@cloud/shared";
import { useFormat, useT } from "../../lib/i18n/provider";
import {
  isActive,
  itemPercent,
  summarize,
  type QueueSummary,
  type UploadItem,
} from "../../lib/upload-queue";
import { useThrottled } from "../../lib/use-throttled";
import { useUploads } from "./uploads-provider";

/** How often the summary may be read out. */
const ANNOUNCE_EVERY_MS = 4000;

function useSummaryText(summary: QueueSummary, announced: boolean): string {
  const t = useT().files.uploads.summary;
  const counted = summary.total - summary.cancelled;
  // A reader hears progress in steps of ten percent, not every byte.
  const percent = announced ? Math.floor(summary.percent / 10) * 10 : summary.percent;
  if (summary.active > 0) {
    return t.active(summary.done + summary.failed, counted, percent);
  }
  if (summary.failed > 0) {
    return t.withFailures(summary.done, summary.failed);
  }
  return summary.done > 0 ? t.finished(summary.done) : t.idle;
}

type ErrorOverrides = Partial<Record<ErrorCode, string>>;

function ItemRow({ item, errors }: { item: UploadItem; errors: ErrorOverrides }) {
  const all = useT();
  const t = all.files.uploads;
  const format = useFormat();
  const uploads = useUploads();
  const percent = itemPercent(item);

  const status =
    item.status === "uploading"
      ? t.status.uploading(percent)
      : item.status === "error"
        ? (errors[item.error ?? "internal"] ?? all.errors[item.error ?? "internal"])
        : t.status[item.status];

  return (
    <li className="upload-item">
      <p className="upload-name">{item.name}</p>
      <p className="note upload-status">
        {status}
        {item.status === "uploading" || item.status === "paused" ? (
          <>
            {" · "}
            {t.amount(format.bytes(item.sent), format.bytes(item.size))}
          </>
        ) : null}
      </p>
      {item.status === "cancelled" ? null : (
        <div
          role="progressbar"
          aria-label={t.progressLabel(item.name)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          className="meter"
        >
          <span
            className={item.status === "error" ? "meter-fill meter-fill-full" : "meter-fill"}
            style={{ inlineSize: `${percent}%` }}
          />
        </div>
      )}
      <div className="row-actions">
        {item.status === "uploading" ? (
          <button
            type="button"
            className="button button-quiet button-small"
            aria-label={t.pauseLabel(item.name)}
            onClick={() => {
              uploads.pause(item.id);
            }}
          >
            {t.pause}
          </button>
        ) : null}
        {item.status === "paused" ? (
          <button
            type="button"
            className="button button-quiet button-small"
            aria-label={t.resumeLabel(item.name)}
            onClick={() => {
              uploads.resume(item.id);
            }}
          >
            {t.resume}
          </button>
        ) : null}
        {isActive(item.status) ? (
          <button
            type="button"
            className="button button-quiet button-small"
            aria-label={t.cancelLabel(item.name)}
            onClick={() => {
              uploads.cancel(item.id);
            }}
          >
            {t.cancel}
          </button>
        ) : null}
        {item.status === "error" || item.status === "cancelled" ? (
          <button
            type="button"
            className="button button-quiet button-small"
            aria-label={t.retryLabel(item.name)}
            onClick={() => {
              uploads.retry(item.id);
            }}
          >
            {t.retry}
          </button>
        ) : null}
        {isActive(item.status) ? null : (
          <button
            type="button"
            className="button button-quiet button-small"
            aria-label={t.dismissLabel(item.name)}
            onClick={() => {
              uploads.dismiss(item.id);
            }}
          >
            {t.dismiss}
          </button>
        )}
      </div>
    </li>
  );
}

/** `errors` words a failure differently where the generic copy would mislead (a public drop box). */
export function UploadPanel({ errors = {} }: { errors?: ErrorOverrides }) {
  const t = useT().files.uploads;
  const { items, clearFinished } = useUploads();
  const headingId = useId();
  const summary = summarize(items);
  const visible = useSummaryText(summary, false);
  const announced = useThrottled(useSummaryText(summary, true), ANNOUNCE_EVERY_MS);

  return (
    <>
      {/* Always mounted, so the first message is announced too. */}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {items.length > 0 ? announced : ""}
      </div>
      {items.length > 0 ? (
        <section aria-labelledby={headingId} className="upload-panel">
          <div className="upload-panel-head">
            <h2 id={headingId}>{t.title}</h2>
            <button
              type="button"
              className="button button-quiet button-small"
              disabled={summary.active === items.length}
              onClick={clearFinished}
            >
              {t.clearFinished}
            </button>
          </div>
          <p className="note">{visible}</p>
          <ul className="upload-list">
            {items.map((item) => (
              <ItemRow key={item.id} item={item} errors={errors} />
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
