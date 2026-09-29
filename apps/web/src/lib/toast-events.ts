export type ToastStatus = "pending" | "success" | "error" | "warning" | "info";
export type ToastAction = { label: string; run: () => void };
export type ToastInput = {
  id?: string;
  message: string;
  state?: ToastStatus;
  action?: ToastAction;
  lifetime?: number;
};
export type ToastNote = ToastInput & { id: string };

export const TOAST_EVENT = "ciele:toast";

let nextId = 0;

export function emitToast(input: string | ToastInput): string | undefined {
  if (typeof window === "undefined") return undefined;
  const detail = typeof input === "string" ? { message: input } : input;
  const id = detail.id ?? `toast-${++nextId}`;
  window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail: { ...detail, id } }));
  return id;
}
