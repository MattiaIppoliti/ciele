import { SkeletonReveal } from "@/components/spectrumui/skeleton-reveal";

const PROVIDER_LABELS: Record<string, string> = {
  entra: "Microsoft Entra ID",
  clerk: "Clerk",
  workos: "Single sign-on",
};

/**
 * The sign-in gate shown over the chat when an assistant requires
 * authentication (widget + editor preview). Copy is generic (no
 * vertical-specific wording); the button is branded to the connected provider.
 * Login opens in a popup (the IdP can't be framed) and the surface unlocks on
 * the callback's postMessage.
 */
export function IdentityGate({
  provider,
  loading,
  onLogin,
  brandColor,
}: {
  provider: string | null;
  loading: boolean;
  onLogin: (provider: string) => void;
  brandColor: string;
}) {
  const label = provider ? (PROVIDER_LABELS[provider] ?? "your account") : null;
  return (
    <div className="bg-background/70 absolute inset-0 z-20 flex items-center justify-center px-6 backdrop-blur-sm">
      <div className="bg-card ring-border w-full max-w-sm rounded-2xl p-7 text-center shadow-xl ring-1">
        <h2 className="text-foreground text-xl font-semibold">
          Verify your identity to continue
        </h2>
        <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
          Sign in to continue.
        </p>
        <SkeletonReveal
          loading={loading}
          pulseCount={2}
          pulseDuration={900}
          className="mt-6"
          skeleton={<div className="bg-muted h-11 rounded-lg" />}
        >
          {provider ? (
            <button
              type="button"
              onClick={() => onLogin(provider)}
              className="border-border text-foreground flex h-11 w-full items-center justify-center gap-2 rounded-lg border px-4 py-3 text-sm font-medium transition hover:bg-muted"
              style={{ ["--brand" as string]: brandColor }}
            >
              Log in with {label}
            </button>
          ) : (
            <p className="text-muted-foreground text-sm">
              Sign-in isn&apos;t available yet, please check back soon.
            </p>
          )}
        </SkeletonReveal>
      </div>
    </div>
  );
}
