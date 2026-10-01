// lib/hooks/useTeamActivity.ts
import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../supabase';
import { useSupabaseQuery, subscribeToTable } from './useSupabase';
import type { JobCard, ServiceRequest, TechnicianLocation } from '../../types/database.types';

export interface TeamJob {
  request: ServiceRequest;
  jobCard: JobCard | null;
  /** When the technician accepted (job card opened). */
  acceptedAt: string | null;
  completedAt: string | null;
  /** Accept -> complete, or accept -> now while still running. Null until accepted. */
  workMs: number | null;
  /** Offer -> accept: how long the technician took to take the job. */
  responseMs: number | null;
  running: boolean;
}

/** Every job this reseller has handed to a technician, newest offer first,
 * joined with its job card so assigned / accepted / completed times and the
 * time taken are all in one row. Pass `technicianIds` to narrow to some
 * employees. Refreshes live as jobs move, with a slow poll as a fallback. */
export function useTeamJobs(resellerId: string | undefined, technicianIds?: string[]) {
  const queryClient = useQueryClient();
  const { data: requests, isLoading } = useSupabaseQuery('service_requests', {
    filters: resellerId ? { reseller_id: resellerId } : {},
    orderBy: { column: 'updated_at', ascending: false },
    enabled: !!resellerId,
    queryOptions: { refetchInterval: 30_000 },
  });

  const idKey = technicianIds?.join(',') ?? '*';
  const jobs = useMemo(
    () =>
      (requests ?? []).filter(
        (r) => r.technician_id && (!technicianIds || technicianIds.includes(r.technician_id)) && r.status !== 'cancelled'
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [requests, idKey]
  );
  const requestIds = useMemo(() => jobs.map((r) => r.id), [jobs]);

  const { data: cards } = useQuery({
    queryKey: ['team-job-cards', requestIds],
    queryFn: async () => {
      const { data, error } = await supabase.from('job_cards').select('*').in('service_request_id', requestIds);
      if (error) throw error;
      return (data ?? []) as JobCard[];
    },
    enabled: requestIds.length > 0,
    refetchInterval: 30_000,
  });

  useEffect(() => {
    if (!resellerId) return;
    const refresh = () => {
      queryClient.invalidateQueries({ queryKey: ['service_requests'] });
      queryClient.invalidateQueries({ queryKey: ['team-job-cards'] });
    };
    const offA = subscribeToTable('service_requests', refresh, `reseller_id=eq.${resellerId}`, 'team-activity');
    const offB = subscribeToTable('job_cards', refresh, undefined, 'team-activity');
    return () => {
      offA();
      offB();
    };
  }, [resellerId, queryClient]);

  const team = useMemo((): TeamJob[] => {
    const byRequest = new Map((cards ?? []).map((c) => [c.service_request_id, c]));
    const now = Date.now();
    return jobs
      .map((request) => {
        const jobCard = byRequest.get(request.id) ?? null;
        const acceptedAt = jobCard?.started_at ?? null;
        const completedAt = request.status === 'resolved' ? jobCard?.completed_at ?? null : null;
        const running = request.status === 'in_progress' && !!acceptedAt;
        const workMs = acceptedAt
          ? (completedAt ? new Date(completedAt).getTime() : running ? now : new Date(acceptedAt).getTime()) -
            new Date(acceptedAt).getTime()
          : null;
        const responseMs =
          acceptedAt && request.assigned_at
            ? new Date(acceptedAt).getTime() - new Date(request.assigned_at).getTime()
            : null;
        return { request, jobCard, acceptedAt, completedAt, workMs, responseMs, running };
      })
      .sort(
        (a, b) =>
          new Date(b.request.assigned_at ?? b.request.updated_at).getTime() -
          new Date(a.request.assigned_at ?? a.request.updated_at).getTime()
      );
  }, [jobs, cards]);

  return { data: team, isLoading };
}

/** Live positions of this reseller's accepted employees, keyed by technician
 * id. Row-level security already limits the table to people who work for you. */
export function useTeamLocations(resellerId: string | undefined) {
  const queryClient = useQueryClient();
  const { data } = useSupabaseQuery('technician_locations', {
    enabled: !!resellerId,
    queryOptions: { refetchInterval: 30_000 },
  });

  useEffect(() => {
    if (!resellerId) return;
    return subscribeToTable(
      'technician_locations',
      () => queryClient.invalidateQueries({ queryKey: ['technician_locations'] }),
      undefined,
      'team-activity'
    );
  }, [resellerId, queryClient]);

  return useMemo(() => new Map((data ?? []).map((l: TechnicianLocation) => [l.technician_id, l])), [data]);
}
