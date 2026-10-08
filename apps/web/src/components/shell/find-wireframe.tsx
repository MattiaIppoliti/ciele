
import { Button as CieleButton } from "@agent-hub/ui";
import { memo } from "react";
import { ArrowUpRight } from "lucide-react";
import {
  FIND_KIND_INFO,
  detailRequest,
  opensInNewTab,
  type FindPageContent,
  type FindPreviewData,
} from "@/lib/find-index";
import {
  describePage,
  wireframeFor,
  type PageLink,
  type WireframeKind,
} from "@/lib/find-pages";
import type { FindItem } from "@/components/shell/find-row";
import { cn } from "@/lib/utils";

/**
 * The Find preview, the right-hand pane: the highlighted result drawn as a
 * small page, with the little that is worth reading written into it. A
 * heading, its properties and a paragraph are real text, a conversation's
 * first exchange is real bubbles, a help desk's channels are real rows. What is heavy or unbounded, a table's
 * rows, a kanban's cards, a chart, stays a grey block in the right shape.
 *
 * So it reads as one page rather than a card of facts above a drawing, and it
 * costs a few dozen DOM nodes and no request of its own however fast someone
 * arrows through results. Everything is built from the same three greys
 * (`bar`, `soft`, `line`), so it follows the theme without a colour of its own.
 *
 * What the list already read fills it at once. The detail (a conversation's
 * first exchange, a help desk's channels) lands a beat later for the row being
 * looked at. Nothing else is loaded.
 */

/** Opens a link inside the preview. Receives whether it was meant for a new tab. */
type Navigate = (href: string, newTab: boolean) => void;

/** What a drawing writes in: the page's own content and the row's detail, either maybe empty. */
interface DrawingProps {
  /** What a console page holds: cards, kanban titles, list rows. Empty for a record. */
  page: FindPageContent;
  /** undefined while it loads, null when there is nothing more to show. */
  detail: FindPreviewData | null | undefined;
  onNavigate: Navigate;
}

const bar = "bg-foreground/15 rounded-full";
const soft = "bg-foreground/[0.06] rounded-md";
const line = "border border-foreground/15 rounded-md";

function Bar({ w, h = "h-1.5", className }: { w: string; h?: string; className?: string }) {
  return <div className={cn(bar, h, className)} style={{ width: w }} />;
}

function Table() {
  return (
    <div className={cn(line, "overflow-hidden")}>
      <div className={cn(soft, "grid grid-cols-[2fr_1fr_1fr] gap-3 rounded-none px-3 py-2")}>
        <Bar w="50%" />
        <Bar w="60%" />
        <Bar w="40%" />
      </div>
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="border-foreground/10 grid grid-cols-[2fr_1fr_1fr] items-center gap-3 border-t px-3 py-2"
        >
          <div className="flex items-center gap-2">
            <div className={cn(bar, "size-2.5 shrink-0")} />
            <Bar w={`${55 + ((i * 17) % 35)}%`} />
          </div>
          <div className={cn(soft, "h-3 w-10")} />
          <Bar w="50%" />
        </div>
      ))}
    </div>
  );
}

/** A thing inside the preview that opens what it stands for: a lit edge on hover, a click to go in. */
const clickable =
  "cursor-pointer text-left transition-colors hover:border-foreground/45 hover:bg-foreground/[0.05] focus-visible:border-foreground/60 focus-visible:outline-none";

/**
 * A drawn card or row: a button that opens what it names when it names
 * something (`openClassName` on top), otherwise only the drawing.
 */
function Tile({
  link,
  onNavigate,
  className,
  openClassName,
  children,
}: {
  link: PageLink | undefined;
  onNavigate: Navigate;
  className: string;
  openClassName: string;
  children: React.ReactNode;
}) {
  return link ? (
    <button
      type="button"
      aria-label={`Open ${link.title}`}
      onClick={(event) => onNavigate(link.href, opensInNewTab(event))}
      className={cn(className, openClassName)}
    >
      {children}
    </button>
  ) : (
    <div className={className}>{children}</div>
  );
}

function Cards({ page, onNavigate }: DrawingProps) {
  return (
    <div className="grid grid-cols-2 gap-2.5">
      {Array.from({ length: 4 }).map((_, i) => {
        const card = page.cards[i];
        return (
          <Tile
            key={i}
            link={card}
            onNavigate={onNavigate}
            className={cn(line, "space-y-2.5 p-3")}
            openClassName={cn(clickable, "block")}
          >
            <div className="flex items-center justify-between">
              <div className={cn(soft, "size-6")} />
              <div className={cn(soft, "h-3 w-8")} />
            </div>
            {card ? (
              <>
                <p className="truncate text-xs font-semibold">{card.title}</p>
                {card.text ? (
                  <p className="text-muted-foreground line-clamp-2 text-2xs leading-snug break-words">
                    {card.text}
                  </p>
                ) : (
                  <Bar w="70%" />
                )}
              </>
            ) : (
              <>
                <Bar w="70%" h="h-2" />
                <Bar w="90%" />
                <Bar w="50%" />
              </>
            )}
          </Tile>
        );
      })}
    </div>
  );
}

