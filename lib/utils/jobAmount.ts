// lib/utils/jobAmount.ts
import type { JobCard } from '../../types/database.types';

/** What the customer pays for a job - the same rule as the SQL
 * service_request_amount() (migration 0077) behind the ledger, the payment
 * record and the Fonepay QR: the price the customer agreed to, or the
 * technician's job card total only for a job that was never priced. */
export function jobAmountDue(
  quotedPrice: number | null | undefined,
  jobCard: Pick<JobCard, 'labor_cost' | 'parts_cost'> | null | undefined
): number | null {
  const quoted = quotedPrice != null ? Number(quotedPrice) : 0;
  if (quoted > 0) return quoted;
  const total = jobCard ? Number(jobCard.labor_cost) + Number(jobCard.parts_cost) : 0;
  return total > 0 ? total : null;
}
