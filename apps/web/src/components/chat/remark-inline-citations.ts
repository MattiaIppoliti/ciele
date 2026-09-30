import type { Link, Nodes, Root } from "mdast";
import type { CitationItem } from "@/components/agents/citations";

function marker(index: number): Link {
  return {
    type: "link",
    url: `#citation-${index + 1}`,
    children: [{ type: "text", value: String(index + 1) }],
    data: {
      hProperties: {
        "data-citation-index": index,
        "data-citation-numeric": true,
      },
    },
  };
}

/** Resolve explicit source IDs or public source links; never guess from a bare [n]. */
export function remarkInlineCitations({
  citations,
}: {
  citations: readonly CitationItem[];
}) {
  return (tree: Root) => {
    function visit(node: Nodes) {
      if (!("children" in node)) return;
      for (const child of node.children) {
        if (child.type === "link") {
          const index = citations.findIndex(
            (citation) =>
              child.url === `#ciele-source-${encodeURIComponent(citation.id)}` ||
              (citation.url !== undefined && citation.url === child.url),
          );
          if (index !== -1) {
            // Keep meaningful link text: replacing "the application form" by
            // a number would change the sentence. Numeric labels need no twin.
            const numeric =
              child.children.length === 1 &&
              child.children[0].type === "text" &&
              /^\[?\d+\]?$/.test(child.children[0].value);
            if (!numeric) {
              child.children.push({ type: "text", value: " " });
            }
            const reference = marker(index);
            child.data = {
              hProperties: {
                "data-citation-index": index,
                "data-citation-numeric": numeric,
              },
            };
            child.url = reference.url;
            if (numeric) child.children = reference.children;
          }
        } else {
          visit(child);
        }
      }
    }
    visit(tree);
  };
}
