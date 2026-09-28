// lib/components/PaymentStatusSheet.tsx
import { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, Modal, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../supabase';
import { showAlert, getErrorMessage } from '../utils/alert';
import type { ServiceRequest } from '../../types/database.types';

export type JobPaymentStatus = 'unpaid' | 'partial' | 'paid';

const BLUE = '#2563EB';

export const PAYMENT_META: Record<JobPaymentStatus, { label: string; color: string; bg: string; icon: keyof typeof Ionicons.glyphMap }> = {
  unpaid: { label: 'Unpaid', color: '#B91C1C', bg: '#FEF2F2', icon: 'ellipse-outline' },
  partial: { label: 'Partly paid', color: '#B45309', bg: '#FFFBEB', icon: 'contrast-outline' },
  paid: { label: 'Paid in full', color: '#047857', bg: '#ECFDF5', icon: 'checkmark-circle' },
};

export function money(n: number | null | undefined): string {
  return `NPR ${Math.round(Number(n ?? 0)).toLocaleString()}`;
}

/** What the job is worth. The job card's parts and labour win once the
 * technician has filled them in; the quote is the fallback, same as the
 * server's own service_request_amount. */
export function jobTotal(request: Pick<ServiceRequest, 'quoted_price'>, jobCardTotal?: number | null): number {
  if (jobCardTotal != null && jobCardTotal > 0) return jobCardTotal;
  return Number(request.quoted_price ?? 0);
}

/** The one call that changes a job's payment. The server decides who may:
 * the reseller who owns it, a supervisor on their team, or the technician
 * who did it (migration 0078). */
export async function setJobPayment(requestId: string, status: JobPaymentStatus, amountPaid?: number) {
  const { error } = await (supabase as any).rpc('set_job_payment', {
    p_request_id: requestId,
    p_status: status,
    p_amount_paid: amountPaid ?? null,
  });
  if (error) throw error;
}

/** Shows where a job's money stands, and - for the three people allowed to
 * change it - lets them move it: unpaid, part paid with the figure
 * actually received, or paid in full. */
export function PaymentStatusSheet({
  visible,
  request,
  total,
  onClose,
}: {
  visible: boolean;
  request: ServiceRequest;
  total: number;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const current = (request.payment_status ?? 'unpaid') as JobPaymentStatus;
  const [choice, setChoice] = useState<JobPaymentStatus>(current);
  const [received, setReceived] = useState(String(Number(request.amount_paid ?? 0) || ''));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setChoice(current);
    setReceived(String(Number(request.amount_paid ?? 0) || ''));
  }, [visible, current, request.amount_paid]);

  const receivedNumber = Number(received) || 0;
  const due = Math.max(total - (choice === 'paid' ? total : choice === 'partial' ? receivedNumber : 0), 0);

  async function handleSave() {
    if (choice === 'partial' && receivedNumber <= 0) {
      showAlert('How much came in?', 'Type the amount received so far.');
      return;
    }
    setBusy(true);
    try {
      await setJobPayment(request.id, choice, choice === 'partial' ? receivedNumber : undefined);
      await queryClient.invalidateQueries({ queryKey: ['service_requests'] });
      await queryClient.invalidateQueries({ queryKey: ['customer_ledger_entries'] });
      await queryClient.invalidateQueries({ queryKey: ['business_transactions'] });
      onClose();
    } catch (err) {
      showAlert('Could not update the payment', getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <Pressable className="flex-1 items-center justify-center bg-black/50 px-4" onPress={onClose}>
          <Pressable onPress={() => {}} className="w-full overflow-hidden rounded-2xl bg-white" style={{ maxWidth: 420, maxHeight: '90%' }}>
            <View className="flex-row items-center gap-2.5 px-5 py-4" style={{ backgroundColor: BLUE }}>
              <View className="flex-1">
                <Text className="text-[16px] font-bold text-white">Payment</Text>
                <Text className="mt-0.5 text-[11.5px] text-white/85" numberOfLines={1}>
                  {request.issue_type} · {money(total)}
                </Text>
              </View>
              <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Close">
                <Ionicons name="close" size={22} color="#FFFFFF" />
              </Pressable>
            </View>

            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20 }}>
              {(['unpaid', 'partial', 'paid'] as JobPaymentStatus[]).map((key) => {
                const meta = PAYMENT_META[key];
                const active = choice === key;
                return (
                  <Pressable
                    key={key}
                    onPress={() => setChoice(key)}
                    className="mb-2.5 flex-row items-center gap-3 rounded-xl p-3.5"
                    style={{
                      borderWidth: active ? 2 : 1,
                      borderColor: active ? meta.color : '#E5E7EB',
                      backgroundColor: active ? meta.bg : '#FFFFFF',
                    }}
                  >
                    <Ionicons name={meta.icon} size={20} color={active ? meta.color : '#9CA3AF'} />
                    <View className="flex-1">
                      <Text className="text-[14.5px] font-bold" style={{ color: active ? meta.color : '#374151' }}>
                        {meta.label}
                      </Text>
                      <Text className="mt-0.5 text-[11.5px] text-gray-500">
                        {key === 'unpaid'
                          ? 'Nothing received yet'
                          : key === 'partial'
                            ? 'Some of it has come in'
                            : `The whole ${money(total)} has come in`}
                      </Text>
                    </View>
                    {active && <Ionicons name="checkmark-circle" size={18} color={meta.color} />}
                  </Pressable>
                );
              })}

              {choice === 'partial' && (
                <View className="mt-1.5 rounded-xl border border-gray-200 bg-gray-50 p-3.5">
                  <Text className="mb-1.5 text-sm font-medium text-gray-700">Amount received (NPR)</Text>
                  <TextInput
                    value={received}
                    onChangeText={(v) => setReceived(v.replace(/[^0-9.]/g, ''))}
                    keyboardType="decimal-pad"
                    placeholder="0"
                    className="rounded-lg border border-gray-300 bg-white px-4 py-3 text-base text-gray-900"
                  />
                  <View className="mt-3 flex-row justify-between">
                    <Text className="text-[12.5px] text-gray-600">Received</Text>
                    <Text className="text-[13px] font-bold" style={{ color: '#047857' }}>
                      {money(receivedNumber)}
                    </Text>
                  </View>
                  <View className="mt-1 flex-row justify-between">
                    <Text className="text-[12.5px] text-gray-600">Still due</Text>
                    <Text className="text-[13px] font-bold" style={{ color: due > 0 ? '#B91C1C' : '#047857' }}>
                      {money(due)}
                    </Text>
                  </View>
                  {receivedNumber >= total && total > 0 && (
                    <Text className="mt-2 text-[11.5px] text-gray-500">
                      That covers the whole job - saving marks it paid in full.
                    </Text>
                  )}
                </View>
              )}

              <Pressable
                onPress={handleSave}
                disabled={busy}
                className="mt-4 h-12 flex-row items-center justify-center gap-2 rounded-xl disabled:opacity-50"
                style={{ backgroundColor: BLUE }}
              >
                <Ionicons name="checkmark" size={18} color="#fff" />
                <Text className="text-base font-semibold text-white">{busy ? 'Saving…' : 'Save payment'}</Text>
              </Pressable>
            </ScrollView>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** The small coloured line every screen can show: state, and what is left
 * when it is only part paid. */
export function PaymentChip({ request, total }: { request: ServiceRequest; total?: number }) {
  const status = (request.payment_status ?? 'unpaid') as JobPaymentStatus;
  const meta = PAYMENT_META[status];
  const paid = Number(request.amount_paid ?? 0);
  const due = total != null ? Math.max(total - paid, 0) : null;
  return (
    <View className="self-start rounded-full px-2 py-0.5" style={{ backgroundColor: meta.bg }}>
      <Text className="text-[10.5px] font-bold" style={{ color: meta.color }} numberOfLines={1}>
        {status === 'partial' && due != null ? `Partly paid · ${money(due)} due` : meta.label}
      </Text>
    </View>
  );
}
