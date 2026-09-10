/**
 * Read a stream to the end and throw the bytes away.
 *
 * Three callers want this and none of them wants the output: a resumption job,
 * a routine run and a callback continuation all drive `streamConversationTurn`
 * for its side effects (the persisted message, the effects, the telemetry) with
 * nobody on the other end of the stream. The turn only completes if something
 * pulls, so "pull and discard" is the whole job.
 */
export async function drain(stream: ReadableStream<Uint8Array>): Promise<void> {
  await stream.pipeTo(new WritableStream());
}
