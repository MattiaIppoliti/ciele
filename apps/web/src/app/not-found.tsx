import Link from "next/link";
import { NotFoundArt } from "./not-found-art";
import styles from "./not-found.module.css";

export default function NotFound() {
  return (
    <main className={`${styles.page} light`}>
      <NotFoundArt position="top" />

      <section className={styles.message} aria-labelledby="not-found-title">
        <p className={styles.code} aria-hidden="true">
          404
        </p>
        <h1 id="not-found-title">Page not found</h1>
        <Link className={styles.cta} href="/home">
          Ask Ciele
        </Link>
      </section>

      <NotFoundArt position="bottom" />
    </main>
  );
}
