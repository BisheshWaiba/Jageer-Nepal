// lib/hooks/useTechnicianEmployment.ts
import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../supabase';
import { useSupabaseQuery, useSupabaseInsert, useSupabaseUpdate, subscribeToTable } from './useSupabase';
import type { Profile, TechnicianEmployment } from '../../types/database.types';

/** A technician's own employment request/status - at most one active
 * (pending or accepted) row exists per technician at a time (see the
 * migration's partial unique index), older rejected/ended rows are just
 * history. */
export function useMyEmployment(technicianId: string | undefined) {
  const { data: rows, ...rest } = useSupabaseQuery('technician_employment', {
    filters: technicianId ? { technician_id: technicianId } : {},
    orderBy: { column: 'requested_at', ascending: false },
    enabled: !!technicianId,
  });

  // A pending row the reseller started is an invite, not the technician's own
  // application - that is listed separately (useMyInvites) for accept/decline.
  const current = useMemo(
    () =>
      (rows ?? []).find(
        (r) => r.status === 'accepted' || (r.status === 'pending' && r.initiated_by !== 'reseller')
      ) ?? null,
    [rows]
  );
  const { data: employer } = useSupabaseQuery('profiles', {
    filters: current ? { id: current.reseller_id } : {},
    enabled: !!current,
  });

  return { current, employer: employer?.[0] ?? null, ...rest };
}

interface EmploymentWithProfile {
  employment: TechnicianEmployment;
  profile: Profile;
}

function useJoinedTechnicianEmployment(
  resellerId: string | undefined,
  status: TechnicianEmployment['status'],
  initiatedBy?: TechnicianEmployment['initiated_by']
) {
  const { data: rows, isLoading } = useSupabaseQuery('technician_employment', {
    filters: resellerId ? { reseller_id: resellerId, status, ...(initiatedBy ? { initiated_by: initiatedBy } : {}) } : {},
    orderBy: { column: 'requested_at', ascending: false },
    enabled: !!resellerId,
  });

  const technicianIds = useMemo(() => (rows ?? []).map((r) => r.technician_id), [rows]);

  const { data: profiles } = useQuery({
    queryKey: ['technician-employment-profiles', technicianIds],
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('*').in('id', technicianIds);
      if (error) throw error;
      return (data ?? []) as Profile[];
    },
    enabled: technicianIds.length > 0,
  });

  const joined = useMemo((): EmploymentWithProfile[] => {
    const byId = new Map((profiles ?? []).map((p) => [p.id, p]));
    return (rows ?? [])
      .map((employment) => {
        const profile = byId.get(employment.technician_id);
        return profile ? { employment, profile } : null;
      })
      .filter((x): x is EmploymentWithProfile => x !== null);
  }, [rows, profiles]);

  return { data: joined, isLoading };
}

/** Pending applications a reseller has received from technicians. */
export function usePendingHires(resellerId: string | undefined) {
  return useJoinedTechnicianEmployment(resellerId, 'pending', 'technician');
}

/** Invites a reseller has sent that the technician hasn't answered yet. */
export function useSentInvites(resellerId: string | undefined) {
  return useJoinedTechnicianEmployment(resellerId, 'pending', 'reseller');
}

/** A reseller's currently-accepted employee technicians. */
export function useMyEmployees(resellerId: string | undefined) {
  return useJoinedTechnicianEmployment(resellerId, 'accepted');
}

export function useApplyToReseller() {
  const insert = useSupabaseInsert('technician_employment');
  return {
    ...insert,
    apply: (params: {
      technicianId: string;
      resellerId: string;
      workStartTime: string;
      workEndTime: string;
    }) =>
      insert.mutateAsync({
        technician_id: params.technicianId,
        reseller_id: params.resellerId,
        status: 'pending',
        work_start_time: params.workStartTime,
        work_end_time: params.workEndTime,
      }),
  };
}

export function useRespondToHire() {
  const update = useSupabaseUpdate('technician_employment');
  return {
    ...update,
    respond: (id: string, accept: boolean) =>
      update.mutateAsync({ id, values: { status: accept ? 'accepted' : 'rejected', responded_at: new Date().toISOString() } }),
  };
}

export function useEndEmployment() {
  const update = useSupabaseUpdate('technician_employment');
  return {
    ...update,
    end: (id: string) => update.mutateAsync({ id, values: { status: 'ended', ended_at: new Date().toISOString() } }),
  };
}