function Kanban({ page, onNavigate }: DrawingProps) {
  const lanes = page.lanes;
  return (
    <div className="grid grid-cols-3 gap-2.5">
      {[3, 2, 1].map((fallback, lane) => {
        const real = lanes[lane];
        const cards = real ? Math.max(real.entries.length, 1) : fallback;
        return (
          <div key={lane} className={cn(soft, "space-y-2 p-2")}>
            {real ? (
              <p className="truncate text-2xs font-medium">{real.label}</p>
            ) : (
              <Bar w="85%" h="h-2" />
            )}
            {Array.from({ length: cards }).map((_, i) => {
              const entry = real?.entries[i];
              return (
                <Tile
                  key={i}
                  link={entry}
                  onNavigate={onNavigate}
                  className={cn(line, "bg-background/60 space-y-1.5 p-2")}
                  openClassName={cn(clickable, "block w-full")}
                >
                  {entry ? (
                    <p className="line-clamp-2 text-2xs leading-snug break-words">
                      {entry.title}
                    </p>
                  ) : (
                    <Bar w="85%" />
                  )}
                  <Bar w="55%" />
                  <div className="flex gap-1 pt-0.5">
                    <div className={cn(soft, "h-2.5 w-7")} />
                    <div className={cn(bar, "size-2.5")} />
                  </div>
                </Tile>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function Chat({ detail }: DrawingProps) {
  const messages = detail?.messages ?? [];
  const [question, answer] = [
    messages.find((m) => m.role === "user"),
    messages.find((m) => m.role === "assistant"),
  ];
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        {question ? (
          <p className="bg-foreground/[0.08] max-w-[85%] rounded-2xl px-3 py-1.5 text-xs leading-snug break-words">
            {question.text}
          </p>
        ) : (
          <div className={cn(soft, "h-6 w-2/5 rounded-2xl")} />
        )}
      </div>
      {answer ? (
        <p className="text-muted-foreground line-clamp-4 text-xs leading-relaxed break-words">
          {answer.text}
        </p>
      ) : (
        <div className="space-y-1.5">
          <Bar w="90%" />
          <Bar w="75%" />
          <Bar w="40%" />
        </div>
      )}
      <div className="flex justify-end">
        <div className={cn(soft, "h-6 w-1/3 rounded-2xl")} />
      </div>
      <div className="space-y-1.5">
        <Bar w="85%" />
        <Bar w="60%" />
      </div>
      <div className={cn(line, "mt-4 flex h-8 items-center justify-between rounded-xl px-3")}>
        <Bar w="90px" />
        <div className={cn(bar, "size-4 shrink-0")} />
      </div>
    </div>
  );
}

function Dashboard() {
  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-3 gap-2.5">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className={cn(line, "space-y-2 p-2.5")}>
            <Bar w="60%" />
            <Bar w="40%" h="h-3" />
          </div>
        ))}
      </div>
      <div className={cn(line, "flex h-24 items-end gap-1.5 p-3")}>
        {[35, 55, 40, 70, 50, 85, 60, 75, 45, 65].map((height, i) => (
          <div key={i} className={cn(soft, "flex-1 rounded-sm")} style={{ height: `${height}%` }} />
        ))}
      </div>
    </div>
  );
}

function Form() {
  return (
    <div className="space-y-3.5">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className={cn(line, "space-y-2 p-3")}>
          <Bar w="35%" h="h-2" />
          <Bar w="70%" />
          <div className={cn(line, "h-6 w-full")} />
        </div>
      ))}
      <div className="flex justify-end">
        <div className={cn(bar, "h-5 w-16 rounded-md")} />
      </div>
    </div>
  );
}

function List({ page, detail, onNavigate }: DrawingProps) {
  // Named rows come from what a record contains (a desk's channels) or from
  // the page's own rows (conversations). Every one opens what it names.
  const items = detail?.items ?? [];
  const links: PageLink[] =
    items.length > 0 ? items : page.rows.length > 0 ? page.rows : (detail?.links ?? []);
  const rows = Math.max(5, links.length);
  return (
    <div className={cn(line, "overflow-hidden")}>
      {Array.from({ length: rows }).map((_, i) => {
        const named = links[i];
        return (
          <Tile
            key={i}
            link={named}
            onNavigate={onNavigate}
            className="border-foreground/10 flex w-full items-center gap-2.5 border-t px-3 py-2.5 first:border-t-0"
            openClassName="cursor-pointer text-left transition-colors hover:bg-foreground/[0.06] focus-visible:bg-foreground/[0.08] focus-visible:outline-none"
          >
            <div className={cn(bar, "size-4 shrink-0")} />
            <div className="min-w-0 flex-1 space-y-1.5">
              {named ? (
                <p className="truncate text-xs font-medium">{named.title}</p>
              ) : (
                <Bar w={`${45 + ((i * 23) % 40)}%`} h="h-2" />
              )}
              <Bar w={`${30 + ((i * 11) % 30)}%`} />
            </div>
            <div className={cn(soft, "h-3 w-8 shrink-0")} />
          </Tile>
        );
      })}
    </div>
  );
}

function Flow() {
  return (
    <div className="flex flex-col items-center gap-0">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex flex-col items-center">
          <div className={cn(line, "flex w-44 items-center gap-2 p-2.5")}>
            <div className={cn(soft, "size-5 shrink-0")} />
            <div className="flex-1 space-y-1.5">
              <Bar w="70%" h="h-2" />
              <Bar w="45%" />
            </div>
          </div>
          {i < 2 && <div className="bg-foreground/15 h-4 w-px" />}
        </div>
      ))}
    </div>
  );
}

