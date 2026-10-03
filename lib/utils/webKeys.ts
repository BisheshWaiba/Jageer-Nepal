// lib/utils/webKeys.ts

export interface WebKeyInfo {
  key: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  prevent: () => void;
}

/** Reads the pressed key off a keyboard event from react-native-web's
 * TextInput `onKeyPress` (a React synthetic event whose `nativeEvent` is the
 * real DOM event) or from a plain DOM element's `onKeyDown` - both expose the
 * same fields, but RN's own event typings only declare `key`. */
export function readKey(e: unknown): WebKeyInfo {
  const ev = e as {
    key?: string;
    nativeEvent?: { key?: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean };
    preventDefault?: () => void;
  };
  const ne = ev.nativeEvent ?? {};
  return {
    key: ne.key ?? ev.key ?? '',
    ctrl: !!(ne.ctrlKey || ne.metaKey),
    alt: !!ne.altKey,
    shift: !!ne.shiftKey,
    prevent: () => ev.preventDefault?.(),
  };
}
