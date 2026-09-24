import { marketingMetadata } from "@/lib/marketing/seo";
import { DownloadContent } from "@/components/marketing/download-content";

export const metadata = marketingMetadata({
  title: "Download | Ciele",
  description: "Get Ciele on your own machine: the macOS desktop app, the one-script Docker stack, or the open-source repository. Self-service, no account, no license fee.",
  path: "/download",
});

export default function DownloadPage() {
  return <DownloadContent />;
}
