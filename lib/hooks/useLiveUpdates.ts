// lib/hooks/useLiveUpdates.ts
import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import * as Updates from 'expo-updates';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { showAlert } from '../utils/alert';

// Foreground checks closer together than this are skipped - coming back to
// the app twice in a minute shouldn't hit the update server twice.
const MIN_CHECK_GAP_MS = 60_000;

const LAST_ANNOUNCED_KEY = 'last-announced-update-id';

// Once per downloaded update, say so - it is why the app just restarted by
// itself. A launch from the APK's own bundle (fresh install, or a rollback to
// it) stays silent.
async function announceUpdate() {
  if (Updates.isEmbeddedLaunch || !Updates.updateId) return;
  try {
    if ((await AsyncStorage.getItem(LAST_ANNOUNCED_KEY)) === Updates.updateId) return;
    await AsyncStorage.setItem(LAST_ANNOUNCED_KEY, Updates.updateId);
    showAlert('Updated', 'Jageer was updated to the latest version.');
  } catch {
    // storage unavailable - skip the notice
  }
}

/**
 * Keeps an installed build current without a rebuild: on launch and every
 * time the app comes back to the foreground it asks for a newer JS update,
 * downloads it and restarts straight into it. (expo-updates alone only
 * downloads in the background and applies it on the launch after next.)
 *
 * A rollback-to-embedded update is applied the same way, so pulling a bad
 * update reaches phones as fast as shipping one. Any failure - offline,
 * update server down - is swallowed: the app just keeps the version it has.
 *
 * Only JS/asset changes arrive this way; native changes (permissions, new
 * native libraries) still need a new APK, and bumping `runtimeVersion` in
 * app.json at that point stops the old APKs being sent JS that needs it.
 */
export function useLiveUpdates() {
  const lastCheck = useRef(0);
  const busy = useRef(false);

  useEffect(() => {
    // No updates on web (Vercel deploys cover it) or in a dev/Metro session.
    if (Platform.OS === 'web' || __DEV__ || !Updates.isEnabled) return;

    const checkAndApply = async () => {
      if (busy.current || Date.now() - lastCheck.current < MIN_CHECK_GAP_MS) return;
      busy.current = true;
      lastCheck.current = Date.now();
      try {
        const check = await Updates.checkForUpdateAsync();
        if (!check.isAvailable && !check.isRollBackToEmbedded) return;
        const fetched = await Updates.fetchUpdateAsync();
        if (fetched.isNew || fetched.isRollBackToEmbedded) await Updates.reloadAsync();
      } catch {
        // keep running the current version
      } finally {
        busy.current = false;
      }
    };

    announceUpdate();
    checkAndApply();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') checkAndApply();
    });
    return () => sub.remove();
  }, []);
}
