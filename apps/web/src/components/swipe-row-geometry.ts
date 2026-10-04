type Sample = [number, number];
const DECEL = 0.998;
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const rubber = (o: number, dim: number, c: number) => (o * dim * c) / (dim + c * Math.abs(o));
export const unrubber = (y: number, dim: number, c: number) => (y * dim) / (c * Math.max(1, dim - Math.abs(y)));
export const project = (v: number) => ((v / 1000) * DECEL) / (1 - DECEL);
export const velocityOf = (hist: Sample[]) => {
  if (hist.length < 2) return 0;
  const a = hist[0];
  const b = hist[hist.length - 1];
  return ((b[1] - a[1]) / Math.max(1, b[0] - a[0])) * 1000;
};
