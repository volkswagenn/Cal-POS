import { useEffect, useRef } from 'react';
import type { ReceiptRenderConfig } from '../../services/receiptLayoutService';

interface Props {
  text: string;
  config: ReceiptRenderConfig;
  scale?: number;
}

/**
 * Renders receipt text on a Canvas using the same parameters as EscPosRasterBuilder.java:
 * - monospace font (matches Android Typeface.MONOSPACE)
 * - fixed paperWidthDots width with horizontal clipping (no CSS word-wrap)
 * - identical lineHeight, padding calculations
 * This makes the preview match the actual printed receipt 1:1.
 */
export function ReceiptCanvasPreview({ text, config, scale = 0.5 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { paperWidthDots, fontSizePx, lineHeightPx, horizontalPaddingPx, verticalPaddingPx } = config;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const lines = text.split('\n');
    const canvasHeight = Math.max(
      lineHeightPx + verticalPaddingPx * 2,
      lines.length * lineHeightPx + verticalPaddingPx * 2,
    );

    canvas.width = paperWidthDots;
    canvas.height = canvasHeight;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, paperWidthDots, canvasHeight);

    ctx.font = `${fontSizePx}px monospace`;
    ctx.fillStyle = '#000000';
    ctx.textBaseline = 'top';

    let y = verticalPaddingPx;
    for (const line of lines) {
      ctx.fillText(line, horizontalPaddingPx, y);
      y += lineHeightPx;
    }
  }, [text, paperWidthDots, fontSizePx, lineHeightPx, horizontalPaddingPx, verticalPaddingPx]);

  return (
    <div style={{ width: `${Math.ceil(paperWidthDots * scale)}px` }}>
      <canvas
        ref={canvasRef}
        style={{ display: 'block', transform: `scale(${scale})`, transformOrigin: 'top left' }}
      />
    </div>
  );
}
