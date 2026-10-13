"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import type { ErrorCode, SearchResult } from "@cloud/shared";
import { errorCodeOf } from "../../lib/api";
import { useFormat, useT } from "../../lib/i18n/provider";
import { previewSet } from "../../lib/preview";
import { SEARCH_LIMIT, searchFiles } from "../../lib/search-api";
import { FileIcon } from "../files/file-icon";
import { PreviewDialog, previewTriggerProps } from "../files/preview-dialog";

type State =
  | { q: string; status: "loading" }
  | { q: string; status: "error"; code: ErrorCode }
  | { q: string; status: "ready"; results: readonly SearchResult[] };

function SearchResults() {
  const all = useT();
  const t = all.search;
  const q = (useSearchParams().get("q") ?? "").trim();
  const [state, setState] = useState<State>({ q, status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [previewId, setPreviewId] = useState<string | null>(null);

  useEffect(() => {
    if (q === "") {
      return;
    }
    const controller = new AbortController();
    void (async () => {
      try {
        const { results } = await searchFiles(q, controller.signal);
        if (!controller.signal.aborted) {
          setState({ q, status: "ready", results });
        }
      } catch (e) {
        if (!controller.signal.aborted) {
          setState({ q, status: "error", code: errorCodeOf(e) });
        }
      }
    })();
    return () => {
      controller.abort();
    };
  }, [q, attempt]);

  // Results of an earlier query stay on screen, dimmed, until the new ones arrive.
  const current = state.q === q;
  const results = state.status === "ready" ? state.results : null;
  const loading = q !== "" && (!current || state.status === "loading");
  const failed = q !== "" && current && state.status === "error" ? state.code : null;

  let announcement = "";
  if (loading) {
    announcement = t.searching;
  } else if (q !== "" && current && results) {
    announcement = t.count(results.length, q);
  }

  return (
    <>
      <p role="status" className="note">
        {announcement}
      </p>
      {q === "" ? (
        <div className="empty">
          <p className="empty-title">{t.idle}</p>
        </div>
      ) : null}
      {failed ? (
        <div className="stack">
          <p role="alert" className="alert">
            {all.errors[failed]}
          </p>
          <div>
            <button
              type="button"
              className="button"
              onClick={() => {
                setState({ q, status: "loading" });
                setAttempt((n) => n + 1);
              }}
            >
              {all.common.app.retry}
            </button>
          </div>
        </div>
      ) : null}
      {q !== "" && results && !failed ? (
        <div aria-busy={loading} className={loading ? "results-stale" : undefined}>
          {results.length === 0 ? (
            loading ? null : (
              <div className="empty">
                <p className="empty-title">{t.none.title(q)}</p>
                <p className="note">{t.none.hint}</p>
              </div>
            )
          ) : (
            <ResultTable
              q={state.q}
              results={results}
              onPreview={(id) => {
                setPreviewId(id);
              }}
            />
          )}
          {results.length >= SEARCH_LIMIT ? (
            <p className="note">{t.limited(SEARCH_LIMIT)}</p>
          ) : null}
        </div>
      ) : null}
      {previewId && results ? (
        <PreviewDialog
          files={previewSet(
            results.map((result) => result.node),
            previewId,
          )}
          startId={previewId}
          onClose={() => {
            setPreviewId(null);
          }}
        />
      ) : null}
    </>
  );
}

function ResultTable({
  q,
  results,
  onPreview,
}: {
  q: string;
  results: readonly SearchResult[];
  onPreview: (id: string) => void;
}) {
  const all = useT();
  const t = all.search;
  const files = all.files;
  const format = useFormat();
  return (
    <table className="table files-table">
      <caption className="sr-only">{t.caption(q)}</caption>
      <thead>
        <tr>
          <th scope="col">{files.table.name}</th>
          <th scope="col">{files.table.size}</th>
          <th scope="col">{files.table.modified}</th>
          <th scope="col">{t.location}</th>
        </tr>
      </thead>
      <tbody>
        {results.map(({ node, path }) => (
          <tr key={node.id}>
            <td data-label={files.table.name} className="cell-wrap">
              <span className="name-cell">
                <FileIcon kind={node.kind} />
                {node.kind === "folder" ? (
                  <Link href={`/folders/${encodeURIComponent(node.id)}`}>{node.name}</Link>
                ) : (
                  <button
                    type="button"
                    className="link-button"
                    {...previewTriggerProps(node.id)}
                    onClick={() => {
                      onPreview(node.id);
                    }}
                  >
                    {node.name}
                  </button>
                )}
              </span>
            </td>
            <td data-label={files.table.size}>
              {node.kind === "folder" ? files.table.folder : format.bytes(node.size)}
            </td>
            <td data-label={files.table.modified}>{format.dateTime(node.updatedAt)}</td>
            <td data-label={t.location} className="cell-wrap">
              <ol className="breadcrumbs" aria-label={t.pathLabel(node.name)}>
                {path.map((crumb, index) => (
                  <li key={crumb.id}>
                    <Link href={index === 0 ? "/" : `/folders/${encodeURIComponent(crumb.id)}`}>
                      {crumb.name === "" ? files.rootName : crumb.name}
                    </Link>
                  </li>
                ))}
              </ol>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function SearchView() {
  const t = useT().search;
  return (
    <>
      <h1>{t.title}</h1>
      <Suspense fallback={null}>
        <SearchResults />
      </Suspense>
    </>
  );
}
