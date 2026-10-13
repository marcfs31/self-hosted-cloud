"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ActivityEvent, ActivityPage, ErrorCode } from "@cloud/shared";
import { apiFetch, errorCodeOf } from "../../lib/api";
import { detailLines, type DetailLine } from "../../lib/activity";
import { useFormat, useT } from "../../lib/i18n/provider";
import type { Messages } from "../../lib/i18n/messages";
import { useForm } from "../../lib/use-form";
import { FormAlert } from "../form";

const PAGE_SIZE = 50;

function fetchPage(path: string, cursor: string | null): Promise<ActivityPage> {
  const query = new URLSearchParams({ limit: String(PAGE_SIZE) });
  if (cursor !== null) {
    query.set("cursor", cursor);
  }
  return apiFetch<ActivityPage>(`${path}?${query.toString()}`);
}

function methodLabel(t: Messages["activity"], method: string): string {
  switch (method) {
    case "password":
      return t.methods.password;
    case "totp":
      return t.methods.totp;
    case "recovery_code":
      return t.methods.recovery_code;
    case "passkey":
      return t.methods.passkey;
    default:
      return method;
  }
}

function detailText(t: Messages["activity"], line: DetailLine): string {
  switch (line.kind) {
    case "method":
      return t.detail.method(methodLabel(t, line.value));
    case "file":
      return t.detail.file(line.value);
    case "passkey":
      return t.detail.passkey(line.value);
    case "appPassword":
      return t.detail.appPassword(line.value);
    case "by":
      return t.detail.by(line.value);
  }
}

/**
 * A newest-first table of events with cursor pagination. `path` is /activity (own events) or
 * /admin/activity (security events of everyone, which adds the account column).
 */
export function ActivityList({
  path,
  caption,
  showAccount,
}: {
  path: string;
  caption: string;
  showAccount: boolean;
}) {
  const all = useT();
  const t = all.activity;
  const format = useFormat();
  const moreForm = useForm();
  const endRef = useRef<HTMLParagraphElement>(null);
  const [events, setEvents] = useState<ActivityEvent[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<ErrorCode | null>(null);
  const [pagedOnce, setPagedOnce] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  const loadFirst = useCallback(async () => {
    setLoadError(null);
    try {
      const page = await fetchPage(path, null);
      setEvents(page.events);
      setNext(page.nextCursor);
    } catch (e) {
      setLoadError(errorCodeOf(e));
    }
  }, [path]);

  useEffect(() => {
    void loadFirst();
  }, [loadFirst]);

  useEffect(() => {
    if (pagedOnce && next === null) {
      endRef.current?.focus();
    }
  }, [pagedOnce, next]);

  function onLoadMore() {
    if (next === null) {
      return;
    }
    setAnnouncement("");
    void moreForm.submit(async () => {
      const page = await fetchPage(path, next);
      setEvents((current) => [...(current ?? []), ...page.events]);
      setNext(page.nextCursor);
      setPagedOnce(true);
      setAnnouncement(t.loadedMore(page.events.length));
    });
  }

  if (loadError) {
    return (
      <div className="stack">
        <p role="alert" className="alert">
          {all.errors[loadError]}
        </p>
        <div>
          <button
            type="button"
            className="button"
            onClick={() => {
              void loadFirst();
            }}
          >
            {all.common.app.retry}
          </button>
        </div>
      </div>
    );
  }
  if (events === null) {
    return <p role="status">{t.loading}</p>;
  }
  if (events.length === 0) {
    return <p>{t.empty}</p>;
  }

  return (
    <div className="stack">
      <table className="table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">{t.colEvent}</th>
            {showAccount ? <th scope="col">{t.colAccount}</th> : null}
            <th scope="col">{t.colWhen}</th>
            <th scope="col">{t.colIp}</th>
            <th scope="col">{t.colDetails}</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => {
            const lines = detailLines(event);
            return (
              <tr key={event.id}>
                <td data-label={t.colEvent}>{t.events[event.type]}</td>
                {showAccount ? (
                  <td data-label={t.colAccount} className="cell-wrap">
                    {event.userEmail ?? ""}
                  </td>
                ) : null}
                <td data-label={t.colWhen}>
                  <time dateTime={event.createdAt}>{format.dateTime(event.createdAt)}</time>
                </td>
                <td data-label={t.colIp} className="cell-wrap">
                  {event.ip ?? t.noIp}
                </td>
                <td data-label={t.colDetails} className="cell-wrap">
                  {lines.length === 0 ? null : (
                    <ul className="plain-list">
                      {lines.map((line) => (
                        <li key={`${line.kind}:${line.value}`}>{detailText(t, line)}</li>
                      ))}
                    </ul>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <FormAlert form={moreForm} />
      <p role="status" className="note">
        {announcement}
      </p>
      {next === null ? (
        pagedOnce ? (
          <p ref={endRef} tabIndex={-1} className="note">
            {t.end}
          </p>
        ) : null
      ) : (
        <div>
          <button
            type="button"
            className="button"
            disabled={moreForm.busy}
            aria-busy={moreForm.busy}
            onClick={onLoadMore}
          >
            {moreForm.busy ? t.loadingMore : t.loadMore}
          </button>
        </div>
      )}
    </div>
  );
}
