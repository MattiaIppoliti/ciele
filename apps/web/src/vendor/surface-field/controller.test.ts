import { describe, expect, it, vi } from "vitest";
import { createSurfaceFieldController, subscribeSurfaceField, type SurfaceFieldScene } from "./controller";

const root = {} as HTMLElement;
const scene: SurfaceFieldScene = {
  root,
  rects: [{ id: "a", parent: null, left: 1, top: 2, right: 3, bottom: 4 }],
};

describe("SurfaceField controller lifecycle", () => {
  it("replays only the latest committed scene after a late mount or strict-mode remount", () => {
    const controller = createSurfaceFieldController();
    controller.setScene(scene);
    controller.setFootprint({ pointerId: 1, rects: [] });
    const first = vi.fn();
    const detach = subscribeSurfaceField(controller, first);
    expect(first).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledWith({ kind: "scene", value: scene });
    detach();
    controller.setPreview({ rect: null });
    const second = vi.fn();
    subscribeSurfaceField(controller, second);
    expect(second).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledWith({ kind: "scene", value: scene });
  });

  it("keeps two fields isolated and removes a detached field's listener", () => {
    const a = createSurfaceFieldController();
    const b = createSurfaceFieldController();
    const aSignal = vi.fn();
    const bSignal = vi.fn();
    const detachA = subscribeSurfaceField(a, aSignal);
    subscribeSurfaceField(b, bSignal);
    aSignal.mockClear();
    bSignal.mockClear();
    a.setScene(scene);
    a.setFootprint({ pointerId: 4, rects: [], suppressRipple: true });
    expect(aSignal).toHaveBeenCalledTimes(2);
    expect(bSignal).not.toHaveBeenCalled();
    detachA();
    a.refreshTheme();
    expect(aSignal).toHaveBeenCalledTimes(2);
  });

  it("rejects attaching one controller to two live fields", () => {
    const controller = createSurfaceFieldController();
    const detach = subscribeSurfaceField(controller, vi.fn());
    expect(() => subscribeSurfaceField(controller, vi.fn())).toThrow(/only one field/);
    detach();
    expect(() => subscribeSurfaceField(controller, vi.fn())).not.toThrow();
  });
});

describe("SurfaceField controller viewport", () => {
  it("retains the latest viewport and replays it after the scene on attach", () => {
    const controller = createSurfaceFieldController();
    controller.setScene(scene);
    controller.setViewport({ x: 1, y: 2, zoom: 0.5 });
    controller.setViewport({ x: 10, y: -20, zoom: 2 });
    const listener = vi.fn();
    subscribeSurfaceField(controller, listener);
    expect(listener.mock.calls).toEqual([
      [{ kind: "scene", value: scene }],
      [{ kind: "viewport", value: { x: 10, y: -20, zoom: 2 } }],
    ]);
  });

  it("sends a live viewport without replaying the scene, and copies the host's object", () => {
    const controller = createSurfaceFieldController();
    const listener = vi.fn();
    subscribeSurfaceField(controller, listener);
    listener.mockClear();
    const camera = { x: 5, y: 6, zoom: 1.5 };
    controller.setViewport(camera);
    camera.x = 999;
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ kind: "viewport", value: { x: 5, y: 6, zoom: 1.5 } });
    const late = vi.fn();
    listener.mockClear();
    const other = createSurfaceFieldController();
    subscribeSurfaceField(other, late);
    expect(late).toHaveBeenCalledTimes(1);
  });
});
