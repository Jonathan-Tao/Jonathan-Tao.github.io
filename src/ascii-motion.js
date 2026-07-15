export const asciiMotion = {
  t: 0,
  breath: 0,
  scanNorm: 0.5,
  driftX: 0,
  driftY: 0,
  reducedMotion: false,
};

export function updateAsciiMotion(now, start, reducedMotion) {
  const t = (now - start) / 1000;
  asciiMotion.t = t;
  asciiMotion.reducedMotion = reducedMotion;
  if (reducedMotion) {
    asciiMotion.breath = 0;
    asciiMotion.scanNorm = 0.5;
    asciiMotion.driftX = 0;
    asciiMotion.driftY = 0;
    return asciiMotion;
  }
  asciiMotion.breath = Math.sin(t * 0.7) * 0.035;
  asciiMotion.scanNorm = (Math.sin(t * 0.45) * 0.5 + 0.5) * 0.7 + 0.15;
  asciiMotion.driftX = Math.sin(t * 0.35) * 1.2;
  asciiMotion.driftY = Math.cos(t * 0.28) * 0.8;
  return asciiMotion;
}
