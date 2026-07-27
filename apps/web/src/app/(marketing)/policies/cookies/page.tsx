import type { Metadata } from "next";
import { getSession } from "@/lib/auth";
import { CookiePreferencesButton } from "@/components/cookie-consent/cookie-preferences-button";
import { HomeFooter } from "@/components/home/home-footer";
import { HomeShell } from "@/components/home/home-shell";
import { LegalDoc, type LegalBlock, type LegalSection } from "@/components/marketing/legal-doc";
import {
  CONSENT_CATEGORIES,
  CONSENT_COOKIE_DAYS,
  COOKIE_NOTICE_LAST_UPDATED,
  COOKIE_TABLE_HEADERS,
  type ConsentCategory,
} from "@/lib/cookie-consent";

export const metadata: Metadata = {
  title: "Cookie Notice — Ciele",
  description:
    "Which cookies and similar technologies Ciele uses, what each one is for, how long it lasts, and how to change or withdraw your choice.",
};

const LINK_CLASS = "text-foreground font-medium underline underline-offset-4";

/* The per-category tables are generated from the same declaration that drives
   the consent banner (lib/cookie-consent.ts). That is the whole point of
   sharing it: a cookie can never be set by the banner yet missing from this
   page, which is the drift that makes a notice legally worthless. */
function categorySection(category: ConsentCategory): LegalSection {
  const blocks: LegalBlock[] = [
    { type: "p", text: category.description },
    {
      type: "table",
      caption: category.essential
        ? "Always active — these cannot be switched off."
        : "Set only if you allow this category.",
      headers: [
        COOKIE_TABLE_HEADERS.name,
        COOKIE_TABLE_HEADERS.kind,
        COOKIE_TABLE_HEADERS.provider,
        COOKIE_TABLE_HEADERS.purpose,
        COOKIE_TABLE_HEADERS.duration,
      ],
      rows: category.items.map((item) => [
        item.name,
        item.kind,
        item.provider,
        item.purpose,
        item.duration,
      ]),
    },
  ];

  return {
    id: `${category.id}-cookies`,
    title: `${category.title} cookies`,
    blocks,
  };
}

