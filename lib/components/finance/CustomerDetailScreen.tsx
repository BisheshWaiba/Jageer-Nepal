// lib/components/finance/CustomerDetailScreen.tsx
import { useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, Linking } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../hooks/useAuth';
import {
  useSupabaseRow,
  useSupabaseQuery,
  useSupabaseUpdate,
  useSupabaseInsert,
  useSupabaseDelete,
} from '../../hooks/useSupabase';
import { useBankAccounts } from '../../hooks/useBankAccounts';
import { BankAccountPickerModal } from './BankAccountPickerModal';
import { TransactionDetailModal } from './TransactionsScreen';
import { supabase } from '../../supabase';
import { showAlert, getErrorMessage } from '../../utils/alert';
import { isValidPhone10 } from '../../utils/phone';
import { toBsHistoryLabel } from '../../utils/nepaliDate';
import type {
  BusinessTransaction,
  BusinessTransactionType,
  CustomerLedgerEntry,
  LedgerEntryType,
  VendorLedgerEntry,
} from '../../../types/database.types';

const TX_TYPE_LABEL: Record<BusinessTransactionType, string> = {
  sale: 'Sale',
  purchase: 'Purchase',
  expense: 'Expense',
};

// Rendering-only shadow used to replace thin gray borders on history rows -
// no bearing on the data or logic those rows show.
const ROW_SHADOW = {
  shadowColor: '#101828',
  shadowOpacity: 0.05,
  shadowRadius: 8,
  shadowOffset: { width: 0, height: 3 },
  elevation: 1,
} as const;

/** Whether `phone` is already used by a different customer of this owner. */
async function phoneAlreadyUsed(ownerId: string, phone: string, excludeCustomerId: string) {
  const { data, error } = await supabase
    .from('customers')
    .select('id')
    .eq('owner_id', ownerId)
    .eq('phone', phone)
    .neq('id', excludeCustomerId)
    .limit(1);
  if (error) throw error;
  return (data ?? []).length > 0;
}

