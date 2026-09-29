'use client';

import { useState } from 'react';
import { monthLabel } from './account-360';

// Barras por mes, una sola serie (un color de marca, sin leyenda: el título la
// nombra). SVG propio: el panel no tiene librería de gráficos y esto no la
// justifica. Validado con el skill de dataviz: budi-primary-500 (#3b82f6) pasa
// banda de luminosidad y contraste >= 3:1 en claro y en oscuro.

type Point = { month: string; value: number };

const W = 480;
const H = 160;
const PAD_TOP = 16;
const PAD_BOTTOM = 2;
const GAP = 8;

/** Barra con esquinas de 4px arriba y base recta sobre el eje. */
function barPath(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}

export function MonthBars({
  title,
  data,
  format,
  currentMonth,
}: {
  title: string;
  data: Point[];
  format: (n: number) => string;
  /** YYYY-MM-01 del mes en curso: se rotula como parcial. */
  currentMonth?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...data.map((d) => d.value), 0);
  const plotH = H - PAD_TOP - PAD_BOTTOM;
  const slot = W / Math.max(data.length, 1);
  const barW = Math.min(44, slot - GAP * 2);
  const isEmpty = max === 0;

  return (
    <figure className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <figcaption className="mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">{title}</figcaption>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-36 w-full" role="img" aria-label={title}>
          {/* Grilla recesiva: base + mitad */}
          {[0, 0.5].map((f) => (
            <line
              key={f}
              x1={0}
              x2={W}
              y1={PAD_TOP + plotH * (1 - f)}
              y2={PAD_TOP + plotH * (1 - f)}
              className={f === 0 ? 'stroke-zinc-300 dark:stroke-zinc-700' : 'stroke-zinc-100 dark:stroke-zinc-800'}
              strokeWidth={1}
            />
          ))}
          {data.map((d, i) => {
            const h = max ? (d.value / max) * plotH : 0;
            const x = i * slot + (slot - barW) / 2;
            const y = PAD_TOP + plotH - h;
            return (
              <g key={d.month}>
                {h > 0 && (
                  <path
                    d={barPath(x, y, barW, h)}
                    className={`fill-budi-primary-500 transition-opacity ${hover !== null && hover !== i ? 'opacity-40' : ''}`}
                  />
                )}
                {/* Zona de hover más grande que la barra */}
                <rect
                  x={i * slot}
                  y={0}
                  width={slot}
                  height={H}
                  fill="transparent"
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                />
              </g>
            );
          })}
        </svg>
        {/* Eje de meses en HTML: dentro del SVG el texto se escalaba con el ancho. */}
        <div className="mt-1 flex text-[11px] text-zinc-500 dark:text-zinc-400" aria-hidden>
          {data.map((d) => (
            <span key={d.month} className="flex-1 text-center">
              {monthLabel(d.month)}
              {d.month.slice(0, 10) === currentMonth ? '*' : ''}
            </span>
          ))}
        </div>
        {hover !== null && data[hover] && (
          <div
            className="pointer-events-none absolute top-0 -translate-x-1/2 whitespace-nowrap rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs shadow-md dark:border-zinc-700 dark:bg-zinc-800"
            style={{ left: `${((hover + 0.5) / data.length) * 100}%` }}
          >
            <p className="text-zinc-500 dark:text-zinc-400">
              {monthLabel(data[hover].month, true)}
              {data[hover].month.slice(0, 10) === currentMonth && ' (en curso)'}
            </p>
            <p className="font-semibold tabular-nums text-zinc-900 dark:text-white">{format(data[hover].value)}</p>
          </div>
        )}
        {isEmpty && (
          <p className="absolute inset-0 flex items-center justify-center text-sm text-zinc-400">Sin datos en estos meses</p>
        )}
      </div>
      <details className="mt-2 text-xs text-zinc-500">
        <summary className="cursor-pointer select-none">Ver tabla</summary>
        <table className="mt-2 w-full">
          <tbody>
            {data.map((d) => (
              <tr key={d.month}>
                <td className="py-0.5">{monthLabel(d.month, true)}</td>
                <td className="py-0.5 text-right tabular-nums text-zinc-700 dark:text-zinc-300">{format(d.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
      {currentMonth && data.some((d) => d.month.slice(0, 10) === currentMonth) && (
        <p className="mt-1 text-[11px] text-zinc-400">* mes en curso, todavía parcial</p>
      )}
    </figure>
  );
}