const SECTIONS: LegalSection[] = [
  {
    id: "what-are-cookies",
    title: "What cookies are",
    blocks: [
      {
        type: "p",
        text: "Cookies are small text files placed on your computer or phone when you visit a site. They hold information a web server in the issuing domain can read back later — which is how a site remembers that you are signed in, or which settings you picked.",
      },
      {
        type: "p",
        text: "Cookies set by the site you are visiting are called first-party cookies; only that site can read them. Cookies set by anyone else are third-party cookies, and whoever set them can often recognise your device on other sites too. Almost everything described on this page is first party.",
      },
      {
        type: "p",
        text: "Some cookies are session cookies, deleted the moment you close your browser. Others are persistent, and stay until they expire or you delete them. The retention column in each table below tells you which is which.",
      },
      {
        type: "p",
        text: "We use the word “cookies” on this page as shorthand for a few related technologies that all store or read something on your device: cookies proper, browser local storage, and pixel tags (tiny images, sometimes called tracking pixels, that record whether a page or email was opened). Local storage works much like a cookie but is not sent with every request, and we use it for interface preferences and to keep an assistant conversation continuous.",
      },
    ],
  },
  {
    id: "why-we-use-cookies",
    title: "Why we use cookies",
    blocks: [
      {
        type: "p",
        text: "Some cookies are technically required: without them we cannot sign you in, keep your session pointed at the right organization, or remember the choice you make about this very notice. We call those strictly necessary, and they are the only ones we set before you have decided anything.",
      },
      {
        type: "p",
        text: "Everything else is optional and off until you turn it on. We do not set optional cookies on the strength of you continuing to browse, and rejecting them takes exactly one click — the same as accepting.",
      },
      {
        type: "table",
        caption: "The categories you can control, and who serves them.",
        headers: ["Category", "Your control", "Served by"],
        rows: CONSENT_CATEGORIES.map((category) => [
          category.title,
          category.essential
            ? "Always active — required to deliver the service"
            : "Off until you allow it; can be withdrawn at any time",
          Array.from(new Set(category.items.map((item) => item.provider))).join(", "),
        ]),
      },
    ],
  },
  ...CONSENT_CATEGORIES.map(categorySection),
  {
    id: "not-used",
    title: "What we do not do",
    blocks: [
      {
        type: "ul",
        items: [
          "We set no advertising cookies and run no advertising or cross-site tracking pixels. That is why this notice has no “marketing” category — there is nothing to disclose. If that ever changes, this notice and the consent banner will change with it, and we will ask you again before setting anything.",
          "We do not sell personal data, and we do not share it for cross-context behavioural advertising.",
          "We do not use the conversations that flow through our customers' assistants to train foundation models.",
        ],
      },
      {
        type: "p",
        text: "Where an organization publishes an assistant with Ciele on its own site, that organization decides what cookies its site sets and is responsible for asking its own visitors. Our banner deliberately does not appear inside an embedded assistant, because that consent is the host site's to collect.",
      },
    ],
  },
  {
    id: "how-to-control",
    title: "How to control your cookies",
    blocks: [
      {
        type: "p",
        text: (
          <>
            You can change or withdraw your choice at any time, and it is no
            harder than making it in the first place — open{" "}
            <CookiePreferencesButton className={LINK_CLASS} /> and switch any
            category off. The same link sits in the footer of every page on this
            site. Withdrawing consent stops the affected scripts immediately and
            clears the storage that category had set.
          </>
        ),
      },
      {
        type: "p",
        text: `We remember your choice for ${CONSENT_COOKIE_DAYS} days and then ask again, and we ask again sooner if we start using cookies in a materially different way. Alongside your choice we store when you made it and a random consent id, which is the record we rely on to show what you agreed to.`,
      },
      {
        type: "h3",
        text: "Controlling cookies in your browser",
      },
      {
        type: "p",
        text: "Every major browser also lets you block or delete cookies for a site, independently of us. You will still be able to read this site, but blocking strictly necessary cookies will stop you signing in and will break parts of the product. How to do it differs by browser, so check its help pages — the settings are usually under Privacy.",
      },
      {
        type: "p",
        text: (
          <>
            Because we serve no advertising cookies, there is nothing here to opt
            out of through the industry ad-choice tools. If you want to check what
            other sites are doing, the usual directories are{" "}
            <a
              href="https://optout.aboutads.info/"
              target="_blank"
              rel="noopener noreferrer"
              className={LINK_CLASS}
            >
              optout.aboutads.info
            </a>{" "}
            and{" "}
            <a
              href="https://www.youronlinechoices.com/"
              target="_blank"
              rel="noopener noreferrer"
              className={LINK_CLASS}
            >
              youronlinechoices.com
            </a>
            .
          </>
        ),
      },
    ],
  },
  {
    id: "consent-record",
    title: "Our record of your choice",
    blocks: [
      {
        type: "p",
        text: "Data protection law requires us to be able to demonstrate that you consented, not merely to assert it. The cookie on your device is not enough for that on its own — it is yours, and you can clear it at any time — so when you make or change a choice we also store a record of it on our servers.",
      },
      {
        type: "table",
        caption: "What one consent record contains.",
        headers: ["Field", "What it holds"],
        rows: [
          [
            "Consent id",
            "The same random id held in your cookie. It is what ties the record to your choice. It is not your name, not an account, and it changes if you clear your cookies.",
          ],
          [
            "Your choice",
            "Which categories you allowed and which you refused, and whether you accepted everything, refused everything, or picked individually.",
          ],
          [
            "Notice version",
            "Which version of this notice you were shown — consent to an older version does not evidence consent to a newer one.",
          ],
          [
            "When",
            "The time you chose, and the time we stored it.",
          ],
          [
            "Where",
            "The page you were on, reduced to the site address and path. Anything after the “?” or “#” is discarded before storage, because those can carry search terms or tokens the record does not need.",
          ],
          [
            "Browser",
            "The browser identification string your browser sends, for context.",
          ],
        ],
      },
      {
        type: "p",
        text: "We do not store your IP address with the record. The consent id already links it to your browser, and an IP address would add identifying data this record does not need.",
      },
      {
        type: "p",
        text: "Each decision is added as a new entry rather than overwriting the last, so withdrawing consent is itself recorded — that history is what makes the record meaningful. We keep these entries for as long as we may need to evidence the choice, and no longer. Our legal basis is our legitimate interest in meeting the accountability duty the law places on us, not your consent — so this record exists whether you accept or refuse, and refusing everything still produces one.",
      },
    ],
  },
  {
    id: "your-rights",
    title: "Your rights",
    blocks: [
      {
        type: "p",
        text: (
          <>
            Where cookies involve personal data, the rights in our{" "}
            <a href="/policies/privacy" className={LINK_CLASS}>
              Privacy Policy
            </a>{" "}
            apply: you can ask for access, correction, deletion or a copy of your
            data, object to or restrict certain processing, and withdraw consent.
            Withdrawing consent does not affect processing that already happened
            while it was valid, and you will not be treated differently for
            exercising any of these rights.
          </>
        ),
      },
      {
        type: "p",
        text: "If you are in the European Economic Area, the United Kingdom or Switzerland, you can also complain to your local data protection authority.",
      },
    ],
  },
  {
    id: "changes",
    title: "Changes to this notice",
    blocks: [
      {
        type: "p",
        text: "We will update this notice when the cookies we use change, or for operational, legal or regulatory reasons. The date at the top of the page tells you when it last changed. When a change is material we do not rely on you noticing — we reset the consent banner so everyone is asked again.",
      },
    ],
  },
  {
    id: "contact",
    title: "Where to get more information",
    blocks: [
      {
        type: "p",
        text: (
          <>
            For anything about our use of cookies, email us at{" "}
            <a href="mailto:privacy@ciele.app" className={LINK_CLASS}>
              privacy@ciele.app
            </a>
            . For how we handle personal data more generally, see our{" "}
            <a href="/policies/privacy" className={LINK_CLASS}>
              Privacy Policy
            </a>
            .
          </>
        ),
      },
    ],
  },
];

export default async function CookieNoticePage() {
  const session = await getSession();

  return (
    <HomeShell authenticated={session !== null}>
      <LegalDoc
        eyebrow="Legal"
        title="Cookie Notice"
        lastUpdated={COOKIE_NOTICE_LAST_UPDATED}
        intro="This notice explains how Ciele uses cookies, local storage and similar technologies on ciele.app, in the Ciele console, and across the assistants our customers publish — what each one is for, how long it lasts, and how to change or withdraw your choice. The tables below are generated from the same declaration that drives our consent banner, so what you see here is what we actually set."
        sections={SECTIONS}
      />
      <HomeFooter />
    </HomeShell>
  );
}
