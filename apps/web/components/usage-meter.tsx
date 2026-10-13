"use client";

import { useFormat, useT } from "../lib/i18n/provider";
import { useUsage } from "./usage-provider";

const ALMOST_FULL = 0.9;

export function UsageMeter() {
  const t = useT().files.usage;
  const format = useFormat();
  const { usage } = useUsage();
  if (!usage) {
    return null;
  }
  const { usedBytes, quotaBytes } = usage;
  const used = format.bytes(usedBytes);
  if (quotaBytes === 0) {
    return (
      <p className="usage note" role="status">
        <strong>{t.label}:</strong> {t.noQuota(used)}
      </p>
    );
  }
  const share = Math.min(usedBytes / quotaBytes, 1);
  const text = t.used(used, format.bytes(quotaBytes));
  return (
    <div className="usage">
      <p className="usage-text">
        <strong>{t.label}:</strong> {text}
        {share >= ALMOST_FULL ? <span className="usage-warning"> {t.almostFull}</span> : null}
      </p>
      <div
        role="meter"
        aria-label={t.label}
        aria-valuemin={0}
        aria-valuemax={quotaBytes}
        aria-valuenow={Math.min(usedBytes, quotaBytes)}
        aria-valuetext={text}
        className="meter"
      >
        <span
          className={share >= ALMOST_FULL ? "meter-fill meter-fill-full" : "meter-fill"}
          style={{ inlineSize: `${Math.round(share * 100)}%` }}
        />
      </div>
    </div>
  );
}
