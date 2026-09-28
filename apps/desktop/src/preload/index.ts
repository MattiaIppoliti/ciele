// The entire bridge between the app's own renderer and the main process.
//
// It is deliberately small and it is deliberately not attached to the product
// window (see src/main/windows.ts): nothing here should ever be reachable from
// a page this app did not write. Every method is a named invoke, no generic
// `invoke(channel, ...)` escape hatch, which would make the surface unbounded.

import { contextBridge, ipcRenderer } from "electron";
import { CHANNELS, type AppState, type CieleBridge, type Mode } from "../shared/state";
import { SETUP_CHANNELS, type SetupBridge, type SetupSnapshot } from "../shared/setup-ipc";
import { STACK_CHANNELS, type StackBridge, type StackStatus } from "../shared/stack";

/**
 * A listener on one fixed push channel from main; the return unsubscribes.
 * The channel is bound here, so the renderer still cannot pick one.
 */
function subscribe<T>(channel: string) {
  return (listener: (payload: T) => void) => {
    const handler = (_event: unknown, payload: T) => listener(payload);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.off(channel, handler);
  };
}

const bridge: CieleBridge & SetupBridge & StackBridge = {
  getState: () => ipcRenderer.invoke(CHANNELS.getState),
  onState: subscribe<AppState>(CHANNELS.stateChanged),
  onNavigate: subscribe<string>(CHANNELS.navigate),
  chooseMode: (mode: Mode) => ipcRenderer.invoke(CHANNELS.chooseMode, mode),
  openProduct: () => ipcRenderer.invoke(CHANNELS.openProduct),
  signOut: () => ipcRenderer.invoke(CHANNELS.signOut),
  setSaasBaseUrl: (url: string) => ipcRenderer.invoke(CHANNELS.setSaasBaseUrl, url),
  dismissUpdate: () => ipcRenderer.invoke(CHANNELS.dismissUpdate),
  openExternal: (url: string) => ipcRenderer.invoke(CHANNELS.openExternal, url),
  setSoundsMuted: (muted: boolean) => ipcRenderer.invoke(CHANNELS.setSoundsMuted, muted),

  setup: {
    getSnapshot: () => ipcRenderer.invoke(SETUP_CHANNELS.getSnapshot),
    onSnapshot: subscribe<SetupSnapshot>(SETUP_CHANNELS.snapshotChanged),
    run: () => ipcRenderer.invoke(SETUP_CHANNELS.run),
    retry: () => ipcRenderer.invoke(SETUP_CHANNELS.retry),
    skip: () => ipcRenderer.invoke(SETUP_CHANNELS.skip),
    setInput: (stepId: string, values: Record<string, string>) =>
      ipcRenderer.invoke(SETUP_CHANNELS.setInput, stepId, values),
    revisit: (stepId: string) => ipcRenderer.invoke(SETUP_CHANNELS.revisit, stepId),
    reset: () => ipcRenderer.invoke(SETUP_CHANNELS.reset),
  },

  stack: {
    status: () => ipcRenderer.invoke(STACK_CHANNELS.status),
    onStatus: subscribe<StackStatus>(STACK_CHANNELS.statusChanged),
    start: () => ipcRenderer.invoke(STACK_CHANNELS.start),
    stop: () => ipcRenderer.invoke(STACK_CHANNELS.stop),
  },
};

contextBridge.exposeInMainWorld("ciele", bridge);
