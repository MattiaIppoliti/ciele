import type { ChatReplyPart } from "@agent-hub/agent/client";
import { normalizeTable } from "@agent-hub/agent/client";

/**
 * Reply Components, client half: one component per catalogue entry the runtime
 * can emit (`render-tools.ts`), keyed by the part's `name`.
 *
 * Shared by the widget, the admin Preview and the Inbox transcript on purpose.
 * The nine older reply kinds are rendered by three separate if-chains that have
 * already drifted (the iframe part renders differently in each). A catalogue
 * meant to grow cannot afford that, so it gets one implementation and all three
 * surfaces call it.
 *
 * Shape rules are NOT re-implemented here: `normalizeTable` squares, caps and
 * type-checks the props, the same call the server's part builder and the Inbox
 * export make. That matters most on this side, because a live client renders
 * props parsed out of a half-written argument stream, which passed through no
 * schema at all.
 */

type ComponentPart = Extract<ChatReplyPart, { type: "component" }>;

/**
 * A table of retrieved rows, whose rows can be asked about.
 *
 * The asking is the point. Answer text already renders GFM tables on every
 * surface (`chat-markdown.tsx`), so a component that only laid text out would
 * buy nothing; what markdown cannot do is carry behaviour. `onAsk` is absent on
 * read-only surfaces (the Inbox transcript), and then the rows are just rows.
 */
function TableComponent({
  props,
  pending,
  onAsk,
}: {
  props: Record<string, unknown>;
  pending?: boolean;
  onAsk?: (text: string) => void;
}) {
  const table = normalizeTable(props);

  // Still streaming and no headers yet: hold the space so the answer below does
  // not jump once the first cells land.
  if (!table) {
    return pending ? (
      <div className="w-full max-w-[92%] animate-pulse space-y-2 rounded-xl border p-3">
        <div className="h-3 w-1/3 rounded bg-muted" />
        <div className="h-3 w-full rounded bg-muted" />
        <div className="h-3 w-2/3 rounded bg-muted" />
      </div>
    ) : null;
  }

  const askable = Boolean(onAsk) && table.askAbout.some(Boolean);

  return (
    <div
      className="w-full max-w-[92%] space-y-1.5"
      aria-busy={pending ? true : undefined}
    >
      {table.title && <p className="text-sm font-medium">{table.title}</p>}
      {/* A chat bubble is narrow and a table is not: it scrolls in its own box
          rather than widening the conversation. */}
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="bg-muted/60">
            <tr>
              {table.columns.map((column, index) => (
                <th
                  key={index}
                  scope="col"
                  className="border-b px-3 py-2 font-medium whitespace-nowrap"
                >
                  {column}
                </th>
              ))}
              {askable && <th className="border-b px-2 py-2" />}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, rowIndex) => {
              const ask = table.askAbout[rowIndex];
              return (
                <tr key={rowIndex} className="border-b last:border-b-0">
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex} className="px-3 py-2 align-top">
                      {cell}
                    </td>
                  ))}
                  {askable && (
                    <td className="px-2 py-2 align-top">
                      {ask && onAsk && (
                        // The label IS the question. It is model-authored text
                        // that gets posted as the Visitor's own message, so
                        // they read it before they send it; a button reading
                        // "Ask" would send words they never saw. Same contract
                        // as the follow-up questions under an answer.
                        <button
                          type="button"
                          onClick={() => onAsk(ask)}
                          title={ask}
                          className="text-muted-foreground max-w-[14rem] truncate rounded-md border px-2 py-1 text-left text-xs transition-colors hover:bg-muted hover:text-foreground"
                        >
                          {ask}
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {table.caption && (
        <p className="text-muted-foreground text-xs">{table.caption}</p>
      )}
    </div>
  );
}

export function ComponentReplyPart({
  part,
  onAsk,
}: {
  part: ComponentPart;
  /** Sends a follow-up on the Visitor's behalf; omitted on read-only surfaces. */
  onAsk?: (text: string) => void;
}) {
  switch (part.name) {
    case "table":
      return (
        <TableComponent props={part.props} pending={part.pending} onAsk={onAsk} />
      );
    default:
      // Unreachable by the type, reachable in production: a published widget
      // can be serving a bundle older than the runtime that wrote the part.
      // Skipping it beats rendering a broken frame in a transcript.
      return null;
  }
}
