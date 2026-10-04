/** Quiet menu ticks, based on travelled rows rather than scroll-event frequency. */
export function createScrollDetents(initialPosition: number) {
  let previous = initialPosition;
  let direction = 0;
  let travel = 0;
  let lastPulse = Number.NEGATIVE_INFINITY;

  return {
    next(position: number, now: number): boolean {
      const delta = position - previous;
      previous = position;
      if (delta === 0) return false;
      const nextDirection = Math.sign(delta);
      if (nextDirection !== direction) travel = 0;
      direction = nextDirection;
      travel += Math.abs(delta);
      if (travel < 44) return false;
      // Consume crossings even while throttled: a fast flick never queues a burst.
      travel %= 44;
      if (now - lastPulse < 80) return false;
      lastPulse = now;
      return true;
    },
  };
}
