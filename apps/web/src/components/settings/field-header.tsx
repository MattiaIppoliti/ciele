/** A Settings field's title and one-line hint. */
export function FieldHeader({ title, hint }: { title: string; hint: string }) {
  return (
    <div>
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="text-muted-foreground mt-0.5 text-sm">{hint}</p>
    </div>
  );
}
