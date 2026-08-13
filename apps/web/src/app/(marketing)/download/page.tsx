import type { Metadata } from "next";
import { DownloadContent } from "@/components/marketing/download-content";

export const metadata: Metadata = {
  title: "Download | Ciele",
  description:
    "Get Ciele on your own machine: the macOS desktop app, the one-script Docker stack, or the open-source repository. Self-service, no account, no license fee.",
};

export default function DownloadPage() {
  return <DownloadContent />;
}
