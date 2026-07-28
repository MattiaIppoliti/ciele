/**
 * One Settings tab's heading, at the dialog's scale.
 *
 * Deliberately its own server component rather than a second export from
 * `settings-dialog.tsx`: that module is a client component, so importing the
 * wrapper from there would pull every settings page into the client boundary.
 */
export function SettingsPanel({
  title,
  description,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-2xl pr-6">
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      {description && (
        <p className="text-muted-foreground mt-1 text-sm">{description}</p>
      )}
      {children}
    </div>
  );
}