/** A technician asks to leave their employer. The employment stays live
 * until the employer approves (the database refuses a direct end - see
 * migration 0081); the employer is told by popup/notification. */
export function useRequestToLeave() {
  const update = useSupabaseUpdate('technician_employment');
  return {
    ...update,
    request: (id: string, reason: string) =>
      update.mutateAsync({
        id,
        // The server overwrites this with its own clock; sent only because
        // the column has to change for the trigger to see a request.
        values: { leave_requested_at: new Date().toISOString(), leave_reason: reason.trim() || null },
      }),
    withdraw: (id: string) => update.mutateAsync({ id, values: { leave_requested_at: null } }),
  };
}

/** The employer's answer to a leave request: approve ends the employment,
 * reject clears the request and tells the technician no. */
export function useDecideLeaveRequest() {
  const update = useSupabaseUpdate('technician_employment');
  return {
    ...update,
    decide: (id: string, approve: boolean) =>
      update.mutateAsync({
        id,
        values: approve
          ? { status: 'ended', ended_at: new Date().toISOString() }
          : { leave_requested_at: null },
      }),
  };
}

/** Accepted employees of this reseller who have asked to leave, oldest
 * first. Refreshes live (realtime) with a slow poll as a safety net, so the
 * employer's popup appears while they are using the app. */
export function useLeaveRequests(resellerId: string | undefined) {
  const queryClient = useQueryClient();
  const { data: employees } = useMyEmployees(resellerId);

  useEffect(() => {
    if (!resellerId) return;
    const unsubscribe = subscribeToTable(
      'technician_employment',
      () => queryClient.invalidateQueries({ queryKey: ['technician_employment'] }),
      `reseller_id=eq.${resellerId}`,
      'leave-requests'
    );
    const poll = setInterval(() => queryClient.invalidateQueries({ queryKey: ['technician_employment'] }), 20_000);
    return () => {
      unsubscribe();
      clearInterval(poll);
    };
  }, [resellerId, queryClient]);

  return useMemo(
    () =>
      employees
        .filter((e) => !!e.employment.leave_requested_at)
        .sort((a, b) => (a.employment.leave_requested_at! < b.employment.leave_requested_at! ? -1 : 1)),
    [employees]
  );
}

/** The employer's fields on an employment row - work hours, job title and
 * their private note. Technicians are blocked from changing these in the
 * database (technician_employment_hours_guard). */
export function useUpdateEmployment() {
  const update = useSupabaseUpdate('technician_employment');
  return {
    ...update,
    save: (id: string, values: Partial<TechnicianEmployment>) => update.mutateAsync({ id, values }),
  };
}

/** A reseller invites a technician; the technician accepts or declines. */
export function useInviteTechnician() {
  const insert = useSupabaseInsert('technician_employment');
  return {
    ...insert,
    invite: (params: { technicianId: string; resellerId: string; workStartTime: string; workEndTime: string }) =>
      insert.mutateAsync({
        technician_id: params.technicianId,
        reseller_id: params.resellerId,
        status: 'pending',
        initiated_by: 'reseller',
        work_start_time: params.workStartTime,
        work_end_time: params.workEndTime,
      }),
  };
}

/** Invites a technician has received from resellers, with who sent each. */
export function useMyInvites(technicianId: string | undefined) {
  const { data: rows, isLoading } = useSupabaseQuery('technician_employment', {
    filters: technicianId ? { technician_id: technicianId, status: 'pending', initiated_by: 'reseller' } : {},
    orderBy: { column: 'requested_at', ascending: false },
    enabled: !!technicianId,
  });
  const resellerIds = useMemo(() => (rows ?? []).map((r) => r.reseller_id), [rows]);
  const { data: resellers } = useQuery({
    queryKey: ['employment-invite-resellers', resellerIds],
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('*').in('id', resellerIds);
      if (error) throw error;
      return (data ?? []) as Profile[];
    },
    enabled: resellerIds.length > 0,
  });
  const invites = useMemo(() => {
    const byId = new Map((resellers ?? []).map((p) => [p.id, p]));
    return (rows ?? []).map((employment) => ({ employment, reseller: byId.get(employment.reseller_id) ?? null }));
  }, [rows, resellers]);
  return { data: invites, isLoading };
}

