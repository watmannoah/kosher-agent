/**
 * Audio-reactive waveform driven by a real AnalyserNode.
 *
 * Canvas rather than animated DOM: 48 bars at 60fps through React state would
 * be 2,880 re-renders a second. The draw loop writes straight to the canvas and
 * never touches React.
 *
 * When the analyser is unavailable — permission refused, or a browser without
 * getUserMedia — this renders a flat idle line rather than a fake animation.
 * A waveform that moves without a microphone is exactly the kind of thing the
 * brief says not to build.
 */

'use client';

import { useEffect, useRef } from 'react';
import type { AnalyserHandle } from '@/lib/client/voice';

const BARS = 48;

export function Waveform({
  analyser,
  active,
  className = '',
}: {
  analyser: AnalyserHandle | null;
  active: boolean;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<number | null>(null);
  // Smoothed levels, kept outside React so the loop can mutate in place.
  const levelsRef = useRef<number[]>(new Array(BARS).fill(0));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;

      if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
        canvas.width = width * dpr;
        canvas.height = height * dpr;
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const target = active && analyser ? analyser.levels(BARS) : new Array(BARS).fill(0);
      const levels = levelsRef.current;

      const barWidth = width / BARS;
      const mid = height / 2;

      for (let i = 0; i < BARS; i++) {
        // Ease toward the target so the bars do not strobe between frames.
        levels[i] += (target[i] - levels[i]) * 0.35;
        const amplitude = Math.max(0.012, levels[i]) * (height * 0.46);

        ctx.fillStyle = active ? 'rgba(74, 222, 128, 0.85)' : 'rgba(92, 102, 115, 0.55)';
        ctx.fillRect(i * barWidth + barWidth * 0.22, mid - amplitude, barWidth * 0.56, amplitude * 2);
      }

      frameRef.current = requestAnimationFrame(draw);
    };

    frameRef.current = requestAnimationFrame(draw);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [analyser, active]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={`h-10 w-full ${className}`}
    />
  );
}
