"use client";

import { useMemo } from "react";
import { generatedAvatar } from "@/lib/avatar-generator";

export default function StaticAvatar({ seed }: { seed: string }) {
  const svg = useMemo(() => generatedAvatar(seed), [seed]);
  return <span className="size-full [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: svg }} />;
}