/** Look up a technician by phone, for a reseller inviting them. */
export function useFindTechnicianByPhone() {
  return async (phone: string): Promise<Profile | null> => {
    const { data, error } = await (supabase.from('profiles') as any)
      .select('*')
      .eq('role', 'technician')
      .eq('phone', phone)
      .maybeSingle();
    if (error) throw error;
    return data as Profile | null;
  };
}

/** Sign-in emails of this reseller's own employees (and pending invites),
 * keyed by profile id. Emails live in auth.users, so this goes through the
 * my_employee_emails definer function (see migration 0074). */
export function useEmployeeEmails(resellerId: string | undefined) {
  const { data } = useQuery({
    queryKey: ['my-employee-emails', resellerId],
    queryFn: async () => {
      const { data: rows, error } = await (supabase as any).rpc('my_employee_emails');
      if (error) throw error;
      return (rows ?? []) as { id: string; email: string }[];
    },
    enabled: !!resellerId,
  });
  return useMemo(() => new Map((data ?? []).map((r) => [r.id, r.email])), [data]);
}

/** Whether the signed-in technician supervises their employer's team, and
 * who else is on it. Both come from definer functions (migration 0077) -
 * a technician cannot read the employment table of people other than
 * themselves. */
export function useMyStaffRole(technicianId: string | undefined) {
  const { current } = useMyEmployment(technicianId);
  return current?.status === 'accepted' ? (current.staff_role ?? 'technician') : null;
}

export interface TeamMate {
  technician_id: string;
  full_name: string | null;
  phone: string | null;
  avatar_url: string | null;
  job_title: string | null;
  work_start_time: string | null;
  work_end_time: string | null;
  staff_role: 'technician' | 'supervisor';
}

export function useTeamRoster(enabled: boolean) {
  const { data } = useQuery({
    queryKey: ['my-team-roster'],
    queryFn: async () => {
      const { data: rows, error } = await (supabase as any).rpc('my_team_roster');
      if (error) throw error;
      return (rows ?? []) as TeamMate[];
    },
    enabled,
  });
  return data ?? [];
}

/** A supervisor hands a job to a teammate - it rings on their phone like
 * any other offer - or opens it to the whole team. */
export async function supervisorAssignJob(requestId: string, technicianId: string) {
  const { error } = await (supabase as any).rpc('supervisor_assign_job', {
    p_request_id: requestId,
    p_technician_id: technicianId,
  });
  if (error) throw error;
}

export async function supervisorSetOpenToTeam(requestId: string, open: boolean) {
  const { error } = await (supabase as any).rpc('supervisor_set_open_to_team', {
    p_request_id: requestId,
    p_open: open,
  });
  if (error) throw error;
}

/** Look up a technician by the email they signed up with. Sign-in emails
 * aren't readable from the client, so this goes through the
 * find_technician_by_email definer function (see migration 0073), which
 * returns at most the one matching technician. */
export function useFindTechnicianByEmail() {
  return async (email: string): Promise<Profile | null> => {
    const { data, error } = await (supabase as any).rpc('find_technician_by_email', { p_email: email });
    if (error) throw error;
    const row = (data ?? [])[0];
    return row ? (row as Profile) : null;
  };
}

/** Search technicians by name or phone, for a reseller browsing for someone
 * to invite instead of typing an exact phone number. `,()%` are stripped
 * from the term first - PostgREST's `.or()` filter syntax treats them as
 * control characters, and letting a typed name reach it unescaped would let
 * someone smuggle in extra filter clauses. */
export function useSearchTechnicians(query: string) {
  const term = query.trim().replace(/[,()%]/g, '');
  return useQuery({
    queryKey: ['technician-search', term],
    queryFn: async () => {
      const { data, error } = await (supabase.from('profiles') as any)
        .select('*')
        .eq('role', 'technician')
        .or(`full_name.ilike.%${term}%,phone.ilike.%${term}%`)
        .order('full_name')
        .limit(8);
      if (error) throw error;
      return (data ?? []) as Profile[];
    },
    enabled: term.length >= 2,
  });
}

/** Look up a reseller by phone, for a technician applying to work for them. */
export function useFindResellerByPhone() {
  const queryClient = useQueryClient();
  return async (phone: string): Promise<Profile | null> => {
    const { data, error } = await (supabase.from('profiles') as any)
      .select('*')
      .eq('role', 'reseller')
      .eq('phone', phone)
      .maybeSingle();
    if (error) throw error;
    if (data) queryClient.setQueryData(['profiles', 'row', data.id], data);
    return data as Profile | null;
  };
}
