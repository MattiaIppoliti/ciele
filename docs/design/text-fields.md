# Smooth text fields

The native input or textarea remains the editor. `TextFieldMotion` mounts once
in the app root and paints only its focused field with the composer's
`SPRING_CARET`. Shared Input/Textarea primitives, raw fields, the composer,
search fields and fields mounted later in portals receive the same behavior.
The supplied SmoothInput example informs the behavior; its DialKit demo controls
and extra wrapper are unnecessary in the product.

The painter measures the full text at the native selection using an invisible
mirror. It preserves line wrapping, typography, padding, scrolling and scaled
panels. Password mirrors contain mask characters only. Selection and IME retain
the native editor. Focus and line changes jump to their position; movement within
a line glides. Reduced motion also jumps, including preference changes while a
field is focused. Numeric/date controls and email/URL editors whose browsers do
not expose selection coordinates keep their native caret.

The visual layer is a manual, non-interactive popover so it can paint inside
native dialogs. It is clipped to the editor and its scrolling ancestors, remains
outside the focus order and adds no wrapper or layout space. There is no server
rendered overlay and no per-keystroke React render. Only the focused editor is
monitored; blur, removal and unmount restore its native caret.

## Tab completion

Tab accepts the visible placeholder in an empty editable text field, or a
remaining suggestion that matches the typed prefix when the caret is at its end.
The remaining suffix appears beside typed text. An explicit `data-text-suggestion`
value takes precedence; otherwise datalist values precede the placeholder.
The browser retains native insertion and undo. Completion updates controlled
React fields through the real input event and never submits or saves a form.

Shift+Tab remains backward navigation. Tab also retains its normal behavior for
selections, unrelated text, completed suggestions, composition, a suggestion menu
with `aria-expanded="true"`, or a key already handled by the field. Candidates
must fit `maxLength`. Read-only, disabled and password fields never complete.
`data-text-completion="off"` opts out; shared PasswordInput retains that opt-out
when its reveal button switches its native type to text. An accessible status
announces an available suggestion.

## Verification

`node apps/web/scripts/check-text-fields.mjs` checks actual controlled Flow and
composer fields, native undo, raw inputs, prefix completion, normal Tab and
Shift+Tab, selection, IME, existing handlers, password masking and opt-outs,
maximum length, datalists, email validity, multiline scrolling, native dialogs,
live reduced motion and mobile bounds. It edits only an unsaved draft and
adds temporary local fixtures; it never saves a form or sends a chat request.
