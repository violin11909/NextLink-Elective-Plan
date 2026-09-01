"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const sections = [
  { href: "/", label: "ภาพรวมแผน" },
  { href: "/rooms", label: "ห้องเรียน" },
  { href: "/courses/list", label: "รายวิชา" },
  { href: "/courses", label: "ช่วงที่สะดวก" },
];

/**
 * One nav for every header, including the loading skeleton's.
 *
 * Each dashboard used to carry its own copy and the skeleton carried none, so
 * switching sections made the whole control vanish and come back — the worst
 * kind of flicker to sit under the cursor you just clicked with.
 */
export function AppNav() {
  const pathname = usePathname();

  return (
    <nav className="app-nav" aria-label="ส่วนของระบบ">
      {sections.map((section) => {
        const isActive = pathname === section.href;
        return (
          <Link
            key={section.href}
            className={isActive ? "is-active" : ""}
            href={section.href}
            aria-current={isActive ? "page" : undefined}
          >
            {section.label}
          </Link>
        );
      })}
    </nav>
  );
}
