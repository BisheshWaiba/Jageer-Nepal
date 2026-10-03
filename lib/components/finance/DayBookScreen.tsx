// lib/components/finance/DayBookScreen.tsx
import { useEffect, useMemo, useState, type ComponentProps, type ReactNode } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Modal, KeyboardAvoidingView, Platform, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../../hooks/useAuth';
import { useSupabaseQuery, useSupabaseUpdate, useSupabaseDelete } from '../../hooks/useSupabase';
import { useBankAccounts } from '../../hooks/useBankAccounts';
import { DateField } from '../DateTimeFields';
import { FormSection } from './FormSection';
import { BankAccountPickerModal } from './BankAccountPickerModal';
import { useWideDetail } from '../detail/DetailLayout';
import { dateLabels, useCalendarMode } from '../../hooks/useCalendarMode';
import { useBookToolbar } from './BookKit';
import { MONEY } from './moneyColors';
import { showAlert, getErrorMessage } from '../../utils/alert';

type Kind = 'opening' | 'received' | 'paid' | 'expense' | 'sale' | 'purchase' | 'transfer';

type BookRow = {
  id: string;
  kind: Kind;
  time: string;
  details: string;
  sub: string | null;
  invoice: number | null;
  discount: number | null;
  /** Bill total (sale/purchase) or amount moved (transfer) - not cash. */
  amount: number | null;
  cashIn: number | null;
  cashOut: number | null;
  /** Running cash + bank balance after this row; null for non-cash rows. */
  balance: number | null;
  sortKey: string;
  href?: string;
  /** What this row actually is in the database, so it can be edited here. */
  edit?: EditTarget;
};

type EditTable = 'business_transactions' | 'customer_ledger_entries' | 'vendor_ledger_entries' | 'account_transfers';

type EditValues = {
  date: string;
  amount: string;
  party: string;
  billNo: string;
  discount: string;
  receiptNo: string;
  note: string;
  /** null means cash, like the Payment In form's method picker. */
  bankAccountId: string | null;
};

type EditTarget = {
  table: EditTable;
  id: string;
  title: string;
  /** Set when the entry belongs to something else (a job's payment, say) -
   * it is then shown read-only, since a change here would just be
   * overwritten by whatever created it. */
  lockedReason?: string;
  /** Which fields this kind of entry has. */
  fields: { party?: boolean; billNo?: boolean; discount?: boolean; receiptNo?: boolean; method?: boolean };
  /** Heading for the name section - "Customer", "Vendor", "Paid to"... */
  partyLabel?: string;
  /** Name to show when it isn't typed here but on the customer's own record. */
  subtitleParty?: string;
  /** Wording for the numbered field, as Payment In words it. */
  numberLabel?: string;
  values: EditValues;
};

const KIND: Record<Kind, { label: string; color: string; bg: string }> = {
  opening: { label: 'Opening', color: '#374151', bg: '#F3F4F6' },
  received: { label: 'Cash in', color: '#047857', bg: '#ECFDF5' },
  paid: { label: 'Paid out', color: '#B91C1C', bg: '#FEF2F2' },
  expense: { label: 'Expense', color: '#B91C1C', bg: '#FEF2F2' },
  sale: { label: 'Sale bill', color: MONEY.in.text, bg: MONEY.in.bg },
  purchase: { label: 'Purchase bill', color: MONEY.out.text, bg: MONEY.out.bg },
  transfer: { label: 'Transfer', color: '#4338CA', bg: '#EEF2FF' },
};

/** Local calendar day of a timestamp, as YYYY-MM-DD - going through
 * toISOString would use UTC and shift late-evening Nepal entries a day. */
