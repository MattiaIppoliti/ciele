// The application menu is the only native chrome that is always reachable.
//
// It has to be: once the product window is up it fills the frame with the web
// app, which knows nothing about modes or the local stack. Without a menu the
// only way back to the app's own screens would be quitting.

import { Menu, app, shell, type MenuItemConstructorOptions } from "electron";

export interface MenuActions {
  showWelcome(): void;
  showSettings(): void;
  showStack(): void;
  openProduct(): void;
  signOut(): void;
}

export function installAppMenu(actions: MenuActions): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        {
          label: "Settings…",
          accelerator: "CmdOrCtrl+,",
          click: () => actions.showSettings(),
        },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "Ciele",
      submenu: [
        { label: "Open Ciele", accelerator: "CmdOrCtrl+O", click: () => actions.openProduct() },
        { type: "separator" },
        { label: "Choose Mode…", click: () => actions.showWelcome() },
        { label: "Local Stack Status", click: () => actions.showStack() },
        { type: "separator" },
        { label: "Sign Out", click: () => actions.signOut() },
      ],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        {
          label: "Ciele Desktop Guide",
          click: () => void shell.openExternal("https://docs.ciele.app/self-hosting/desktop"),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
