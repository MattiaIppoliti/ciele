// The one send-to-every-window loop.
//
// State, setup snapshots and stack status all push the same way; three copies
// of this loop is how one of them ends up forgetting the isDestroyed guard.

import { BrowserWindow } from "electron";

/** Push a payload to every live window; the product window has no bridge and ignores it. */
export function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, payload);
  }
}
