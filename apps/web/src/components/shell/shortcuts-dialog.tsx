"use client";

import { useSyncExternalStore } from "react";
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from "@agent-hub/ui";
import { navItem } from "@/components/shell/nav";
import { isApplePlatform, shortcutGroups } from "@/components/shell/shell-hotkeys";

const noSubscription = () => () => {};

/**
 * The `?` dialog (#1071): every shell shortcut, generated from the binding
 * table so it cannot list a key that does nothing. Opened by `?`, and by the
 * Keyboard shortcuts entry in the account and Support menus.
 */
export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  // ⌘ on a Mac, Ctrl elsewhere. The content renders only while open, which is
  // only ever on the client, so the server snapshot is never what anyone reads.
  const apple = useSyncExternalStore(noSubscription, () => isApplePlatform(navigator.platform), () => true);
  const groups = shortcutGroups((id) => navItem(id).label, { apple });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
            {groups.map((group) => (
              <section key={group.title} aria-label={group.title} className={group.title === "Go to" ? "sm:row-span-2" : undefined}>
                <h3 className="text-muted-foreground mb-2 text-xs font-semibold">{group.title}</h3>
                <dl className="flex flex-col gap-1.5">
                  {group.rows.map((row) => (
                    <div key={row.label} className="flex items-center justify-between gap-4 text-sm">
                      <dt className="min-w-0 truncate">{row.label}</dt>
                      <dd className="flex shrink-0 items-center gap-1.5">
                        {row.keys.map((combo, i) => (
                          <span key={i} className="flex items-center gap-0.5">
                            {i > 0 && <span className="text-muted-foreground mr-1 text-xs">or</span>}
                            {combo.map((part, j) => (
                              <kbd
                                key={j}
                                className="border-alpha-medium bg-alpha-lighter text-muted-foreground inline-grid h-5 min-w-5 place-items-center rounded-sm border px-1 font-sans text-2xs"
                              >
                                {part}
                              </kbd>
                            ))}
                          </span>
                        ))}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>
          <p className="text-muted-foreground mt-5 text-xs">
            Letter shortcuts do nothing while you type in a field. Press G, then a letter within about a second.
          </p>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
