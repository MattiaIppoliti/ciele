"use client";

import Link from "next/link";
import { RollInText } from "@/components/motion/roll-in-text";
import { NotFoundArt } from "./not-found-art";
import styles from "./not-found.module.css";

export default function NotFound() {
  return (
    <main className={`${styles.page} light`}>
      <NotFoundArt position="top" />

      <section className={styles.message} aria-labelledby="not-found-title">
        <p className={styles.code} aria-hidden="true">
          <RollInText text="404" entrance={false} />
        </p>
        <h1 id="not-found-title"><RollInText text="Page not found" /></h1>
        <Link className={styles.cta} href="/home">
          Ask Ciele
        </Link>
      </section>

      <NotFoundArt position="bottom" />
    </main>
  );
}
