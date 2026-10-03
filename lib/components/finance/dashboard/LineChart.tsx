// lib/components/finance/dashboard/LineChart.tsx
import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Svg, { Circle, Defs, G, Line, LinearGradient, Path, Stop, Text as SvgText } from 'react-native-svg';
import { compactNpr } from './dashboardData';

export interface LineSeries {
  key: string;
  label: string;
  color: string;
  /** One per label - or fewer, when the rest hasn't happened yet (the later hours of today). */
  values: number[];
  /** Soft gradient fill under the line - one series gets this, the rest stay plain lines. */
  area?: boolean;
}

interface Props {
  labels: string[];
  series: LineSeries[];
  height?: number;
  formatValue?: (v: number) => string;
  emptyText?: string;
}

const PAD = { left: 46, right: 16, top: 14, bottom: 28 };

function niceScale(max: number): { step: number; max: number } {
  if (max <= 0) return { step: 1, max: 4 };
  const rough = max / 4;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const f = rough / pow;
  const nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  const step = nf * pow;
  return { step, max: step * 4 };
}

// Monotone cubic interpolation (Fritsch-Carlson): a smooth line that never
// overshoots the data, so a flat stretch of zero sales doesn't dip below zero.
function monotonePath(pts: { x: number; y: number }[]): string {
  const n = pts.length;
  if (n === 0) return '';
  if (n === 1) return `M${pts[0].x},${pts[0].y}`;
  const dx: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = pts[i + 1].x - pts[i].x;
    m[i] = (pts[i + 1].y - pts[i].y) / dx[i];
  }
  const t: number[] = [m[0]];
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  t[n - 1] = m[n - 2];
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) {
      t[i] = 0;
      t[i + 1] = 0;
    } else {
      const a = t[i] / m[i];
      const b = t[i + 1] / m[i];
      const s = a * a + b * b;
      if (s > 9) {
        const tau = 3 / Math.sqrt(s);
        t[i] = tau * a * m[i];
        t[i + 1] = tau * b * m[i];
      }
    }
  }
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 0; i < n - 1; i++) {
    const c1x = pts[i].x + dx[i] / 3;
    const c1y = pts[i].y + (t[i] * dx[i]) / 3;
    const c2x = pts[i + 1].x - dx[i] / 3;
    const c2y = pts[i + 1].y - (t[i + 1] * dx[i]) / 3;
    d += ` C${c1x},${c1y} ${c2x},${c2y} ${pts[i + 1].x},${pts[i + 1].y}`;
  }
  return d;
}

/** A responsive multi-series line chart with a soft area fill, grid, and a
 * hover/tap readout. Draws only the series it is given - the caller decides
 * which are switched on. */
