// app/(technician)/dashboard.tsx
import { useMemo } from 'react';
import { router } from 'expo-router';
import { useAuthStore } from '../../lib/hooks/useAuth';
import { useSupabaseQuery } from '../../lib/hooks/useSupabase';
import { resolveVisualKey } from '../../lib/constants/categoryIcons';
import { TechnicianDashboardView } from '../../lib/components/technician/TechnicianDashboardView';
import { isoOfLocalDate, type Completion } from '../../lib/utils/dashboardStats';
import { jobCardAmount, type JobCardWithQuote } from './earnings';

/** "Laptop Repair - Screen replacement" -> "Laptop Repair". A job's issue_type
 * is "{category} - {action}" (see request-details); a built-in category is
 * recognised by name first, so a label that itself contains " - " still
 * groups correctly. */
function categoryOf(issueType: string | null | undefined): string {
  if (!issueType) return 'Other';
  const known = resolveVisualKey(issueType);
  if (known) return known;
  const head = issueType.split(' - ')[0].trim();
  return head || 'Other';
}

/** The technician's Home tab: what they have finished and earned, by
 * category, over a date range they choose. Offers to answer and open team
 * work live on the Inbox screen (header button). */
export default function TechnicianDashboard() {
  const userId = useAuthStore((state) => state.session?.user.id);

  // Same query as the Earnings screen, so both share one cached request.
  const { data: jobCards, isLoading } = useSupabaseQuery('job_cards', {
    filters: userId ? { technician_id: userId } : {},
    orderBy: { column: 'created_at', ascending: false },
    columns: '*, service_requests(quoted_price, issue_type)',
    enabled: !!userId,
  }) as { data: JobCardWithQuote[] | undefined; isLoading: boolean };

  const completions = useMemo<Completion[]>(
    () =>
      (jobCards ?? [])
        .filter((c) => !!c.completed_at)
        .map((c) => ({
          id: c.id,
          date: isoOfLocalDate(new Date(c.completed_at as string)),
          category: categoryOf(c.service_requests?.issue_type),
          amount: jobCardAmount(c),
        })),
    [jobCards]
  );

  return (
    <TechnicianDashboardView
      completions={completions}
      loading={!!userId && (isLoading || jobCards === undefined)}
      onOpenCompleted={() =>
        // `t` changes every time so the Jobs tab reacts even if it is already on Completed.
        router.push({ pathname: '/(technician)/jobs', params: { tab: 'completed', t: String(Date.now()) } })
      }
      onOpenEarnings={() => router.push('/(technician)/earnings')}
    />
  );
}
