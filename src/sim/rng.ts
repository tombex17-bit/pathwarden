/** Deterministic generator (mulberry32) seeded from several integers. */
export function createRng(...seeds: number[]): () => number {
  let a = 0x9e3779b9;
  for (const s of seeds) a = Math.imul(a ^ (s | 0), 0x85ebca6b) ^ (a >>> 13);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
