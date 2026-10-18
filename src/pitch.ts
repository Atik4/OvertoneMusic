/**
 * YIN pitch detector (de Cheveigné & Kawahara, 2002). Monophonic.
 * Returns the fundamental frequency and a 0..1 clarity score, or null.
 */
export function detectPitch(buf: Float32Array, sampleRate: number, threshold = 0.15): { freq: number; clarity: number } | null {
  const half = Math.floor(buf.length / 2);
  const minTau = Math.max(2, Math.floor(sampleRate / 4200));
  const d = new Float32Array(half);

  for (let tau = 1; tau < half; tau++) {
    let sum = 0;
    for (let i = 0; i < half; i++) {
      const diff = buf[i] - buf[i + tau];
      sum += diff * diff;
    }
    d[tau] = sum;
  }

  // Cumulative mean normalized difference.
  d[0] = 1;
  let running = 0;
  for (let tau = 1; tau < half; tau++) {
    running += d[tau];
    d[tau] = running === 0 ? 1 : (d[tau] * tau) / running;
  }

  let tau = -1;
  for (let t = minTau; t < half - 1; t++) {
    if (d[t] < threshold) {
      while (t + 1 < half && d[t + 1] < d[t]) t++;
      tau = t;
      break;
    }
  }
  if (tau < 0) return null;

  // Parabolic interpolation around the minimum.
  const a = d[tau - 1], b = d[tau], c = d[tau + 1] ?? b;
  const denom = a + c - 2 * b;
  const better = denom !== 0 ? tau + (a - c) / (2 * denom) : tau;
  return { freq: sampleRate / better, clarity: 1 - b };
}
