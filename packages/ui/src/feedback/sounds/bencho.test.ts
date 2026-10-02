import { afterEach, describe, expect, it, vi } from "vitest";
import { createBenchoPlayer } from "./bencho";

function param() {
  return { value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() };
}

function node() {
  return { connect: vi.fn(function (target: unknown) { return target; }), disconnect: vi.fn() };
}

function audioMock(state = "running") {
  const oscillators: Array<ReturnType<typeof oscillator>> = [];
  function oscillator() {
    return { ...node(), type: "sine", frequency: param(), start: vi.fn(), stop: vi.fn(), onended: null as (() => void) | null };
  }
  const audio = {
    state, currentTime: 10, destination: {},
    createOscillator: vi.fn(() => { const o = oscillator(); oscillators.push(o); return o; }),
    createGain: vi.fn(() => ({ ...node(), gain: param() })),
    createBiquadFilter: vi.fn(() => ({ ...node(), type: "", frequency: param() })),
    resume: vi.fn(async () => { audio.state = "running"; }),
    close: vi.fn(async () => {}),
  };
  vi.stubGlobal("AudioContext", class { constructor() { return audio; } });
  return { audio, oscillators };
}

afterEach(() => vi.unstubAllGlobals());

describe("Bencho playback", () => {
  it("schedules layered tones with offsets and releases their audio nodes", () => {
    const { audio, oscillators } = audioMock();
    const player = createBenchoPlayer(() => true);
    player.play("open", { pitch: 12, volume: 0.5 });
    expect(oscillators).toHaveLength(2);
    expect(oscillators[0]!.frequency.setValueAtTime).toHaveBeenCalledWith(392, 10);
    expect(oscillators[1]!.start).toHaveBeenCalledWith(10.024);
    expect(audio.createGain.mock.results[0]!.value.gain.exponentialRampToValueAtTime)
      .toHaveBeenCalledWith(0.021, 10.036);
    oscillators[0]!.onended!();
    expect(oscillators[0]!.disconnect).toHaveBeenCalledOnce();
    player.destroy();
    expect(audio.close).toHaveBeenCalledOnce();
  });

  it("suppresses duplicate cues without suppressing a different interaction", () => {
    const { audio, oscillators } = audioMock();
    const player = createBenchoPlayer(() => true);
    player.play("press");
    player.play("tap");
    player.play("release");
    expect(oscillators).toHaveLength(2);
    audio.currentTime += 0.061;
    player.play("tap");
    expect(oscillators).toHaveLength(3);
    player.destroy();
  });

  it("checks mute or hidden state again after an asynchronous audio resume", async () => {
    const { audio, oscillators } = audioMock("suspended");
    let allowed = true;
    const player = createBenchoPlayer(() => allowed);
    player.play("send");
    allowed = false;
    await Promise.resolve();
    expect(audio.resume).toHaveBeenCalledOnce();
    expect(oscillators).toHaveLength(0);
    player.destroy();
  });

  it("stops pending playback when the provider unmounts during resume", async () => {
    const { audio, oscillators } = audioMock("suspended");
    const player = createBenchoPlayer(() => true);
    player.play("reply");
    player.destroy();
    await Promise.resolve();
    player.play("error");
    expect(audio.createOscillator).not.toHaveBeenCalled();
    expect(oscillators).toHaveLength(0);
  });
});
