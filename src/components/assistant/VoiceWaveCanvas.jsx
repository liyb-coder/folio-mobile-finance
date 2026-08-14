import { useEffect, useRef } from "react";
import "./VoiceWaveCanvas.css";

const WAVE_STYLES = Object.freeze([
  { color: "rgba(220, 213, 255, 0.82)", width: 1.4, speed: 0.82, frequency: 1.65, offset: 0.15 },
  { color: "rgba(154, 137, 236, 0.92)", width: 1.8, speed: 1.08, frequency: 2.05, offset: 1.9 },
  { color: "rgba(184, 242, 70, 0.96)", width: 1.6, speed: 1.28, frequency: 1.82, offset: 3.4 },
]);

function drawVoiceWaves(context, width, height, level, active, phase) {
  context.clearRect(0, 0, width, height);
  const centerY = height / 2;
  const liveAmplitude = active ? Math.max(0.16, Math.min(1, level)) : 0.08;
  const amplitude = Math.max(4, height * (0.08 + liveAmplitude * 0.24));

  WAVE_STYLES.forEach((wave, waveIndex) => {
    context.beginPath();
    for (let x = 0; x <= width; x += 2) {
      const normalizedX = x / width;
      const envelope = Math.pow(Math.sin(Math.PI * normalizedX), 1.7);
      const primary = Math.sin(
        normalizedX * Math.PI * 2 * wave.frequency
          + phase * wave.speed
          + wave.offset,
      );
      const detail = Math.sin(
        normalizedX * Math.PI * 2 * (wave.frequency * 1.9)
          - phase * 0.48
          + waveIndex,
      ) * 0.2;
      const y = centerY + (primary + detail) * amplitude * envelope;
      if (x === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.lineWidth = wave.width;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = wave.color;
    context.shadowColor = wave.color;
    context.shadowBlur = active ? 10 : 5;
    context.stroke();
  });
  context.shadowBlur = 0;
}

export function VoiceWaveCanvas({ active = false, level = 0 }) {
  const canvasRef = useRef(null);
  const levelRef = useRef(level);
  const activeRef = useRef(active);

  useEffect(() => {
    levelRef.current = level;
    activeRef.current = active;
  }, [active, level]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const context = canvas.getContext("2d");
    if (!context) return undefined;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frameId = 0;
    let width = 1;
    let height = 1;
    const startedAt = performance.now();

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      const scale = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(1, bounds.width);
      height = Math.max(1, bounds.height);
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      context.setTransform(scale, 0, 0, scale, 0, 0);
      if (reducedMotion) {
        drawVoiceWaves(context, width, height, levelRef.current, activeRef.current, 0);
      }
    };

    const render = (now) => {
      const elapsed = reducedMotion ? 0 : (now - startedAt) / 1000;
      drawVoiceWaves(
        context,
        width,
        height,
        levelRef.current,
        activeRef.current,
        elapsed * (activeRef.current ? 2.2 : 0.42),
      );
      if (!reducedMotion) frameId = window.requestAnimationFrame(render);
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    render(performance.now());

    return () => {
      observer.disconnect();
      if (frameId) window.cancelAnimationFrame(frameId);
    };
  }, []);

  return <canvas ref={canvasRef} className="voice-wave-canvas" aria-hidden="true" />;
}
