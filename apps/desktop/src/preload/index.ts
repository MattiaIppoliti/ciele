// The entire bridge between the app's own renderer and the main process.
//
// It is deliberately small and it is deliberately not attached to the product
// window (see src/main/windows.ts): nothing here should ever be reachable from
// a page this app did not write. Every method is a named invoke — no generic
// `invoke(channel, ...)` escape hatch, which would make the surface unbounded.

import { contextBridge, ipcRenderer } from "electron";
import { CHANNELS, type AppState, type CieleBridge, type Mode } from "../shared/state";
import { SETUP_CHANNELS, type SetupBridge, type SetupSnapshot } from "../shared/setup-ipc";
import { STACK_CHANNELS, type StackBridge, type StackStatus } from "../shared/stack";

const bridge: CieleBridge & SetupBridge & StackBridge = {
  getState: () => ipcRenderer.invoke(CHANNELS.getState),
  onState: (listener: (state: AppState) => void) => {
    const handler = (_event: unknown, state: AppState) => listener(state);
    ipcRenderer.on(CHANNELS.stateChanged, handler);
    return () => ipcRenderer.off(CHANNELS.stateChanged, handler);
  },
  onNavigate: (listener: (route: string) => void) => {
    const handler = (_event: unknown, route: string) => listener(route);
    ipcRenderer.on(CHANNELS.navigate, handler);
    return () => ipcRenderer.off(CHANNELS.navigate, handler);
  },
  chooseMode: (mode: Mode) => ipcRenderer.invoke(CHANNELS.chooseMode, mode),
  openProduct: () => ipcRenderer.invoke(CHANNELS.openProduct),
  signOut: () => ipcRenderer.invoke(CHANNELS.signOut),
  setSaasBaseUrl: (url: string) => ipcRenderer.invoke(CHANNELS.setSaasBaseUrl, url),
  dismissUpdate: () => ipcRenderer.invoke(CHANNELS.dismissUpdate),
  openExternal: (url: string) => ipcRenderer.invoke(CHANNELS.openExternal, url),

  setup: {
    getSnapshot: () => ipcRenderer.invoke(SETUP_CHANNELS.getSnapshot),
    onSnapshot: (listener: (snapshot: SetupSnapshot) => void) => {
      const handler = (_event: unknown, snapshot: SetupSnapshot) => listener(snapshot);
      ipcRenderer.on(SETUP_CHANNELS.snapshotChanged, handler);
      return () => ipcRenderer.off(SETUP_CHANNELS.snapshotChanged, handler);
    },
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
    onStatus: (listener: (status: StackStatus) => void) => {
      const handler = (_event: unknown, status: StackStatus) => listener(status);
      ipcRenderer.on(STACK_CHANNELS.statusChanged, handler);
      return () => ipcRenderer.off(STACK_CHANNELS.statusChanged, handler);
    },
    start: () => ipcRenderer.invoke(STACK_CHANNELS.start),
    stop: () => ipcRenderer.invoke(STACK_CHANNELS.stop),
  },
};

contextBridge.exposeInMainWorld("ciele", bridge);
