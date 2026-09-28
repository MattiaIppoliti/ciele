/** The two free-text fields the detail view edits in place. */
export interface ImprovementTextFields {
  title: string;
  description: string;
}

/**
 * The patch that would bring the server up to what the fields show, or null
 * when there is nothing to send. A blank title is not an edit: the field puts
 * the saved title back on blur, so flushing it would erase the item's name.
 */
export function unsavedEdits(
  saved: ImprovementTextFields,
  current: ImprovementTextFields,
): Partial<ImprovementTextFields> | null {
  const patch: Partial<ImprovementTextFields> = {};
  const title = current.title.trim();
  if (title && title !== saved.title) patch.title = title;
  if (current.description !== saved.description) {
    patch.description = current.description;
  }
  return Object.keys(patch).length > 0 ? patch : null;
}
