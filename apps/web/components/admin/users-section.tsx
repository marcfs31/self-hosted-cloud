"use client";

import { useEffect, useId, useRef, useState, type SubmitEvent } from "react";
import type {
  ErrorCode,
  ListUsersResponse,
  Role,
  UpdateUserRequest,
  User,
  UserSummary,
} from "@cloud/shared";
import { apiFetch, errorCodeOf } from "../../lib/api";
import { parseGiB, toGiBInput } from "../../lib/i18n/format";
import { useFormat, useT } from "../../lib/i18n/provider";
import { useForm } from "../../lib/use-form";
import { ConfirmDialog } from "../confirm-dialog";
import { Field, FormAlert } from "../form";

const ROLES: readonly Role[] = ["admin", "member"];

function UserRow({
  user,
  isSelf,
  onSaved,
}: {
  user: UserSummary;
  isSelf: boolean;
  onSaved: (user: User) => void;
}) {
  const all = useT();
  const t = all.admin.users;
  const mfa = all.security.admin;
  const format = useFormat();
  const form = useForm();
  const formId = useId();
  const quotaRef = useRef<HTMLInputElement>(null);
  const initialQuota = toGiBInput(user.quotaBytes);
  const [role, setRole] = useState<Role>(user.role);
  const [quota, setQuota] = useState(initialQuota);
  const [saved, setSaved] = useState(false);
  const [reset, setReset] = useState<{ returnFocus: HTMLElement | null } | null>(null);
  const [resetNotice, setResetNotice] = useState("");
  const dirty = role !== user.role || quota !== initialQuota;

  function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const quotaBytes = parseGiB(quota);
    if (quotaBytes === null) {
      form.fail(t.quotaInvalid, quotaRef);
      return;
    }
    const body: UpdateUserRequest = {};
    if (role !== user.role) {
      body.role = role;
    }
    if (quota !== initialQuota) {
      body.quotaBytes = quotaBytes;
    }
    void form.submit(async () => {
      const updated = await apiFetch<User>(`/admin/users/${encodeURIComponent(user.id)}`, {
        method: "PATCH",
        json: body,
      });
      setRole(updated.role);
      setQuota(toGiBInput(updated.quotaBytes));
      setSaved(true);
      onSaved(updated);
    });
  }

  return (
    <tr>
      <td data-label={t.email} className="cell-wrap">
        {user.email}
        {isSelf ? <span className="badge">{t.you}</span> : null}
      </td>
      <td data-label={t.role}>
        {isSelf ? (
          all.common.roles[user.role]
        ) : (
          <>
            <label htmlFor={`${formId}-role`} className="sr-only">
              {t.roleFor(user.email)}
            </label>
            <select
              id={`${formId}-role`}
              form={formId}
              value={role}
              onChange={(e) => {
                setRole(e.target.value === "admin" ? "admin" : "member");
                setSaved(false);
                form.clear();
              }}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {all.common.roles[r]}
                </option>
              ))}
            </select>
          </>
        )}
      </td>
      <td data-label={t.quota}>
        {isSelf ? (
          format.bytes(user.quotaBytes)
        ) : (
          <Field
            id={`${formId}-quota`}
            form={formId}
            label={t.quotaFor(user.email)}
            hideLabel
            inputMode="decimal"
            autoComplete="off"
            required
            inputRef={quotaRef}
            state={form}
            value={quota}
            onChange={(e) => {
              setQuota(e.target.value);
              setSaved(false);
              form.clear();
            }}
          />
        )}
      </td>
      <td data-label={t.used}>
        {t.usedOf(format.bytes(user.usedBytes), format.bytes(user.quotaBytes))}
      </td>
      <td data-label={t.created}>{format.date(user.createdAt)}</td>
      <td data-label={t.actions}>
        {isSelf ? null : (
          <form id={formId} onSubmit={onSubmit} className="row-actions">
            <button
              type="submit"
              className="button"
              disabled={form.busy || !dirty}
              aria-busy={form.busy}
              aria-label={t.saveFor(user.email)}
            >
              {form.busy ? t.saving : t.save}
            </button>
            <span role="status" className="note">
              {saved && !dirty ? t.saved : ""}
            </span>
            <FormAlert form={form} />
          </form>
        )}
        {isSelf ? null : (
          <div className="row-actions">
            <button
              type="button"
              className="button button-quiet button-small"
              aria-label={mfa.resetMfaFor(user.email)}
              onClick={(event) => {
                setResetNotice("");
                setReset({ returnFocus: event.currentTarget });
              }}
            >
              {mfa.resetMfa}
            </button>
            <span role="status" className="note">
              {resetNotice}
            </span>
            {reset === null ? null : (
              <ConfirmDialog
                title={mfa.resetTitle}
                body={mfa.resetBody(user.email)}
                cancelLabel={all.security.cancel}
                submitLabel={mfa.resetSubmit}
                submittingLabel={mfa.resetting}
                onConfirm={async () => {
                  await apiFetch(`/admin/users/${encodeURIComponent(user.id)}/reset-mfa`, {
                    method: "POST",
                  });
                  setReset(null);
                  setResetNotice(mfa.resetDone(user.email));
                }}
                onClose={() => {
                  setReset(null);
                }}
                returnFocus={reset.returnFocus}
              />
            )}
          </div>
        )}
      </td>
    </tr>
  );
}

export function UsersSection({ me }: { me: User }) {
  const all = useT();
  const t = all.admin.users;
  const [users, setUsers] = useState<UserSummary[] | null>(null);
  const [loadError, setLoadError] = useState<ErrorCode | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const { users: list } = await apiFetch<ListUsersResponse>("/admin/users");
        if (!cancelled) {
          setUsers(list);
        }
      } catch (e) {
        if (!cancelled) {
          setLoadError(errorCodeOf(e));
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section aria-labelledby="users-heading" className="stack">
      <h2 id="users-heading">{t.title}</h2>
      {loadError ? (
        <p role="alert" className="alert">
          {all.errors[loadError]}
        </p>
      ) : users === null ? (
        <p role="status">{t.loading}</p>
      ) : (
        <table className="table">
          <caption className="sr-only">{t.caption}</caption>
          <thead>
            <tr>
              <th scope="col">{t.email}</th>
              <th scope="col">{t.role}</th>
              <th scope="col">{t.quota}</th>
              <th scope="col">{t.used}</th>
              <th scope="col">{t.created}</th>
              <th scope="col">{t.actions}</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <UserRow
                key={u.id}
                user={u}
                isSelf={u.id === me.id}
                onSaved={(updated) => {
                  setUsers(
                    (current) =>
                      current?.map((x) => (x.id === updated.id ? { ...x, ...updated } : x)) ?? null,
                  );
                }}
              />
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