export function LineChart({ labels, series, height = 250, formatValue, emptyText }: Props) {
  const [width, setWidth] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const n = labels.length;
  const fmt = formatValue ?? ((v: number) => String(Math.round(v)));

  const maxValue = useMemo(() => Math.max(0, ...series.flatMap((s) => s.values)), [series]);
  const scale = useMemo(() => niceScale(maxValue), [maxValue]);
  const isEmpty = maxValue <= 0;

  const innerW = Math.max(0, width - PAD.left - PAD.right);
  const innerH = height - PAD.top - PAD.bottom;
  const x = (i: number) => (n <= 1 ? PAD.left + innerW / 2 : PAD.left + (innerW * i) / (n - 1));
  const y = (v: number) => PAD.top + innerH * (1 - v / scale.max);
  const step = n <= 1 ? innerW : innerW / (n - 1);
  // With no hover, the readout sits on the latest point that has data.
  const dataLen = Math.max(0, ...series.map((s) => s.values.length));
  const active = selected != null && selected < n ? selected : Math.max(0, Math.min(n, dataLen) - 1);

  // As many labels as fit (about one per 74px), always including the first and
  // last. The last label is right-aligned, so the one before it must sit at
  // least ~80px away or the two print on top of each other.
  const maxLabels = Math.max(2, Math.floor(innerW / 74));
  const every = Math.max(1, Math.ceil(n / maxLabels));
  const showLabel = (i: number) => i === n - 1 || (i % every === 0 && (n - 1 - i) * step >= 80);

  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ height }}>
      {width > 0 && (
        <>
          <Svg width={width} height={height}>
            <Defs>
              {series.map((s) => (
                <LinearGradient key={s.key} id={`fill-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor={s.color} stopOpacity={0.22} />
                  <Stop offset="1" stopColor={s.color} stopOpacity={0.01} />
                </LinearGradient>
              ))}
            </Defs>

            {[0, 1, 2, 3, 4].map((k) => {
              const v = scale.step * k;
              return (
                <G key={k}>
                  <Line
                    x1={PAD.left}
                    x2={width - PAD.right}
                    y1={y(v)}
                    y2={y(v)}
                    stroke={k === 0 ? '#D9DDE3' : '#EEF0F3'}
                    strokeWidth={1}
                    strokeDasharray={k === 0 ? undefined : '3 4'}
                  />
                  <SvgText x={PAD.left - 8} y={y(v) + 3.5} fontSize={10.5} fill="#9CA3AF" textAnchor="end">
                    {compactNpr(v)}
                  </SvgText>
                </G>
              );
            })}

            {labels.map((label, i) =>
              showLabel(i) ? (
                <SvgText key={`${label}-${i}`} x={i === n - 1 && n > 2 ? x(i) + 4 : x(i)} y={height - 8} fontSize={10.5} fill="#9CA3AF" textAnchor={i === n - 1 && n > 2 ? 'end' : 'middle'}>
                  {label}
                </SvgText>
              ) : null
            )}

            {n > 0 ? (
              <Line x1={x(active)} x2={x(active)} y1={PAD.top} y2={PAD.top + innerH} stroke="#CBD5E1" strokeWidth={1} strokeDasharray="4 4" />
            ) : null}

            {series.map((s) => {
              const pts = s.values.map((v, i) => ({ x: x(i), y: y(v) }));
              const line = monotonePath(pts);
              return (
                <G key={s.key}>
                  {s.area && pts.length > 1 && (
                    <Path d={`${line} L${pts[pts.length - 1].x},${y(0)} L${pts[0].x},${y(0)} Z`} fill={`url(#fill-${s.key})`} />
                  )}
                  <Path d={line} fill="none" stroke={s.color} strokeWidth={s.area ? 2.5 : 2} strokeLinecap="round" strokeLinejoin="round" />
                  {s.values[active] !== undefined && (
                    <>
                      <Circle cx={x(active)} cy={y(s.values[active])} r={6.5} fill={s.color} fillOpacity={0.18} />
                      <Circle cx={x(active)} cy={y(s.values[active])} r={3.5} fill="#fff" stroke={s.color} strokeWidth={2} />
                    </>
                  )}
                </G>
              );
            })}
          </Svg>

          {/* One transparent hit column per point: hover on web, tap on a phone. */}
          {labels.map((_, i) => (
            <Pressable
              key={i}
              onHoverIn={() => setSelected(i)}
              onPress={() => setSelected(i)}
              tabIndex={-1}
              style={{ position: 'absolute', top: 0, height: height - PAD.bottom, left: x(i) - step / 2, width: Math.max(step, 8) }}
            />
          ))}

          {!isEmpty && (
            <View
              pointerEvents="none"
              className="rounded-xl border border-gray-200 bg-white px-3 py-2"
              style={{
                position: 'absolute',
                top: 4,
                left: Math.min(Math.max(x(active) - 78, PAD.left), Math.max(PAD.left, width - 168)),
                minWidth: 150,
                boxShadow: '0 8px 24px rgba(16,24,40,0.12)',
              }}
            >
              <Text className="mb-1 text-[11px] font-semibold text-gray-500">{labels[active]}</Text>
              {series.map((s) => (
                <View key={s.key} className="flex-row items-center justify-between" style={{ gap: 14 }}>
                  <View className="flex-row items-center" style={{ gap: 6 }}>
                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: s.color }} />
                    <Text className="text-[11px] text-gray-600">{s.label}</Text>
                  </View>
                  <Text className="text-[11px] font-bold text-gray-900">{s.values[active] == null ? '—' : fmt(s.values[active])}</Text>
                </View>
              ))}
            </View>
          )}

          {isEmpty && (
            <View pointerEvents="none" className="items-center justify-center" style={{ position: 'absolute', left: PAD.left, right: PAD.right, top: PAD.top, height: innerH }}>
              <Text className="text-sm text-gray-400">{emptyText ?? 'No data in this period yet'}</Text>
            </View>
          )}
        </>
      )}
    </View>
  );
}