function Detail({ detail, onNavigate }: DrawingProps) {
  const items = detail?.items ?? [];
  return (
    <div className="space-y-3.5">
      {items.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {items.map((item, i) => (
            <ItemChip
              key={`${item.href}:${item.title}`}
              item={item}
              onNavigate={onNavigate}
              className={i === 0 ? "bg-foreground/15" : "bg-foreground/[0.06]"}
            />
          ))}
        </div>
      ) : (
        <div className="flex gap-1.5">
          {["w-12", "w-10", "w-14", "w-9"].map((w, i) => (
            <div key={i} className={cn(i === 0 ? bar : soft, "h-4", w)} />
          ))}
        </div>
      )}
      <div className={cn(line, "space-y-2 p-3")}>
        <Bar w="40%" h="h-2" />
        <Bar w="95%" />
        <Bar w="80%" />
      </div>
      <div className={cn(line, "space-y-2 p-3")}>
        <Bar w="30%" h="h-2" />
        <Bar w="85%" />
      </div>
    </div>
  );
}

const DRAWINGS: Record<WireframeKind, (props: DrawingProps) => React.ReactElement> = {
  chat: Chat,
  table: Table,
  cards: Cards,
  kanban: Kanban,
  dashboard: Dashboard,
  form: Form,
  list: List,
  flow: Flow,
  detail: Detail,
};

/** One thing a record contains, as a chip that opens where it lives. */
function ItemChip({
  item,
  onNavigate,
  className,
}: {
  item: PageLink;
  onNavigate: Navigate;
  className: string;
}) {
  return (
    <button
      type="button"
      aria-label={`Open ${item.title}`}
      onClick={(event) => onNavigate(item.href, opensInNewTab(event))}
      className={cn(
        className,
        "hover:bg-foreground/20 focus-visible:ring-ring max-w-full cursor-pointer truncate rounded-full px-2.5 py-0.5 text-2xs transition-colors focus-visible:ring-1 focus-visible:outline-none"
      )}
    >
      {item.title}
    </button>
  );
}

/** A labelled run of links, each a button with an edge that lights on hover. */
function LinkGroup({
  label,
  links,
  onNavigate,
}: {
  label: string;
  links: PageLink[];
  onNavigate: Navigate;
}) {
  return (
    <div>
      <p className="text-muted-foreground mb-1.5 text-2xs">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {links.map((link) => (
          <button
            key={`${link.href}:${link.title}`}
            type="button"
            aria-label={`Open ${link.title}`}
            onClick={(event) => onNavigate(link.href, opensInNewTab(event))}
            className={cn(
              line,
              clickable,
              "max-w-full truncate rounded-full px-2.5 py-0.5 text-2xs"
            )}
          >
            {link.title}
          </button>
        ))}
      </div>
    </div>
  );
}

