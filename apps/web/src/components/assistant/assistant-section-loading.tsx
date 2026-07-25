import { Skeleton } from "@agent-hub/ui";

type AssistantSectionLoadingVariant =
  | "general"
  | "knowledge"
  | "flows"
  | "tools"
  | "goals"
  | "help-desks"
  | "style"
  | "authentication"
  | "publish";

function CardSkeleton({ rows = 2 }: { rows?: number }) {
  return (
    <div className="rounded-xl border p-4">
      <Skeleton className="h-5 w-40" />
      <Skeleton className="mt-2 h-4 w-3/4" />
      {rows > 0 && (
        <div className="mt-4 space-y-3">
          {Array.from({ length: rows }, (_, index) => (
            <Skeleton key={index} className="h-10 w-full" />
          ))}
        </div>
      )}
    </div>
  );
}

function FieldSkeleton({ multiline = false }: { multiline?: boolean }) {
  return (
    <div className="space-y-3">
      <Skeleton className="h-5 w-36" />
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className={`${multiline ? "h-28" : "h-11"} w-full`} />
    </div>
  );
}

function ListRowSkeleton() {
  return (
    <div className="flex items-center gap-4 rounded-xl border p-4">
      <Skeleton className="size-8 shrink-0" />
      <div className="min-w-0 flex-1">
        <Skeleton className="h-5 w-44" />
        <Skeleton className="mt-2 h-4 w-3/4" />
      </div>
      <Skeleton className="h-8 w-16 shrink-0" />
    </div>
  );
}

function GeneralSkeleton() {
  return (
    <div className="space-y-8 pt-8 pb-24">
      <CardSkeleton rows={0} />
      <FieldSkeleton />
      <FieldSkeleton />
      <FieldSkeleton />
      <FieldSkeleton multiline />
    </div>
  );
}

function KnowledgeSkeleton() {
  return (
    <div className="mt-6 space-y-6">
      <div className="flex gap-2">
        {[72, 84, 64, 56].map((width) => (
          <Skeleton key={width} className="h-9 rounded-lg" style={{ width }} />
        ))}
      </div>
      <div>
        <div className="flex items-center justify-between gap-4">
          <div className="flex-1">
            <Skeleton className="h-6 w-44" />
            <Skeleton className="mt-2 h-4 w-2/3" />
          </div>
          <Skeleton className="h-9 w-28 shrink-0" />
        </div>
        <Skeleton className="mt-5 h-10 w-full" />
        <div className="mt-4 overflow-hidden rounded-xl border">
          <Skeleton className="h-10 w-full rounded-none" />
          {[0, 1, 2].map((row) => (
            <div key={row} className="flex gap-4 border-t p-4">
              <Skeleton className="h-5 w-2/5" />
              <Skeleton className="h-5 w-1/4" />
              <Skeleton className="ml-auto h-5 w-20" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function FlowsSkeleton() {
  return (
    <div className="mt-6 space-y-4">
      {[0, 1, 2].map((row) => (
        <ListRowSkeleton key={row} />
      ))}
    </div>
  );
}

function ToolsSkeleton() {
  return (
    <div className="mt-8 space-y-10">
      {[0, 1, 2].map((section) => (
        <section key={section}>
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <Skeleton className="h-6 w-36" />
              <Skeleton className="mt-2 h-4 w-3/4" />
            </div>
            {section > 0 && <Skeleton className="h-9 w-24" />}
          </div>
          <div className="mt-4 space-y-3">
            {[0, 1].map((row) => (
              <Skeleton key={row} className="h-14 w-full" />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function GoalsSkeleton() {
  return (
    <div className="mt-6 grid gap-4">
      {[0, 1, 2].map((row) => (
        <ListRowSkeleton key={row} />
      ))}
      <Skeleton className="mt-2 h-10 w-28" />
    </div>
  );
}

function HelpDesksSkeleton() {
  return (
    <div className="mt-8 space-y-4">
      <Skeleton className="h-7 w-72" />
      <Skeleton className="h-4 w-3/4" />
      <CardSkeleton rows={0} />
      <CardSkeleton rows={1} />
      <div className="my-8 border-t" />
      <Skeleton className="h-7 w-44" />
      <Skeleton className="h-4 w-3/4" />
      <div className="rounded-xl border p-4">
        <div className="flex gap-3">
          <Skeleton className="h-9 w-56" />
          <Skeleton className="ml-auto h-7 w-24" />
        </div>
        <Skeleton className="mt-4 h-11 w-full" />
        <Skeleton className="mt-4 h-24 w-full" />
      </div>
    </div>
  );
}

function StyleSkeleton() {
  return (
    <div className="mt-6 rounded-xl border p-4">
      <Skeleton className="h-5 w-32" />
      <Skeleton className="mt-2 h-4 w-2/3" />
      <div className="mt-4 flex flex-wrap items-end gap-6">
        <div className="space-y-2">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-9 w-28" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-9 w-36" />
        </div>
        <Skeleton className="h-9 w-16" />
      </div>
    </div>
  );
}

function AuthenticationSkeleton() {
  return (
    <div className="mt-6 space-y-6">
      <CardSkeleton rows={1} />
      <CardSkeleton rows={3} />
      <CardSkeleton rows={0} />
    </div>
  );
}

function PublishSkeleton() {
  return (
    <div className="space-y-8 pt-8 pb-16">
      <CardSkeleton rows={1} />
      <CardSkeleton rows={0} />
      <CardSkeleton rows={3} />
    </div>
  );
}

const SECTION_BODY: Record<
  AssistantSectionLoadingVariant,
  () => React.ReactNode
> = {
  general: GeneralSkeleton,
  knowledge: KnowledgeSkeleton,
  flows: FlowsSkeleton,
  tools: ToolsSkeleton,
  goals: GoalsSkeleton,
  "help-desks": HelpDesksSkeleton,
  style: StyleSkeleton,
  authentication: AuthenticationSkeleton,
  publish: PublishSkeleton,
};

/**
 * Destination-owned fallback for Assistant SETUP routes. Each section has its
 * own loading.tsx so a sibling navigation mounts a fresh Suspense boundary
 * instead of leaving the previous section visible while data is fetched.
 */
export function AssistantSectionLoading({
  variant,
}: {
  variant: AssistantSectionLoadingVariant;
}) {
  const SectionBody = SECTION_BODY[variant];
  const wide = variant === "knowledge" || variant === "flows";
  const showHeaderAction = variant === "flows";

  return (
    <div
      className={`mx-auto ${wide ? "max-w-4xl" : "max-w-3xl"} px-8 py-8`}
      aria-busy="true"
      aria-label="Loading assistant section"
    >
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0 flex-1">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="mt-2 h-4 w-3/4 max-w-xl" />
        </div>
        {showHeaderAction && <Skeleton className="h-10 w-28 shrink-0" />}
      </div>
      <SectionBody />
    </div>
  );
}
