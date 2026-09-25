"use client";

import { LoaderCircle, Pause, Volume2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "@/lib/toast";
import type { VoiceEndpoint } from "./voice-input-button";

let playingAudio: HTMLAudioElement | null = null;

type SpeechPlaybackProps = VoiceEndpoint & {
  text: string;
  /** Published playback is authorized against the persisted conversation message. */
  conversationId?: string | null;
  messageId?: string | null;
};

export function SpeechPlayback(props: SpeechPlaybackProps) {
  // A changed message must release its old audio and start with fresh controls.
  return <SpeechPlaybackSession key={`${props.endpoint}:${props.assistantId ?? ""}:${typeof props.visitorId === "string" ? props.visitorId : ""}:${props.conversationId ?? ""}:${props.messageId ?? ""}:${props.text}`} {...props} />;
}

function SpeechPlaybackSession({ endpoint, assistantId, visitorId, text, conversationId, messageId }: SpeechPlaybackProps) {
  const [state, setState] = useState<"idle" | "loading" | "playing">("idle");
  const audio = useRef<HTMLAudioElement | null>(null);
  const url = useRef<string | null>(null);
  const request = useRef<AbortController | null>(null);

  useEffect(() => () => {
    request.current?.abort();
    if (playingAudio === audio.current) playingAudio = null;
    if (audio.current) {
      audio.current.onpause = null;
      audio.current.onended = null;
      audio.current.onerror = null;
      audio.current.pause();
    }
    if (url.current) URL.revokeObjectURL(url.current);
    audio.current = null;
    url.current = null;
  }, [endpoint, assistantId, visitorId, text]);

  async function toggle() {
    if (state === "loading") {
      request.current?.abort();
      request.current = null;
      setState("idle");
      return;
    }
    if (audio.current && !audio.current.paused) {
      audio.current.pause();
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    try {
      if (!audio.current) {
        setState("loading");
        const response = await fetch(endpoint, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, assistantId, conversationId, messageId, visitorId: typeof visitorId === "function" ? visitorId() : visitorId }), signal: controller.signal,
        });
        if (!response.ok) {
          const error = await response.json().catch(() => ({}));
          throw new Error(error.error || "Could not generate audio for this response.");
        }
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        url.current = URL.createObjectURL(blob);
        const player = new Audio(url.current);
        audio.current = player;
        player.onpause = player.onended = () => setState("idle");
        player.onerror = () => {
          if (playingAudio === player) playingAudio = null;
          audio.current = null;
          if (url.current) URL.revokeObjectURL(url.current);
          url.current = null;
          setState("idle");
          toast.error("This audio could not be played. Please try again.");
        };
      }
      if (playingAudio && playingAudio !== audio.current) playingAudio.pause();
      playingAudio = audio.current;
      await audio.current.play();
      if (!controller.signal.aborted) setState("playing");
    } catch (error) {
      if (!controller.signal.aborted) {
        setState("idle");
        toast.error(error instanceof Error ? error.message : "Could not play this response.");
      }
    } finally {
      if (request.current === controller) request.current = null;
    }
  }

  const label = state === "playing" ? "Pause reading aloud" : state === "loading" ? "Cancel audio loading" : "Read response aloud";
  return <button type="button" aria-label={label} title={label} onClick={() => void toggle()} className="grid size-7 place-items-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
    {state === "loading" ? <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" /> : state === "playing" ? <Pause className="size-3.5" /> : <Volume2 className="size-3.5" />}
  </button>;
}
