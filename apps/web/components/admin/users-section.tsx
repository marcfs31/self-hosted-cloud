"use client";

import { useEffect, useId, useRef, useState, type SubmitEvent } from "react";
import type { ListUsersResponse, Role, UpdateUserRequest, User } from "@cloud/shared";
import { apiFetch, errorMessage } from "../../lib/api";
import { formatBytes, formatDate, parseGiB, toGiBInput } from "../../lib/format";
import { messages } from "../../lib/messages";
import { useForm } from "../../lib/use-form";
import { Field, FormAlert } from "../form";

const t = messages.admin.users;
const ROLES: readonly Role[] = ["admin", "member"];

function UserRow({
  user,
  isSelf,
  onSaved,
}: {
  user: User;
  isSelf: boolean;
  onSaved: (user: User) => void;
}) {
  const form = useForm();
  const formId = useId();
  const quotaRef = useRef<HTMLInputElement>(null);
  const initialQuota = toGiBInput(user.quotaBytes);
  const [role, setRole] = useState<Role>(user.role);
  const [quota, setQuota] = useState(initialQuota);
  const [saved, setSaved] = useState(false);
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
          messages.roles[user.role]
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
                  {messages.roles[r]}
                </option>
              ))}
            </select>
          </>
        )}
      </td>
      <td data-label={t.quota}>
        {isSelf ? (
          formatBytes(user.quotaBytes)
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
      <td data-label={t.created}>{formatDate(user.createdAt)}</td>
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
      </td>
    </tr>
  );
}

export function UsersSection({ me }: { me: User }) {
  const [users, setUsers] = useState<User[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

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
          setLoadError(errorMessage(e));
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
          {loadError}
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
                    (current) => current?.map((x) => (x.id === updated.id ? updated : x)) ?? null,
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
