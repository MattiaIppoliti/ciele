/**
 * The Project view a Member last opened, which `/projects/{id}` opens on
 * (#1050). A cookie rather than browser storage, so the server's redirect can
 * read it and the Project opens on the right view without a client hop.
 */
export const PROJECT_VIEW_COOKIE = "ciele.project-view";

/** The built-in views a remembered value may name; a Saved View is never the default. */
export const DEFAULT_PROJECT_VIEWS = ["overview", "list", "board", "table", "calendar", "timeline", "files", "activity"] as const;
export type DefaultProjectView = (typeof DEFAULT_PROJECT_VIEWS)[number];

/** The view to open: the remembered one when it is still a view, else the List. */
export function defaultProjectView(remembered: string | undefined): DefaultProjectView {
  return DEFAULT_PROJECT_VIEWS.find((view) => view === remembered) ?? "list";
}

/** Remembers a view for a year, for this browser. */
export function rememberProjectView(view: string): void {
  if (!DEFAULT_PROJECT_VIEWS.some((known) => known === view)) return;
  document.cookie = `${PROJECT_VIEW_COOKIE}=${view}; path=/; max-age=31536000; samesite=lax`;
}
