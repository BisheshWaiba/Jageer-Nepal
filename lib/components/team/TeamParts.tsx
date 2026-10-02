// lib/components/team/TeamParts.tsx
import { View, Text, Pressable } from 'react-native';
import { STATE_LABEL, type MemberState } from '../../utils/teamStatus';

const BLUE = '#2563EB';

// Soft-tint pairs, per DESIGN.md: a state is never a solid-fill chip.
const STATE_STYLE: Record<MemberState, { bg: string; fg: string }> = {
  working: { bg: '#EFF6FF', fg: '#1D4ED8' },
  offer: { bg: '#FFFBEB', fg: '#B45309' },
  free: { bg: '#F0FDF4', fg: '#15803D' },
  off: { bg: '#F3F4F6', fg: '#6B7280' },
};

export function StateChip({ state }: { state: MemberState }) {
  const s = STATE_STYLE[state];
  return (
    <View className="flex-row items-center self-start rounded-full px-2 py-0.5" style={{ backgroundColor: s.bg, gap: 5 }}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: s.fg }} />
      <Text className="text-[10px] font-bold uppercase" style={{ color: s.fg, letterSpacing: 0.5 }}>
        {STATE_LABEL[state]}
      </Text>
    </View>
  );
}

/** Two or three top-level views on one screen. `badge` adds a count to a tab. */
export function SegmentedSwitch<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { key: T; label: string; badge?: number }[];
}) {
  return (
    <View className="flex-row rounded-xl bg-gray-100 p-1" style={{ gap: 4 }} accessibilityRole="tablist">
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Pressable
            key={o.key}
            onPress={() => onChange(o.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            className="h-10 flex-1 flex-row items-center justify-center rounded-lg"
            style={{ backgroundColor: on ? BLUE : 'transparent', gap: 6 }}
          >
            <Text className="text-[13.5px] font-bold" style={{ color: on ? '#FFFFFF' : '#4B5563' }}>
              {o.label}
            </Text>
            {!!o.badge && (
              <View
                className="items-center justify-center rounded-full px-1.5"
                style={{ minWidth: 18, height: 18, backgroundColor: on ? '#FFFFFF' : '#FEF2F2' }}
              >
                <Text className="text-[10.5px] font-bold" style={{ color: on ? BLUE : '#DC2626' }}>
                  {o.badge}
                </Text>
              </View>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

/** Small filter chip: blue fill when selected, white with a border otherwise. */
export function FilterChip({ label, count, on, onPress }: { label: string; count?: number; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      className="h-9 flex-row items-center justify-center rounded-full border px-3.5"
      style={{ borderColor: on ? '#1D4ED8' : '#E5E7EB', backgroundColor: on ? '#2563EB' : '#FFFFFF', gap: 5 }}
    >
      <Text className="text-xs font-semibold" style={{ color: on ? '#FFFFFF' : '#374151' }}>
        {label}
      </Text>
      {count != null && (
        <Text className="text-xs font-bold" style={{ color: on ? '#DBEAFE' : '#9CA3AF' }}>
          {count}
        </Text>
      )}
    </Pressable>
  );
}
