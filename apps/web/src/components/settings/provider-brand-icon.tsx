import type { ProviderConnectionProvider } from "@agent-hub/db";
import type { ConnectorProvider } from "@/lib/local-connector-protocol";
import { cn } from "@/lib/utils";

export function ProviderBrandIcon({
  provider,
  className,
}: {
  provider: ConnectorProvider | ProviderConnectionProvider;
  className?: string;
}) {
  if (provider === "anthropic") {
    return (
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        className={cn("size-5", className)}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      >
        {Array.from({ length: 12 }, (_, index) => (
          <path
            key={index}
            d="M12 2.2v5.1"
            transform={`rotate(${index * 30} 12 12)`}
          />
        ))}
        <circle cx="12" cy="12" r="2.1" />
      </svg>
    );
  }
  if (provider === "google") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" className={cn("size-5", className)}>
        <path
          fill="currentColor"
          d="M20.7 12.2c0-.7-.1-1.4-.2-2H12v3.9h4.9a4.2 4.2 0 0 1-1.8 2.7v2.6H18c1.7-1.6 2.7-4 2.7-7.2Z"
        />
        <path
          fill="currentColor"
          opacity=".8"
          d="M12 21c2.4 0 4.5-.8 6-2.1l-2.9-2.2c-.8.5-1.8.9-3.1.9-2.3 0-4.3-1.6-5-3.7H4v2.7A9 9 0 0 0 12 21Z"
        />
        <path
          fill="currentColor"
          opacity=".6"
          d="M7 13.9a5.4 5.4 0 0 1 0-3.8V7.4H4a9 9 0 0 0 0 9.2l3-2.7Z"
        />
        <path
          fill="currentColor"
          opacity=".4"
          d="M12 6.4c1.4 0 2.7.5 3.7 1.4l2.7-2.7A9 9 0 0 0 4 7.4l3 2.7c.7-2.1 2.7-3.7 5-3.7Z"
        />
      </svg>
    );
  }
  if (provider === "azure_openai") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" className={cn("size-5", className)}>
        <path fill="currentColor" d="M13.1 2 4 19.1h5.4L18.8 2h-5.7Zm-.7 8.8L8.8 22H21l-8.6-11.2Z" />
      </svg>
    );
  }
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={cn("size-5", className)}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.55"
      strokeLinejoin="round"
    >
      {Array.from({ length: 6 }, (_, index) => (
        <path
          key={index}
          d="M12 3.2c2.2 0 4 1.8 4 4v3.1l-4 2.3-4-2.3V7.2c0-2.2 1.8-4 4-4Z"
          transform={`rotate(${index * 60} 12 12)`}
        />
      ))}
    </svg>
  );
}