function localDay(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function shiftDay(day: string, delta: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return localDay(new Date(y, m - 1, d + delta).toISOString());
}

function timeOf(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function money(n: number | null | undefined): string {
  return n == null ? '—' : Math.round(n).toLocaleString();
}

function amountText(n: number | null | undefined): string {
  return n == null ? '' : String(n);
}

// Full-table column widths; Transaction details takes the rest. All nine
// columns need about this much window to fit beside the sidebar - narrower
// than that and the table falls back to the compact four-column form rather
// than cutting off Cash in / Cash out / Balance.
const COL = { time: 58, type: 104, invoice: 96, discount: 76, amount: 104, cashIn: 100, cashOut: 100, balance: 112 };
const FULL_TABLE_MIN_WINDOW = 1280;

function TypePill({ kind }: { kind: Kind }) {
  const k = KIND[kind];
  return (
    <View className="self-start rounded-full px-2 py-0.5" style={{ backgroundColor: k.bg }}>
      <Text className="text-[10.5px] font-bold" style={{ color: k.color }} numberOfLines={1}>
        {k.label}
      </Text>
    </View>
  );
}

/** Every entry of the day in one cash-book table, in time order: opening
 * balance first, then cash in / paid out / expenses (which move the running
 * balance) mixed with the day's sales and purchase bills and transfers
 * (which don't), closing balance last. */
function DayBookTable({ rows, opening, totalIn, totalOut, closing, full, onOpenRow }: {
  rows: BookRow[];
  opening: number;
  totalIn: number;
  totalOut: number;
  closing: number;
  /** Show every column; otherwise Time | Details | Amount | Balance. */
  full: boolean;
  onOpenRow: (row: BookRow) => void;
}) {
  const cell = 'px-2.5 py-2 border-r border-gray-200';
  const headCell = (label: string, style: object, right = false) => (
    <Text className={`${cell} text-[11.5px] font-bold text-gray-600 ${right ? 'text-right' : ''}`} style={style}>
      {label}
    </Text>
  );
  const num = (value: number | null, style: object, color = '#111827', bold = false) => (
    <Text
      className={`${cell} text-right text-[12.5px] ${bold ? 'font-bold' : 'font-medium'}`}
      style={[style, { color: value == null ? '#9CA3AF' : color }]}
      numberOfLines={1}
    >
      {value == null ? '—' : money(value)}
    </Text>
  );
  // Tapping an entry opens it for editing; the opening-balance line and
  // anything without a record behind it stays inert.
  const open = (r: BookRow) => (r.edit ? () => onOpenRow(r) : r.href ? () => router.push(r.href as any) : undefined);

  if (!full) {
    // Narrow: Time | Details (type, notes, invoice) | Amount | Balance.
    return (
      <View className="overflow-hidden rounded-xl border border-gray-300 bg-white">
        <View className="flex-row border-b border-gray-300 bg-gray-50">
          {headCell('Time', { width: 50 })}
          {headCell('Transaction details', { flex: 1 })}
          {headCell('Amount', { width: 82 }, true)}
          <Text className="px-2.5 py-2 text-right text-[11.5px] font-bold text-gray-600" style={{ width: 84 }}>
            Balance
          </Text>
        </View>
        {rows.map((r) => {
          const cash = r.cashIn ?? r.cashOut;
          const amountText = r.cashIn != null ? `+${money(r.cashIn)}` : r.cashOut != null ? `−${money(r.cashOut)}` : money(r.amount);
          const amountColor = r.cashIn != null ? '#047857' : r.cashOut != null ? '#B91C1C' : '#6B7280';
          return (
            <Pressable key={r.id} onPress={open(r)} disabled={!r.edit && !r.href} className="flex-row border-b border-gray-200">
              <Text className={`${cell} text-[11.5px] text-gray-500`} style={{ width: 50 }} numberOfLines={1}>
                {r.time}
              </Text>
              <View className={cell} style={{ flex: 1, gap: 2 }}>
                <Text className={`text-[13px] text-gray-900 ${r.kind === 'opening' ? 'font-bold' : 'font-medium'}`} numberOfLines={2}>
                  {r.details}
                </Text>
                <TypePill kind={r.kind} />
                {!!r.sub && (
                  <Text className="text-[11px] text-gray-400" numberOfLines={2}>
                    {r.sub}
                  </Text>
                )}
                {r.invoice != null && (
                  <Text className="text-[11px] text-gray-500">
                    Invoice {money(r.invoice)}
                    {r.discount ? ` · Discount ${money(r.discount)}` : ''}
                  </Text>
                )}
              </View>
              <Text
                className={`${cell} text-right text-[12.5px] ${cash != null ? 'font-bold' : 'font-medium'}`}
                style={{ width: 82, color: r.kind === 'opening' ? '#9CA3AF' : amountColor }}
              >
                {r.kind === 'opening' ? '—' : amountText}
              </Text>
              <Text
                className="px-2.5 py-2 text-right text-[12.5px] font-semibold"
                style={{ width: 84, color: r.balance == null ? '#9CA3AF' : '#111827' }}
              >
                {money(r.balance)}
              </Text>
            </Pressable>
          );
        })}
        <View className="flex-row bg-gray-50">
          <Text className={`${cell} flex-1 text-right text-[12.5px] font-bold text-gray-700`}>Closing balance</Text>
          <Text
            className="px-2.5 py-2 text-right text-[14px] font-extrabold"
            style={{ width: 84, color: closing >= 0 ? '#2563EB' : '#DC2626' }}
          >
            {money(closing)}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View className="overflow-hidden rounded-xl border border-gray-300 bg-white">
      <View>
          <View className="flex-row border-b border-gray-300 bg-gray-50">
            {headCell('Time', { width: COL.time })}
            {headCell('Transaction details', { flex: 1 })}
            {headCell('Type', { width: COL.type })}
            {headCell('Invoice', { width: COL.invoice }, true)}
            {headCell('Discount', { width: COL.discount }, true)}
            {headCell('Bill amount', { width: COL.amount }, true)}
            {headCell('Cash in', { width: COL.cashIn }, true)}
            {headCell('Cash out', { width: COL.cashOut }, true)}
            <Text className="px-2.5 py-2 text-right text-[11.5px] font-bold text-gray-600" style={{ width: COL.balance }}>
              Balance
            </Text>
          </View>

          {rows.map((r) => (
            <Pressable
              key={r.id}
              onPress={open(r)}
              disabled={!r.edit && !r.href}
              className="flex-row border-b border-gray-200"
              style={r.kind === 'opening' ? { backgroundColor: '#FAFAFA' } : undefined}
            >
              <Text className={`${cell} text-[12.5px] text-gray-500`} style={{ width: COL.time }} numberOfLines={1}>
                {r.time}
              </Text>
              <View className={cell} style={{ flex: 1, minWidth: 0 }}>
                <Text className={`text-[13px] text-gray-900 ${r.kind === 'opening' ? 'font-bold' : 'font-medium'}`} numberOfLines={1}>
                  {r.details}
                </Text>
                {!!r.sub && (
                  <Text className="text-[11px] text-gray-400" numberOfLines={1}>
                    {r.sub}
                  </Text>
                )}
              </View>
              <View className={cell} style={{ width: COL.type }}>
                <TypePill kind={r.kind} />
              </View>
              {num(r.invoice, { width: COL.invoice }, '#4B5563')}
              {num(r.discount, { width: COL.discount }, '#4B5563')}
              {num(r.amount, { width: COL.amount }, KIND[r.kind].color)}
              {num(r.cashIn, { width: COL.cashIn }, '#047857', true)}
              {num(r.cashOut, { width: COL.cashOut }, '#B91C1C', true)}
              <Text
                className="px-2.5 py-2 text-right text-[13px] font-bold"
                style={{ width: COL.balance, color: r.balance == null ? '#9CA3AF' : '#111827' }}
              >
                {money(r.balance)}
              </Text>
            </Pressable>
          ))}

          <View className="flex-row bg-gray-50">
            <Text className={`${cell} flex-1 text-right text-[12.5px] font-bold text-gray-700`}>
              Opening {money(opening)} + In {money(totalIn)} − Out {money(totalOut)} = Closing balance
            </Text>
            <Text className={`${cell} text-right text-[13px] font-extrabold`} style={{ width: COL.cashIn, color: '#047857' }}>
              {money(totalIn)}
            </Text>
            <Text className={`${cell} text-right text-[13px] font-extrabold`} style={{ width: COL.cashOut, color: '#B91C1C' }}>
              {money(totalOut)}
            </Text>
            <Text
              className="px-2.5 py-2 text-right text-[14px] font-extrabold"
              style={{ width: COL.balance, color: closing >= 0 ? '#2563EB' : '#DC2626' }}
            >
              {money(closing)}
            </Text>
          </View>
      </View>
    </View>
  );
}

function EditField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View className="mb-3.5">
      <Text className="mb-1.5 text-sm font-medium text-gray-700">{label}</Text>
      {children}
    </View>
  );
}

function EditInput(props: ComponentProps<typeof TextInput>) {
  return (
    <TextInput
      {...props}
      className={`rounded-lg border px-4 py-3 text-base ${props.editable === false ? 'border-gray-200 bg-gray-50 text-gray-500' : 'border-gray-300 bg-white text-gray-900'}`}
    />
  );
}

/** Edit or delete one entry without leaving the Day Book. Writes go to the
 * row's own table, so the ledgers, balances and the rest of Finance follow
 * along - a sale's customer debit, for one, is kept in step by a database
 * trigger. */
function EditEntryModal({ target, onClose }: { target: EditTarget | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const userId = useAuthStore((state) => state.session?.user.id);
  const bankAccounts = useBankAccounts(userId);
  const [showAccountPicker, setShowAccountPicker] = useState(false);
  const updates = {
    business_transactions: useSupabaseUpdate('business_transactions'),
    customer_ledger_entries: useSupabaseUpdate('customer_ledger_entries'),
    vendor_ledger_entries: useSupabaseUpdate('vendor_ledger_entries'),
    account_transfers: useSupabaseUpdate('account_transfers'),
  };
  const removals = {
    business_transactions: useSupabaseDelete('business_transactions'),
    customer_ledger_entries: useSupabaseDelete('customer_ledger_entries'),
    vendor_ledger_entries: useSupabaseDelete('vendor_ledger_entries'),
    account_transfers: useSupabaseDelete('account_transfers'),
  };
  const [form, setForm] = useState<EditValues | undefined>(target?.values);
  const [busy, setBusy] = useState(false);
  // Deleting asks a second time in the sheet itself rather than through a
  // pop-up: the confirmation sits under the reader's finger, right where
  // the first tap was, and can't be missed behind this window.
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    setForm(target?.values);
    setConfirmingDelete(false);
  }, [target]);

  useEffect(() => {
    if (!confirmingDelete) return;
    const timer = setTimeout(() => setConfirmingDelete(false), 5000);
    return () => clearTimeout(timer);
  }, [confirmingDelete]);

  if (!target || !form) return null;
  const locked = !!target.lockedReason;
  const accountName = form.bankAccountId
    ? (bankAccounts.accounts.find((a) => a.id === form.bankAccountId)?.name ?? 'Bank')
    : 'Cash';
  const set = (key: keyof EditValues) => (value: string) => setForm((f) => (f ? { ...f, [key]: value } : f));

  // Each table keeps its own column names; the Day Book only ever changes
  // what is actually visible on the row.
  function valuesFor(values: EditValues): Record<string, unknown> {
    const amount = Number(values.amount);
    const note = values.note.trim() || null;
    switch (target!.table) {
      case 'business_transactions':
        return {
          bill_date: values.date,
          amount,
          discount_amount: values.discount.trim() ? Number(values.discount) : 0,
          party_name: values.party.trim() || null,
          bill_no: values.billNo.trim() || null,
          bank_account_id: values.bankAccountId,
          note,
        };
      case 'customer_ledger_entries':
      case 'vendor_ledger_entries':
        return {
          entry_date: values.date,
          amount,
          receipt_no: values.receiptNo.trim() || null,
          bank_account_id: values.bankAccountId,
          note,
        };
      case 'account_transfers':
        return { transfer_date: values.date, amount, note };
    }
  }

  async function refreshEverything() {
    // A bill's trigger writes to the ledgers, so refresh all of them.
    await Promise.all(
      ['business_transactions', 'customer_ledger_entries', 'vendor_ledger_entries', 'account_transfers'].map((t) =>
        queryClient.invalidateQueries({ queryKey: [t] })
      )
    );
  }

  async function handleSave() {
    const values = form!;
    const amount = Number(values.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      showAlert('Check the amount', 'Enter an amount greater than zero.');
      return;
    }
    if (!values.date) {
      showAlert('Pick a date', 'Every entry needs a date.');
      return;
    }
    setBusy(true);
    try {
      await updates[target!.table].mutateAsync({ id: target!.id, values: valuesFor(values) as never });
      await refreshEverything();
      onClose();
    } catch (err) {
      showAlert('Could not save', getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    setBusy(true);
    try {
      await removals[target!.table].mutateAsync(target!.id);
      await refreshEverything();
      onClose();
    } catch (err) {
      showAlert('Could not delete', getErrorMessage(err));
    } finally {
      setBusy(false);
      setConfirmingDelete(false);
    }
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <Pressable className="flex-1 items-center justify-center bg-black/50 px-4" onPress={onClose}>
          <Pressable onPress={() => {}} className="w-full overflow-hidden rounded-2xl bg-white" style={{ maxWidth: 460, maxHeight: '90%' }}>
            <View className="flex-row items-center gap-2.5 px-5 py-4" style={{ backgroundColor: '#1D4ED8' }}>
              <View className="flex-1">
                <Text className="text-[16px] font-bold text-white">{locked ? 'Entry details' : 'Edit entry'}</Text>
                <Text className="mt-0.5 text-[11.5px] text-white/85">{target.title}</Text>
              </View>
              <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Close">
                <Ionicons name="close" size={22} color="#FFFFFF" />
              </Pressable>
            </View>

            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20 }}>
              {locked && (
                <View className="mb-4 flex-row items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 p-3.5">
                  <Ionicons name="lock-closed-outline" size={16} color="#B45309" />
                  <Text className="flex-1 text-xs leading-[17px] text-amber-900">{target.lockedReason}</Text>
                </View>
              )}

              {/* Same order and the same field blocks as the Payment In
                  form, so an entry reads the way it was written. */}
              <FormSection icon="document-text-outline" title="Details" first>
                <View className="flex-row" style={{ gap: 10 }}>
                  <View className="flex-1">
                    <Text className="mb-1 text-xs font-medium text-gray-500">Date</Text>
                    {locked ? (
                      <EditInput value={form.date} editable={false} />
                    ) : (
                      <DateField value={form.date} onChange={(v) => v && set('date')(v)} />
                    )}
                  </View>
                  {(target.fields.receiptNo || target.fields.billNo) && (
                    <View className="flex-1">
                      <Text className="mb-1 text-xs font-medium text-gray-500">{target.numberLabel ?? 'Receipt No.'}</Text>
                      <EditInput
                        value={target.fields.billNo ? form.billNo : form.receiptNo}
                        onChangeText={target.fields.billNo ? set('billNo') : set('receiptNo')}
                        placeholder="Optional"
                        editable={!locked}
                      />
                    </View>
                  )}
                </View>
              </FormSection>

              {target.fields.method && (
                <FormSection icon="wallet-outline" title="Payment method">
                  <Pressable
                    onPress={() => !locked && setShowAccountPicker(true)}
                    disabled={locked}
                    className={`flex-row items-center justify-between rounded-lg border px-3 py-2.5 ${locked ? 'border-gray-200 bg-gray-50' : 'border-gray-300 bg-white'}`}
                  >
                    <View className="flex-row items-center gap-2">
                      <Ionicons name={form.bankAccountId ? 'business-outline' : 'cash-outline'} size={16} color="#6B7280" />
                      <Text className={`text-sm ${locked ? 'text-gray-500' : 'text-gray-900'}`}>{accountName}</Text>
                    </View>
                    {!locked && <Ionicons name="chevron-down" size={16} color="#9CA3AF" />}
                  </Pressable>
                </FormSection>
              )}

              {target.fields.party && (
                <FormSection icon="person-outline" title={target.partyLabel ?? 'Customer'}>
                  <EditInput value={form.party} onChangeText={set('party')} placeholder="Name" editable={!locked} />
                </FormSection>
              )}

              {!target.fields.party && !!target.subtitleParty && (
                <FormSection icon="person-outline" title={target.partyLabel ?? 'Customer'}>
                  <EditInput value={target.subtitleParty} editable={false} />
                </FormSection>
              )}

              <FormSection icon="cash-outline" title="Amount">
                <View className="flex-row" style={{ gap: 10 }}>
                  <View className="flex-1">
                    <Text className="mb-1 text-xs font-medium text-gray-500">Amount (NPR)</Text>
                    <EditInput
                      value={form.amount}
                      onChangeText={(v) => set('amount')(v.replace(/[^0-9.]/g, ''))}
                      keyboardType="decimal-pad"
                      editable={!locked}
                    />
                  </View>
                  {target.fields.discount && (
                    <View className="flex-1">
                      <Text className="mb-1 text-xs font-medium text-gray-500">Discount (NPR)</Text>
                      <EditInput
                        value={form.discount}
                        onChangeText={(v) => set('discount')(v.replace(/[^0-9.]/g, ''))}
                        keyboardType="decimal-pad"
                        editable={!locked}
                      />
                    </View>
                  )}
                </View>
                <View className="mt-3">
                  <Text className="mb-1 text-xs font-medium text-gray-500">Note</Text>
                  <EditInput
                    value={form.note}
                    onChangeText={set('note')}
                    placeholder="Optional"
                    multiline
                    style={{ minHeight: 70, textAlignVertical: 'top' }}
                    editable={!locked}
                  />
                </View>
              </FormSection>

              {!locked && (
                <>
                  <Pressable
                    onPress={handleSave}
                    disabled={busy}
                    className="h-12 flex-row items-center justify-center gap-2 rounded-xl disabled:opacity-50"
                    style={{ backgroundColor: '#1D4ED8' }}
                  >
                    <Ionicons name="checkmark" size={18} color="#fff" />
                    <Text className="text-base font-semibold text-white">{busy ? 'Saving...' : 'Save changes'}</Text>
                  </Pressable>
                  <Pressable
                    onPress={handleDelete}
                    disabled={busy}
                    className="mt-3 flex-row items-center justify-center gap-2 rounded-xl py-3 disabled:opacity-50"
                    style={
                      confirmingDelete
                        ? { backgroundColor: '#DC2626' }
                        : { backgroundColor: '#FEF2F2', borderWidth: 1, borderColor: '#FECACA' }
                    }
                  >
                    <Ionicons name="trash-outline" size={17} color={confirmingDelete ? '#FFFFFF' : '#DC2626'} />
                    <Text className={`text-sm font-semibold ${confirmingDelete ? 'text-white' : 'text-red-600'}`}>
                      {confirmingDelete ? 'Tap again to delete for good' : 'Delete entry'}
                    </Text>
                  </Pressable>
                  {confirmingDelete && (
                    <Text className="mt-2 text-center text-[11px] text-gray-400">
                      It disappears from the Day Book and from every total that counted it.
                    </Text>
                  )}
                </>
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>

      <BankAccountPickerModal
        visible={showAccountPicker}
        accounts={bankAccounts.accounts}
        selectedId={form.bankAccountId}
        onSelect={(id) => setForm((f) => (f ? { ...f, bankAccountId: id } : f))}
        onClose={() => setShowAccountPicker(false)}
        onRename={bankAccounts.rename}
        onDelete={bankAccounts.remove}
      />
    </Modal>
  );
}

/** The five things a day can gain, behind one button - the same forms the
 * Finance menu opens, without leaving the Day Book to find them. */
const NEW_ENTRY_KINDS: { key: string; label: string; icon: ComponentProps<typeof Ionicons>['name']; color: string; path: string }[] = [
  { key: 'received', label: 'Received', icon: 'arrow-down-circle', color: '#059669', path: '/quick-payment?type=in' },
  { key: 'payment-out', label: 'Payment Out', icon: 'arrow-up-circle', color: '#DC2626', path: '/quick-payment?type=out' },
  { key: 'sale', label: 'Sale', icon: 'trending-up', color: '#059669', path: '/transactions?type=sale&add=1' },
  { key: 'purchase', label: 'Purchase', icon: 'cart', color: '#DC2626', path: '/transactions?type=purchase&add=1' },
  { key: 'expense', label: 'Expense', icon: 'receipt', color: '#DC2626', path: '/transactions?type=expense&add=1' },
];

function NewEntryMenu({ basePath }: { basePath: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        className="h-9 flex-row items-center justify-center gap-1.5 rounded-lg px-3.5"
        style={{ backgroundColor: '#1D4ED8' }}
      >
        <Ionicons name="add" size={16} color="#FFFFFF" />
        <Text className="text-[13px] font-semibold text-white">New entry</Text>
        <Ionicons name="chevron-down" size={14} color="#FFFFFF" />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable className="flex-1 items-center justify-center bg-black/50 px-4" onPress={() => setOpen(false)}>
          <Pressable onPress={() => {}} className="w-full overflow-hidden rounded-2xl bg-white" style={{ maxWidth: 380 }}>
            <View className="flex-row items-center gap-2.5 px-5 py-4" style={{ backgroundColor: '#1D4ED8' }}>
              <Text className="flex-1 text-[16px] font-bold text-white">What are you recording?</Text>
              <Pressable onPress={() => setOpen(false)} hitSlop={8} accessibilityLabel="Close">
                <Ionicons name="close" size={22} color="#FFFFFF" />
              </Pressable>
            </View>
            {NEW_ENTRY_KINDS.map((kind, i) => (
              <Pressable
                key={kind.key}
                onPress={() => {
                  setOpen(false);
                  router.push(`${basePath}${kind.path}` as any);
                }}
                className={`flex-row items-center gap-3 px-5 py-3.5 ${i === NEW_ENTRY_KINDS.length - 1 ? '' : 'border-b border-gray-100'}`}
              >
                <Ionicons name={kind.icon} size={20} color={kind.color} />
                <Text className="flex-1 text-[15px] font-semibold text-gray-900">{kind.label}</Text>
                <Ionicons name="chevron-forward" size={16} color="#9CA3AF" />
              </Pressable>
            ))}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View className="rounded-xl border border-gray-200 bg-white px-3.5 py-2.5" style={{ flexGrow: 1, flexBasis: 140 }}>
      <Text className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{label}</Text>
      <Text className="mt-0.5 text-[16px] font-extrabold" style={{ color }}>
        NPR {money(value)}
      </Text>
    </View>
  );
}

/** The day's money laid out like a paper cash book, as one table. Uses the
 * dashboard's definitions - a sale or purchase books a debt rather than
 * moving cash, the ledger rows it creates are skipped so nothing counts
 * twice, and entries sit on the date the user gave them. The opening balance
 * is every cash movement dated before this day, the same formula as the
 * Available Balance (useAccountBalances), so the two always agree. */
export function DayBookScreen({ basePath }: { basePath: string }) {
  const userId = useAuthStore((state) => state.session?.user.id);
  const wide = useWideDetail();
  const { width: windowWidth } = useWindowDimensions();
  const fullTable = wide && windowWidth >= FULL_TABLE_MIN_WINDOW;
  const [calendarMode] = useCalendarMode();
  const today = localDay(new Date().toISOString());
  const [day, setDay] = useState(today);
  const [editing, setEditing] = useState<EditTarget | null>(null);

  const owner: Record<string, string> = userId ? { owner_id: userId } : {};
  const { data: transactions, isLoading } = useSupabaseQuery('business_transactions', { filters: owner, enabled: !!userId });
  const { data: customerEntries } = useSupabaseQuery('customer_ledger_entries', { filters: owner, enabled: !!userId });
  const { data: vendorEntries } = useSupabaseQuery('vendor_ledger_entries', { filters: owner, enabled: !!userId });
  const { data: transfers } = useSupabaseQuery('account_transfers', { filters: owner, enabled: !!userId });
  const { data: contacts } = useSupabaseQuery('customers', { filters: owner, enabled: !!userId });
  const { data: accounts } = useSupabaseQuery('bank_accounts', { filters: owner, orderBy: { column: 'name' }, enabled: !!userId });
  const { data: categories } = useSupabaseQuery('expense_categories', { filters: owner, orderBy: { column: 'name' }, enabled: !!userId });

  const book = useMemo(() => {
    const contactName = new Map((contacts ?? []).map((c) => [c.id, c.name]));
    const accountName = new Map((accounts ?? []).map((a) => [a.id, a.name]));
    const categoryName = new Map((categories ?? []).map((c) => [c.id, c.name]));
    const via = (bankId: string | null) => (bankId ? (accountName.get(bankId) ?? 'Bank') : 'Cash');
    const blank = { invoice: null, discount: null, amount: null, cashIn: null, cashOut: null, balance: null };

    let opening = 0;
    const rows: BookRow[] = [];

    for (const t of transactions ?? []) {
      const date = t.bill_date ?? localDay(t.created_at);
      if (t.type === 'expense' && date < day) opening -= t.amount;
      if (date !== day) continue;
      const discount = t.discount_amount ?? 0;
      const category = t.expense_category_id ? categoryName.get(t.expense_category_id) : null;
      const isExpense = t.type === 'expense';
      rows.push({
        ...blank,
        id: t.id,
        kind: isExpense ? 'expense' : t.type === 'sale' ? 'sale' : 'purchase',
        time: timeOf(t.created_at),
        details: isExpense
          ? t.party_name || category || 'Expense'
          : t.party_name || (t.type === 'sale' ? 'Sale' : 'Purchase'),
        sub:
          [
            t.bill_no ? `Bill #${t.bill_no}` : null,
            isExpense && t.party_name ? category : null,
            t.note,
            isExpense ? via(t.bank_account_id) : t.payment_mode === 'credit' ? 'On credit' : null,
          ]
            .filter(Boolean)
            .join(' · ') || null,
        // Invoice is the value before discount and VAT; the bill amount after.
        invoice: t.amount + discount - (t.vat_amount ?? 0),
        discount,
        // An expense is paid on the spot, so it's cash out; a sale or
        // purchase bill is a debt until its payment is recorded.
        amount: isExpense ? null : t.amount,
        cashOut: isExpense ? t.amount : null,
        sortKey: t.created_at,
        edit: {
          table: 'business_transactions',
          id: t.id,
          title: `${isExpense ? 'Expense' : t.type === 'sale' ? 'Sale bill' : 'Purchase bill'} · ${t.party_name ?? 'no name'}`,
          fields: { party: true, billNo: true, discount: true, method: true },
          partyLabel: isExpense ? 'Paid to' : t.type === 'sale' ? 'Customer' : 'Vendor',
          numberLabel: 'Bill No.',
          values: {
            date,
            amount: amountText(t.amount),
            party: t.party_name ?? '',
            billNo: t.bill_no ?? '',
            discount: amountText(t.discount_amount ?? 0),
            receiptNo: '',
            note: t.note ?? '',
            bankAccountId: t.bank_account_id ?? null,
          },
        },
      });
    }

    for (const e of customerEntries ?? []) {
      const isIn = e.entry_type === 'credit';
      // Booking debits are the Sale itself, not cash.
      if (!isIn && e.source !== 'manual') continue;
      const date = e.entry_date ?? localDay(e.created_at);
      if (date < day) opening += isIn ? e.amount : -e.amount;
      if (date !== day) continue;
      rows.push({
        ...blank,
        id: e.id,
        kind: isIn ? 'received' : 'paid',
        time: timeOf(e.created_at),
        details: `${isIn ? 'Received from' : 'Paid to'} ${contactName.get(e.customer_id) ?? 'customer'}`,
        sub: [e.receipt_no ? `Receipt #${e.receipt_no}` : null, via(e.bank_account_id), e.note].filter(Boolean).join(' · ') || null,
        cashIn: isIn ? e.amount : null,
        cashOut: isIn ? null : e.amount,
        sortKey: e.created_at,
        edit: {
          table: 'customer_ledger_entries',
          id: e.id,
          title: `${isIn ? 'Received from' : 'Paid to'} ${contactName.get(e.customer_id) ?? 'customer'}`,
          lockedReason:
            e.source === 'manual'
              ? undefined
              : 'This was recorded by a job when its payment was collected. Change it on the job, and this entry follows.',
          fields: { receiptNo: true, method: true },
          partyLabel: 'Customer',
          numberLabel: isIn ? 'Receipt No.' : 'Payment No.',
          subtitleParty: contactName.get(e.customer_id) ?? 'Customer',
          values: {
            date,
            amount: amountText(e.amount),
            party: '',
            billNo: '',
            discount: '',
            receiptNo: e.receipt_no ?? '',
            note: e.note ?? '',
            bankAccountId: e.bank_account_id ?? null,
          },
        },
      });
    }

    for (const e of vendorEntries ?? []) {
      // Only payments to a vendor move money; debits are the Purchase.
      if (e.entry_type !== 'credit') continue;
      const date = e.entry_date ?? localDay(e.created_at);
      if (date < day) opening -= e.amount;
      if (date !== day) continue;
      rows.push({
        ...blank,
        id: e.id,
        kind: 'paid',
        time: timeOf(e.created_at),
        details: `Paid to ${contactName.get(e.vendor_id) ?? 'vendor'}`,
        sub: [e.receipt_no ? `Receipt #${e.receipt_no}` : null, via(e.bank_account_id), e.note].filter(Boolean).join(' · ') || null,
        cashOut: e.amount,
        sortKey: e.created_at,
        edit: {
          table: 'vendor_ledger_entries',
          id: e.id,
          title: `Paid to ${contactName.get(e.vendor_id) ?? 'vendor'}`,
          lockedReason:
            e.source === 'manual'
              ? undefined
              : 'This was recorded by a purchase bill. Edit the bill and this entry follows.',
          fields: { receiptNo: true, method: true },
          partyLabel: 'Vendor',
          numberLabel: 'Payment No.',
          subtitleParty: contactName.get(e.vendor_id) ?? 'Vendor',
          values: {
            date,
            amount: amountText(e.amount),
            party: '',
            billNo: '',
            discount: '',
            receiptNo: e.receipt_no ?? '',
            note: e.note ?? '',
            bankAccountId: e.bank_account_id ?? null,
          },
        },
      });
    }

    // A transfer only moves money between the owner's own accounts, so it
    // never changes the combined balance - listed for reference only.
    for (const tr of transfers ?? []) {
      if ((tr.transfer_date ?? localDay(tr.created_at)) !== day) continue;
      rows.push({
        ...blank,
        id: tr.id,
        kind: 'transfer',
        time: timeOf(tr.created_at),
        details: `${via(tr.from_account_id)} → ${via(tr.to_account_id)}`,
        sub: tr.note,
        amount: tr.amount,
        sortKey: tr.created_at,
        edit: {
          table: 'account_transfers',
          id: tr.id,
          title: `${via(tr.from_account_id)} to ${via(tr.to_account_id)}`,
          fields: {},
          partyLabel: 'Between accounts',
          subtitleParty: `${via(tr.from_account_id)} to ${via(tr.to_account_id)}`,
          values: {
            date: tr.transfer_date ?? localDay(tr.created_at),
            amount: amountText(tr.amount),
            party: '',
            billNo: '',
            discount: '',
            receiptNo: '',
            note: tr.note ?? '',
            bankAccountId: null,
          },
        },
      });
    }

    rows.sort((a, b) => a.sortKey.localeCompare(b.sortKey));

    let running = opening;
    let totalIn = 0;
    let totalOut = 0;
    let totalSales = 0;
    let totalPurchases = 0;
    for (const r of rows) {
      if (r.cashIn != null || r.cashOut != null) {
        totalIn += r.cashIn ?? 0;
        totalOut += r.cashOut ?? 0;
        running += (r.cashIn ?? 0) - (r.cashOut ?? 0);
        r.balance = running;
      }
      if (r.kind === 'sale') totalSales += r.amount ?? 0;
      if (r.kind === 'purchase') totalPurchases += r.amount ?? 0;
    }

    const openingRow: BookRow = {
      ...blank,
      id: 'opening',
      kind: 'opening',
      time: '',
      details: 'Opening balance',
      sub: 'Cash + bank at the start of the day',
      balance: opening,
      sortKey: '',
    };

    return {
      rows: [openingRow, ...rows],
      entryCount: rows.length,
      opening,
      totalIn,
      totalOut,
      totalSales,
      totalPurchases,
      closing: running,
    };
  }, [transactions, customerEntries, vendorEntries, transfers, contacts, accounts, categories, day, basePath]);

  const [mainDate, otherDate] = dateLabels(day, calendarMode);

  // The day picker (previous / date / next / Today) and New entry live in the top
  // bar on a wide screen - the date box already shows the day in both calendars -
  // and as a plain row above the tiles on a narrow one.
  const toolbar = useBookToolbar(
    {
      wide,
      right: (inBar) => (
        <>
          <Pressable
            onPress={() => setDay((d) => shiftDay(d, -1))}
            accessibilityLabel="Previous day"
            className="h-9 w-9 items-center justify-center rounded-lg border border-gray-200"
          >
            <Ionicons name="chevron-back" size={18} color="#374151" />
          </Pressable>
          <View style={inBar ? { width: 200 } : { flexGrow: 1, minWidth: 160 }}>
            <DateField
              value={day}
              onChange={(v) => v && setDay(v)}
              renderTrigger={(open) => (
                <Pressable
                  onPress={open}
                  accessibilityLabel="Pick a date"
                  className="h-9 justify-center rounded-lg border border-gray-300 bg-white px-3"
                >
                  <Text className="text-[12px] font-bold leading-[14px] text-gray-900" numberOfLines={1}>
                    {mainDate}
                  </Text>
                  <Text className="text-[10px] leading-[12px] text-gray-500" numberOfLines={1}>
                    {otherDate}
                  </Text>
                </Pressable>
              )}
            />
          </View>
          <Pressable
            onPress={() => setDay((d) => shiftDay(d, 1))}
            disabled={day >= today}
            accessibilityLabel="Next day"
            className="h-9 w-9 items-center justify-center rounded-lg border border-gray-200 disabled:opacity-30"
          >
            <Ionicons name="chevron-forward" size={18} color="#374151" />
          </Pressable>
          {day !== today && (
            <Pressable
              onPress={() => setDay(today)}
              className="h-9 items-center justify-center rounded-lg px-3.5"
              style={{ backgroundColor: '#EFF6FF' }}
            >
              <Text className="text-[13px] font-semibold text-blue-700">Today</Text>
            </Pressable>
          )}
          <NewEntryMenu basePath={basePath} />
        </>
      ),
    },
    [day, today, basePath, mainDate, otherDate]
  );

  return (
    <ScrollView
      className="flex-1 bg-gray-50"
      contentContainerStyle={{ padding: wide ? 24 : 12, paddingTop: wide ? 24 : 12, paddingBottom: 48, gap: 14 }}
    >
      {toolbar}

      {isLoading && !transactions ? (
        <Text className="px-1 text-sm text-gray-500">Loading…</Text>
      ) : (
        <>
          <View className="flex-row flex-wrap" style={{ gap: 10 }}>
            <Stat label="Opening" value={book.opening} color="#374151" />
            <Stat label="Cash in" value={book.totalIn} color="#047857" />
            <Stat label="Cash out" value={book.totalOut} color="#B91C1C" />
            <Stat label="Closing" value={book.closing} color={book.closing >= 0 ? '#2563EB' : '#DC2626'} />
            {book.totalSales > 0 && <Stat label="Sales billed" value={book.totalSales} color={MONEY.in.text} />}
            {book.totalPurchases > 0 && <Stat label="Purchases billed" value={book.totalPurchases} color={MONEY.out.text} />}
          </View>

          <DayBookTable
            rows={book.rows}
            opening={book.opening}
            totalIn={book.totalIn}
            totalOut={book.totalOut}
            closing={book.closing}
            full={fullTable}
            onOpenRow={(row) => row.edit && setEditing(row.edit)}
          />

          <EditEntryModal target={editing} onClose={() => setEditing(null)} />

          {book.entryCount === 0 && (
            <Text className="px-1 text-[13px] text-gray-500">No entries on this day.</Text>
          )}

          <Text className="px-1 text-[11.5px] leading-[17px] text-gray-400">
            Tap any entry to edit, save or delete it. Sale and purchase bills show what was billed that day - they
            don't change the balance until the money is received or paid, which appears as its own Cash in or Paid
            out row.
          </Text>
        </>
      )}
    </ScrollView>
  );
}
