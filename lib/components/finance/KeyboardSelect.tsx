// lib/components/finance/KeyboardSelect.tsx
import { useState } from 'react';

export interface SelectOption {
  value: string;
  label: string;
}

/** A native browser <select> - the one dropdown that is already fully
 * keyboard-driven (arrows or type-ahead change it, no popup to reach for).
 * Web only: the RN web build renders DOM elements directly, native never
 * mounts this. Enter moves on (`onEnter`), Ctrl+Enter saves (`onRequestSave`). */
export function KeyboardSelect({
  value,
  options,
  onChange,
  selectRef,
  onEnter,
  onRequestSave,
  accent,
  label,
}: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  selectRef?: (el: HTMLSelectElement | null) => void;
  onEnter?: () => void;
  onRequestSave?: () => void;
  accent: string;
  label: string;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <select
      ref={selectRef}
      value={value}
      aria-label={label}
      onChange={(e) => onChange(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (e.ctrlKey || e.metaKey) onRequestSave?.();
          else onEnter?.();
        }
      }}
      style={{
        width: '100%',
        boxSizing: 'border-box',
        padding: '10px 12px',
        fontSize: 14,
        fontWeight: 600,
        color: '#111827',
        background: '#fff',
        border: `1px solid ${focused ? accent : '#D1D5DB'}`,
        borderRadius: 8,
        outline: 'none',
        boxShadow: focused ? `0 0 0 3px ${accent}29` : 'none',
        fontFamily: 'inherit',
        height: 40,
      }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