export const PagePreview = memo(function PagePreview({
  item,
  detail,
  page,
  onNavigateHref: onNavigate,
  onOpen,
}: {
  item: FindItem;
  /** undefined while it loads, null when there is nothing more to show. */
  detail: FindPreviewData | null | undefined;
  /** What a console page holds, empty for a record. */
  page: FindPageContent;
  /** Opens something the preview shows, in this tab or a new one. */
  onNavigateHref: Navigate;
  onOpen: () => void;
}) {
  const { record, icon: Icon } = item;
  const kind = wireframeFor({ record, href: item.href });
  const Drawing = DRAWINGS[kind];
  const items = detail?.items ?? [];
  const links = detail?.links ?? [];
  const summary =
    detail?.summary ?? record?.snippet ?? (record ? null : describePage(item.href)?.blurb ?? null);
  // A page's blurb is already on screen, so only a record shimmers.
  const loading = record !== null && detail === undefined && detailRequest(item) !== null;
  const facts = [...(record?.facts ?? []), ...(detail?.stats ?? [])];
  if (record) {
    facts.push({
      label: "Updated",
      value: new Date(record.updatedAt).toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
      }),
    });
  }
  return (
    <div
      data-wireframe={kind}
      // Hovering the page lights it: the edge brightens, a soft glow rises from
      // the top and the band deepens. Same ink throughout, only its strength
      // changes, so it reads as the page catching light rather than recolouring.
      className="group/page border-foreground/15 bg-background/50 hover:border-foreground/30 relative overflow-hidden rounded-xl border transition-[border-color,box-shadow] duration-300 hover:shadow-[0_0_18px_-4px_color-mix(in_srgb,var(--foreground)_16%,transparent)] motion-reduce:transition-none"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover/page:opacity-100 motion-reduce:transition-none [background:radial-gradient(120%_70%_at_50%_0%,color-mix(in_srgb,var(--foreground)_10%,transparent),transparent_70%)]"
      />
      {/* The band across the top of a page, with the open control where a page
          keeps its own. */}
      {/* The light along the top edge. It is its own layer, not the band's
          background, so on hover it can grow taller and brighter without the
          page's content moving under it. */}
      <div
        aria-hidden
        className="from-foreground/[0.11] group-hover/page:from-foreground/[0.22] pointer-events-none absolute inset-x-0 top-0 h-11 bg-gradient-to-b to-transparent transition-[height,--tw-gradient-from] duration-300 group-hover/page:h-24 motion-reduce:transition-none"
      />
      <div className="relative h-9">
        <CieleButton variant="ghost" size="icon-sm"
          type="button"
          aria-label="Open"
          onClick={onOpen}
          className="group/open text-muted-foreground hover:bg-foreground/10 hover:text-foreground absolute top-1.5 right-1.5 flex size-6 items-center justify-center overflow-hidden rounded-md transition-colors"
        >
          {/* On hover the arrow leaves through the corner and comes back in from
              the opposite one (`find-open-arrow`, globals.css). */}
          <ArrowUpRight aria-hidden className="find-open-arrow size-3.5" />
        </CieleButton>
      </div>
      <div className="space-y-3.5 px-3.5 pb-4">
        <div className="flex items-start gap-2.5">
          <span className="bg-foreground/[0.08] flex size-8 shrink-0 items-center justify-center rounded-lg">
            <Icon aria-hidden className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="text-muted-foreground text-2xs">
              {record ? FIND_KIND_INFO[record.kind].singular : item.group}
            </p>
            <h3 className="text-sm leading-snug font-semibold break-words">{item.label}</h3>
            {record?.subtitle && (
              <p className="text-muted-foreground mt-0.5 text-xs break-words">{record.subtitle}</p>
            )}
          </div>
        </div>

        {summary ? (
          <p className="text-muted-foreground line-clamp-4 text-xs leading-relaxed break-words">
            {summary}
          </p>
        ) : loading ? (
          <div aria-hidden className="space-y-1.5">
            <div className="bg-foreground/10 h-2 w-11/12 rounded-full" />
            <div className="bg-foreground/10 h-2 w-8/12 rounded-full" />
          </div>
        ) : null}

        {detail?.partial && (
          <p role="status" className="text-muted-foreground text-2xs">
            Some figures could not be read and are left out.
          </p>
        )}

        {facts.length > 0 && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            {facts.map((fact, index) => (
              <div key={`${fact.label}:${index}`} className="contents">
                <dt className="text-muted-foreground">{fact.label}</dt>
                <dd className="min-w-0 break-words">{fact.value}</dd>
              </div>
            ))}
          </dl>
        )}

        {items.length > 0 && kind !== "detail" && kind !== "list" && (
          <div className="flex flex-wrap gap-1.5">
            {items.map((contained) => (
              <ItemChip
                key={`${contained.href}:${contained.title}`}
                item={contained}
                onNavigate={onNavigate}
                className="bg-foreground/[0.06]"
              />
            ))}
          </div>
        )}

        <div>
          <Drawing page={page} detail={detail} onNavigate={onNavigate} />
        </div>

        {/* Where the page leads: its own sub-pages, and what it holds that
            opens on its own. A list draws its links as rows, so it skips them. */}
        {[
          ...page.shortcuts,
          ...(kind !== "list" && links.length > 0
            ? [{ label: detail?.linksLabel ?? "Open", links }]
            : []),
        ].map((group) => (
          <LinkGroup
            key={group.label}
            label={group.label}
            links={group.links}
            onNavigate={onNavigate}
          />
        ))}
      </div>
    </div>
  );
});
