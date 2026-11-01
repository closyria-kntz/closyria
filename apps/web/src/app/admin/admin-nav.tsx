"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type AdminNavItem, isActive } from "./nav";
import { focusRing } from "./ui";

/** The admin menu; the current page is marked for assistive technologies too (`aria-current`). */
export function AdminNavLinks({ items }: { items: Array<AdminNavItem & { label: string }> }) {
  const pathname = usePathname();
  return (
    <ul className="flex flex-row flex-wrap gap-space-1 md:flex-col">
      {items.map((item) => {
        const current = isActive(item, pathname);
        return (
          <li key={item.key}>
            <Link
              href={item.href}
              aria-current={current ? "page" : undefined}
              className={`block rounded-button px-space-3 py-space-2 text-sm hover:bg-surface-strong aria-[current=page]:bg-surface-strong aria-[current=page]:font-strong ${focusRing}`}
            >
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
