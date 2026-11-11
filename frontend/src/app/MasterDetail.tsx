import { createContext, useContext, useState } from "react";
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

const ListVersionContext = createContext(0);

/**
 * A number that changes each time the detail beside this list closes. A list
 * that loads its data once lists it as a dependency of that load, so it
 * reloads after a save or delete in the detail without being remounted.
 */
export function useListVersion(): number {
  return useContext(ListVersionContext);
}

/**
 * A list with its detail. On desktop the list stays in a 340px pane and the
 * selected item, or a new/edit form, opens beside it. On a phone the list and
 * the detail are separate screens, as before.
 *
 * The list stays mounted while a detail opens and closes beside it, so what
 * the user typed into it (a search, a filter) survives. Instead of being
 * remounted, the list is told the detail closed through `useListVersion()`,
 * and a list that loads its data once reloads on that signal to pick up what
 * the detail just saved or deleted.
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
  const [listVersion, setListVersion] = useState(0);
  const [wasAtList, setWasAtList] = useState(atList);

  // Bump the version during render, not in an effect: the list then sees the
  // new version in the same commit that closes the detail, with no extra
  // render after the browser has painted and the user has started typing.
  if (atList !== wasAtList) {
    setWasAtList(atList);
    if (atList) setListVersion((version) => version + 1);
  }

  const listPane = <ListVersionContext.Provider value={listVersion}>{list}</ListVersionContext.Provider>;

  if (!isDesktop) return atList ? <div>{listPane}</div> : detail;

  return (
    <div className="grid h-full min-h-0 grid-cols-[340px_1fr]">
      <div
        data-testid="master-pane"
        className="min-h-0 overflow-y-auto border-r border-line bg-subtle px-4 pt-5 pb-16"
      >
        {listPane}
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
