"use client";

import { useCallback, useEffect, useId, useRef, useState, type SubmitEvent } from "react";
import type {
  CreateInviteRequest,
  CreatedInviteResponse,
  Invite,
  ListInvitesResponse,
  Role,
} from "@cloud/shared";
import { apiFetch, errorMessage } from "../../lib/api";
import { formatDate } from "../../lib/format";
import { messages } from "../../lib/messages";
import { useForm } from "../../lib/use-form";
import { Field, FormAlert, SubmitButton } from "../form";

const t = messages.admin.invites;
const ROLES: readonly Role[] = ["member", "admin"];

type InviteStatus = keyof typeof t.status;

function statusOf(invite: Invite, now: number): InviteStatus {
  if (invite.usedAt !== null) {
    return "used";
  }
  return Date.parse(invite.expiresAt) <= now ? "expired" : "active";
}

function CreatedLink({ link, onDismiss }: { link: string; onDismiss: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [copy, setCopy] = useState<string>("");

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [link]);

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopy(t.copied);
    } catch {
      setCopy(t.copyFailed);
      inputRef.current?.select();
    }
  }

  return (
    <section aria-labelledby="created-heading" className="callout stack">
      <h3 id="created-heading">{t.createdTitle}</h3>
      <p>{t.linkNote}</p>
      <Field id="invite-link" label={t.linkLabel} readOnly inputRef={inputRef} value={link} />
      <div className="row-actions">
        <button
          type="button"
          className="button"
          onClick={() => {
            void onCopy();
          }}
        >
          {t.copy}
        </button>
        <button type="button" className="button button-quiet" onClick={onDismiss}>
          {t.dismiss}
        </button>
        <span role="status" className="note">
          {copy}
        </span>
      </div>
    </section>
  );
}

export function InvitesSection() {
  const createForm = useForm();
  const revokeForm = useForm();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const formId = useId();
  const [invites, setInvites] = useState<Invite[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [role, setRole] = useState<Role>("member");
  const [days, setDays] = useState("7");
  const [link, setLink] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const { invites: list } = await apiFetch<ListInvitesResponse>("/admin/invites");
    setInvites(list);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const { invites: list } = await apiFetch<ListInvitesResponse>("/admin/invites");
        if (!cancelled) {
          setInvites(list);
        }
      } catch (e) {
        if (!cancelled) {
          setLoadError(errorMessage(e));
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  function onCreate(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setLink(null);
    void createForm.submit(async () => {
      const body: CreateInviteRequest = { role, expiresInDays: Number.parseInt(days, 10) };
      const created = await apiFetch<CreatedInviteResponse>("/admin/invites", {
        method: "POST",
        json: body,
      });
      setLink(`${window.location.origin}/register?token=${encodeURIComponent(created.token)}`);
      await refresh();
    });
  }

  async function onRevoke(id: string) {
    setRevokingId(id);
    await revokeForm.submit(async () => {
      await apiFetch(`/admin/invites/${encodeURIComponent(id)}`, { method: "DELETE" });
      await refresh();
      headingRef.current?.focus();
    });
    setRevokingId(null);
  }

  const now = Date.now();

  return (
    <section aria-labelledby="invites-heading" className="stack">
      <h2 id="invites-heading" ref={headingRef} tabIndex={-1}>
        {t.title}
      </h2>

      <form onSubmit={onCreate} className="stack card" aria-labelledby={`${formId}-title`}>
        <h3 id={`${formId}-title`}>{t.createTitle}</h3>
        <div className="field">
          <label htmlFor={`${formId}-role`}>{t.role}</label>
          <select
            id={`${formId}-role`}
            value={role}
            onChange={(e) => {
              setRole(e.target.value === "admin" ? "admin" : "member");
            }}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {messages.roles[r]}
              </option>
            ))}
          </select>
        </div>
        <Field
          id={`${formId}-days`}
          label={t.expiresInDays}
          hint={t.expiresHint}
          type="number"
          min={1}
          max={30}
          step={1}
          required
          value={days}
          onChange={(e) => {
            setDays(e.target.value);
          }}
        />
        <FormAlert form={createForm} />
        <SubmitButton busy={createForm.busy} label={t.create} busyLabel={t.creating} />
      </form>

      {link ? (
        <CreatedLink
          link={link}
          onDismiss={() => {
            setLink(null);
          }}
        />
      ) : null}

      {loadError ? (
        <p role="alert" className="alert">
          {loadError}
        </p>
      ) : invites === null ? (
        <p role="status">{t.loading}</p>
      ) : invites.length === 0 ? (
        <p>{t.empty}</p>
      ) : (
        <table className="table">
          <caption className="sr-only">{t.caption}</caption>
          <thead>
            <tr>
              <th scope="col">{t.colRole}</th>
              <th scope="col">{t.colCreated}</th>
              <th scope="col">{t.colExpires}</th>
              <th scope="col">{t.colStatus}</th>
              <th scope="col">{t.colActions}</th>
            </tr>
          </thead>
          <tbody>
            {invites.map((invite) => {
              const status = statusOf(invite, now);
              return (
                <tr key={invite.id}>
                  <td data-label={t.colRole}>{messages.roles[invite.role]}</td>
                  <td data-label={t.colCreated}>{formatDate(invite.createdAt)}</td>
                  <td data-label={t.colExpires}>{formatDate(invite.expiresAt)}</td>
                  <td data-label={t.colStatus}>
                    <span className={`badge badge-${status}`}>{t.status[status]}</span>
                  </td>
                  <td data-label={t.colActions}>
                    {status === "active" ? (
                      <button
                        type="button"
                        className="button button-quiet"
                        disabled={revokeForm.busy}
                        aria-busy={revokingId === invite.id}
                        aria-label={t.revokeFor(
                          messages.roles[invite.role],
                          formatDate(invite.createdAt),
                        )}
                        onClick={() => {
                          void onRevoke(invite.id);
                        }}
                      >
                        {revokingId === invite.id ? t.revoking : t.revoke}
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <FormAlert form={revokeForm} />
    </section>
  );
}
