import { Skeleton } from "@agent-hub/ui";

/** The Skill page's own shape: its centred column, title, description and body. */
export default function SkillLoading() {
  return (
    <div aria-busy="true" className="mx-auto max-w-3xl px-5 py-6 @xl:px-8 @xl:py-10">
      <Skeleton className="h-8 w-72 max-w-full" />
      <Skeleton className="mt-3 h-4 w-56 max-w-full" />
      <div className="mt-6 border-t pt-4">
        <Skeleton className="h-56 w-full" />
      </div>
      <Skeleton className="mt-6 h-32 w-full rounded-lg" />
    </div>
  );
}
