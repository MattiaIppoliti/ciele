# Squircle surfaces

The admin interface uses the filter from [Skiper UI's Apple squicircle
effect](https://skiper-ui.com/v1/skiper63), by gxuri. See
`apps/web/src/components/v1/skiper63.NOTICE.md` for attribution and source terms.
The app mounts one SVG definition through `AppInteractions`, with blur `10`,
alpha multiplier `20`, and alpha offset `-7`.

The filter applies to background pseudo-elements on shared Cards, standard
Dialogs, the Improvements list and task panel, and the Flow
toolbar rail and selected tool pad. Text, icons, native inputs, focus rings,
resizing handles and hit areas remain outside the filter. Overview retains its
gray outer frame, inner panel and hover treatment. Its outlined inset uses native
rounding so the border and fill share one contour. Its title and circular
icon sit below the content, outside the filtered background. Other cards retain
the existing sheen.

Keep scrolling popovers, the step catalogue, scrolling dialog containers,
transparent dialogs, tables and dense text controls on their native backgrounds.
A background pseudo-element inside a scrolling container would move out of view.
The Improvements panel instead scrolls its inner content, so its background stays
fixed while the task scrolls or switches to full screen.

Styles activate only after the shared filter mounts and only on the admin
surface. Server HTML and other surfaces retain their native styling. Forced
colors disables the SVG effect and uses system colors. The filter adds no motion
and leaves the existing reduced-motion behavior intact.
