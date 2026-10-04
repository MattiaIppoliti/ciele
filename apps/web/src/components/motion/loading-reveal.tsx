import type { ReactNode } from "react";

/** Transitions.dev skeleton reveal: state swaps immediately; CSS owns the cross-fade. */
export function LoadingReveal({ loading, placeholder, children }: {
  loading: boolean;
  placeholder: ReactNode;
  children: ReactNode;
}) {
  return <div className={`t-skel ciele-loading-reveal ${loading ? "" : "is-revealed"}`} aria-busy={loading}>
    <div className="t-skel-skeleton is-pulsing" aria-hidden inert>{placeholder}</div>
    <div className="t-skel-content" aria-hidden={loading || undefined} inert={loading}>{children}</div>
  </div>;
}
