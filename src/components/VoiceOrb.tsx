import { useEffect, useRef } from 'react';

export type OrbMode = 'idle' | 'recording' | 'transcribing' | 'thinking' | 'speaking' | 'error';

interface VoiceOrbProps {
  mode: OrbMode;
  audioLevel: number;
  analyser: AnalyserNode | null;
  playbackAnalyser?: AnalyserNode | null;
  size?: number;
}

const INK = '#000000';
const INK_FAINT = 'rgba(0, 0, 0, 0.32)';
const INK_GHOST = 'rgba(0, 0, 0, 0.16)';
const INK_TICK = 'rgba(0, 0, 0, 0.10)';

export function VoiceOrb({
  mode,
  audioLevel,
  analyser,
  playbackAnalyser,
  size = 480,
}: VoiceOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const modeRef = useRef(mode);
  const levelRef = useRef(audioLevel);
  const anRef = useRef<AnalyserNode | null>(analyser);
  const pbRef = useRef<AnalyserNode | null>(playbackAnalyser ?? null);

  modeRef.current = mode;
  levelRef.current = audioLevel;
  anRef.current = analyser;
  pbRef.current = playbackAnalyser ?? null;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    ctx.scale(dpr, dpr);

    const cx = size / 2;
    const cy = size / 2;
    const baseRadius = size * 0.18;

    // A handful of tiny particles orbiting silently
    const particles = Array.from({ length: 28 }, () => ({
      angle: Math.random() * Math.PI * 2,
      radius: baseRadius * 2.0 + Math.random() * baseRadius * 0.7,
      speed: 0.0012 + Math.random() * 0.002,
      size: 0.6 + Math.random() * 1.0,
      phase: Math.random() * Math.PI * 2,
    }));

    let t = 0;
    let raf = 0;

    const draw = () => {
      t += 0.016;
      const m = modeRef.current;
      const an = anRef.current;
      const pb = pbRef.current;
      const activeAnalyser = pb && m === 'speaking' ? pb : an;

      // Frequency data (typed for TS 6)
      let freq: Uint8Array<ArrayBuffer> | null = null;
      if (activeAnalyser) {
        freq = new Uint8Array(new ArrayBuffer(activeAnalyser.frequencyBinCount));
        activeAnalyser.getByteFrequencyData(freq);
      }

      // Pulse driver
      const lvl =
        m === 'idle'
          ? 0.03 + (Math.sin(t * 1.2) * 0.5 + 0.5) * 0.025
          : m === 'thinking' || m === 'transcribing'
            ? 0.08 + (Math.sin(t * 3.4) * 0.5 + 0.5) * 0.06
            : levelRef.current;

      const r = baseRadius + lvl * baseRadius * 0.45;

      ctx.clearRect(0, 0, size, size);

      // Concentric guide rings — pure hairlines
      for (let i = 1; i <= 4; i++) {
        const rr = r + i * 26 + Math.sin(t * 1.2 + i * 0.6) * (i === 1 ? 1.5 : 0.8);
        ctx.beginPath();
        ctx.arc(cx, cy, rr, 0, Math.PI * 2);
        ctx.strokeStyle = i === 1 ? INK_GHOST : i === 4 ? INK_TICK : INK_TICK;
        ctx.lineWidth = i === 1 ? 1.0 : 0.6;
        ctx.setLineDash(i === 4 ? [1.5, 6] : []);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Frequency bars — outward strokes in black
      if (freq && (m === 'recording' || m === 'speaking')) {
        const bars = 88;
        for (let i = 0; i < bars; i++) {
          const angle = (i / bars) * Math.PI * 2 - Math.PI / 2;
          const idx = Math.floor((i / bars) * (freq.length * 0.55));
          const amp = freq[idx] / 255;
          const h = 4 + amp * (size * 0.16);
          const inner = r + 6;
          const outer = inner + h;
          const x1 = cx + Math.cos(angle) * inner;
          const y1 = cy + Math.sin(angle) * inner;
          const x2 = cx + Math.cos(angle) * outer;
          const y2 = cy + Math.sin(angle) * outer;
          ctx.strokeStyle = INK;
          ctx.lineWidth = 1.0;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        }
      } else {
        // Static tick marks — minimal radial scale
        const bars = 60;
        for (let i = 0; i < bars; i++) {
          const angle = (i / bars) * Math.PI * 2 - Math.PI / 2;
          const len = i % 5 === 0 ? 8 : 4;
          const inner = r + 8;
          const outer = inner + len;
          const x1 = cx + Math.cos(angle) * inner;
          const y1 = cy + Math.sin(angle) * inner;
          const x2 = cx + Math.cos(angle) * outer;
          const y2 = cy + Math.sin(angle) * outer;
          ctx.strokeStyle = i % 5 === 0 ? INK_FAINT : INK_TICK;
          ctx.lineWidth = 0.8;
          ctx.lineCap = 'butt';
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        }
      }

      // Orbiting particles — tiny ink dots
      particles.forEach((pt) => {
        pt.angle += pt.speed + lvl * 0.005;
        const pulse = Math.sin(t * 2 + pt.phase) * 4;
        const rad = pt.radius + pulse;
        const x = cx + Math.cos(pt.angle) * rad;
        const y = cy + Math.sin(pt.angle) * rad;
        ctx.fillStyle = INK;
        ctx.beginPath();
        ctx.arc(x, y, pt.size, 0, Math.PI * 2);
        ctx.fill();
      });

      // Main perimeter (solid black hairline)
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();

      // Inner ring offset
      ctx.strokeStyle = INK_FAINT;
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.78, 0, Math.PI * 2);
      ctx.stroke();

      // Core dot — small, solid, centered
      const coreR = 6 + lvl * 16;
      ctx.fillStyle = INK;
      ctx.beginPath();
      ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
      ctx.fill();

      raf = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(raf);
  }, [size]);

  return <canvas ref={canvasRef} className="orb-canvas" />;
}
