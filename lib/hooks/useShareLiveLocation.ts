// lib/hooks/useShareLiveLocation.ts
import { useEffect } from 'react';
import * as Location from 'expo-location';
import { supabase } from '../supabase';
import { useMyEmployment } from './useTechnicianEmployment';
import { isWithinWorkHours } from './useTechnicianRanking';

const MIN_GAP_MS = 45_000;

/** While a technician is an accepted employee and their shift is on, keeps
 * their position up to date in technician_locations so their employer can
 * see where they are. Foreground only - it stops when the app is closed - and
 * it never runs for outsource technicians or outside work hours. The
 * technician is told about this on their Employment screen. */
export function useShareLiveLocation(technicianId: string | undefined) {
  const { current } = useMyEmployment(technicianId);
  const employed = current?.status === 'accepted';
  const start = current?.work_start_time ?? null;
  const end = current?.work_end_time ?? null;

  useEffect(() => {
    if (!technicianId || !employed) return;
    let subscription: Location.LocationSubscription | null = null;
    let cancelled = false;
    let lastSent = 0;

    const stop = () => {
      subscription?.remove();
      subscription = null;
    };

    async function push(pos: Location.LocationObject) {
      const now = Date.now();
      if (now - lastSent < MIN_GAP_MS) return;
      lastSent = now;
      await (supabase.from('technician_locations') as any).upsert(
        {
          technician_id: technicianId,
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy_m: pos.coords.accuracy ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'technician_id' }
      );
    }

    async function begin() {
      if (subscription || !isWithinWorkHours({ work_start_time: start, work_end_time: end })) return;
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted' || cancelled) return;
      const sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, distanceInterval: 50, timeInterval: 60_000 },
        (pos) => {
          push(pos).catch(() => {});
        }
      );
      if (cancelled) sub.remove();
      else subscription = sub;
    }

    // Re-check the shift every minute so tracking starts and stops on time.
    const tick = () => {
      if (isWithinWorkHours({ work_start_time: start, work_end_time: end })) begin().catch(() => {});
      else stop();
    };
    tick();
    const timer = setInterval(tick, 60_000);

    return () => {
      cancelled = true;
      clearInterval(timer);
      stop();
    };
  }, [technicianId, employed, start, end]);
}
