import { toast } from "@/lib/toast";

/**
 * The clipboard can refuse (no permission, an insecure origin), so the toast
 * waits for the write instead of announcing a copy that never happened.
 */
export async function copyToClipboard(
  text: string,
  done: string,
  failed = "Could not copy to the clipboard"
): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(done);
  } catch {
    toast.error(failed);
  }
}
