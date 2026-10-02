// lib/components/technician/CategoryLineChart.tsx
import { useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, Text, View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Line, Path, Text as SvgText, TSpan } from 'react-native-svg';
import { niceAxis, type Series } from '../../utils/dashboardStats';

export interface ChartBucket {
  /** Short text under the axis. */
  label: string;
  /** Full text at the top of the tooltip. */
  title: string;
}

// Room kept around the plot: y-axis numbers on the left, x-axis text below,
// and (on wide screens) the names of the leading lines on the right.
const ML = 36;
const MT = 12;
const MB = 30;
const PAD = 14;
const TIP_W = 208;

/** Jobs finished over time, one line per category. Press or drag across the
 * chart (hover with a mouse) to read the numbers for a point; the legend
 * highlights one line at a time. */
export function CategoryLineChart({
  buckets,
  series,
  height,
  endLabels,
  totalLabel,
  emptyText,
  focusId,
  onFocus,
}: {
  buckets: ChartBucket[];
  series: Series[];
  height: number;
  /** Names the leading lines at the right edge (wide screens only). */
  endLabels: boolean;
  totalLabel: string;
  emptyText: string;
  focusId: string | null;
  onFocus: (id: string | null) => void;
}) {
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);

  const N = buckets.length;
  // A different set of points (the date range changed) must never leave an old
  // index behind: it could point past the end of the new, shorter list.
  const bucketsKey = `${N}|${buckets[0]?.title}|${buckets[N - 1]?.title}`;
  useEffect(() => {
    setHover(null);
  }, [bucketsKey]);

  const maxValue = useMemo(() => Math.max(0, ...series.flatMap((s) => s.values)), [series]);
  const axis = useMemo(() => niceAxis(maxValue), [maxValue]);
  const empty = maxValue === 0;

  const focused = focusId && series.some((s) => s.id === focusId) ? focusId : null;
  // Names at the right edge only when the chart is wide enough to spare the room.
  const labelsOn = endLabels && width >= 480;
  const mr = labelsOn ? 160 : 16;
  const plotLeft = ML + PAD;
  const plotW = Math.max(1, width - mr - PAD - plotLeft);
  const ph = height - MT - MB;
  const x = (i: number) => (N > 1 ? plotLeft + (i / (N - 1)) * plotW : plotLeft + plotW / 2);
  const y = (v: number) => MT + ph * (1 - v / axis.top);
  const hi = hover != null && hover >= 0 && hover < N ? hover : null;

  const indexAt = (px: number) => {
    if (N <= 1) return 0;
    return Math.max(0, Math.min(N - 1, Math.round(((px - plotLeft) / plotW) * (N - 1))));
  };
  const selectFromTouch = (e: GestureResponderEvent, toggle: boolean) => {
    const i = indexAt(e.nativeEvent.locationX);
    setHover((cur) => (toggle && cur === i && Platform.OS !== 'web' ? null : i));
  };
  // With a mouse the point under the pointer is shown without pressing.
  const webHover =
    Platform.OS === 'web'
      ? ({
          onMouseMove: (e: { nativeEvent: { offsetX: number } }) => setHover(indexAt(e.nativeEvent.offsetX)),
          onMouseLeave: () => setHover(null),
        } as object)
      : {};

  const labelStep = N <= 8 ? 1 : Math.ceil(N / 7);
  const drawOrder = [...series.filter((s) => s.id !== focused), ...series.filter((s) => s.id === focused)];

  // The leading lines get a name at the right edge, skipping any that would sit on one already placed.
  const placedY: number[] = [];
  // While one line is highlighted, only that one is named.
  const ended = labelsOn && N > 0
    ? (focused ? series.filter((s) => s.id === focused) : [...series])
        .sort((a, b) => b.values[N - 1] - a.values[N - 1])
        .filter((s) => {
          const yy = y(s.values[N - 1]);
          if (placedY.length >= 4 || placedY.some((p) => Math.abs(p - yy) < 18)) return false;
          placedY.push(yy);
          return true;
        })
    : [];

  const tipRows = hi != null ? series.map((s) => ({ s, v: s.values[hi] })).sort((a, b) => b.v - a.v) : [];
  const tipTotal = tipRows.reduce((t, r) => t + r.v, 0);
  const tipLeft =
    hi != null
      ? Math.max(4, Math.min(width - TIP_W - 4, hi < N / 2 ? x(hi) + 14 : x(hi) - 14 - TIP_W))
      : 0;

  const summary = series.map((s) => `${s.name} ${s.values.reduce((a, b) => a + b, 0)}`).join(', ');

  return (
    <View>
      <View className="flex-row flex-wrap" style={{ columnGap: 20, rowGap: 6 }}>
        {series.map((s) => (
          <Pressable
            key={s.id}
            onPress={() => onFocus(focused === s.id ? null : s.id)}
            {...(Platform.OS === 'web' ? { onHoverIn: () => onFocus(s.id), onHoverOut: () => onFocus(null) } : {})}
            accessibilityRole="button"
            accessibilityLabel={`${s.name}, highlight line`}
            className="flex-row items-center gap-2"
            style={{ opacity: focused && focused !== s.id ? 0.45 : 1, minHeight: 20 }}
          >
            <View style={{ width: 16, height: 3, borderRadius: 2, backgroundColor: s.color }} />
            <Text className="text-xs text-gray-600" numberOfLines={1}>
              {s.name}
            </Text>
          </Pressable>
        ))}
      </View>

      <View
        style={{ height, marginTop: 16 }}
        onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
        accessible
        accessibilityRole="image"
        accessibilityLabel={empty ? emptyText : `Jobs completed over time. ${summary}.`}
      >
        {width > 0 && (
          <>
            <Svg width={width} height={height}>
              {axis.ticks.map((t) => (
                <Line key={`g${t}`} x1={ML} x2={width - mr} y1={y(t)} y2={y(t)} stroke={t === 0 ? '#d1d5db' : '#e5e7eb'} strokeWidth={1} />
              ))}
              {axis.ticks.map((t) => (
                <SvgText key={`t${t}`} x={ML - 8} y={y(t) + 4} fontSize={11} fill="#6b7280" textAnchor="end">
                  {String(t)}
                </SvgText>
              ))}
              {buckets.map((b, i) =>
                i % labelStep === 0 || i === hi ? (
                  <SvgText
                    key={`x${i}`}
                    x={x(i)}
                    y={MT + ph + 22}
                    fontSize={12}
                    fontWeight={i === hi ? '700' : '500'}
                    fill={i === hi ? '#111827' : '#6b7280'}
                    textAnchor="middle"
                  >
                    {b.label}
                  </SvgText>
                ) : null
              )}
              {drawOrder.map((s) => (
                <Path
                  key={s.id}
                  d={s.values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ')}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={focused && focused !== s.id ? 0.18 : 1}
                />
              ))}
              {N > 0 &&
                series.map((s) => (
                  <Circle
                    key={`e${s.id}`}
                    cx={x(N - 1)}
                    cy={y(s.values[N - 1])}
                    r={4}
                    fill={s.color}
                    stroke="#ffffff"
                    strokeWidth={2}
                    opacity={focused && focused !== s.id ? 0.18 : 1}
                  />
                ))}
              {ended.map((s) => (
                <SvgText key={`n${s.id}`} x={x(N - 1) + 14} y={y(s.values[N - 1]) + 4} fontSize={12} fill="#4b5563" opacity={focused && focused !== s.id ? 0.18 : 1}>
                  <TSpan fontWeight="700" fill="#111827">{`${s.values[N - 1]}  `}</TSpan>
                  {s.name}
                </SvgText>
              ))}
              {hi != null && <Line x1={x(hi)} x2={x(hi)} y1={MT} y2={MT + ph} stroke="#9ca3af" strokeWidth={1} />}
              {hi != null &&
                tipRows.map((r) => (
                  <Circle key={`h${r.s.id}`} cx={x(hi)} cy={y(r.v)} r={4} fill={r.s.color} stroke="#ffffff" strokeWidth={2} opacity={focused && focused !== r.s.id ? 0.18 : 1} />
                ))}
            </Svg>

            {empty && (
              <View pointerEvents="none" style={{ position: 'absolute', left: ML, right: mr, top: MT, height: ph, alignItems: 'center', justifyContent: 'center' }}>
                <Text className="text-[13px] text-gray-500">{emptyText}</Text>
              </View>
            )}

            {/* Catches the finger / pointer over the whole plot; the tooltip never takes touches. */}
            <View
              style={{ position: 'absolute', left: 0, top: MT, width, height: ph + MB }}
              onStartShouldSetResponder={() => true}
              onResponderGrant={(e) => selectFromTouch(e, true)}
              onResponderMove={(e) => selectFromTouch(e, false)}
              {...webHover}
            />

            {hi != null && !empty && (
              <View
                pointerEvents="none"
                className="rounded-xl border border-gray-200 bg-white"
                style={{
                  position: 'absolute',
                  left: tipLeft,
                  top: MT + 6,
                  width: TIP_W,
                  paddingVertical: 12,
                  paddingHorizontal: 14,
                  shadowColor: '#111827',
                  shadowOpacity: 0.1,
                  shadowRadius: 10,
                  shadowOffset: { width: 0, height: 6 },
                  elevation: 4,
                }}
              >
                <Text className="mb-2 text-[10.5px] font-bold uppercase text-gray-500" style={{ letterSpacing: 0.5 }}>
                  {buckets[hi].title}
                </Text>
                {tipRows.map((r) => (
                  <View key={r.s.id} className="flex-row items-center gap-2" style={{ height: 22 }}>
                    <View style={{ width: 12, height: 3, borderRadius: 2, backgroundColor: r.s.color }} />
                    <Text className="flex-1 text-xs text-gray-600" numberOfLines={1}>
                      {r.s.name}
                    </Text>
                    <Text className="text-[13px] font-bold text-gray-900">{r.v}</Text>
                  </View>
                ))}
                <View className="mt-1.5 flex-row items-center justify-between border-t border-gray-100 pt-2">
                  <Text className="text-xs text-gray-600">{totalLabel}</Text>
                  <Text className="text-[13px] font-bold text-gray-900">{tipTotal}</Text>
                </View>
              </View>
            )}
          </>
        )}
      </View>
    </View>
  );
}
