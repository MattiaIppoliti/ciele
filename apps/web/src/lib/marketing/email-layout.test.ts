import { describe, expect, it } from "vitest";
import { escapeHtml, renderBrandedEmail } from "./email-layout";

describe("escapeHtml", () => {
  it("neutralises the four characters that can break out of an attribute or body", () => {
    expect(escapeHtml(`<img src="x" onerror=alert(1)> & done`)).toBe(
      "&lt;img src=&quot;x&quot; onerror=alert(1)&gt; &amp; done"
    );
  });
});

describe("renderBrandedEmail", () => {
  const base = {
    preheader: "One click and you are on the list.",
    heading: "Confirm your subscription",
    paragraphs: ["First line.", "Second line."],
  };

  it("renders the wordmark, the heading and every paragraph", () => {
    const html = renderBrandedEmail(base);
    expect(html).toContain(">Ciele</a>");
    expect(html).toContain("Confirm your subscription");
    expect(html).toContain("First line.");
    expect(html).toContain("Second line.");
  });

  it("hides the preheader from the body while leaving it in the source", () => {
    const html = renderBrandedEmail(base);
    expect(html).toContain("One click and you are on the list.");
    expect(html).toContain("display:none;max-height:0");
  });

  it("omits the button and the URL fallback when there is no CTA", () => {
    const html = renderBrandedEmail(base);
    expect(html).not.toContain("Or paste this into your browser");
    expect(html).not.toContain("border-radius:999px");
  });

  it("repeats the CTA URL as text so a client that strips buttons is not a dead end", () => {
    const html = renderBrandedEmail({
      ...base,
      cta: { label: "Confirm subscription", url: "https://ciele.app/x?token=a&b=c" },
      showUrlFallback: true,
    });
    // Once in the button href, once in the fallback href, once as its text.
    expect(html.split("https://ciele.app/x?token=a&amp;b=c")).toHaveLength(4);
    expect(html).toContain("Or paste this into your browser");
  });

  it("escapes a URL and a label rather than pasting them into the markup", () => {
    const html = renderBrandedEmail({
      ...base,
      heading: 'Hello "<script>"',
      cta: { label: "<b>go</b>", url: 'https://x.test/"><script>alert(1)</script>' },
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;b&gt;go&lt;/b&gt;");
  });

  it("declares both colour schemes so a dark client does not invert it by force", () => {
    const html = renderBrandedEmail(base);
    expect(html).toContain('name="color-scheme" content="light dark"');
    expect(html).toContain("prefers-color-scheme: dark");
  });
});
