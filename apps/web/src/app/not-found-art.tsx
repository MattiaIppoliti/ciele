"use client";

import Link from "next/link";
import styles from "./not-found.module.css";

/**
 * The 404 page's scrolling prompt walls.
 *
 * A Client Component for one reason, and it is not interactivity: Next
 * serializes a not-found boundary's contents into the RSC payload of **every**
 * route that sits under it, so these 50 localized strings and their wrapper
 * markup were 40 kB of every document the app serves, twice over. On
 * `/assistants` that was 42.6 kB of a 58.9 kB payload, refetched on every soft
 * navigation, to draw a page the Member was not looking at. Behind a client
 * boundary the strings live in this component's own chunk, which only the 404
 * loads, and every other route carries a module reference instead.
 *
 * The cost is that the walls paint after hydration on the 404 itself. They are
 * decoration on the one page nobody is trying to reach.
 */
type MarqueeDirection = "left-to-right" | "right-to-left";

const MARQUEE_ROWS: ReadonlyArray<{
  direction: MarqueeDirection;
  prompts: readonly string[];
}> = [
  {
    direction: "left-to-right",
    prompts: [
      "Aiutami a creare un assistente per le ammissioni",
      "Create a course FAQ from our uploaded files",
      "Erstelle einen Assistenten für Studieninteressierte",
      "Crée un guide pour les nouveaux étudiants",
      "Crea un assistente che risponda dalle nostre fonti",
    ],
  },
  {
    direction: "right-to-left",
    prompts: [
      "Resume los plazos de matrícula para los estudiantes",
      "Aiutami a organizzare le domande più frequenti",
      "Crie um assistente para orientar novos alunos",
      "Route complex questions to the right help desk",
      "학생들이 자주 묻는 질문을 정리해 줘",
    ],
  },
  {
    direction: "left-to-right",
    prompts: [
      "Prépare un assistant pour accompagner les étudiants",
      "Rendi consultabili i documenti del mio corso",
      "Build an assistant grounded in our knowledge",
      "学生向けの案内を分かりやすくまとめて",
      "Erkläre unsere Einschreibung Schritt für Schritt",
    ],
  },
  {
    direction: "right-to-left",
    prompts: [
      "Collega l'assistenza alle richieste più complesse",
      "Build a searchable guide from our documents",
      "Crée une réponse à partir de notre base de connaissances",
      "Begleite neue Studierende Schritt für Schritt",
      "Organize your support conversations in one place",
    ],
  },
  {
    direction: "left-to-right",
    prompts: [
      "Rendi subito utili i contenuti del tuo sito",
      "Help visitors find the right answer faster",
      "Crea un assistente per il tuo corso online",
      "Summarize the most important student services",
      "Prépare un parcours d'accueil personnalisé",
    ],
  },
];

const TOP_MARQUEE_ROWS = MARQUEE_ROWS.slice(0, 3);
const BOTTOM_MARQUEE_ROWS = MARQUEE_ROWS.slice(3);

function PromptCards({
  prompts,
  decorative = false,
}: {
  prompts: readonly string[];
  decorative?: boolean;
}) {
  return (
    <div className={styles.cardGroup} aria-hidden={decorative || undefined}>
      {prompts.map((prompt) => {
        const contents = (
          <>
            <span>{prompt}</span>
            <span className={styles.arrow} aria-hidden="true">
              ↗
            </span>
          </>
        );

        return decorative ? (
          <span className={styles.promptCard} key={prompt}>
            {contents}
          </span>
        ) : (
          <Link className={styles.promptCard} href="/home" key={prompt}>
            {contents}
          </Link>
        );
      })}
    </div>
  );
}

function PromptMarquee({
  prompts,
  direction,
}: {
  prompts: readonly string[];
  direction: MarqueeDirection;
}) {
  return (
    <div className={styles.marquee}>
      <div
        className={`${styles.marqueeTrack} ${
          direction === "left-to-right" ? styles.leftToRight : styles.rightToLeft
        }`}
      >
        <PromptCards prompts={prompts} />
        <PromptCards decorative prompts={prompts} />
      </div>
    </div>
  );
}

function PromptMarqueeStack({
  rows,
  position,
}: {
  rows: readonly (typeof MARQUEE_ROWS)[number][];
  position: "top" | "bottom";
}) {
  return (
    <div
      className={`${styles.marqueeStack} ${
        position === "bottom" ? styles.bottomMarqueeStack : ""
      }`}
      aria-label={`Ciele assistant ideas, ${position}`}
    >
      {rows.map(({ direction, prompts }) => (
        <PromptMarquee
          direction={direction}
          key={prompts[0]}
          prompts={prompts}
        />
      ))}
    </div>
  );
}

export function NotFoundArt({ position }: { position: "top" | "bottom" }) {
  return (
    <PromptMarqueeStack
      position={position}
      rows={position === "top" ? TOP_MARQUEE_ROWS : BOTTOM_MARQUEE_ROWS}
    />
  );
}