function EditableDetails({ customerId, basePath }: { customerId: string; basePath: string }) {
  const { data: customer } = useSupabaseRow('customers', customerId);
  const updateCustomer = useSupabaseUpdate('customers');
  const deleteCustomer = useSupabaseDelete('customers');
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [saving, setSaving] = useState(false);

  if (!customer) return null;

  function startEditing() {
    setName(customer!.name);
    setPhone(customer!.phone ?? '');
    setAddress(customer!.address ?? '');
    setEditing(true);
  }

  async function handleSave() {
    if (!name.trim()) {
      showAlert('Add a name', "Enter the customer's name.");
      return;
    }
    const trimmedPhone = phone.trim();
    if (trimmedPhone && !isValidPhone10(trimmedPhone)) {
      showAlert('Check the phone number', 'Enter a valid 10-digit phone number.');
      return;
    }
    setSaving(true);
    try {
      if (trimmedPhone && (await phoneAlreadyUsed(customer!.owner_id, trimmedPhone, customerId))) {
        showAlert('Already saved', 'A customer with this phone number already exists.');
        return;
      }
      await updateCustomer.mutateAsync({
        id: customerId,
        values: { name: name.trim(), phone: trimmedPhone || null, address: address.trim() || null },
      });
      setEditing(false);
    } catch (err) {
      showAlert('Could not save', getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  function handleDelete() {
    showAlert('Delete this customer?', 'Their saved contact info and ledger history will be permanently removed.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteCustomer.mutateAsync(customerId);
            router.replace(`${basePath}/customers` as any);
          } catch (err) {
            showAlert('Could not delete', getErrorMessage(err));
          }
        },
      },
    ]);
  }

  if (editing) {
    return (
      <View className="mb-4 rounded-2xl border border-gray-200 bg-white p-4">
        <Text className="mb-3 text-sm font-semibold text-gray-900">Edit customer</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Name"
          className="mb-2.5 rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900"
        />
        <TextInput
          value={phone}
          onChangeText={(v) => setPhone(v.replace(/[^0-9]/g, ''))}
          placeholder="Phone (10 digits)"
          keyboardType="phone-pad"
          maxLength={10}
          className="mb-2.5 rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900"
        />
        <TextInput
          value={address}
          onChangeText={setAddress}
          placeholder="Address"
          className="mb-3 rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900"
        />
        <View className="flex-row gap-2">
          <Pressable onPress={() => setEditing(false)} className="flex-1 items-center rounded-lg border border-gray-300 py-2.5">
            <Text className="text-sm font-semibold text-gray-600">Cancel</Text>
          </Pressable>
          <Pressable
            onPress={handleSave}
            disabled={saving}
            className="flex-1 items-center rounded-lg bg-orange-500 py-2.5 disabled:opacity-50"
          >
            <Text className="text-sm font-semibold text-white">{saving ? 'Saving…' : 'Save'}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View className="mb-4 rounded-2xl border border-gray-200 bg-white p-4">
      <View className="mb-2 flex-row items-start justify-between">
        <Text className="flex-1 text-lg font-bold text-gray-900">{customer.name}</Text>
        <View className="flex-row gap-3">
          <Pressable onPress={startEditing} hitSlop={8}>
            <Ionicons name="pencil" size={16} color="#2563eb" />
          </Pressable>
          <Pressable onPress={handleDelete} hitSlop={8}>
            <Ionicons name="trash-outline" size={16} color="#DC2626" />
          </Pressable>
        </View>
      </View>
      {customer.phone && (
        <Pressable onPress={() => Linking.openURL(`tel:${customer.phone}`)} className="mb-1 flex-row items-center gap-1.5">
          <Ionicons name="call-outline" size={13} color="#6B7280" />
          <Text className="text-sm text-blue-700">{customer.phone}</Text>
        </Pressable>
      )}
      {customer.address && (
        <Pressable
          onPress={() =>
            customer.latitude != null && customer.longitude != null
              ? Linking.openURL(`https://www.google.com/maps?q=${customer.latitude},${customer.longitude}`)
              : undefined
          }
          className="flex-row items-start gap-1.5"
        >
          <Ionicons name="location-outline" size={13} color="#6B7280" style={{ marginTop: 1.5 }} />
          <Text className="flex-1 text-sm text-gray-600">{customer.address}</Text>
        </Pressable>
      )}
    </View>
  );
}

