"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type AdminNavItem, isActive } from "./nav";
import { focusRing } from "./ui";

/** The admin menu; the current page is marked for assistive technologies too (`aria-current`). */
export function AdminNavLinks({ items }: { items: Array<AdminNavItem & { label: string }> }) {
  const pathname = usePathname();
  return (
    // One row that scrolls sideways on a phone (the menu stays a single line under the bar), a column on a computer.
    <ul className="-mx-space-3 flex flex-row gap-space-1 overflow-x-auto px-space-3 md:sticky md:top-space-8 md:mx-space-0 md:flex-col md:overflow-visible md:px-space-0 md:py-space-3">
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
  );
}
