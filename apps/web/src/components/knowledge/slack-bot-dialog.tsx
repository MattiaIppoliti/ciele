"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
} from "@agent-hub/ui";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ApplicationScopeOption } from "@agent-hub/agent";
import type { PublicApplicationConnection } from "@/lib/application-connections";
import { slackBotConfig, SLACK_BOT_SCOPES } from "@/lib/slack/config";
import { configureSlackBotAction } from "@/app/slack-actions";
import { discoverApplicationScopesAction } from "@/app/actions";
import { toast } from "@/lib/toast";

export function SlackBotDialog({
  connection,
  assistants,
  onClose,
}: {
  connection: PublicApplicationConnection;
  assistants: Array<{ id: string; title: string }>;
  onClose: () => void;
}) {
  const config = slackBotConfig(connection.metadata);
  const [assistantId, setAssistantId] = useState(config?.assistantId ?? "");
  const [channelIds, setChannelIds] = useState<string[]>(
    config?.channelIds ?? [],
  );
  const [channelOptions, setChannelOptions] = useState<ApplicationScopeOption[]>(
    [],
  );
  const [channelsLoading, setChannelsLoading] = useState(true);
  const [pending, startTransition] = useTransition();
  const selectedChannels = useMemo(() => new Set(channelIds), [channelIds]);
  const visibleChannels = channelOptions.filter(
    (scope) => scope.kind === "channel",
  );
  const unknownChannelIds = channelIds.filter(
    (id) => !visibleChannels.some((scope) => scope.id === id),
  );
  const hasScopes =
    SLACK_BOT_SCOPES.every((scope) => connection.scopes.includes(scope)) &&
    Boolean(
      connection.metadata.slackAppId && connection.metadata.slackBotUserId,
    );

  useEffect(() => {
    let cancelled = false;
    discoverApplicationScopesAction(connection.id)
      .then((options) => {
        if (!cancelled) setChannelOptions(options);
      })
      .catch((error) => {
        if (!cancelled) {
          toast.error(
            error instanceof Error
              ? error.message
              : "Could not load Slack channels.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setChannelsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [connection.id]);

  function toggleChannel(channelId: string) {
    setChannelIds((current) =>
      current.includes(channelId)
        ? current.filter((id) => id !== channelId)
        : [...current, channelId],
    );
  }

  function save(disable = false) {
    startTransition(async () => {
      try {
        await configureSlackBotAction(
          connection.id,
          disable
            ? null
            : {
                assistantId,
                channelIds,
              },
        );
        toast.success(
          disable ? "Slack replies disabled." : "Slack assistant saved.",
        );
        onClose();
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Could not save Slack settings.",
        );
      }
    });
  }
  function reconnect() {
    const popup = window.open(
      "about:blank",
      "ciele-slack-bot",
      "width=720,height=820",
    );
    startTransition(async () => {
      try {
        if (!popup) throw new Error("Allow pop-ups to connect Slack.");
        const response = await fetch("/api/applications/oauth/slack/start", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            connectionId: connection.id,
            returnTo: "/library/applications",
            scopes: SLACK_BOT_SCOPES,
          }),
        });
        if (!response.ok)
          throw new Error("Could not start Slack authorization.");
        const result = (await response.json()) as { authorizationUrl: string };
        popup.location.href = result.authorizationUrl;
        onClose();
      } catch (error) {
        popup?.close();
        toast.error(
          error instanceof Error ? error.message : "Could not connect Slack.",
        );
      }
    });
  }
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Conversational Ciele in Slack</DialogTitle>
          <DialogDescription>
            Choose the published Assistant that answers @Ciele in{" "}
            {connection.name}.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Everyone in the selected channels can receive answers from this
            Assistant’s linked knowledge. Choose knowledge suitable for that
            audience. Invite Ciele to each channel. Shared Slack Connect
            channels are not supported.
          </p>
          {!hasScopes && (
            <Button disabled={pending} onClick={reconnect}>
              Authorize conversational permissions
            </Button>
          )}
          <div className="space-y-2">
            <Label>Assistant</Label>
            <Select
              value={assistantId}
              onValueChange={(value) => setAssistantId(value ?? "")}
            >
            <SelectTrigger aria-label="Slack Assistant">
                <SelectValue placeholder="Select a published Assistant">
                  {(value: string) =>
                    assistants.find((assistant) => assistant.id === value)
                      ?.title ?? "Select a published Assistant"
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {assistants.map((assistant) => (
                  <SelectItem key={assistant.id} value={assistant.id}>
                    {assistant.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Channels</Label>
            <div className="max-h-52 space-y-1 overflow-y-auto rounded-lg border p-2">
              {channelsLoading && (
                <p className="p-2 text-sm">Loading channels…</p>
              )}
              {!channelsLoading && visibleChannels.length === 0 && (
                <p className="p-2 text-sm text-muted-foreground">
                  No Slack channels were found. Invite Ciele to a channel, then
                  reopen this dialog.
                </p>
              )}
              {visibleChannels.map((channel) => (
                <label
                  key={channel.id}
                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted"
                >
                  <input
                    type="checkbox"
                    checked={selectedChannels.has(channel.id)}
                    onChange={() => toggleChannel(channel.id)}
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {channel.label}
                  </span>
                  {channel.metadata.member === false && (
                    <span className="text-xs text-muted-foreground">
                      Not in channel
                    </span>
                  )}
                </label>
              ))}
              {unknownChannelIds.map((channelId) => (
                <label
                  key={channelId}
                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted"
                >
                  <input
                    type="checkbox"
                    checked
                    onChange={() => toggleChannel(channelId)}
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {channelId}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Previously configured
                  </span>
                </label>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Public channels are listed automatically. Invite Ciele to every
              selected channel before mentioning it; private channels appear
              only after it is invited. Replies stay in the mention’s thread.
            </p>
          </div>
        </div>
        <DialogFooter>
          {config && (
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => save(true)}
            >
              Disable replies
            </Button>
          )}
          <Button
            disabled={
              pending || !hasScopes || !assistantId || channelIds.length === 0
            }
            onClick={() => save()}
          >
            Save Slack assistant
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
