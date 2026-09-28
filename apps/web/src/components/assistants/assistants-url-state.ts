import { filtersFromSearchParams } from "@/lib/url-state";

/** The assistants dashboard's search, order and layout, as the URL spells them. */
export interface AssistantsUrlState {
  q: string;
  sort: "updated" | "name";
  view: "grid" | "list";
}

export const DEFAULT_ASSISTANTS_URL_STATE: AssistantsUrlState = {
  q: "",
  sort: "updated",
  view: "grid",
};

export function assistantsUrlStateFromSearchParams(
  params: URLSearchParams | Record<string, string | string[] | undefined>,
): AssistantsUrlState {
  return filtersFromSearchParams(params, DEFAULT_ASSISTANTS_URL_STATE, {
    sort: ["updated", "name"],
    view: ["grid", "list"],
  });
}
