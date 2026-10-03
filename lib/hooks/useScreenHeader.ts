// lib/hooks/useScreenHeader.ts
import { useLayoutEffect, type ReactNode } from 'react';
import { useNavigation } from 'expo-router';

/** Lets a screen put its own controls into the top bar (PortalHeaderBar renders
 * `headerLeft` / `headerRight` beside the title), so filters, search and the
 * main action sit up there instead of in a card of their own.
 *
 * The options belong to this screen's route only - tab screens stay mounted
 * when you switch away, and each keeps its own header. They are cleared when
 * the screen goes away (and only then, so a control the user is typing in is
 * never torn down by a re-render). `deps` is what the controls depend on - the
 * selected filter, the search text ... - so they are registered again when
 * those change, not on every render. Anything that must be current when tapped
 * (callbacks) should be read through a ref by the caller. */
export function useScreenHeader(
  options: {
    title?: string;
    /** The title to go back to when this screen stops setting its own. */
    resetTitle?: string;
    headerLeft?: () => ReactNode;
    headerRight?: () => ReactNode;
  },
  deps: readonly unknown[]
) {
  const navigation = useNavigation();
  useLayoutEffect(() => {
    const { resetTitle: _ignored, title, ...rest } = options;
    navigation.setOptions({ ...rest, ...(title !== undefined ? { title } : null) });
    // `options` is rebuilt every render; `deps` says when it actually changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation, ...deps]);

  useLayoutEffect(
    () => () => {
      navigation.setOptions({
        ...(options.resetTitle !== undefined ? { title: options.resetTitle } : null),
        headerLeft: undefined,
        headerRight: undefined,
      });
    },
    // Unmount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [navigation]
  );
}
