"use client";

import Link from "next/link";
import type { Breadcrumb } from "@cloud/shared";
import { useT } from "../../lib/i18n/provider";

export function Breadcrumbs({ crumbs }: { crumbs: readonly Breadcrumb[] }) {
  const t = useT().files;
  return (
    <nav aria-label={t.breadcrumbsLabel}>
      <ol className="breadcrumbs">
        {crumbs.map((crumb, index) => {
          const name = crumb.name === "" ? t.rootName : crumb.name;
          const last = index === crumbs.length - 1;
          return (
            <li key={crumb.id}>
              {last ? (
                <span aria-current="page">{name}</span>
              ) : (
                <Link href={index === 0 ? "/" : `/folders/${encodeURIComponent(crumb.id)}`}>
                  {name}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
