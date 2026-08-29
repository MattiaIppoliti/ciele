'use client';

import { useEffect, useId, useState } from 'react';
import { CopyFeedbackIcon, useCopyFeedback } from '@agent-hub/ui';

/**
 * Stable 32-bit hash of the chart source.
 *
 * Feeds mermaid's `handDrawnSeed` so the sketch wobble is deterministic: the
 * same diagram gets the same strokes on every render (including a theme flip),
 * instead of visibly re-scribbling itself.
 */
function seedOf(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/**
 * Reads a Fumadocs theme token off the document root.
 *
 * Feeding these into mermaid's `themeVariables` is what makes a diagram share
 * the documentation palette in both light and dark, instead of shipping
 * mermaid's own two themes. The fallback covers a token being renamed upstream.
 */
function token(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value || fallback;
}

/**
 * Mermaid diagram block for MDX content.
 *
 * Registered as `<Mermaid />` in `components/mdx.tsx`, so any page can write a
 * diagram inline without importing anything. The `mermaid` package is loaded
 * through a dynamic `import()`, which keeps it in its own chunk, pages without
 * a diagram never download it.
 *
 * Theme: Fumadocs' `RootProvider` toggles a `dark` class on `<html>`, so the
 * colour scheme is read from that class and re-rendered when it changes. That
 * avoids depending on `next-themes` directly (it is fumadocs' transitive
 * dependency, not ours).
 */
export function Mermaid({
  chart,
  title,
}: {
  /** Mermaid source, e.g. a `flowchart LR` or `sequenceDiagram` body. */
  chart: string;
  /** Accessible name for the diagram, also rendered as a caption. */
  title?: string;
}) {
  // `useId` contains colons, which are not valid in the DOM id mermaid needs.
  const id = `mermaid-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const [dark, setDark] = useState<boolean | null>(null);
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const { isCopied, copyText } = useCopyFeedback<string>();
  const source = chart.trim();

  // Render only on the client (mermaid needs a DOM), and follow theme changes.
  useEffect(() => {
    const read = () => setDark(document.documentElement.classList.contains('dark'));
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (dark === null) return;
    let cancelled = false;

    void (async () => {
      try {
        const { default: mermaid } = await import('mermaid');
        // Read the live palette so both themes come from one source of truth.
        const card = token('--color-fd-card', dark ? '#191919' : '#ffffff');
        const bg = token('--color-fd-background', dark ? '#121212' : '#ffffff');
        const fg = token('--color-fd-foreground', dark ? '#ebebeb' : '#171717');
        const muted = token('--color-fd-muted', dark ? '#212121' : '#f4f4f5');
        mermaid.initialize({
          startOnLoad: false,
          // `strict` sanitizes the generated SVG. We never bind click handlers,
          // so nothing here needs the permissive `loose` level.
          securityLevel: 'strict',
          // Handwriting face to match the sketched strokes (see layout.tsx).
          fontFamily: 'var(--font-sketch), ui-rounded, cursive',
          theme: dark ? 'dark' : 'default',
          // Sketched, Excalidraw-like strokes instead of exact vectors. Applies
          // to diagram types on mermaid's unified renderer (flowchart, class,
          // state); the others fall back to their normal look on their own.
          look: 'handDrawn',
          handDrawnSeed: seedOf(source),
          // `useMaxWidth: false` keeps each diagram at its natural size rather
          // than scaling it down to the prose column, a wide diagram squeezed
          // into ~650px is unreadable. Wide ones scroll inside the figure
          // instead; see the wrapper below.
          flowchart: {
            // Straight segments, not `basis` splines: sweeping curves are what
            // make a diagram read as tangled.
            curve: 'linear',
            useMaxWidth: false,
            nodeSpacing: 28,
            rankSpacing: 44,
            padding: 8,
          },
          sequence: { useMaxWidth: false, actorMargin: 14, width: 112 },
          er: { useMaxWidth: false },
          themeVariables: {
            // A documentation column is narrow; the default 16px makes even a
            // modest diagram overflow it.
            fontSize: '13px',
            // The hand-drawn look fills shapes with hachure (diagonal pencil
            // strokes). Filling with the figure's own background makes that
            // hatch blend away, leaving the sketched outline, the Excalidraw
            // look rather than a shaded box.
            mainBkg: card,
            nodeBorder: fg,
            titleColor: fg,
            textColor: fg,
            nodeTextColor: fg,
            lineColor: fg,
            // Group boxes should recede behind their contents, not read as a
            // solid block the way mermaid's default mid-grey does.
            clusterBkg: bg,
            clusterBorder: muted,
          },
        });
        const rendered = await mermaid.render(id, source);
        if (!cancelled) setSvg(rendered.svg);
      } catch {
        // A malformed diagram must not take the page down, fall back to the
        // source, which is still readable.
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [dark, id, source]);

  if (failed) {
    return (
      <pre className="my-6 overflow-x-auto rounded-lg border border-fd-border bg-fd-card p-4 text-sm">
        <code>{source}</code>
      </pre>
    );
  }

  const copied = isCopied(id);

  return (
    <figure
      // Stays inside the prose column: `w-full` + `min-w-0` so a wide diagram
      // scrolls *within* the figure instead of stretching it past the text and
      // over the table of contents. `relative` anchors the copy button.
      className="group relative my-6 w-full min-w-0 rounded-lg border border-fd-border bg-fd-card p-4"
      aria-label={title}
      role="group"
    >
      <button
        type="button"
        onClick={() => void copyText(id, source)}
        // Always reachable by keyboard; only fades in on hover/focus so it does
        // not compete with the diagram itself.
        // `whitespace-nowrap` + a label that never changes keeps the icon and
        // text on one line and the button the same size, so flipping to the
        // check mark cannot reflow it.
        className="absolute right-2 top-2 z-10 inline-flex flex-nowrap items-center gap-1.5 whitespace-nowrap rounded-md border border-fd-border bg-fd-card/90 px-2 py-1 text-xs text-fd-muted-foreground opacity-0 backdrop-blur transition-opacity hover:text-fd-foreground focus-visible:opacity-100 group-hover:opacity-100 motion-reduce:transition-none"
        aria-label={copied ? 'Diagram source copied' : 'Copy diagram source'}
      >
        <CopyFeedbackIcon copied={copied} className="size-3.5" />
        <span>Mermaid</span>
      </button>
      {/* A diagram wider than the prose column scrolls here rather than
          shrinking; `max-w-none` overrides the prose reset that would scale it
          back down. */}
      <div className="overflow-x-auto [&_svg]:mx-auto [&_svg]:block [&_svg]:h-auto [&_svg]:max-w-none">
        {svg ? (
          <div dangerouslySetInnerHTML={{ __html: svg }} />
        ) : (
          <div aria-hidden className="h-32 animate-pulse rounded bg-fd-muted" />
        )}
      </div>
      {title ? (
        <figcaption className="mt-3 text-center text-sm text-fd-muted-foreground">
          {title}
        </figcaption>
      ) : null}
    </figure>
  );
}
