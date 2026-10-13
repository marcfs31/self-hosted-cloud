"use client";

import Link from "next/link";
import type { FileNode } from "@cloud/shared";
import { downloadHref } from "../../lib/files-api";
import { useFormat, useT } from "../../lib/i18n/provider";
import { FileIcon } from "./file-icon";
import { RowMenu, type MenuItem } from "./row-menu";

export type RowAction = "rename" | "move" | "versions" | "trash";

interface FileTableProps {
  folderName: string;
  nodes: readonly FileNode[];
  onAction: (action: RowAction, node: FileNode, trigger: HTMLButtonElement) => void;
}

export function FileTable({ folderName, nodes, onAction }: FileTableProps) {
  const t = useT().files;
  const format = useFormat();

  function itemsFor(node: FileNode): MenuItem[] {
    const choose = (action: RowAction) => (trigger: HTMLButtonElement) => {
      onAction(action, node, trigger);
    };
    return [
      node.kind === "folder"
        ? { key: "open", label: t.rowMenu.open, href: `/folders/${encodeURIComponent(node.id)}` }
        : {
            key: "download",
            label: t.rowMenu.download,
            href: downloadHref(node.id),
            download: true,
          },
      { key: "rename", label: t.rowMenu.rename, onSelect: choose("rename") },
      { key: "move", label: t.rowMenu.move, onSelect: choose("move") },
      ...(node.kind === "file"
        ? [{ key: "versions", label: t.rowMenu.versions, onSelect: choose("versions") }]
        : []),
      { key: "trash", label: t.rowMenu.trash, onSelect: choose("trash") },
    ];
  }

  return (
    <table className="table files-table">
      <caption className="sr-only">{t.table.caption(folderName)}</caption>
      <thead>
        <tr>
          <th scope="col">{t.table.name}</th>
          <th scope="col">{t.table.size}</th>
          <th scope="col">{t.table.modified}</th>
          <th scope="col">
            <span className="sr-only">{t.table.actions}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {nodes.map((node) => (
          <tr key={node.id}>
            <td data-label={t.table.name} className="cell-wrap">
              <span className="name-cell">
                <FileIcon kind={node.kind} />
                <span>
                  {node.kind === "folder" ? (
                    <Link href={`/folders/${encodeURIComponent(node.id)}`}>{node.name}</Link>
                  ) : (
                    node.name
                  )}
                  {node.versionCount > 1 ? (
                    <span className="note name-extra">{t.table.versions(node.versionCount)}</span>
                  ) : null}
                </span>
              </span>
            </td>
            <td data-label={t.table.size}>
              {node.kind === "folder" ? t.table.folder : format.bytes(node.size)}
            </td>
            <td data-label={t.table.modified}>{format.dateTime(node.updatedAt)}</td>
            <td data-label={t.table.actions} className="cell-actions">
              <RowMenu label={t.rowMenu.label(node.name)} items={itemsFor(node)} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
