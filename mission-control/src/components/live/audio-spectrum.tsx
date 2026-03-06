"use client";

import { useRef, useEffect } from "react";

interface AudioSpectrumProps {
  analyser: AnalyserNode | null;
  isSpeaking: boolean;
  height?: number;
  barCount?: number;
}

export function AudioSpectrum({
  analyser,
  isSpeaking,
  height = 48,
  barCount = 32,
}: AudioSpectrumProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dataArray = new Uint8Array(analyser?.frequencyBinCount ?? barCount);

    const draw = () => {
      rafRef.current = requestAnimationFrame(draw);

      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      if (analyser && isSpeaking) {
        analyser.getByteFrequencyData(dataArray);
      } else {
        // Idle: flat low bars
        dataArray.fill(0);
      }

      const barWidth = w / barCount;
      const gap = 2;

      for (let i = 0; i < barCount; i++) {
        // Sample from frequency data (spread across available bins)
        const dataIndex = Math.floor(
          (i / barCount) * (analyser?.frequencyBinCount ?? barCount)
        );
        const value = dataArray[dataIndex] ?? 0;

        // Scale with reduction for bass frequencies
        const reductionFactor = 0.1 + 0.9 * (i / barCount);
        const normalized = (value / 255) * reductionFactor;

        const minH = 3;
        const maxH = h * 0.9;
        const barH = Math.max(minH, normalized * maxH);

        const x = i * barWidth + gap / 2;
        const y = h - barH;

        // Purple gradient matching primary
        const intensity = Math.min(1, normalized * 2 + 0.3);
        ctx.fillStyle = `rgba(109, 40, 217, ${intensity})`;
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth - gap, barH, 2);
        ctx.fill();
      }
    };

    draw();

    return () => {
      cancelAnimationFrame(rafRef.current);
    };
  }, [analyser, isSpeaking, barCount, height]);

  // Resize canvas to match container
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        canvas.width = entry.contentRect.width * window.devicePixelRatio;
        canvas.height = height * window.devicePixelRatio;
      }
    });

    observer.observe(canvas.parentElement!);
    return () => observer.disconnect();
  }, [height]);

  return (
    <div className="w-full" style={{ height }}>
      <canvas
        ref={canvasRef}
        className="w-full h-full"
        style={{ imageRendering: "pixelated" }}
      />
    </div>
  );
}
