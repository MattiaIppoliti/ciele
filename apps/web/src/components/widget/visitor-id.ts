/**
 * The anonymous Visitor's id: minted once per browser and kept in
 * localStorage, so the widget's history and escalations stay tied together
 * across page loads.
 */
export function visitorId(): string {
  const key = "ciele-visitor";
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
  }
  return id;
}
