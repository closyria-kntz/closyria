"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { type AdminNavItem, isActive } from "./nav";
import { focusRing } from "./ui";

/** The fade over an edge of the menu row (phone) where more links are hidden: decorative, the row scrolls. */
const fade = "pointer-events-none absolute inset-y-space-0 w-space-7 md:hidden";

/**
 * The admin menu; the current page is marked for assistive technologies too (`aria-current`). On a phone it is one
 * row that scrolls sideways: the current link is brought into view, and a fade on an edge shows more links there.
 */
export function AdminNavLinks({ items }: { items: Array<AdminNavItem & { label: string }> }) {
  const pathname = usePathname();
  const row = useRef<HTMLUListElement>(null);
  const [more, setMore] = useState({ start: false, end: false });

  const measure = useCallback(() => {
    const list = row.current;
    if (!list) return;
    const end = list.scrollWidth - list.clientWidth;
    setMore({ start: list.scrollLeft > 1, end: list.scrollLeft < end - 1 });
  }, []);

  // The current page's link in view (the row only: the page itself never scrolls for it).
  // biome-ignore lint/correctness/useExhaustiveDependencies: run again when the page changes.
  useEffect(() => {
    const list = row.current;
    const current = list?.querySelector<HTMLElement>("[aria-current=page]");
    if (list && current && list.scrollWidth > list.clientWidth) {
      const left = current.offsetLeft - list.offsetLeft;
      if (left < list.scrollLeft || left + current.offsetWidth > list.scrollLeft + list.clientWidth) {
        list.scrollLeft = left - (list.clientWidth - current.offsetWidth) / 2;
      }
    }
    measure();
  }, [pathname, measure]);

  useEffect(() => {
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure]);

  return (
    // `md:contents`: on a computer the list sticks within the full-height column, not this wrapper.
    <div className="relative -mx-space-3 md:contents">
      <ul
        ref={row}
        onScroll={measure}
        className="flex flex-row gap-space-1 overflow-x-auto px-space-3 md:sticky md:top-space-8 md:flex-col md:overflow-visible md:px-space-0 md:py-space-3"
      >
        {items.map((item) => {
          const current = isActive(item, pathname);
          return (
            <li key={item.key}>
              <Link
                href={item.href}
                aria-current={current ? "page" : undefined}
                className={`flex min-h-touch-target items-center rounded-button px-space-3 text-sm whitespace-nowrap hover:bg-surface-strong aria-[current=page]:bg-surface-strong aria-[current=page]:font-strong ${focusRing}`}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
      {more.start && (
        <span
          aria-hidden="true"
          data-testid="nav-more-start"
          className={`${fade} left-space-0 bg-linear-to-r from-surface-sunken to-transparent`}
        />
      )}
      {more.end && (
        <span
          aria-hidden="true"
          data-testid="nav-more-end"
          className={`${fade} right-space-0 bg-linear-to-l from-surface-sunken to-transparent`}
        />
      )}
    </div>
  );
}