function AddEntryForm({
  customerId,
  ownerId,
  initial,
  onDone,
}: {
  customerId: string;
  ownerId: string;
  initial?: CustomerLedgerEntry | null;
  onDone: () => void;
}) {
  const insertEntry = useSupabaseInsert('customer_ledger_entries');
  const updateEntry = useSupabaseUpdate('customer_ledger_entries');
  const bankAccounts = useBankAccounts(ownerId);
  const [entryType, setEntryType] = useState<LedgerEntryType>(initial?.entry_type ?? 'credit');
  const [amount, setAmount] = useState(initial ? String(initial.amount) : '');
  const [note, setNote] = useState(initial?.note ?? '');
  const [bankAccountId, setBankAccountId] = useState<string | null>(initial?.bank_account_id ?? null);
  const [showAccountPicker, setShowAccountPicker] = useState(false);
  const [saving, setSaving] = useState(false);

  const selectedAccountName = bankAccountId
    ? bankAccounts.accounts.find((a) => a.id === bankAccountId)?.name ?? 'Cash'
    : 'Cash';

  async function handleSave() {
    const value = Number(amount);
    if (!amount.trim() || Number.isNaN(value) || value <= 0) {
      showAlert('Enter an amount', 'Add a valid amount in NPR.');
      return;
    }
    setSaving(true);
    try {
      if (initial) {
        await updateEntry.mutateAsync({
          id: initial.id,
          values: { entry_type: entryType, amount: value, note: note.trim() || null, bank_account_id: bankAccountId },
        });
      } else {
        await insertEntry.mutateAsync({
          customer_id: customerId,
          owner_id: ownerId,
          entry_type: entryType,
          amount: value,
          note: note.trim() || null,
          source: 'manual',
          bank_account_id: bankAccountId,
        });
      }
      onDone();
    } catch (err) {
      showAlert('Could not save entry', getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <View className="mb-4 rounded-2xl border border-gray-200 bg-white p-4">
      <Text className="mb-3 text-sm font-semibold text-gray-900">{initial ? 'Edit ledger entry' : 'Add ledger entry'}</Text>
      <View className="mb-3 flex-row gap-2">
        <Pressable
          onPress={() => setEntryType('credit')}
          className={`flex-1 items-center rounded-lg border py-2 ${entryType === 'credit' ? 'border-emerald-600 bg-emerald-50' : 'border-gray-300'}`}
        >
          <Text className={`text-xs font-bold ${entryType === 'credit' ? 'text-emerald-700' : 'text-gray-500'}`}>
            Payment received
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setEntryType('debit')}
          className={`flex-1 items-center rounded-lg border py-2 ${entryType === 'debit' ? 'border-red-600 bg-red-50' : 'border-gray-300'}`}
        >
          <Text className={`text-xs font-bold ${entryType === 'debit' ? 'text-red-700' : 'text-gray-500'}`}>
            Customer owes
          </Text>
        </Pressable>
      </View>
      <TextInput
        value={amount}
        onChangeText={setAmount}
        placeholder="Amount (NPR)"
        keyboardType="numeric"
        className="mb-2.5 rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900"
      />
      <TextInput
        value={note}
        onChangeText={setNote}
        placeholder="Note (optional)"
        className="mb-2.5 rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900"
      />
      {entryType === 'credit' && (
        <Pressable
          onPress={() => setShowAccountPicker(true)}
          className="mb-3 flex-row items-center justify-between rounded-lg border border-gray-300 px-3 py-2.5"
        >
          <View className="flex-row items-center gap-2">
            <Ionicons name={bankAccountId ? 'business-outline' : 'cash-outline'} size={16} color="#6B7280" />
            <Text className="text-sm text-gray-900">{selectedAccountName}</Text>
          </View>
          <Ionicons name="chevron-down" size={16} color="#9CA3AF" />
        </Pressable>
      )}
      <View className="flex-row gap-2">
        <Pressable onPress={onDone} className="flex-1 items-center rounded-lg border border-gray-300 py-2.5">
          <Text className="text-sm font-semibold text-gray-600">Cancel</Text>
        </Pressable>
        <Pressable
          onPress={handleSave}
          disabled={saving}
          className="flex-1 items-center rounded-lg bg-orange-500 py-2.5 disabled:opacity-50"
        >
          <Text className="text-sm font-semibold text-white">{saving ? 'Saving…' : initial ? 'Save' : 'Add entry'}</Text>
        </Pressable>
      </View>
      <BankAccountPickerModal
        visible={showAccountPicker}
        accounts={bankAccounts.accounts}
        selectedId={bankAccountId}
        onSelect={setBankAccountId}
        onClose={() => setShowAccountPicker(false)}
        onRename={bankAccounts.rename}
        onDelete={bankAccounts.remove}
      />
    </View>
  );
}

/** Same shape as AddEntryForm, but for the vendor-payable side: "Bought on
 * credit" (debit - you owe this vendor more) and "You paid" (credit -
 * settles part of what you owe). Most credit purchases already get logged
 * automatically from the Purchase form's "Pay later" toggle - this is
 * mainly for recording an actual payment made to bring that debt down, or
 * a one-off debt that isn't tied to a specific bill. */
function AddVendorEntryForm({
  vendorId,
  ownerId,
  initial,
  onDone,
}: {
  vendorId: string;
  ownerId: string;
  initial?: VendorLedgerEntry | null;
  onDone: () => void;
}) {
  const insertEntry = useSupabaseInsert('vendor_ledger_entries');
  const updateEntry = useSupabaseUpdate('vendor_ledger_entries');
  const bankAccounts = useBankAccounts(ownerId);
  const [entryType, setEntryType] = useState<LedgerEntryType>(initial?.entry_type ?? 'credit');
  const [amount, setAmount] = useState(initial ? String(initial.amount) : '');
  const [note, setNote] = useState(initial?.note ?? '');
  const [bankAccountId, setBankAccountId] = useState<string | null>(initial?.bank_account_id ?? null);
  const [showAccountPicker, setShowAccountPicker] = useState(false);
  const [saving, setSaving] = useState(false);

  const selectedAccountName = bankAccountId
    ? bankAccounts.accounts.find((a) => a.id === bankAccountId)?.name ?? 'Cash'
    : 'Cash';

  async function handleSave() {
    const value = Number(amount);
    if (!amount.trim() || Number.isNaN(value) || value <= 0) {
      showAlert('Enter an amount', 'Add a valid amount in NPR.');
      return;
    }
    setSaving(true);
    try {
      if (initial) {
        await updateEntry.mutateAsync({
          id: initial.id,
          values: { entry_type: entryType, amount: value, note: note.trim() || null, bank_account_id: bankAccountId },
        });
      } else {
        await insertEntry.mutateAsync({
          vendor_id: vendorId,
          owner_id: ownerId,
          entry_type: entryType,
          amount: value,
          note: note.trim() || null,
          source: 'manual',
          bank_account_id: bankAccountId,
        });
      }
      onDone();
    } catch (err) {
      showAlert('Could not save entry', getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <View className="mb-4 rounded-2xl border border-gray-200 bg-white p-4">
      <Text className="mb-3 text-sm font-semibold text-gray-900">{initial ? 'Edit vendor entry' : 'Add vendor entry'}</Text>
      <View className="mb-3 flex-row gap-2">
        <Pressable
          onPress={() => setEntryType('credit')}
          className={`flex-1 items-center rounded-lg border py-2 ${entryType === 'credit' ? 'border-emerald-600 bg-emerald-50' : 'border-gray-300'}`}
        >
          <Text className={`text-xs font-bold ${entryType === 'credit' ? 'text-emerald-700' : 'text-gray-500'}`}>You paid</Text>
        </Pressable>
        <Pressable
          onPress={() => setEntryType('debit')}
          className={`flex-1 items-center rounded-lg border py-2 ${entryType === 'debit' ? 'border-red-600 bg-red-50' : 'border-gray-300'}`}
        >
          <Text className={`text-xs font-bold ${entryType === 'debit' ? 'text-red-700' : 'text-gray-500'}`}>Bought on credit</Text>
        </Pressable>
      </View>
      <TextInput
        value={amount}
        onChangeText={setAmount}
        placeholder="Amount (NPR)"
        keyboardType="numeric"
        className="mb-2.5 rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900"
      />
      <TextInput
        value={note}
        onChangeText={setNote}
        placeholder="Note (optional)"
        className="mb-2.5 rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900"
      />
      {entryType === 'credit' && (
        <Pressable
          onPress={() => setShowAccountPicker(true)}
          className="mb-3 flex-row items-center justify-between rounded-lg border border-gray-300 px-3 py-2.5"
        >
          <View className="flex-row items-center gap-2">
            <Ionicons name={bankAccountId ? 'business-outline' : 'cash-outline'} size={16} color="#6B7280" />
            <Text className="text-sm text-gray-900">{selectedAccountName}</Text>
          </View>
          <Ionicons name="chevron-down" size={16} color="#9CA3AF" />
        </Pressable>
      )}
      <View className="flex-row gap-2">
        <Pressable onPress={onDone} className="flex-1 items-center rounded-lg border border-gray-300 py-2.5">
          <Text className="text-sm font-semibold text-gray-600">Cancel</Text>
        </Pressable>
        <Pressable
          onPress={handleSave}
          disabled={saving}
          className="flex-1 items-center rounded-lg bg-orange-500 py-2.5 disabled:opacity-50"
        >
          <Text className="text-sm font-semibold text-white">{saving ? 'Saving…' : initial ? 'Save' : 'Add entry'}</Text>
        </Pressable>
      </View>
      <BankAccountPickerModal
        visible={showAccountPicker}
        accounts={bankAccounts.accounts}
        selectedId={bankAccountId}
        onSelect={setBankAccountId}
        onClose={() => setShowAccountPicker(false)}
        onRename={bankAccounts.rename}
        onDelete={bankAccounts.remove}
      />
    </View>
  );
}

export function CustomerDetailScreen({ basePath }: { basePath: string }) {
  const { id } = useLocalSearchParams<{ id: string }>();
  // Hidden tab screens stay mounted between visits, so opening another
  // record reused this one's component state (typed quote/remark/price, a
  // "thanks for rating" flag, an open edit form...). Keying on the id gives
  // every record its own fresh state.
  return <CustomerDetail key={id} id={id} basePath={basePath} />;
}

function CustomerDetail({ id, basePath }: { id: string; basePath: string }) {
  const userId = useAuthStore((state) => state.session?.user.id);
  const { data: entries } = useSupabaseQuery('customer_ledger_entries', {
    filters: { customer_id: id },
    orderBy: { column: 'created_at', ascending: false },
    enabled: !!id,
  });
  // Sales/purchases billed directly to this saved customer/vendor. Each one
  // automatically books a matching debt on the ledger below (see
  // 0061_sale_purchase_always_ledger.sql) - the bill itself is shown here
  // instead of that auto-synced ledger entry (history filters those out),
  // since the bill carries the real detail (items, bill no.) the ledger
  // entry doesn't.
  const { data: linkedTransactions } = useSupabaseQuery('business_transactions', {
    filters: { customer_id: id },
    orderBy: { column: 'created_at', ascending: false },
    enabled: !!id,
  });
  // The payable side of this same party - only ever non-empty for someone
  // who's also been picked as a Vendor on a credit Purchase, or who's had a
  // payment logged against them below. Kept separate from `entries` above
  // (opposite polarity: a vendor's debit is a debt owed BY the business).
  const { data: vendorEntries } = useSupabaseQuery('vendor_ledger_entries', {
    filters: { vendor_id: id },
    orderBy: { column: 'created_at', ascending: false },
    enabled: !!id,
  });
  const deleteEntry = useSupabaseDelete('customer_ledger_entries');
  const deleteVendorEntry = useSupabaseDelete('vendor_ledger_entries');
  const [showAddEntry, setShowAddEntry] = useState(false);
  const [showAddVendorEntry, setShowAddVendorEntry] = useState(false);
  // Tapping a manual entry in History reopens the same form pre-filled,
  // instead of only ever letting one be added and never fixed - a wrong
  // amount or note previously meant delete-and-redo.
  const [editingEntry, setEditingEntry] = useState<CustomerLedgerEntry | null>(null);
  const [editingVendorEntry, setEditingVendorEntry] = useState<VendorLedgerEntry | null>(null);
  // Tapping a linked bill in History opens the same organized detail view
  // Transactions uses, instead of duplicating that layout here.
  const [viewingTx, setViewingTx] = useState<BusinessTransaction | null>(null);

  const balance = useMemo(() => {
    return (entries ?? []).reduce((sum, e) => sum + (e.entry_type === 'debit' ? e.amount : -e.amount), 0);
  }, [entries]);

  // A party that already has vendor history but has never been used as a
  // customer is being treated purely as a vendor here (e.g. opened from the
  // To Give tile) - the customer-side balance card and "Add ledger entry"
  // are just noise on that page. A brand-new party with neither yet still
  // sees both, so there's always a way to log its first entry. Same logic
  // in reverse for a party that's only ever been a customer - the vendor
  // card and "Log a vendor..." button are just as much noise there.
  const isPureVendor = (vendorEntries?.length ?? 0) > 0 && (entries?.length ?? 0) === 0;
  const isPureCustomer = (entries?.length ?? 0) > 0 && (vendorEntries?.length ?? 0) === 0;

  const vendorBalance = useMemo(() => {
    return (vendorEntries ?? []).reduce((sum, e) => sum + (e.entry_type === 'debit' ? e.amount : -e.amount), 0);
  }, [vendorEntries]);

  const history = useMemo(() => {
    // Entries auto-synced from a Sale/Purchase's own ledger debt (see
    // 0061_sale_purchase_always_ledger.sql) are skipped here - the linked
    // bill below already represents them, so this only counts toward
    // balance/vendorBalance above, not shown a second time.
    const isAutoSyncedFromBill = (source: string, sourceType: string | null) => source === 'booking' && sourceType === 'business_transaction';
    const ledgerItems = (entries ?? [])
      .filter((e) => !isAutoSyncedFromBill(e.source, e.source_type))
      .map((e) => ({ kind: 'ledger' as const, id: e.id, date: e.created_at, entry: e }));
    const vendorItems = (vendorEntries ?? [])
      .filter((e) => !isAutoSyncedFromBill(e.source, e.source_type))
      .map((e) => ({ kind: 'vendor' as const, id: e.id, date: e.created_at, entry: e }));
    const txItems = (linkedTransactions ?? []).map((t) => ({ kind: 'tx' as const, id: t.id, date: t.created_at, tx: t }));
    return [...ledgerItems, ...vendorItems, ...txItems].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [entries, vendorEntries, linkedTransactions]);

  if (!id || !userId) return null;

  return (
    <>
    <KeyboardAwareScrollView
      className="flex-1 bg-gray-50 px-6 pt-4"
      contentContainerStyle={{ paddingBottom: 40 }}
      enableOnAndroid
      extraScrollHeight={20}
      keyboardShouldPersistTaps="handled"
    >
      <EditableDetails customerId={id} basePath={basePath} />

      {!isPureVendor && (
        <LinearGradient
          colors={['#2563EB', '#1D4ED8']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{
            borderRadius: 24,
            padding: 20,
            gap: 14,
            marginBottom: 16,
            shadowColor: '#2563EB',
            shadowOpacity: 0.35,
            shadowRadius: 16,
            shadowOffset: { width: 0, height: 8 },
            elevation: 6,
          }}
        >
          <View className="flex-row items-center justify-between">
            <View>
              <Text className="text-xs font-bold text-white/75" style={{ letterSpacing: 0.5 }}>
                {(balance > 0 ? 'Customer owes you' : balance < 0 ? 'You owe customer' : 'Balance').toUpperCase()}
              </Text>
              <Text className="mt-1 text-2xl font-extrabold text-white">NPR {Math.abs(balance).toLocaleString()}</Text>
            </View>
            {balance !== 0 && (
              <View className="rounded-full px-3 py-1.5" style={{ backgroundColor: 'rgba(255,255,255,0.16)' }}>
                <Text className="text-[11px] font-bold text-white">{balance > 0 ? 'Owes you' : 'You owe'}</Text>
              </View>
            )}
          </View>
          {!showAddEntry && (
            <Pressable
              onPress={() => {
                setEditingEntry(null);
                setShowAddEntry(true);
              }}
              className="flex-row items-center justify-center gap-1.5 rounded-full bg-white py-3"
            >
              <Ionicons name="add-circle-outline" size={16} color="#1D4ED8" />
              <Text className="text-sm font-semibold" style={{ color: '#1D4ED8' }}>
                Add Ledger Entry
              </Text>
            </Pressable>
          )}
        </LinearGradient>
      )}

      {!isPureVendor && showAddEntry && (
        <AddEntryForm
          customerId={id}
          ownerId={userId}
          initial={editingEntry}
          onDone={() => {
            setShowAddEntry(false);
            setEditingEntry(null);
          }}
        />
      )}

      {(vendorEntries?.length ?? 0) > 0 && (
        <View className="mb-3 flex-row items-center gap-3 rounded-2xl border border-red-200 bg-red-50 p-4">
          <View className="h-9 w-9 items-center justify-center rounded-full bg-white">
            <Ionicons name="cart-outline" size={18} color="#DC2626" />
          </View>
          <View className="flex-1">
            <Text className="text-[11px] font-bold uppercase tracking-wide text-red-700">
              {vendorBalance > 0 ? 'To Give' : vendorBalance < 0 ? 'They owe you (overpaid)' : 'Vendor balance'}
            </Text>
            <Text className="mt-0.5 text-lg font-extrabold text-red-600">NPR {Math.abs(vendorBalance).toLocaleString()}</Text>
          </View>
        </View>
      )}
      {!isPureCustomer && !showAddVendorEntry && (
        <Pressable
          onPress={() => {
            setEditingVendorEntry(null);
            setShowAddVendorEntry(true);
          }}
          className="mb-4 flex-row items-center justify-center gap-1.5 rounded-2xl border border-red-300 bg-white py-3"
        >
          <Ionicons name="cart-outline" size={16} color="#DC2626" />
          <Text className="text-sm font-semibold text-red-600">Log a vendor purchase or payment</Text>
        </Pressable>
      )}
      {!isPureCustomer && showAddVendorEntry && userId && (
        <AddVendorEntryForm
          vendorId={id}
          ownerId={userId}
          initial={editingVendorEntry}
          onDone={() => {
            setShowAddVendorEntry(false);
            setEditingVendorEntry(null);
          }}
        />
      )}

      <Text className="mb-2 text-sm font-semibold text-gray-900">History</Text>
      {history.length === 0 && <Text className="text-center text-sm text-gray-400">No history yet.</Text>}
      {history.map((item) => {
        if (item.kind === 'tx') {
          const t = item.tx;
          return (
            <Pressable
              key={`tx-${t.id}`}
              onPress={() => setViewingTx(t)}
              className="mb-2.5 flex-row items-center gap-3 rounded-2xl bg-white p-3.5"
              style={ROW_SHADOW}
            >
              <View className="h-8 w-8 items-center justify-center rounded-full bg-blue-50">
                <Ionicons name="receipt-outline" size={14} color="#2563EB" />
              </View>
              <View className="flex-1">
                <Text className="text-sm font-semibold text-gray-900">{TX_TYPE_LABEL[t.type]}</Text>
                <Text className="text-xs text-gray-400" numberOfLines={1}>
                  {toBsHistoryLabel(t.bill_date ?? t.created_at)}
                </Text>
              </View>
              <Text className="text-sm font-extrabold text-red-600">NPR {t.amount.toLocaleString()}</Text>
              <Ionicons name="chevron-forward" size={14} color="#D1D5DB" style={{ marginLeft: 6 }} />
            </Pressable>
          );
        }
        if (item.kind === 'vendor') {
          const entry = item.entry;
          return (
            <Pressable
              key={`vendor-${entry.id}`}
              disabled={entry.source !== 'manual'}
              onPress={() => {
                setEditingVendorEntry(entry);
                setShowAddVendorEntry(true);
              }}
              className="mb-2.5 flex-row items-center gap-3 rounded-2xl bg-white p-3.5"
              style={ROW_SHADOW}
            >
              <View
                className={`h-8 w-8 items-center justify-center rounded-full ${entry.entry_type === 'debit' ? 'bg-red-50' : 'bg-emerald-50'}`}
              >
                <Ionicons
                  name={entry.entry_type === 'debit' ? 'cart-outline' : 'arrow-down'}
                  size={14}
                  color={entry.entry_type === 'debit' ? '#DC2626' : '#059669'}
                />
              </View>
              <View className="flex-1">
                <Text className="text-sm font-semibold text-gray-900">
                  {entry.entry_type === 'debit' ? 'Bought on credit' : 'You paid'}
                </Text>
                <Text className="text-xs text-gray-400" numberOfLines={1}>
                  {entry.note ?? (entry.source === 'booking' ? 'From a credit purchase' : 'Manual entry')} ·{' '}
                  {toBsHistoryLabel(entry.entry_date ?? entry.created_at)}
                </Text>
              </View>
              <Text className="text-sm font-extrabold" style={{ color: entry.entry_type === 'debit' ? '#DC2626' : '#059669' }}>
                NPR {entry.amount.toLocaleString()}
              </Text>
              {entry.source === 'manual' && (
                <Pressable
                  onPress={() =>
                    showAlert('Remove this entry?', undefined, [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Remove', style: 'destructive', onPress: () => deleteVendorEntry.mutate(entry.id) },
                    ])
                  }
                  hitSlop={8}
                  className="ml-1"
                >
                  <Ionicons name="close" size={16} color="#9CA3AF" />
                </Pressable>
              )}
            </Pressable>
          );
        }
        const entry = item.entry;
        return (
          <Pressable
            key={`ledger-${entry.id}`}
            disabled={entry.source !== 'manual'}
            onPress={() => {
              setEditingEntry(entry);
              setShowAddEntry(true);
            }}
            className="mb-2.5 flex-row items-center gap-3 rounded-2xl bg-white p-3.5"
            style={ROW_SHADOW}
          >
            <View
              className={`h-8 w-8 items-center justify-center rounded-full ${entry.entry_type === 'debit' ? 'bg-red-50' : 'bg-emerald-50'}`}
            >
              <Ionicons
                name={entry.entry_type === 'debit' ? 'arrow-up' : 'arrow-down'}
                size={14}
                color={entry.entry_type === 'debit' ? '#DC2626' : '#059669'}
              />
            </View>
            <View className="flex-1">
              <Text className="text-sm font-semibold text-gray-900">{entry.entry_type === 'debit' ? 'Owes' : 'Paid'}</Text>
              <Text className="text-xs text-gray-400" numberOfLines={1}>
                {entry.note ?? (entry.source === 'booking' ? 'From a booked job' : 'Manual entry')} ·{' '}
                {toBsHistoryLabel(entry.entry_date ?? entry.created_at)}
              </Text>
            </View>
            <Text className="text-sm font-extrabold" style={{ color: entry.entry_type === 'debit' ? '#DC2626' : '#059669' }}>
              NPR {entry.amount.toLocaleString()}
            </Text>
            {entry.source === 'manual' && (
              <Pressable
                onPress={() =>
                  showAlert('Remove this entry?', undefined, [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Remove', style: 'destructive', onPress: () => deleteEntry.mutate(entry.id) },
                  ])
                }
                hitSlop={8}
                className="ml-1"
              >
                <Ionicons name="close" size={16} color="#9CA3AF" />
              </Pressable>
            )}
          </Pressable>
        );
      })}
    </KeyboardAwareScrollView>
    <TransactionDetailModal
      tx={viewingTx}
      categoryName={null}
      bankAccountName={null}
      onClose={() => setViewingTx(null)}
      onEdit={() => {
        if (viewingTx) router.push(`${basePath}/transactions?type=${viewingTx.type}` as any);
        setViewingTx(null);
      }}
    />
    </>
  );
}
