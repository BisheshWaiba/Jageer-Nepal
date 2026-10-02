// lib/hooks/useSupabase.ts
import { useQuery, useMutation, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import { supabase } from '../supabase';
import type { Database } from '../../types/database.types';

type TableName = keyof Database['public']['Tables'];
type Row<T extends TableName> = Database['public']['Tables'][T]['Row'];
type Insert<T extends TableName> = Database['public']['Tables'][T]['Insert'];
type Update<T extends TableName> = Database['public']['Tables'][T]['Update'];

interface QueryFilters {
  [column: string]: string | number | boolean | null;
}

// Several DB triggers cascade one table's write into another's rows
// server-side - the database always gets this right on its own, but the
// app's query cache has no way to know a write to table A also touched
// table B unless told, so a screen reading B can keep showing stale data
// until something else happens to refetch it. Each entry here is the full
// (already-flattened) set of tables a write to the key table can cascade
// into, so every mutation hook gets the fix for free instead of relying on
// each call site to remember it:
//  - business_transactions -> customer/vendor ledgers (0061, 0059): a
//    Sale/Purchase against a real party posts/reverses a debt there.
//  - orders -> products (0021/0028): a wholesale order reaching "delivered"
//    credits the buying reseller's own stock_level/purchased_stock.
//  - orders -> business_transactions -> ledgers (0049, 0050): an order's
//    status change also books the matching Purchase/Sale for both sides.
//  - catalog_products -> products (0023, 0025): an image edit or an
//    approved wholesaler submission propagates into every products row
//    sourced from that catalog entry.
//  - service_requests -> ledgers/business_transactions (0033, 0037) and ->
//    reward_point_events/profiles (0046, 0048): completing or paying for a
//    job can log a ledger debt, a Finance entry, and a reward point.
const LINKED_INVALIDATIONS: Partial<Record<TableName, TableName[]>> = {
  business_transactions: ['customer_ledger_entries', 'vendor_ledger_entries'],
  orders: ['products', 'business_transactions', 'customer_ledger_entries', 'vendor_ledger_entries'],
  catalog_products: ['products'],
  service_requests: ['customer_ledger_entries', 'business_transactions', 'vendor_ledger_entries', 'reward_point_events', 'profiles'],
};

function invalidateWithLinked(queryClient: ReturnType<typeof useQueryClient>, table: TableName) {
  queryClient.invalidateQueries({ queryKey: [table] });
  for (const linked of LINKED_INVALIDATIONS[table] ?? []) {
    queryClient.invalidateQueries({ queryKey: [linked] });
  }
}

/**
 * Generic read hook for any table, with optional equality filters.
 *
 * Example:
 *   const { data, isLoading } = useSupabaseQuery('service_requests', {
 *     filters: { client_id: userId },
 *   });
 */
export function useSupabaseQuery<T extends TableName>(
  table: T,
  options?: {
    filters?: QueryFilters;
    columns?: string;
    orderBy?: { column: string; ascending?: boolean };
    enabled?: boolean;
    queryOptions?: Omit<UseQueryOptions<Row<T>[]>, 'queryKey' | 'queryFn'>;
  }
) {
  const { filters = {}, columns = '*', orderBy, enabled = true, queryOptions } = options ?? {};

  return useQuery<Row<T>[]>({
    queryKey: [table, filters, orderBy],
    enabled,
    queryFn: async () => {
      // Cast to `any` here: postgrest-js's `.select()`/`.eq()` overloads resolve
      // their column/query types from a literal table name, which breaks down
      // when `table` is itself a generic parameter. The hand-written `Row<T>`
      // cast below is what actually keeps this hook's return type safe.
      let query = (supabase.from(table) as any).select(columns);

      for (const [column, value] of Object.entries(filters)) {
        query = query.eq(column, value);
      }
      if (orderBy) {
        query = query.order(orderBy.column, { ascending: orderBy.ascending ?? true });
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as Row<T>[];
    },
    ...queryOptions,
  });
}

/** Fetch a single row by id. */
export function useSupabaseRow<T extends TableName>(table: T, id: string | undefined, columns = '*') {
  return useQuery<Row<T> | null>({
    // A narrowed column list gets its own cache entry, so a partial row
    // never stands in for a full one elsewhere.
    queryKey: columns === '*' ? [table, 'row', id] : [table, 'row', id, columns],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await (supabase.from(table) as any).select(columns).eq('id', id!).single();
      if (error) throw error;
      return data as Row<T>;
    },
  });
}

/** Insert a row and invalidate that table's queries on success. */
export function useSupabaseInsert<T extends TableName>(table: T) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (values: Insert<T>) => {
      const { data, error } = await (supabase.from(table) as any).insert(values).select().single();
      if (error) throw error;
      return data as Row<T>;
    },
    onSuccess: () => invalidateWithLinked(queryClient, table),
  });
}

/** Update a row by id and invalidate that table's queries on success. */
export function useSupabaseUpdate<T extends TableName>(table: T) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, values }: { id: string; values: Update<T> }) => {
      const { data, error } = await (supabase.from(table) as any).update(values).eq('id', id).select().single();
      if (error) throw error;
      return data as Row<T>;
    },
    onSuccess: () => invalidateWithLinked(queryClient, table),
  });
}

/** Upsert a row by a unique constraint and invalidate that table's queries on success. */
export function useSupabaseUpsert<T extends TableName>(table: T, conflictColumns: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (values: Insert<T>) => {
      const { data, error } = await (supabase.from(table) as any)
        .upsert(values, { onConflict: conflictColumns })
        .select()
        .single();
      if (error) throw error;
      return data as Row<T>;
    },
    onSuccess: () => invalidateWithLinked(queryClient, table),
  });
}

/**
 * Delete a row by id and invalidate that table's queries on success.
 *
 * NOTE: this only deletes the database row (e.g. a `profiles` row). It does
 * NOT delete the corresponding Supabase Auth user — that requires the
 * service_role key via the Auth Admin API, which must never ship inside a
 * client app (anyone could extract it and bypass all your RLS policies).
 * To support true account deletion, add a Supabase Edge Function that runs
 * server-side with the service_role key and call it from here instead.
 */
export function useSupabaseDelete<T extends TableName>(table: T) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase.from(table) as any).delete().eq('id', id);
      if (error) throw error;
      return id;
    },
    onSuccess: () => invalidateWithLinked(queryClient, table),
  });
}

/**
 * Subscribe to realtime changes on a table (optionally filtered), invalidating
 * the matching React Query cache whenever a row changes. Use inside a
 * useEffect in screens that need live updates (e.g. client issue tracking).
 *
 * Every call gets its own channel. supabase hands back the existing channel
 * for a topic it already has, and adding a listener to an already-subscribed
 * channel throws - which, from inside an effect, blanks the whole app. So two
 * components subscribing to the same table+filter (e.g. a layout's notice and
 * a screen both calling useLeaveRequests) must never share a topic. The
 * counter guarantees that; `channelKey` is kept only to make the topic
 * readable in the realtime logs.
 */
let channelSeq = 0;

export function subscribeToTable(table: TableName, onChange: () => void, filter?: string, channelKey?: string) {
  const channel = supabase
    .channel(`realtime:${table}:${filter ?? 'all'}${channelKey ? `:${channelKey}` : ''}:${++channelSeq}`)
    .on('postgres_changes', { event: '*', schema: 'public', table, filter }, onChange)
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
