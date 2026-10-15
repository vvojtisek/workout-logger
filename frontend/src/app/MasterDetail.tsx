import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useMatch, useOutlet } from "react-router-dom";

import { useIsDesktop } from "@/lib/use-media-query";

/** Route handle that asks the desktop shell for an edge-to-edge workspace,
 * because the page lays out its own panes. */
export const FULL_BLEED = { fullBleed: true } as const;

export function isFullBleed(handle: unknown): boolean {
  return (
    typeof handle === "object" &&
    handle !== null &&
    (handle as { fullBleed?: unknown }).fullBleed === true
  );
}

/**
 * A list with its detail. On desktop the list stays in a 340px pane and the
 * selected item, or a new/edit form, opens beside it. On a phone the list and
 * the detail are separate screens, as before.
 *
 * The list is remounted whenever the detail closes, so a list that loads its
 * data once picks up what the detail just saved or deleted.
 */
export function MasterDetail({
  base,
  list,
  placeholder,
}: {
  /** The list's own path, e.g. "/history"; anything below it is detail. */
  base: string;
  list: ReactNode;
  placeholder: string;
}) {
  const isDesktop = useIsDesktop();
  const atList = useMatch({ path: base, end: true }) !== null;
  const detail = useOutlet();
  const [listKey, setListKey] = useState(0);
  const wasAtList = useRef(atList);

  useEffect(() => {
    if (atList && !wasAtList.current) setListKey((key) => key + 1);
    wasAtList.current = atList;
  }, [atList]);

  if (!isDesktop) return atList ? <div key={listKey}>{list}</div> : detail;

  return (
    <div className="grid h-full min-h-0 grid-cols-[340px_1fr]">
      <div
        key={listKey}
        data-testid="master-pane"
        className="min-h-0 overflow-y-auto border-r border-line bg-subtle px-4 pt-5 pb-16"
      >
        {list}
      </div>
      <div data-testid="detail-pane" className="min-h-0 overflow-y-auto px-8 pt-6 pb-16">
        {atList ? (
          <p className="pt-16 text-center text-sm text-muted">{placeholder}</p>
        ) : (
          <div className="max-w-3xl">{detail}</div>
        )}
      </div>
    </div>
  );
}
