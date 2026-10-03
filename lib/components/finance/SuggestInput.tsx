// lib/components/finance/SuggestInput.tsx
import { useState, type ReactNode } from 'react';
import { Pressable, Text, TextInput, View, type StyleProp, type TextStyle } from 'react-native';
import { readKey } from '../../utils/webKeys';

export interface SuggestOption {
  key: string;
  label: string;
  hint?: string | null;
}

export type PickVia = 'enter' | 'tab' | 'click';

interface Props {
  value: string;
  onChangeText: (v: string) => void;
  /** Already filtered for the current text - shown while the box is focused and non-empty. */
  options: SuggestOption[];
  onSelectOption: (option: SuggestOption, via: PickVia) => void;
  inputRef?: (el: TextInput | null) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  /** Called for every key the suggestion list didn't consume (Enter, arrows...). */
  onKeyPress?: (e: unknown) => void;
  placeholder?: string;
  accessibilityLabel?: string;
  autoFocus?: boolean;
  accent: string;
  inputClassName?: string;
  inputStyle?: StyleProp<TextStyle>;
  /** Small indicator drawn inside the right edge of the box. */
  adornment?: ReactNode;
  adornmentWidth?: number;
}

/** A text box with a typeahead list that is fully driven from the keyboard:
 * type to filter, Up/Down to highlight, Enter (or Tab) to take the highlighted
 * suggestion, Esc to dismiss. Anything else is passed on to `onKeyPress`, so
 * the owner can layer its own navigation (Enter = next cell, ...) on top. */
export function SuggestInput({
  value,
  onChangeText,
  options,
  onSelectOption,
  inputRef,
  onFocus,
  onBlur,
  onKeyPress,
  placeholder,
  accessibilityLabel,
  autoFocus,
  accent,
  inputClassName,
  inputStyle,
  adornment,
  adornmentWidth = 0,
}: Props) {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(-1);

  const visible = open && value.trim().length > 0 && options.length > 0;
  const activeIndex = Math.min(index, options.length - 1);

  function choose(option: SuggestOption, via: PickVia) {
    setOpen(false);
    setIndex(-1);
    onSelectOption(option, via);
  }

  function handleKeyPress(e: unknown) {
    const k = readKey(e);
    if (visible) {
      if (k.key === 'ArrowDown') {
        k.prevent();
        setIndex(Math.min(activeIndex + 1, options.length - 1));
        return;
      }
      if (k.key === 'ArrowUp' && activeIndex >= 0) {
        k.prevent();
        setIndex(activeIndex - 1);
        return;
      }
      if (k.key === 'Enter' && !k.ctrl && activeIndex >= 0) {
        k.prevent();
        choose(options[activeIndex], 'enter');
        return;
      }
      if (k.key === 'Tab' && !k.shift && activeIndex >= 0) {
        choose(options[activeIndex], 'tab');
        return;
      }
      if (k.key === 'Escape') {
        k.prevent();
        setOpen(false);
        return;
      }
    }
    onKeyPress?.(e);
  }

  return (
    <View style={{ minWidth: 0, zIndex: visible ? 40 : 0 }}>
      <View style={{ justifyContent: 'center' }}>
        <TextInput
          ref={inputRef}
          value={value}
          onChangeText={(v) => {
            setOpen(true);
            setIndex(-1);
            onChangeText(v);
          }}
          onFocus={() => {
            setOpen(true);
            setIndex(-1);
            onFocus?.();
          }}
          onBlur={() => {
            setTimeout(() => setOpen(false), 120);
            onBlur?.();
          }}
          onKeyPress={handleKeyPress}
          placeholder={placeholder}
          placeholderTextColor="#B2B8C1"
          accessibilityLabel={accessibilityLabel}
          autoFocus={autoFocus}
          selectTextOnFocus
          className={inputClassName}
          style={[inputStyle, adornmentWidth ? { paddingRight: adornmentWidth } : null]}
        />
        {adornment ? (
          <View pointerEvents="none" style={{ position: 'absolute', right: 12 }}>
            {adornment}
          </View>
        ) : null}
      </View>

      {visible && (
        <View
          // Pressing the mouse on a suggestion would first blur the text box -
          // which closes this list before the click lands. Keeping the box
          // focused on mousedown lets the click select the suggestion.
          {...({ onMouseDown: (e: { preventDefault: () => void }) => e.preventDefault() } as object)}
          className="rounded-xl border border-gray-200 bg-white py-1"
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            zIndex: 50,
            marginTop: 2,
            boxShadow: '0 10px 28px rgba(16,24,40,0.14)',
          }}
        >
          {options.map((o, i) => (
            <Pressable
              key={o.key}
              tabIndex={-1}
              onPress={() => choose(o, 'click')}
              className="flex-row items-center justify-between px-3 py-2"
              style={{ backgroundColor: i === activeIndex ? `${accent}14` : 'transparent' }}
            >
              <Text className="flex-1 text-sm text-gray-900" numberOfLines={1}>
                {o.label}
              </Text>
              {!!o.hint && <Text className="ml-2 text-[11px] text-gray-400">{o.hint}</Text>}
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}
