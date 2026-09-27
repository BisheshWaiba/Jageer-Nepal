// lib/hooks/useAdvanceOrder.ts
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../supabase';
import { showAlert, getErrorMessage } from '../utils/alert';
import type { Order } from '../../types/database.types';

/**
 * Seller-side "advance order status" and cancel actions. Both run as one
 * server-side transaction (migration 0079): confirming takes the stock
 * from the seller's listings in the same step - refusing to oversell - and
 * cancelling a confirmed order gives it back. The app no longer writes
 * stock or order status itself, so a half-finished update can't leave the
 * two out of step.
 */
export function useAdvanceOrder() {
  const queryClient = useQueryClient();
  const [isBusy, setIsBusy] = useState(false);

  function refresh() {
    for (const key of ['orders', 'order_items', 'products', 'business_transactions']) {
      queryClient.invalidateQueries({ queryKey: [key] });
    }
  }

  async function advance(order: Order) {
    setIsBusy(true);
    try {
      const { error } = await (supabase as any).rpc('advance_order', { p_order_id: order.id });
      if (error) throw error;
      refresh();
    } catch (err) {
      showAlert('Could not update order', getErrorMessage(err));
    } finally {
      setIsBusy(false);
    }
  }

  async function cancel(order: Order) {
    setIsBusy(true);
    try {
      const { error } = await (supabase as any).rpc('cancel_order', { p_order_id: order.id });
      if (error) throw error;
      refresh();
    } catch (err) {
      showAlert('Could not cancel order', getErrorMessage(err));
    } finally {
      setIsBusy(false);
    }
  }

  return { advance, cancel, isBusy };
}
