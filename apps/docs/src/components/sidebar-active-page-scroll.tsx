'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

/** Keep the selected API operation visible in the independently scrolling docs sidebar. */
export function SidebarActivePageScroll() {
  const pathname = usePathname();

  useEffect(() => {
    if (!/(^|\/)api-reference(\/|$)/.test(pathname)) return;

    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        const sidebar = document.querySelector<HTMLElement>('#nd-sidebar');
        if (!sidebar) return;

        const active = sidebar.querySelector<HTMLElement>('a[data-active="true"]');
        const scroller = [...sidebar.querySelectorAll<HTMLElement>('*')].find((element) => {
          const overflowY = getComputedStyle(element).overflowY;
          return (
            (overflowY === 'auto' || overflowY === 'scroll') &&
            element.scrollHeight > element.clientHeight
          );
        });
        if (!active || !scroller) return;

        const activeRect = active.getBoundingClientRect();
        const sidebarRect = scroller.getBoundingClientRect();
        const top = activeRect.top - sidebarRect.top;
        const bottom = activeRect.bottom - sidebarRect.top;
        const margin = 16;

        if (top < margin) {
          scroller.scrollTo({ top: scroller.scrollTop + top - margin, behavior: 'smooth' });
        } else if (bottom > scroller.clientHeight - margin) {
          scroller.scrollTo({
            top: scroller.scrollTop + bottom - scroller.clientHeight + margin,
            behavior: 'smooth',
          });
        }
      });
    });

    return () => {
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
    };
  }, [pathname]);

  return null;
}
