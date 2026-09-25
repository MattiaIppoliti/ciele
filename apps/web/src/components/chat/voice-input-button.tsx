"use client";

import { LoaderCircle, Mic, Square, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/motion/button";
import { toast } from "@/lib/toast";

export interface VoiceEndpoint {
  endpoint: string;
  assistantId?: string;
  /** Resolve persistent visitor identity only after interaction, never during SSR. */
  visitorId?: string | (() => string);
}

const MAX_BYTES = 4 * 1024 * 1024;
const MAX_SECONDS = 60;

function microphoneError(error: unknown, acquired: boolean) {
  // Recorder setup can fail after access succeeded; it is not a permission denial.
  if (acquired) return "Microphone access succeeded, but recording could not start. Please try again or use another browser.";
  const name = error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    const systemSettings = /Mac/i.test(navigator.userAgent)
      ? "macOS System Settings → Privacy & Security → Microphone"
      : "your device's microphone privacy settings";
    return `Microphone access is blocked. Allow this site in your browser and enable the browser or host app in ${systemSettings}. Restart the app if prompted, then retry.`;
  }
  if (name === "NotFoundError") return "No microphone was found. Connect a microphone and try again.";
  if (name === "NotReadableError" || name === "AbortError") return "Your microphone could not be opened. Check your device's microphone permissions and whether another app is using it, then retry.";
  return "Could not access your microphone. Check that it is connected and try again.";
}

/** Records only on a deliberate click; a transcript always remains an editable draft. */
export function VoiceInputButton({
  endpoint, assistantId, visitorId, disabled, onTranscript, onBusyChange, onStreamChange,
}: VoiceEndpoint & {
  disabled?: boolean;
  onTranscript: (text: string) => void;
  onBusyChange: (busy: boolean) => void;
  onStreamChange: (stream: MediaStream | null) => void;
}) {
  const [state, setState] = useState<"idle" | "requesting" | "recording" | "transcribing">("idle");
  const [seconds, setSeconds] = useState(0);
  const session = useRef(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const request = useRef<AbortController | null>(null);
  const callbacks = useRef({ onTranscript, onBusyChange, onStreamChange });
  useEffect(() => { callbacks.current = { onTranscript, onBusyChange, onStreamChange }; }, [onTranscript, onBusyChange, onStreamChange]);

  function release() {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    const active = recorder.current;
    recorder.current = null;
    if (active && active.state !== "inactive") active.stop();
    stream.current?.getTracks().forEach((track) => track.stop());
    if (stream.current) callbacks.current.onStreamChange(null);
    stream.current = null;
  }

  function cancel() {
    session.current += 1;
    request.current?.abort();
    request.current = null;
    release();
    setState("idle");
    callbacks.current.onBusyChange(false);
  }

  useEffect(() => () => {
    session.current += 1;
    request.current?.abort();
    if (timer.current) clearInterval(timer.current);
    if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop();
    stream.current?.getTracks().forEach((track) => track.stop());
    if (stream.current) callbacks.current.onStreamChange(null);
    callbacks.current.onBusyChange(false);
  }, []);

  async function start() {
    if (disabled || state !== "idle") return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      toast.error("Voice input requires a supported browser and a secure connection.");
      return;
    }
    const token = ++session.current;
    let acquired = false;
    setState("requesting");
    callbacks.current.onBusyChange(true);
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (token !== session.current) {
        media.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = media;
      acquired = true;
      const mimeType = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm", "audio/ogg;codecs=opus"]
        .find((type) => MediaRecorder.isTypeSupported(type));
      const recording = new MediaRecorder(media, mimeType ? { mimeType } : undefined);
      recorder.current = recording;
      const chunks: Blob[] = [];
      let bytes = 0;
      recording.ondataavailable = (event) => {
        if (token !== session.current || !event.data.size) return;
        bytes += event.data.size;
        if (bytes > MAX_BYTES) {
          cancel();
          toast.error("Recording is too large. Please record a shorter question.");
          return;
        }
        chunks.push(event.data);
      };
      recording.onerror = () => {
        if (token !== session.current) return;
        cancel();
        toast.error("The microphone recording failed. Please try again.");
      };
      recording.onstop = async () => {
        if (token !== session.current) return;
        release();
        setState("transcribing");
        const controller = new AbortController();
        request.current = controller;
        try {
          const audio = new Blob(chunks, { type: recording.mimeType || chunks[0]?.type || "audio/webm" });
          if (!audio.size) throw new Error("No audio was recorded. Please try again.");
          const form = new FormData();
          const extension = audio.type.includes("mp4") ? "m4a" : audio.type.includes("ogg") ? "ogg" : "webm";
          form.set("file", audio, `question.${extension}`);
          if (assistantId) form.set("assistantId", assistantId);
          if (visitorId) form.set("visitorId", typeof visitorId === "function" ? visitorId() : visitorId);
          const response = await fetch(endpoint, { method: "POST", body: form, signal: controller.signal });
          const result = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(result.error || "Could not transcribe this recording.");
          if (typeof result.text !== "string" || !result.text.trim()) throw new Error("No speech was detected. Please try again.");
          if (token === session.current) callbacks.current.onTranscript(result.text.trim());
        } catch (error) {
          if (token === session.current && !controller.signal.aborted) toast.error(error instanceof Error ? error.message : "Could not transcribe this recording.");
        } finally {
          if (token === session.current) {
            request.current = null;
            setState("idle");
            callbacks.current.onBusyChange(false);
          }
        }
      };
      recording.start(250);
      callbacks.current.onStreamChange(media);
      setSeconds(0);
      setState("recording");
      const started = Date.now();
      timer.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - started) / 1000);
        setSeconds(elapsed);
        if (elapsed >= MAX_SECONDS && recording.state === "recording") recording.stop();
      }, 250);
    } catch (error) {
      if (token !== session.current) return;
      cancel();
      toast.error(microphoneError(error, acquired));
    }
  }

  const label = state === "recording" ? "Finish recording and transcribe" : state === "transcribing" ? "Cancel transcription" : state === "requesting" ? "Cancel microphone request" : "Dictate a question";
  return (
    <>
      {state === "recording" ? (
        <>
          <span className="text-xs tabular-nums text-muted-foreground">{seconds}s / {MAX_SECONDS}s</span>
          <Button type="button" variant="ghost" size="icon" className="size-8 rounded-full" aria-label="Cancel recording" title="Cancel recording" onClick={cancel}><X className="size-4" /></Button>
        </>
      ) : null}
      <Button type="button" variant="ghost" size="icon" className="size-8 rounded-full" disabled={disabled && state === "idle"} aria-label={label} title={label} aria-pressed={state === "recording"}
        onClick={() => state === "idle" ? void start() : state === "recording" ? recorder.current?.stop() : cancel()}>
        {state === "recording" ? <Square className="size-3.5 fill-current" /> : state === "idle" ? <Mic className="size-4" /> : <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />}
      </Button>
      <span className="sr-only" role="status">{state === "transcribing" ? "Transcribing your recording. The text will appear in the message box." : state === "recording" ? "Microphone recording in progress." : ""}</span>
    </>
  );
}
