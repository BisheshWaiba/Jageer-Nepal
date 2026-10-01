// lib/hooks/useTechnicianRanking.ts
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../supabase';
import { useSupabaseQuery } from './useSupabase';
import { distanceKm } from '../utils/distance';
import type { RequestLocation, TechnicianEmployment } from '../../types/database.types';

/** Whether the current local time falls within a technician_employment row's
 * daily work-hours window. Handles an overnight window (e.g. 22:00-06:00)
 * by wrapping around midnight. */
export function isWithinWorkHours(row: Pick<TechnicianEmployment, 'work_start_time' | 'work_end_time'>): boolean {
  if (!row.work_start_time || !row.work_end_time) return false;
  const [sh, sm] = row.work_start_time.split(':').map(Number);
  const [eh, em] = row.work_end_time.split(':').map(Number);
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  if (startMin <= endMin) return nowMin >= startMin && nowMin < endMin;
  return nowMin >= startMin || nowMin < endMin;
}

export function useRankedTechnicians(
  requestLocation: RequestLocation | null | undefined,
  resellerId: string | undefined
) {
  const { data: technicians, isLoading } = useSupabaseQuery('profiles', {
    filters: { role: 'technician' },
  });
  // This reseller's own employees (RLS lets them read their own rows)...
  const { data: ownEmployment } = useSupabaseQuery('technician_employment', {
    filters: resellerId ? { status: 'accepted', reseller_id: resellerId } : {},
    enabled: !!resellerId,
  });
  // ...and everyone else's, which RLS hides - so read those through a
  // server function that returns only the technician and their hours
  // (migration 0079). Reading the table directly only ever returned this
  // reseller's own rows, so nobody else's employees were ever held back.
  const { data: elsewhere } = useQuery({
    queryKey: ['technician_employment', 'elsewhere', resellerId],
    enabled: !!resellerId,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc('technicians_employed_elsewhere');
      if (error) throw error;
      return (data ?? []) as { technician_id: string; work_start_time: string | null; work_end_time: string | null }[];
    },
  });

  const rankedTechnicians = useMemo(() => {
    const ownByTech = new Map((ownEmployment ?? []).map((r) => [r.technician_id, r]));
    const elsewhereByTech = new Map((elsewhere ?? []).map((r) => [r.technician_id, r]));

    const eligible = (technicians ?? [])
      .map((t) => {
        const employment = ownByTech.get(t.id) ?? null;
        const isYourEmployee = !!employment;
        return { ...t, employment, isYourEmployee };
      })
      .filter((t) => {
        if (t.isYourEmployee) return true;
        const other = elsewhereByTech.get(t.id);
        // Someone else's employee - only excluded from this reseller's pool
        // while they're actually on duty; off-duty they're free outsource.
        return !other || !isWithinWorkHours(other);
      });

    const withDistance = eligible.map((t) => {
      const distance =
        requestLocation?.latitude != null &&
        requestLocation?.longitude != null &&
        t.latitude != null &&
        t.longitude != null
          ? distanceKm(
              { latitude: requestLocation.latitude, longitude: requestLocation.longitude },
              { latitude: t.latitude, longitude: t.longitude }
            )
          : null;
      return { ...t, distance };
    });

    return withDistance.sort((a, b) => {
      if (a.isYourEmployee !== b.isYourEmployee) return a.isYourEmployee ? -1 : 1;
      if (a.is_available !== b.is_available) return a.is_available ? -1 : 1;
      if (a.distance == null && b.distance == null) return 0;
      if (a.distance == null) return 1;
      if (b.distance == null) return -1;
      return a.distance - b.distance;
    });
  }, [technicians, ownEmployment, elsewhere, requestLocation]);

  return { rankedTechnicians, isLoading };
}
