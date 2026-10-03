// lib/components/finance/TransactionsScreen.tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, View, Text, TextInput, Pressable, Modal, ScrollView, FlatList, KeyboardAvoidingView, Platform } from 'react-native';
import { KeyboardAwareSectionList } from 'react-native-keyboard-aware-scroll-view';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore, useRole } from '../../hooks/useAuth';
import { useSupabaseInsert, useSupabaseQuery, useSupabaseUpdate, useSupabaseUpsert, useSupabaseDelete } from '../../hooks/useSupabase';
import { useBankAccounts } from '../../hooks/useBankAccounts';
import { useScreenHeader } from '../../hooks/useScreenHeader';
import { usePhoneContacts } from '../../hooks/usePhoneContacts';
import { useScanBill } from '../../hooks/useScanBill';
import { DateField } from '../DateTimeFields';
import { TrendChartCard } from './TrendChartCard';
import { BankAccountPickerModal } from './BankAccountPickerModal';
import { ContactPickerModal } from '../ContactPickerModal';
import { ToggleSwitch } from '../ToggleSwitch';
import { FormSection } from './FormSection';
import { BillItemsTable, type BillItemsTableHandle } from './BillItemsTable';
import { KeyboardDateInput } from './KeyboardDateInput';
import { KeyInput } from './KeyInput';
import { useConfirmSave } from './ConfirmSave';
import { TransactionsBook } from './TransactionsBook';
import { FINANCE_ENTRY_ACCENT, FINANCE_ENTRY_SHADOW } from './entryTheme';
import { SuggestInput, type SuggestOption } from './SuggestInput';
import { buildCustomerSuggestions, type CustomerSuggestion } from '../../utils/customerSuggestions';
import { readKey } from '../../utils/webKeys';
import { showAlert, getErrorMessage } from '../../utils/alert';
import { toBsLabel, toBsHistoryLabel } from '../../utils/nepaliDate';
import type {
  AccountTransfer,
  BusinessTransaction,
  BusinessTransactionType,
  Customer,
  CustomerLedgerEntry,
  ExpenseCategory,
  FinanceItem,
  Product,
  VendorLedgerEntry,
} from '../../../types/database.types';
import { localTodayIso } from '../../utils/localDate';

// Local date, not UTC - see localTodayIso.
const todayIso = localTodayIso;

interface ItemRowState {
  description: string;
  qty: string;
  rate: string;
}

let expenseRowSeq = 0;
function makeExpenseRowKey() {
  expenseRowSeq += 1;
  return `expense-row-${expenseRowSeq}`;
}

// Web only: recording several expenses under one Date/Payment method in a
// single save, same "shared voucher, per-row table" shape as Quick Payment's
// multi-entry table - see the web branch of TransactionForm below.
interface ExpenseRow {
  key: string;
  partyName: string;
  customerId: string | null;
  categoryId: string | null;
  amount: string;
  note: string;
}

function emptyExpenseRow(): ExpenseRow {
  return { key: makeExpenseRowKey(), partyName: '', customerId: null, categoryId: null, amount: '', note: '' };
}

function lineTotal(row: ItemRowState) {
  return (Number(row.qty) || 0) * (Number(row.rate) || 0);
}

/** A line that actually gets saved on the bill - the subtotal only counts
 * these, so the saved total always matches the saved items. */
function isSavableItem(row: ItemRowState) {
  return !!row.description.trim() && Number(row.qty) > 0 && Number(row.rate) >= 0;
}

/** One item, one line: name (tap to pick/change the stocked product), a
 * compact qty x rate pair, the computed amount, and a remove button. Qty and
 * rate stay directly editable inline so adjusting an already-picked item
 * never needs a second popup. */
function ItemLineRow({
  item,
  onEditProduct,
  onQtyChange,
  onRateChange,
  onRemove,
}: {
  item: ItemRowState;
  onEditProduct: () => void;
  onQtyChange: (v: string) => void;
  onRateChange: (v: string) => void;
  onRemove: () => void;
}) {
  return (
    <View className="mb-2 rounded-lg border border-gray-200 bg-white px-2.5 py-2">
      {/* Name gets its own full-width row (up to 2 lines) so a long product
          name is actually readable, instead of squeezed into flex-1 next to
          the qty/rate/total inputs on one line. */}
      <View className="mb-1.5 flex-row items-start justify-between gap-2">
        <Pressable onPress={onEditProduct} className="flex-1 flex-row items-start gap-1.5 pr-1">
          <Ionicons name="cube-outline" size={13} color="#9CA3AF" style={{ marginTop: 2 }} />
          <Text
            className={`flex-1 text-sm font-semibold ${item.description ? 'text-gray-900' : 'text-gray-400'}`}
            numberOfLines={2}
          >
            {item.description || 'Tap to pick an item'}
          </Text>
        </Pressable>
        <Pressable onPress={onRemove} hitSlop={8}>
          <Ionicons name="close-circle" size={16} color="#D1D5DB" />
        </Pressable>
      </View>
      <View className="flex-row items-center justify-end gap-1.5">
        <TextInput
          value={item.qty}
          onChangeText={onQtyChange}
          keyboardType="numeric"
          placeholder="Qty"
          placeholderTextColor="#9CA3AF"
          className="w-12 rounded border border-gray-200 py-1 text-center text-xs text-gray-900"
        />
        <Text className="text-[10px] text-gray-400">×</Text>
        <TextInput
          value={item.rate}
          onChangeText={onRateChange}
          keyboardType="numeric"
          placeholder="Rate"
          placeholderTextColor="#9CA3AF"
          className="w-16 rounded border border-gray-200 py-1 text-center text-xs text-gray-900"
        />
        <Text className="text-[10px] text-gray-400">=</Text>
        <Text className="text-right text-xs font-bold text-gray-900" numberOfLines={1}>
          NPR {lineTotal(item).toLocaleString()}
        </Text>
      </View>
    </View>
  );
}

/** The "go pick from stock" popup behind each item line: one search field
 * over the reseller's own products (with live stock + price) that also
 * doubles as the name for a one-off item that isn't in the catalog - typing
 * something with no match surfaces a "+ Add as new item" row right in the
 * list instead of a second, separate input. Picking that opens a small
 * confirm step (name + rate, Save/Cancel) before it's actually added.
 * Opened either from "+ Add item" (appends a new line) or by tapping an
 * existing line's name (replaces that line's product). */
type PickableRow =
  | { key: string; kind: 'product'; product: Product }
  | { key: string; kind: 'financeItem'; item: FinanceItem };

function ItemPickerModal({
  visible,
  products,
  financeItems,
  onPick,
  onPickFinanceItem,
  onPickCustom,
  onClose,
}: {
  visible: boolean;
  products: Product[];
  financeItems: FinanceItem[];
  onPick: (p: Product) => void;
  onPickFinanceItem: (item: FinanceItem) => void;
  onPickCustom: (name: string, rate: string) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const [confirmingName, setConfirmingName] = useState<string | null>(null);
  const [customRate, setCustomRate] = useState('');

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    const productRows: PickableRow[] = products
      .filter((p) => !q || p.name.toLowerCase().includes(q))
      .map((product) => ({ key: `p-${product.id}`, kind: 'product', product }));
    // Previously typed one-off names (not real stock - see
    // 0063_finance_items.sql) offered alongside real products so they're
    // reachable again instead of needing to be retyped from scratch.
    const financeRows: PickableRow[] = financeItems
      .filter((i) => !q || i.name.toLowerCase().includes(q))
      .map((item) => ({ key: `f-${item.id}`, kind: 'financeItem', item }));
    return [...productRows, ...financeRows];
  }, [products, financeItems, search]);

  function reset() {
    setSearch('');
    setConfirmingName(null);
    setCustomRate('');
  }

  function submitCustom() {
    if (!confirmingName?.trim()) return;
    onPickCustom(confirmingName.trim(), customRate);
    reset();
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} onShow={reset}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
      <Pressable className="flex-1 items-center justify-center bg-black/40 px-6" onPress={onClose}>
        <Pressable onPress={() => {}} className="w-full max-w-sm rounded-xl bg-white p-3" style={{ maxHeight: '80%' }}>
          <View className="mb-2 flex-row items-center justify-between">
            <Text className="text-base font-semibold text-gray-900">
              {confirmingName != null ? 'Add new item' : 'Pick from your stock'}
            </Text>
            <Pressable onPress={onClose} className="px-2 py-1">
              <Text className="text-sm font-semibold text-blue-700">Close</Text>
            </Pressable>
          </View>

          {confirmingName != null ? (
            <>
              <Text className="mb-1 text-xs font-medium text-gray-500">Item name</Text>
              <TextInput
                value={confirmingName}
                onChangeText={setConfirmingName}
                placeholder="Item name"
                placeholderTextColor="#9CA3AF"
                autoFocus
                className="mb-2.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
              />
              <Text className="mb-1 text-xs font-medium text-gray-500">Rate (NPR)</Text>
              <TextInput
                value={customRate}
                onChangeText={setCustomRate}
                placeholder="Optional — fill in on the item line instead"
                placeholderTextColor="#9CA3AF"
                keyboardType="numeric"
                onSubmitEditing={submitCustom}
                className="mb-3 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
              />
              <View className="flex-row gap-2">
                <Pressable onPress={() => setConfirmingName(null)} className="flex-1 items-center rounded-lg border border-gray-300 py-2.5">
                  <Text className="text-sm font-semibold text-gray-600">Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={submitCustom}
                  disabled={!confirmingName.trim()}
                  className="flex-1 items-center rounded-lg bg-orange-500 py-2.5 disabled:opacity-50"
                >
                  <Text className="text-sm font-semibold text-white">Save</Text>
                </Pressable>
              </View>
            </>
          ) : (
            <>
              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder="Search your products, or type a new item name"
                placeholderTextColor="#9CA3AF"
                autoFocus
                className="mb-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
              />
              <FlatList
                data={matches}
                keyExtractor={(row) => row.key}
                keyboardShouldPersistTaps="handled"
                style={{ maxHeight: 300 }}
                renderItem={({ item: row }) =>
                  row.kind === 'product' ? (
                    <Pressable
                      onPress={() => onPick(row.product)}
                      className="flex-row items-center justify-between border-b border-gray-100 px-2 py-2.5"
                    >
                      <View className="flex-1 pr-2">
                        <Text className="text-sm font-semibold text-gray-900" numberOfLines={1}>
                          {row.product.name}
                        </Text>
                        <Text className={`text-xs ${row.product.stock_level > 0 ? 'text-gray-500' : 'text-red-500'}`}>
                          {row.product.stock_level} in stock
                        </Text>
                      </View>
                      <Text className="text-sm font-semibold text-gray-900">NPR {Number(row.product.price).toLocaleString()}</Text>
                    </Pressable>
                  ) : (
                    <Pressable
                      onPress={() => onPickFinanceItem(row.item)}
                      className="flex-row items-center justify-between border-b border-gray-100 px-2 py-2.5"
                    >
                      <View className="flex-1 pr-2">
                        <Text className="text-sm font-semibold text-gray-900" numberOfLines={1}>
                          {row.item.name}
                        </Text>
                        <Text className="text-xs text-gray-400">Not in stock — used before</Text>
                      </View>
                      {row.item.rate != null && (
                        <Text className="text-sm font-semibold text-gray-900">NPR {Number(row.item.rate).toLocaleString()}</Text>
                      )}
                    </Pressable>
                  )
                }
                ListEmptyComponent={<Text className="px-2 py-3 text-center text-sm text-gray-400">No matching products.</Text>}
                ListFooterComponent={
                  search.trim() ? (
                    <Pressable
                      onPress={() => setConfirmingName(search.trim())}
                      className="mt-1 flex-row items-center gap-1.5 rounded-lg bg-orange-50 px-2 py-2.5"
                    >
                      <Ionicons name="add-circle" size={16} color="#EA580C" />
                      <Text className="text-sm font-semibold text-orange-600">Add "{search.trim()}" as a new item</Text>
                    </Pressable>
                  ) : null
                }
              />
            </>
          )}
        </Pressable>
      </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const TYPE_META: Record<BusinessTransactionType, { label: string; color: string; bg: string; icon: keyof typeof Ionicons.glyphMap }> = {
  sale: { label: 'Sale', color: '#059669', bg: 'bg-emerald-50', icon: 'trending-up' },
  purchase: { label: 'Purchase', color: '#dc2626', bg: 'bg-red-50', icon: 'cart' },
  expense: { label: 'Expense', color: '#dc2626', bg: 'bg-red-50', icon: 'receipt' },
};

const FILTERS: { key: 'all' | BusinessTransactionType; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'sale', label: 'Sales' },
  { key: 'purchase', label: 'Purchase' },
  { key: 'expense', label: 'Expense' },
];


/** Web only: a short "what did I just enter recently" reference list below
 * the live summary card, so a reseller can glance at their last few
 * Sale/Purchase/Expense entries without leaving the form. Sale/Purchase/
 * Expense all read business_transactions directly (Payment In/Out's own
 * version of this lives in QuickPaymentScreen, over the ledger tables). */
function RecentEntriesCard({ userId, type, color }: { userId: string; type: BusinessTransactionType; color: string }) {
  const { data } = useSupabaseQuery('business_transactions', {
    filters: { owner_id: userId, type },
    orderBy: { column: 'created_at', ascending: false },
    enabled: !!userId,
  });
  const recent = (data ?? []).slice(0, 5);

  return (
    <View className="mt-4 rounded-2xl border border-gray-200 bg-white p-4">
      <Text className="mb-2 text-[11px] font-bold uppercase tracking-wide text-gray-400">
        Recent {TYPE_META[type].label}s
      </Text>
      {recent.length === 0 ? (
        <Text className="text-xs text-gray-400">No entries yet.</Text>
      ) : (
        recent.map((tx, i) => (
          <View
            key={tx.id}
            className={`flex-row items-center justify-between py-2 ${i < recent.length - 1 ? 'border-b border-gray-50' : ''}`}
          >
            <View className="flex-1 pr-2">
              <Text numberOfLines={1} className="text-xs font-semibold text-gray-800">
                {tx.party_name || 'Unnamed'}
              </Text>
              <Text className="text-[10px] text-gray-400">{toBsHistoryLabel(tx.bill_date ?? tx.created_at)}</Text>
            </View>
            <Text className="text-xs font-bold" style={{ color }}>
              NPR {tx.amount.toLocaleString()}
            </Text>
          </View>
        ))
      )}
    </View>
  );
}

function CategoryPickerModal({
  visible,
  categories,
  selectedId,
  onSelect,
  onClose,
  onCreate,
  onRename,
  onDelete,
}: {
  visible: boolean;
  categories: ExpenseCategory[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onClose: () => void;
  onCreate: (name: string) => Promise<void>;
  onRename: (id: string, name: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [newName, setNewName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleCreate() {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      await onCreate(newName.trim());
      setNewName('');
    } catch (err) {
      showAlert('Could not add category', getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleRename(id: string) {
    if (!renameValue.trim()) return;
    setSaving(true);
    try {
      await onRename(id, renameValue.trim());
      setRenamingId(null);
    } catch (err) {
      showAlert('Could not rename category', getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
      <Pressable className="flex-1 items-center justify-center bg-black/40 px-6" onPress={onClose}>
        <Pressable onPress={() => {}} className="w-full max-w-sm rounded-xl bg-white p-3" style={{ maxHeight: '75%' }}>
          <View className="mb-2 flex-row items-center justify-between">
            <Text className="text-base font-semibold text-gray-900">Expense categories</Text>
            <Pressable onPress={onClose} className="px-2 py-1">
              <Text className="text-sm font-semibold text-blue-700">Close</Text>
            </Pressable>
          </View>

          <View className="mb-3 flex-row gap-2">
            <TextInput
              value={newName}
              onChangeText={setNewName}
              placeholder="New category name"
              placeholderTextColor="#9CA3AF"
              className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
            />
            <Pressable
              onPress={handleCreate}
              disabled={saving || !newName.trim()}
              className="items-center justify-center rounded-lg bg-orange-500 px-3 disabled:opacity-50"
            >
              <Ionicons name="add" size={18} color="white" />
            </Pressable>
          </View>

          {categories.length === 0 ? (
            <Text className="px-2 py-3 text-center text-sm text-gray-400">No categories yet — add one above.</Text>
          ) : (
            categories.map((cat) => (
              <View key={cat.id} className="mb-1.5 flex-row items-center gap-2 rounded-lg border border-gray-100 px-2 py-1.5">
                {renamingId === cat.id ? (
                  <>
                    <TextInput
                      value={renameValue}
                      onChangeText={setRenameValue}
                      autoFocus
                      className="flex-1 rounded-lg border border-gray-300 px-2 py-1.5 text-sm text-gray-900"
                    />
                    <Pressable onPress={() => handleRename(cat.id)} hitSlop={8} disabled={saving}>
                      <Ionicons name="checkmark" size={18} color="#059669" />
                    </Pressable>
                    <Pressable onPress={() => setRenamingId(null)} hitSlop={8}>
                      <Ionicons name="close" size={18} color="#9CA3AF" />
                    </Pressable>
                  </>
                ) : (
                  <>
                    <Pressable
                      onPress={() => {
                        onSelect(cat.id);
                        onClose();
                      }}
                      className="flex-1 flex-row items-center gap-2 py-1"
                    >
                      {selectedId === cat.id && <Ionicons name="checkmark-circle" size={16} color="#EA580C" />}
                      <Text className="text-sm font-medium text-gray-900">{cat.name}</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => {
                        setRenamingId(cat.id);
                        setRenameValue(cat.name);
                      }}
                      hitSlop={8}
                    >
                      <Ionicons name="pencil-outline" size={15} color="#9CA3AF" />
                    </Pressable>
                    <Pressable
                      onPress={() =>
                        showAlert('Remove this category?', undefined, [
                          { text: 'Cancel', style: 'cancel' },
                          { text: 'Remove', style: 'destructive', onPress: () => onDelete(cat.id) },
                        ])
                      }
                      hitSlop={8}
                    >
                      <Ionicons name="trash-outline" size={15} color="#9CA3AF" />
                    </Pressable>
                  </>
                )}
              </View>
            ))
          )}
        </Pressable>
      </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function TransactionForm({
  userId,
  initial,
  type,
  existingNames,
  customers,
  products,
  voicePrefill,
  onDone,
  onCancel,
}: {
  userId: string;
  initial?: BusinessTransaction;
  type: BusinessTransactionType;
  existingNames: string[];
  customers: Customer[];
  products: Product[];
  voicePrefill?: { amount?: string; party?: string; date?: string; note?: string } | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const createTx = useSupabaseInsert('business_transactions');
  const { confirm: confirmSave, dialog: confirmDialog } = useConfirmSave();
  const updateTx = useSupabaseUpdate('business_transactions');
  const { data: categories } = useSupabaseQuery('expense_categories', {
    filters: { owner_id: userId },
    orderBy: { column: 'name' },
  });
  const createCategory = useSupabaseInsert('expense_categories');
  const updateCategory = useSupabaseUpdate('expense_categories');
  const deleteCategory = useSupabaseDelete('expense_categories');
  const bankAccounts = useBankAccounts(userId);
  const createCustomer = useSupabaseInsert('customers');
  const updateCustomer = useSupabaseUpdate('customers');
  const { data: financeItems } = useSupabaseQuery('finance_items', {
    filters: { owner_id: userId },
    enabled: !!userId,
  });
  const createFinanceItem = useSupabaseUpsert('finance_items', 'owner_id,name');
  const phoneContacts = usePhoneContacts();
  const { scanning, pickAndScan } = useScanBill();
  // Pre-fills the party picker's search box with whatever name Scan Bill
  // read off the photo, instead of a silent auto-pick - a scanned name can
  // be misread, so it still needs a tap to confirm which real customer/
  // vendor it actually is.
  const [partyPickerQuery, setPartyPickerQuery] = useState('');

  // Expense: date + addable name + a managed category + amount + remark.
  const [amount, setAmount] = useState(initial && initial.type === 'expense' ? String(initial.amount) : '');
  const [expenseDate, setExpenseDate] = useState(initial?.bill_date ?? todayIso());
  const [categoryId, setCategoryId] = useState<string | null>(initial?.expense_category_id ?? null);
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);

  // Sale/Purchase: entered as a proper itemized bill.
  const [billNo, setBillNo] = useState(initial?.bill_no ?? '');
  const [billDate, setBillDate] = useState(initial?.bill_date ?? todayIso());
  const [items, setItems] = useState<ItemRowState[]>(
    initial ? initial.items.map((i) => ({ description: i.description, qty: String(i.qty), rate: String(i.rate) })) : []
  );
  const [showItemPicker, setShowItemPicker] = useState(false);
  const [editingItemIndex, setEditingItemIndex] = useState<number | null>(null);

  // Discount is typed as a plain NPR amount (its % is only ever a derived
  // read-out); VAT is typed as a percentage (defaulting to Nepal's standard
  // 13%) since it's normally a fixed rate applied to whatever the subtotal
  // is. They're independent, separately collapsible rows - adding one
  // doesn't imply the other.
  const initialSubtotal = initial ? initial.items.reduce((sum, i) => sum + i.amount, 0) : 0;
  const [discountAmountInput, setDiscountAmountInput] = useState(initial ? String(initial.discount_amount) : '0');
  // Web: the discount can be typed as a percent of the subtotal or as an NPR
  // amount - whichever was typed last drives the other, so a percent keeps
  // following the subtotal as items change. Native only ever uses the amount.
  const [discountMode, setDiscountMode] = useState<'percent' | 'amount'>(
    Platform.OS === 'web' && !initial ? 'percent' : 'amount'
  );
  const [discountPercentInput, setDiscountPercentInput] = useState('');
  // Defaults to 0 (not 13) for a brand-new bill - the VAT row itself starts
  // collapsed, but the percent still fed into vatAmount even while
  // collapsed, so every new Sale/Purchase silently had 13% VAT baked into
  // its total whether the reseller ever opened that row or not. 13% only
  // ever gets filled in when they actually tap to turn VAT on (see the
  // toggle below).
  const [vatPercent, setVatPercent] = useState(
    initial && initialSubtotal - initial.discount_amount > 0
      ? String(Math.round(((initial.vat_amount / (initialSubtotal - initial.discount_amount)) * 100) * 100) / 100)
      : '0'
  );
  const [showDiscount, setShowDiscount] = useState(!!initial && initial.discount_amount > 0);
  const [showVat, setShowVat] = useState(!!initial && initial.vat_amount > 0);

  const [partyName, setPartyName] = useState(initial?.party_name ?? '');
  // Links this bill to a real saved customer/vendor record, not just its
  // free-text name - a Sale/Purchase always books against this party's
  // ledger now (see 0061_sale_purchase_always_ledger.sql), so it's required
  // for a bill, same as Quick Payment already requires a real customer.
  // Only ever set by actually picking a saved contact below, never typing.
  const [customerId, setCustomerId] = useState<string | null>(initial?.customer_id ?? null);
  const [note, setNote] = useState(initial?.note ?? '');
  const [bankAccountId, setBankAccountId] = useState<string | null>(initial?.bank_account_id ?? null);
  const [showAccountPicker, setShowAccountPicker] = useState(false);
  const [saving, setSaving] = useState(false);

  const isBill = type !== 'expense';
  const subtotal = items.filter(isSavableItem).reduce((sum, row) => sum + lineTotal(row), 0);
  const discountAmount =
    discountMode === 'percent'
      ? Math.round((subtotal * Math.min(Number(discountPercentInput) || 0, 100)) / 100)
      : Number(discountAmountInput) || 0;
  const discountPercentDisplay = subtotal > 0 ? (discountAmount / subtotal) * 100 : 0;
  // Flips the single discount box between a percent and an NPR amount, carrying
  // the value across so what is on screen never changes meaning under the user.
  function setDiscountUnit(unit: 'percent' | 'amount') {
    if (unit === discountMode) return;
    if (unit === 'amount') {
      setDiscountAmountInput(String(discountAmount));
    } else {
      setDiscountPercentInput(subtotal > 0 && discountAmount > 0 ? String(Math.round(discountPercentDisplay * 100) / 100) : '');
    }
    setDiscountMode(unit);
  }
  const discountInputValue = discountMode === 'percent' ? discountPercentInput : discountAmountInput;
  const vatAmount = Math.round(((subtotal - discountAmount) * (Number(vatPercent) || 0)) / 100);
  const grandTotal = subtotal - discountAmount + vatAmount;
  const selectedCategory = (categories ?? []).find((c) => c.id === categoryId) ?? null;
  const selectedAccountName = bankAccountId
    ? bankAccounts.accounts.find((a) => a.id === bankAccountId)?.name ?? 'Cash'
    : 'Cash';

  const [showPartyPicker, setShowPartyPicker] = useState(false);
  // Lets a typo in a just-added (or existing) customer/vendor's name get
  // fixed right here - picking a different party is a totally different
  // action (the picker), and a customer created by mistyping a name
  // otherwise has no easy way back to fix it short of hunting it down in
  // Customers.
  const [showRenameParty, setShowRenameParty] = useState(false);
  const [renamePartyValue, setRenamePartyValue] = useState('');
  const [renamingParty, setRenamingParty] = useState(false);

  async function handleRenameParty() {
    if (!customerId || !renamePartyValue.trim()) return;
    setRenamingParty(true);
    try {
      await updateCustomer.mutateAsync({ id: customerId, values: { name: renamePartyValue.trim() } });
      setPartyName(renamePartyValue.trim());
      setShowRenameParty(false);
    } catch (err) {
      showAlert('Could not rename', getErrorMessage(err));
    } finally {
      setRenamingParty(false);
    }
  }

  function selectCustomer(c: Customer) {
    setPartyName(c.name);
    setCustomerId(c.id);
    setShowPartyPicker(false);
  }

  // A phone contact not saved yet is saved as a real customer now (so
  // picking them here actually adds them to the book and links customer_id).
  // A plain typed name with no phone used to just fill the free-text field
  // with no real customer behind it - harmless for Expense (party_name is
  // all it's ever needed), but a Sale/Purchase now requires a real
  // customer_id to save at all (0061_sale_purchase_always_ledger.sql), so
  // that left the "+ add new" flow looking broken: you'd type a name, it
  // seemed to "take", then Save would refuse with "Pick a customer". Create
  // a real customer here too when this is a bill, same as Quick Payment
  // already does.
  async function handleSelectPartyNew(name: string, phone: string | null) {
    setShowPartyPicker(false);
    if (!phone && !isBill) {
      setPartyName(name);
      setCustomerId(null);
      return;
    }
    if (phone) {
      const existing = customers.find((c) => c.phone === phone);
      if (existing) {
        selectCustomer(existing);
        return;
      }
    }
    try {
      const created = await createCustomer.mutateAsync({ owner_id: userId, name, phone });
      selectCustomer(created);
    } catch (err) {
      showAlert('Could not add customer', getErrorMessage(err));
    }
  }

  async function handleCreateCategory(name: string) {
    const created = await createCategory.mutateAsync({ owner_id: userId, name });
    setCategoryId(created.id);
  }
  async function handleRenameCategory(id: string, name: string) {
    await updateCategory.mutateAsync({ id, values: { name } });
  }
  async function handleDeleteCategory(id: string) {
    await deleteCategory.mutateAsync(id);
    if (categoryId === id) setCategoryId(null);
  }

  function updateItem(index: number, next: ItemRowState) {
    setItems((prev) => prev.map((row, i) => (i === index ? next : row)));
  }
  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }
  function openItemPicker(index: number | null) {
    setEditingItemIndex(index);
    setShowItemPicker(true);
  }
  function handlePickProduct(p: Product) {
    const row: ItemRowState = { description: p.name, qty: '1', rate: Number(p.price) > 0 ? String(p.price) : '' };
    if (editingItemIndex != null) updateItem(editingItemIndex, row);
    else setItems((prev) => [...prev, row]);
    setShowItemPicker(false);
    setEditingItemIndex(null);
  }
  function handlePickFinanceItem(item: FinanceItem) {
    const row: ItemRowState = { description: item.name, qty: '1', rate: item.rate != null ? String(item.rate) : '' };
    if (editingItemIndex != null) updateItem(editingItemIndex, row);
    else setItems((prev) => [...prev, row]);
    setShowItemPicker(false);
    setEditingItemIndex(null);
  }
  // Typing a brand-new item used to only ever add it to this one bill's
  // line items, invisibly to the catalog - the next time "Pick from your
  // stock" opened, that same name wouldn't show up, since nothing was ever
  // saved anywhere. `products` isn't the right place either - a reseller
  // can only add a row there by stocking an admin-approved catalog item
  // (products_insert_seller_from_catalog, 0015_product_catalog.sql), not by
  // typing an arbitrary name while billing - so this saves it to the
  // separate, Finance-only finance_items table instead (0063), which has no
  // such restriction.
  async function handlePickCustomItem(name: string, rate: string) {
    const row: ItemRowState = { description: name, qty: '1', rate: rate.trim() };
    if (editingItemIndex != null) updateItem(editingItemIndex, row);
    else setItems((prev) => [...prev, row]);
    setShowItemPicker(false);
    setEditingItemIndex(null);
    try {
      await createFinanceItem.mutateAsync({ owner_id: userId, name, rate: Number(rate) || null });
    } catch (err) {
      showAlert('Added to this bill, but could not save it for next time', getErrorMessage(err));
    }
  }

  async function handleSave() {
    if (saving) return;
    if (isBill) {
      const validItems = items.filter(isSavableItem);
      if (validItems.length === 0) {
        showAlert('Add at least one item', 'Enter a description, quantity, and rate for at least one item.');
        return;
      }
      if (grandTotal <= 0) {
        showAlert('Check the total', 'The grand total must be more than zero — check item amounts and discount/VAT.');
        return;
      }
      if (!customerId && !partyName.trim()) {
        showAlert(
          type === 'purchase' ? 'Pick a vendor' : 'Pick a customer',
          `Every ${type} books against a real ${type === 'purchase' ? 'vendor' : 'customer'}'s ledger now — tap the ${type === 'purchase' ? 'Vendor' : 'Customer'} field above and choose or add one.`
        );
        return;
      }
      const ok = await confirmSave({
        title: `${initial ? 'Save changes to this' : 'Save this'} ${TYPE_META[type].label.toLowerCase()}?`,
        rows: [
          { label: type === 'purchase' ? 'Vendor' : 'Customer', value: partyName.trim() },
          { label: 'Items', value: String(validItems.length) },
          ...(billNo.trim() ? [{ label: 'Bill no.', value: billNo.trim() }] : []),
          ...(discountAmount > 0 ? [{ label: 'Discount', value: `− NPR ${discountAmount.toLocaleString()}` }] : []),
          ...(vatAmount > 0 ? [{ label: 'VAT', value: `+ NPR ${vatAmount.toLocaleString()}` }] : []),
        ],
        total: { label: 'Grand total', value: `NPR ${grandTotal.toLocaleString()}`, color: TYPE_META[type].color },
      });
      if (!ok) return;
      setSaving(true);
      try {
        // A name typed in full without picking it from the list still means
        // the saved party of that name - and a brand-new name is saved as a
        // new customer/vendor on the spot, same as Quick Payment does.
        let resolvedCustomerId = customerId;
        if (!resolvedCustomerId) {
          const typed = partyName.trim();
          const existing = customers.find((c) => c.name.trim().toLowerCase() === typed.toLowerCase());
          if (existing) {
            resolvedCustomerId = existing.id;
          } else {
            const created = await createCustomer.mutateAsync({ owner_id: userId, name: typed, phone: null });
            resolvedCustomerId = created.id;
          }
          setCustomerId(resolvedCustomerId);
        }
        const values = {
          type,
          amount: grandTotal,
          party_name: partyName.trim() || null,
          customer_id: resolvedCustomerId,
          note: note.trim() || null,
          bill_no: billNo.trim() || null,
          bill_date: billDate || null,
          items: validItems.map((r) => ({
            description: r.description.trim(),
            qty: Number(r.qty),
            rate: Number(r.rate),
            amount: Number(r.qty) * Number(r.rate),
          })),
          discount_amount: Math.round(discountAmount),
          vat_amount: vatAmount,
          payment_mode: 'cash' as const,
          bank_account_id: null,
        };
        if (initial) {
          await updateTx.mutateAsync({ id: initial.id, values });
        } else {
          await createTx.mutateAsync({ owner_id: userId, ...values });
        }
        // The typeahead lets an item be typed straight into the bill; one
        // that isn't in the catalog yet is remembered for next time, like
        // "Add as new item" in the picker popup does.
        if (Platform.OS === 'web') {
          const known = new Set([
            ...products.map((p) => p.name.trim().toLowerCase()),
            ...(financeItems ?? []).map((f) => f.name.trim().toLowerCase()),
          ]);
          for (const r of validItems) {
            const name = r.description.trim();
            if (!name || known.has(name.toLowerCase())) continue;
            known.add(name.toLowerCase());
            try {
              await createFinanceItem.mutateAsync({ owner_id: userId, name, rate: Number(r.rate) || null });
            } catch {
              // The bill itself is saved - a failed remember-for-later isn't worth blocking on.
            }
          }
        }
        onDone();
      } catch (err) {
        showAlert('Could not save', getErrorMessage(err));
      } finally {
        setSaving(false);
      }
      return;
    }

    const value = Number(amount);
    if (!amount.trim() || Number.isNaN(value) || value <= 0) {
      showAlert('Enter an amount', 'Add a valid amount in NPR.');
      return;
    }
    const ok = await confirmSave({
      title: `${initial ? 'Save changes to this' : 'Save this'} expense?`,
      rows: [
        ...(partyName.trim() ? [{ label: 'Paid to', value: partyName.trim() }] : []),
        ...(selectedCategory ? [{ label: 'Category', value: selectedCategory.name }] : []),
        { label: 'Paid via', value: selectedAccountName },
      ],
      total: { label: 'Amount', value: `NPR ${value.toLocaleString()}`, color: TYPE_META.expense.color },
    });
    if (!ok) return;
    setSaving(true);
    try {
      const values = {
        type,
        amount: value,
        party_name: partyName.trim() || null,
        customer_id: customerId,
        note: note.trim() || null,
        bill_date: expenseDate || null,
        expense_category_id: categoryId,
        payment_mode: bankAccountId ? ('bank' as const) : ('cash' as const),
        bank_account_id: bankAccountId,
      };
      if (initial) {
        await updateTx.mutateAsync({ id: initial.id, values });
      } else {
        await createTx.mutateAsync({ owner_id: userId, ...values });
      }
      onDone();
    } catch (err) {
      showAlert('Could not save', getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  // Applies whatever the voice-command button understood (voicePrefill is
  // only ever passed on a brand-new entry, never while editing - see the
  // TransactionsScreen caller). Same "review before save" rule as Scan
  // Bill: this only fills fields, it never saves on its own, and the party
  // still needs an explicit tap to confirm via the picker it opens. Depends
  // on voicePrefill itself (memoized by the caller on the actual param
  // values) rather than firing once on mount, since those params aren't
  // always hydrated yet on a freshly-pushed route's first render.
  useEffect(() => {
    if (!voicePrefill) return;
    if (voicePrefill.note) setNote(voicePrefill.note);
    if (voicePrefill.date) {
      if (isBill) setBillDate(voicePrefill.date);
      else setExpenseDate(voicePrefill.date);
    }
    if (voicePrefill.party) {
      setPartyPickerQuery(voicePrefill.party);
      setShowPartyPicker(true);
    }
    if (isBill && voicePrefill.amount) {
      const label = voicePrefill.party
        ? `${type === 'purchase' ? 'Purchase from' : 'Sale to'} ${voicePrefill.party}`
        : 'Voice entry';
      setItems((prev) => [...prev, { description: label, qty: '1', rate: voicePrefill.amount! }]);
    } else if (!isBill && voicePrefill.amount) {
      setAmount(voicePrefill.amount);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voicePrefill]);

  // Fills in whatever Scan Bill could read off the photo; the reseller still
  // reviews and can edit every field afterward, and still has to actually
  // tap-confirm the party (see partyPickerQuery above) since a misread name
  // should never silently become a wrong customer/vendor.
  async function handleScan() {
    phoneContacts.request();
    const scanned = await pickAndScan();
    if (!scanned) return;

    if (scanned.note) setNote(scanned.note);
    if (scanned.vendor_name) {
      setPartyPickerQuery(scanned.vendor_name);
      setShowPartyPicker(true);
    }

    if (isBill) {
      if (scanned.bill_no) setBillNo(scanned.bill_no);
      if (scanned.date) setBillDate(scanned.date);
      if (scanned.items.length > 0) {
        setItems((prev) => [
          ...prev,
          ...scanned.items.map((i) => ({ description: i.description, qty: String(i.qty), rate: String(i.rate) })),
        ]);
        if (scanned.discount_amount) {
          setDiscountMode('amount');
          setDiscountAmountInput(String(scanned.discount_amount));
          setShowDiscount(true);
        }
        if (scanned.vat_amount) {
          const scannedSubtotal = scanned.items.reduce((s, i) => s + i.qty * i.rate, 0) - (scanned.discount_amount ?? 0);
          if (scannedSubtotal > 0) {
            setVatPercent(String(Math.round((scanned.vat_amount / scannedSubtotal) * 10000) / 100));
            setShowVat(true);
          }
        }
      } else if (scanned.amount) {
        // No itemized list on the bill (e.g. a simple slip) - one line for
        // the whole amount, rather than leaving items empty and blocking
        // Save (a bill always needs at least one item).
        setItems((prev) => [
          ...prev,
          { description: scanned.vendor_name ? `Bill from ${scanned.vendor_name}` : 'Scanned bill', qty: '1', rate: String(scanned.amount) },
        ]);
      }
    } else {
      if (scanned.amount) setAmount(String(scanned.amount));
      if (scanned.date) setExpenseDate(scanned.date);
    }
  }

  // Web-only multi-expense table (new entries only - editing an existing
  // expense, `initial` set, stays the single-entry form below regardless of
  // platform). Purely additive: the single-entry amount/partyName/categoryId
  // state and handleSave above are untouched and still drive every other
  // path (native, sale/purchase, and editing).
  const [expenseRows, setExpenseRows] = useState<ExpenseRow[]>([emptyExpenseRow()]);
  const [activePartyRowKey, setActivePartyRowKey] = useState<string | null>(null);
  const [activeCategoryRowKey, setActiveCategoryRowKey] = useState<string | null>(null);
  const [expenseRowPickerQuery, setExpenseRowPickerQuery] = useState('');
  const expenseRowsTotal = expenseRows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);

  function addExpenseRow() {
    setExpenseRows((prev) => [...prev, emptyExpenseRow()]);
  }

  function removeExpenseRow(key: string) {
    setExpenseRows((prev) => (prev.length > 1 ? prev.filter((r) => r.key !== key) : prev));
  }

  function updateExpenseRow(key: string, patch: Partial<ExpenseRow>) {
    setExpenseRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function selectPartyForExpenseRow(c: Customer) {
    if (activePartyRowKey) updateExpenseRow(activePartyRowKey, { partyName: c.name, customerId: c.id });
    setActivePartyRowKey(null);
  }

  // Same "a plain typed name with no phone just fills party_name, a phone
  // number links or creates a real customer" behavior as handleSelectPartyNew
  // above (expense never requires a real customer_id, unlike a bill).
  async function handleSelectNewPartyForExpenseRow(name: string, phone: string | null) {
    const key = activePartyRowKey;
    setActivePartyRowKey(null);
    if (!key) return;
    if (!phone) {
      updateExpenseRow(key, { partyName: name, customerId: null });
      return;
    }
    const existing = customers.find((c) => c.phone === phone);
    if (existing) {
      updateExpenseRow(key, { partyName: existing.name, customerId: existing.id });
      return;
    }
    try {
      const created = await createCustomer.mutateAsync({ owner_id: userId, name, phone });
      updateExpenseRow(key, { partyName: created.name, customerId: created.id });
    } catch (err) {
      showAlert('Could not add customer', getErrorMessage(err));
    }
  }

  function selectCategoryForRow(id: string) {
    if (activeCategoryRowKey) updateExpenseRow(activeCategoryRowKey, { categoryId: id });
    setActiveCategoryRowKey(null);
  }

  // Scanning a bill in the multi-expense table adds a fresh row for it
  // instead of overwriting whichever row is already being edited.
  async function handleScanForExpenseRow() {
    phoneContacts.request();
    const scanned = await pickAndScan();
    if (!scanned) return;
    const key = makeExpenseRowKey();
    setExpenseRows((prev) => [
      ...prev,
      {
        key,
        partyName: scanned.vendor_name ?? '',
        customerId: null,
        categoryId: null,
        amount: scanned.amount ? String(scanned.amount) : '',
        note: scanned.note ?? '',
      },
    ]);
    if (scanned.date) setExpenseDate(scanned.date);
    if (scanned.vendor_name) {
      setExpenseRowPickerQuery(scanned.vendor_name);
      setActivePartyRowKey(key);
    }
  }

  async function handleSaveAllExpenses() {
    const validRows = expenseRows.filter((r) => Number(r.amount) > 0);
    if (validRows.length === 0) {
      showAlert('Add an expense', 'Add at least one expense with a valid amount.');
      return;
    }
    const sum = validRows.reduce((s, r) => s + Number(r.amount), 0);
    const ok = await confirmSave({
      title: `Save ${validRows.length === 1 ? 'this' : `these ${validRows.length}`} expense${validRows.length === 1 ? '' : 's'}?`,
      rows: [
        ...validRows.slice(0, 5).map((r) => {
          const cat = (categories ?? []).find((c) => c.id === r.categoryId)?.name;
          return { label: `${r.partyName.trim() || 'Expense'}${cat ? ' · ' + cat : ''}`, value: `NPR ${Number(r.amount).toLocaleString()}` };
        }),
        ...(validRows.length > 5 ? [{ label: `+ ${validRows.length - 5} more` }] : []),
        { label: 'Paid via', value: selectedAccountName },
      ],
      total: { label: 'Total', value: `NPR ${sum.toLocaleString()}`, color: TYPE_META.expense.color },
    });
    if (!ok) return;
    setSaving(true);
    try {
      for (const row of validRows) {
        await createTx.mutateAsync({
          owner_id: userId,
          type: 'expense',
          amount: Number(row.amount),
          party_name: row.partyName.trim() || null,
          customer_id: row.customerId,
          note: row.note.trim() || null,
          bill_date: expenseDate || null,
          expense_category_id: row.categoryId,
          payment_mode: bankAccountId ? ('bank' as const) : ('cash' as const),
          bank_account_id: bankAccountId,
        });
        // Drop each row once saved, so a failure part-way leaves only the
        // unsaved ones - saving again never records an expense twice.
        setExpenseRows((prev) => {
          const rest = prev.filter((r) => r.key !== row.key);
          return rest.length ? rest : [emptyExpenseRow()];
        });
      }
      onDone();
    } catch (err) {
      showAlert('Could not save', getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  // Web Sale/Purchase form only: refs for the keyboard walk between fields,
  // the vendor typeahead, and an always-present blank last item row (typing
  // into it adds the next one, so there is never an "Add item" to reach for).
  const vendorRef = useRef<TextInput | null>(null);
  const billNoRef = useRef<TextInput>(null);
  const billDateRef = useRef<TextInput>(null);
  const discountRef = useRef<TextInput>(null);
  const vatRef = useRef<TextInput>(null);
  const remarkRef = useRef<TextInput>(null);
  const saveButtonRef = useRef<View>(null);
  const itemsTableRef = useRef<BillItemsTableHandle>(null);
  const [vendorFocused, setVendorFocused] = useState(false);

  const vendorSuggestions = useMemo<CustomerSuggestion[]>(() => {
    if (!vendorFocused || !isBill) return [];
    const q = partyName.trim();
    if (!q) return [];
    if (customerId && customers.find((c) => c.id === customerId)?.name === partyName) return [];
    return buildCustomerSuggestions(customers, phoneContacts.contacts, q, 6);
  }, [vendorFocused, isBill, partyName, customerId, customers, phoneContacts.contacts]);

  const vendorOptions = useMemo<SuggestOption[]>(
    () =>
      vendorSuggestions.map((s) => ({
        key: s.key,
        label: s.name,
        hint: s.customer ? (s.phone ?? 'Saved') : 'From contacts',
      })),
    [vendorSuggestions]
  );

  useEffect(() => {
    if (Platform.OS !== 'web' || !isBill) return;
    const last = items[items.length - 1];
    if (!last || last.description.trim() || last.qty.trim() || last.rate.trim()) {
      setItems((prev) => [...prev, { description: '', qty: '', rate: '' }]);
    }
  }, [items, isBill]);

  // On web the form's name and its Scan Bill button live in the top bar; the
  // heading row that used to repeat the name under it is gone.
  const newExpenses = type === 'expense' && !initial;
  const scanRef = useRef<() => void>(() => {});
  scanRef.current = newExpenses ? handleScanForExpenseRow : handleScan;
  useScreenHeader(
    Platform.OS === 'web'
      ? {
          title: newExpenses ? 'New Expenses' : `${initial ? 'Edit' : 'New'} ${TYPE_META[type].label}`,
          resetTitle: 'Statement',
          headerRight: () => (
            <Pressable
              onPress={() => scanRef.current()}
              disabled={scanning}
              className="h-9 flex-row items-center justify-center rounded-lg border border-blue-600 bg-blue-50 px-3.5 disabled:opacity-50"
              style={{ gap: 6 }}
            >
              <Ionicons name={scanning ? 'hourglass-outline' : 'camera-outline'} size={15} color="#2563EB" />
              <Text className="text-[13px] font-semibold text-blue-700">{scanning ? 'Reading…' : 'Scan Bill'}</Text>
            </Pressable>
          ),
        }
      : {},
    [type, initial?.id, scanning]
  );

  if (Platform.OS === 'web' && type === 'expense' && !initial) {
    return (
      <View className="mb-4">
        <View className="mb-4 flex-row" style={{ gap: 24 }}>
          <View className="flex-1" style={{ minWidth: 0, maxWidth: 1500 }}>
            <View className="mb-5 rounded-2xl border border-gray-200 bg-white p-5">
              <FormSection icon="calendar-outline" title="Details" first>
                <Text className="mb-1 text-xs font-medium text-gray-500">Date</Text>
                <DateField value={expenseDate} onChange={setExpenseDate} />
              </FormSection>

              <FormSection icon="wallet-outline" title="Payment method">
                <Pressable
                  onPress={() => setShowAccountPicker(true)}
                  className="flex-row items-center justify-between rounded-lg border border-gray-300 px-3 py-2.5"
                >
                  <View className="flex-row items-center gap-2">
                    <Ionicons name={bankAccountId ? 'business-outline' : 'cash-outline'} size={16} color="#6B7280" />
                    <Text className="text-sm text-gray-900">{selectedAccountName}</Text>
                  </View>
                  <Ionicons name="chevron-down" size={16} color="#9CA3AF" />
                </Pressable>
              </FormSection>
            </View>

            <View className="rounded-2xl border border-gray-200 bg-white p-5">
              <View className="mb-3 flex-row items-center gap-1.5">
                <Ionicons name="receipt-outline" size={13} color="#9CA3AF" />
                <Text className="text-[11px] font-bold uppercase tracking-wide text-gray-400">Expenses</Text>
              </View>

              <View className="mb-1.5 flex-row gap-2 px-1">
                <Text className="flex-1 text-[11px] font-semibold text-gray-500">Paid to</Text>
                <Text className="flex-1 text-[11px] font-semibold text-gray-500">Category</Text>
                <Text className="w-24 text-[11px] font-semibold text-gray-500">Amount</Text>
                <Text className="flex-1 text-[11px] font-semibold text-gray-500">Note</Text>
                <View style={{ width: 28 }} />
              </View>

              {expenseRows.map((row) => {
                const rowCategory = (categories ?? []).find((c) => c.id === row.categoryId) ?? null;
                return (
                  <View key={row.key} className="mb-2 flex-row items-center gap-2">
                    <Pressable
                      onPress={() => {
                        phoneContacts.request();
                        setExpenseRowPickerQuery('');
                        setActivePartyRowKey(row.key);
                      }}
                      className="flex-1 flex-row items-center justify-between rounded-lg border border-gray-300 bg-white px-3 py-2.5"
                    >
                      <Text className={`flex-1 text-sm ${row.partyName ? 'text-gray-900' : 'text-gray-400'}`} numberOfLines={1}>
                        {row.partyName || 'Paid to?'}
                      </Text>
                      <Ionicons name="chevron-down" size={14} color="#9CA3AF" />
                    </Pressable>
                    <Pressable
                      onPress={() => setActiveCategoryRowKey(row.key)}
                      className="flex-1 flex-row items-center justify-between rounded-lg border border-gray-300 bg-white px-3 py-2.5"
                    >
                      <Text className={`flex-1 text-sm ${rowCategory ? 'text-gray-900' : 'text-gray-400'}`} numberOfLines={1}>
                        {rowCategory?.name ?? 'Category'}
                      </Text>
                      <Ionicons name="chevron-down" size={14} color="#9CA3AF" />
                    </Pressable>
                    <TextInput
                      value={row.amount}
                      onChangeText={(v) => updateExpenseRow(row.key, { amount: v })}
                      placeholder="0"
                      placeholderTextColor="#D1D5DB"
                      keyboardType="numeric"
                      className="w-24 rounded-lg border border-gray-300 px-3 py-2.5 text-sm font-semibold text-gray-900"
                    />
                    <TextInput
                      value={row.note}
                      onChangeText={(v) => updateExpenseRow(row.key, { note: v })}
                      placeholder="Optional"
                      placeholderTextColor="#9CA3AF"
                      className="flex-1 rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900"
                    />
                    <Pressable onPress={() => removeExpenseRow(row.key)} hitSlop={8} style={{ width: 28, alignItems: 'center' }}>
                      <Ionicons name="close-circle" size={18} color={expenseRows.length > 1 ? '#DC2626' : '#E5E7EB'} />
                    </Pressable>
                  </View>
                );
              })}

              <Pressable onPress={addExpenseRow} className="mt-2 flex-row items-center gap-1.5 self-start">
                <Ionicons name="add-circle-outline" size={16} color={FINANCE_ENTRY_ACCENT} />
                <Text className="text-sm font-semibold" style={{ color: FINANCE_ENTRY_ACCENT }}>
                  Add expense
                </Text>
              </Pressable>

              <View className="mt-5 flex-row gap-3 border-t border-gray-100 pt-4">
                <Pressable onPress={onCancel} className="flex-1 items-center rounded-xl border border-gray-300 py-3">
                  <Text className="text-sm font-semibold text-gray-600">Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={handleSaveAllExpenses}
                  disabled={saving}
                  className="flex-1 items-center rounded-xl py-3 disabled:opacity-50"
                  style={{ backgroundColor: FINANCE_ENTRY_ACCENT }}
                >
                  <Text className="text-sm font-bold text-white">{saving ? 'Saving…' : 'Save'}</Text>
                </Pressable>
              </View>
            </View>
          </View>

          <View style={{ width: 320 }}>
            <RecentEntriesCard userId={userId} type="expense" color={FINANCE_ENTRY_ACCENT} />
          </View>
        </View>

        {confirmDialog}

        <ContactPickerModal
          visible={activePartyRowKey != null}
          initialQuery={expenseRowPickerQuery}
          customers={customers}
          phoneContacts={phoneContacts.contacts}
          onSelectCustomer={selectPartyForExpenseRow}
          onSelectNew={handleSelectNewPartyForExpenseRow}
          onClose={() => setActivePartyRowKey(null)}
        />
        <CategoryPickerModal
          visible={activeCategoryRowKey != null}
          categories={categories ?? []}
          selectedId={activeCategoryRowKey ? expenseRows.find((r) => r.key === activeCategoryRowKey)?.categoryId ?? null : null}
          onSelect={selectCategoryForRow}
          onClose={() => setActiveCategoryRowKey(null)}
          onCreate={handleCreateCategory}
          onRename={handleRenameCategory}
          onDelete={handleDeleteCategory}
        />
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

  // Web bill layout (Sale/Purchase): unlike Payment/Expense, a bill always
  // belongs to exactly one party and already has its own per-item table, so
  // this isn't a multi-party batch - it's the same single bill, just laid
  // out in the same "top fields, main table, live summary, Save/Cancel
  // below" shape as the rest of the redesigned web forms. Applies to
  // editing an existing bill too (unlike Expense's new-only table), since
  // it's still one bill either way. All state/handlers below are the exact
  // same ones the original single-column return further down uses -
  // nothing here is a separate calculation.
  if (Platform.OS === 'web' && isBill) {
    const accent = FINANCE_ENTRY_ACCENT;
    const accentShadow = FINANCE_ENTRY_SHADOW;
    const partyLabel = type === 'purchase' ? 'Vendor' : 'Customer';

    return (
      <View className="mb-4">
        <View className="mb-4 flex-row" style={{ gap: 24 }}>
          <View className="flex-1" style={{ minWidth: 0, maxWidth: 1500 }}>
            {/* Vendor, bill number and date share one row - everything that
                identifies the bill - and the whole form is keyboard-driven:
                Tab/Enter walk Vendor -> Bill No. -> Date -> Items -> Discount
                -> VAT -> Remark -> Save, Ctrl+Enter saves from anywhere. */}
            <View
              className="mb-4 rounded-2xl border border-gray-200 bg-white px-5 py-4"
              style={{ boxShadow: '0 1px 2px rgba(16,24,40,0.04), 0 4px 12px rgba(16,24,40,0.03)', zIndex: 20 }}
            >
              <View className="flex-row" style={{ gap: 14 }}>
                <View style={{ flex: 1.7, minWidth: 0 }}>
                  <View className="mb-1.5 flex-row items-center justify-between">
                    <Text className="text-xs font-semibold text-gray-600">{partyLabel}</Text>
                    {!!customerId && (
                      <Pressable
                        onPress={() => {
                          setRenamePartyValue(partyName);
                          setShowRenameParty(true);
                        }}
                        tabIndex={-1}
                        hitSlop={8}
                        accessibilityLabel={`Rename ${partyLabel.toLowerCase()}`}
                      >
                        <Ionicons name="pencil-outline" size={13} color="#9CA3AF" />
                      </Pressable>
                    )}
                  </View>
                  <SuggestInput
                    value={partyName}
                    onChangeText={(v) => {
                      setPartyName(v);
                      if (customerId) {
                        const linked = customers.find((c) => c.id === customerId);
                        if (!linked || linked.name !== v) setCustomerId(null);
                      }
                    }}
                    options={vendorOptions}
                    onSelectOption={async (opt, via) => {
                      const s = vendorSuggestions.find((x) => x.key === opt.key);
                      if (!s) return;
                      if (via !== 'tab') billNoRef.current?.focus();
                      if (s.customer) {
                        setPartyName(s.name);
                        setCustomerId(s.customer.id);
                      } else {
                        await handleSelectPartyNew(s.name, s.phone);
                      }
                    }}
                    inputRef={(el) => {
                      vendorRef.current = el;
                    }}
                    onFocus={() => setVendorFocused(true)}
                    onBlur={() => setVendorFocused(false)}
                    onKeyPress={(e) => {
                      const k = readKey(e);
                      if (k.key !== 'Enter') return;
                      k.prevent();
                      if (k.ctrl) handleSave();
                      else billNoRef.current?.focus();
                    }}
                    placeholder={type === 'purchase' ? 'Vendor / supplier name' : 'Customer name'}
                    accessibilityLabel={partyLabel}
                    autoFocus={!initial}
                    accent={accent}
                    inputClassName="rounded-lg px-3 py-2.5 text-sm font-semibold text-gray-900"
                    inputStyle={[
                      { borderWidth: 1, borderColor: vendorFocused ? accent : '#D1D5DB', backgroundColor: '#FFFFFF' },
                      vendorFocused ? { boxShadow: `0 0 0 3px ${accent}29` } : null,
                      { outlineStyle: 'none' } as object,
                    ]}
                    adornmentWidth={54}
                    adornment={
                      customerId ? (
                        <Ionicons name="checkmark-circle" size={16} color={accent} />
                      ) : partyName.trim() ? (
                        <Text className="text-[10px] font-bold uppercase text-gray-400">New</Text>
                      ) : null
                    }
                  />
                </View>
                <View style={{ flex: 0.8, minWidth: 0 }}>
                  <Text className="mb-1.5 text-xs font-semibold text-gray-600">Bill No.</Text>
                  <KeyInput
                    value={billNo}
                    onChangeText={setBillNo}
                    inputRef={billNoRef}
                    onEnter={() => billDateRef.current?.focus()}
                    onRequestSave={handleSave}
                    accent={accent}
                    placeholder="e.g. 0234"
                    accessibilityLabel="Bill number"
                  />
                </View>
                <View style={{ flex: 1.1, minWidth: 0 }}>
                  <Text className="mb-1.5 text-xs font-semibold text-gray-600">Bill date</Text>
                  <KeyboardDateInput
                    value={billDate}
                    onChange={setBillDate}
                    inputRef={billDateRef}
                    accent={accent}
                    onEnter={() => itemsTableRef.current?.focusRow(0, 0)}
                    onRequestSave={handleSave}
                  />
                </View>
              </View>
              {showRenameParty && (
                <View className="mt-3 flex-row items-center gap-2">
                  <TextInput
                    value={renamePartyValue}
                    onChangeText={setRenamePartyValue}
                    autoFocus
                    placeholder="Name"
                    placeholderTextColor="#9CA3AF"
                    onKeyPress={(e) => {
                      const k = readKey(e);
                      if (k.key === 'Enter') {
                        k.prevent();
                        handleRenameParty();
                      } else if (k.key === 'Escape') {
                        k.prevent();
                        setShowRenameParty(false);
                      }
                    }}
                    className="flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
                  />
                  <Pressable onPress={handleRenameParty} disabled={renamingParty} hitSlop={8}>
                    <Ionicons name="checkmark-circle" size={22} color="#059669" />
                  </Pressable>
                  <Pressable onPress={() => setShowRenameParty(false)} hitSlop={8}>
                    <Ionicons name="close-circle" size={22} color="#9CA3AF" />
                  </Pressable>
                </View>
              )}
            </View>

            <BillItemsTable
              ref={itemsTableRef}
              items={items}
              products={products}
              financeItems={financeItems ?? []}
              accent={accent}
              onUpdate={updateItem}
              onRemove={removeItem}
              onRequestSave={handleSave}
              onExit={() => discountRef.current?.focus()}
              footer={
                <View
                  className="flex-row flex-wrap border-t border-gray-200 bg-gray-50 px-5 py-4"
                  style={{ columnGap: 28, rowGap: 14, borderBottomLeftRadius: 16, borderBottomRightRadius: 16 }}
                >
                  <View style={{ flex: 1, minWidth: 240 }}>
                    <Text className="mb-1.5 text-xs font-semibold text-gray-600">Remark</Text>
                    <KeyInput
                      value={note}
                      onChangeText={setNote}
                      inputRef={remarkRef}
                      onEnter={() => (saveButtonRef.current as unknown as { focus?: () => void } | null)?.focus?.()}
                      onRequestSave={handleSave}
                      accent={accent}
                      placeholder="Optional"
                      accessibilityLabel="Remark"
                      className="rounded-lg px-3 py-2.5 text-sm text-gray-900"
                    />
                  </View>

                  <View style={{ width: 320 }}>
                    <View className="flex-row items-center justify-between py-1.5">
                      <Text className="text-[13px] text-gray-500">Subtotal</Text>
                      <Text className="text-[13px] font-semibold text-gray-700">NPR {subtotal.toLocaleString()}</Text>
                    </View>
                    <View className="flex-row items-center justify-between py-1">
                      <Text className="text-[13px] text-gray-500">{discountMode === 'percent' ? 'Discount (%)' : 'Discount (Rs)'}</Text>
                      <View className="flex-row items-center" style={{ gap: 8 }}>
                        <View style={{ width: 84 }}>
                          <KeyInput
                            value={discountInputValue}
                            onChangeText={(v) => {
                              if (discountMode === 'percent') setDiscountPercentInput(Number(v) > 100 ? '100' : v);
                              else setDiscountAmountInput(v);
                            }}
                            onKey={(k) => {
                              if (k.ctrl || k.alt) return;
                              const unit = k.key === '%' ? 'percent' : ['r', 'R', 'n', 'N'].includes(k.key) ? 'amount' : null;
                              if (!unit) return;
                              k.prevent();
                              setDiscountUnit(unit);
                              // The converted number comes up selected, so typing replaces it.
                              setTimeout(() => (discountRef.current as unknown as HTMLInputElement | null)?.select?.(), 0);
                            }}
                            inputRef={discountRef}
                            onEnter={() => vatRef.current?.focus()}
                            onRequestSave={handleSave}
                            accent={accent}
                            numeric
                            align="right"
                            placeholder="0"
                            accessibilityLabel={discountMode === 'percent' ? 'Discount percent' : 'Discount in NPR'}
                            className="rounded-lg px-2.5 py-1.5 text-sm font-semibold text-gray-900"
                          />
                        </View>
                        <View
                          className="flex-row overflow-hidden rounded-md border border-gray-300 bg-white"
                          style={{ width: 42 }}
                          accessibilityLabel="Discount unit: percent or rupees (press % or R in the box)"
                        >
                          {(
                            [
                              ['percent', '%'],
                              ['amount', 'Rs'],
                            ] as const
                          ).map(([unit, label]) => {
                            const on = discountMode === unit;
                            return (
                              <Pressable
                                key={unit}
                                onPress={() => setDiscountUnit(unit)}
                                tabIndex={-1}
                                className="flex-1 items-center py-0.5"
                                style={{ backgroundColor: on ? accent : 'transparent' }}
                              >
                                <Text className="text-[11px] font-bold" style={{ color: on ? '#fff' : '#6B7280' }}>
                                  {label}
                                </Text>
                              </Pressable>
                            );
                          })}
                        </View>
                        <Text className="text-right text-[13px] font-semibold text-gray-700" style={{ width: 70 }}>
                          − {discountAmount.toLocaleString()}
                        </Text>
                      </View>
                    </View>
                    <View className="flex-row items-center justify-between py-1">
                      <Text className="text-[13px] text-gray-500">VAT (%)</Text>
                      <View className="flex-row items-center" style={{ gap: 8 }}>
                        <View style={{ width: 84 }}>
                          <KeyInput
                            value={vatPercent}
                            onChangeText={setVatPercent}
                            inputRef={vatRef}
                            onEnter={() => remarkRef.current?.focus()}
                            onRequestSave={handleSave}
                            accent={accent}
                            numeric
                            align="right"
                            accessibilityLabel="VAT percent"
                            className="rounded-lg px-2.5 py-1.5 text-sm font-semibold text-gray-900"
                          />
                        </View>
                        <Pressable
                          onPress={() => setVatPercent('13')}
                          tabIndex={-1}
                          className="items-center rounded-md border border-gray-300 bg-white px-1.5 py-0.5"
                          style={{ width: 42 }}
                          accessibilityLabel="Use standard 13 percent VAT"
                        >
                          <Text className="text-[11px] font-semibold text-gray-500">13%</Text>
                        </Pressable>
                        <Text className="text-right text-[13px] font-semibold text-gray-700" style={{ width: 70 }}>
                          + {vatAmount.toLocaleString()}
                        </Text>
                      </View>
                    </View>
                    <View className="mt-2 flex-row items-center justify-between border-t border-gray-300 pt-2.5">
                      <Text className="text-sm font-bold text-gray-900">G. Total</Text>
                      <Text className="text-xl font-extrabold" style={{ color: TYPE_META[type].color }}>
                        NPR {grandTotal.toLocaleString()}
                      </Text>
                    </View>
                  </View>
                </View>
              }
            />

            <View className="mt-4 flex-row flex-wrap items-center justify-end" style={{ gap: 16 }}>
              <View className="flex-row" style={{ gap: 10 }}>
                <Pressable onPress={onCancel} className="items-center rounded-xl border border-gray-300 bg-white px-6 py-2.5">
                  <Text className="text-sm font-semibold text-gray-600">Cancel</Text>
                </Pressable>
                <Pressable
                  ref={saveButtonRef}
                  onPress={handleSave}
                  disabled={saving}
                  className="items-center rounded-xl px-8 py-2.5 disabled:opacity-50"
                  style={{ backgroundColor: accent, boxShadow: `0 2px 6px ${accentShadow}` }}
                >
                  <Text className="text-sm font-bold text-white">{saving ? 'Saving…' : 'Save'}</Text>
                </Pressable>
              </View>
            </View>
          </View>

          <View style={{ width: 300 }}>
            <RecentEntriesCard userId={userId} type={type} color={TYPE_META[type].color} />
          </View>
        </View>

        {confirmDialog}

        <ContactPickerModal
          visible={showPartyPicker}
          initialQuery={partyPickerQuery}
          customers={customers}
          phoneContacts={phoneContacts.contacts}
          onSelectCustomer={selectCustomer}
          onSelectNew={handleSelectPartyNew}
          onClose={() => setShowPartyPicker(false)}
        />
      </View>
    );
  }

  return (
    <View className="mb-4 rounded-2xl border border-gray-200 bg-white p-4">
      <Pressable
        onPress={handleScan}
        disabled={scanning}
        className="mb-3 flex-row items-center justify-center gap-2 rounded-lg border border-blue-600 bg-blue-50 py-2.5 disabled:opacity-50"
      >
        <Ionicons name={scanning ? 'hourglass-outline' : 'camera-outline'} size={16} color="#2563EB" />
        <Text className="text-sm font-semibold text-blue-700">{scanning ? 'Reading the bill…' : 'Scan Bill'}</Text>
      </Pressable>
      {isBill ? (
        <>
          <FormSection icon="receipt-outline" title="Bill info" first>
            <View className="flex-row gap-2">
              <View className="flex-1">
                <Text className="mb-1 text-xs font-medium text-gray-500">Date</Text>
                <DateField value={billDate} onChange={setBillDate} />
              </View>
              <View className="flex-1">
                <Text className="mb-1 text-xs font-medium text-gray-500">Bill No.</Text>
                <View className="rounded-lg border border-gray-300 bg-white px-3 py-2">
                  <TextInput
                    value={billNo}
                    onChangeText={setBillNo}
                    placeholder="e.g. 0234"
                    placeholderTextColor="#9CA3AF"
                    className="text-xs font-bold text-gray-900"
                    style={{ padding: 0, margin: 0, includeFontPadding: false, textAlignVertical: 'center' }}
                  />
                  <Text className="mt-0.5 text-[10px] text-gray-500"> </Text>
                </View>
              </View>
            </View>
          </FormSection>

          <FormSection icon="person-outline" title={type === 'purchase' ? 'Vendor' : 'Customer'} tight>
            <View className="mb-1 flex-row items-center gap-2">
              <Pressable
                onPress={() => {
                  phoneContacts.request();
                  setPartyPickerQuery('');
                  setShowPartyPicker(true);
                }}
                className="flex-1 flex-row items-center justify-between rounded-lg border border-gray-300 bg-white px-3 py-2.5"
              >
                <Text className={`flex-1 text-sm ${partyName ? 'text-gray-900' : 'text-gray-400'}`} numberOfLines={1}>
                  {partyName || (type === 'purchase' ? 'Vendor/supplier name' : 'Party name')}
                </Text>
                <Ionicons name="chevron-down" size={16} color="#9CA3AF" />
              </Pressable>
              {!!customerId && (
                <Pressable
                  onPress={() => {
                    setRenamePartyValue(partyName);
                    setShowRenameParty(true);
                  }}
                  hitSlop={8}
                  className="rounded-lg border border-gray-300 bg-white p-2.5"
                >
                  <Ionicons name="pencil-outline" size={16} color="#6B7280" />
                </Pressable>
              )}
            </View>
            {showRenameParty && (
              <View className="mb-1 flex-row items-center gap-2">
                <TextInput
                  value={renamePartyValue}
                  onChangeText={setRenamePartyValue}
                  autoFocus
                  placeholder="Name"
                  placeholderTextColor="#9CA3AF"
                  className="flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
                />
                <Pressable onPress={handleRenameParty} disabled={renamingParty} hitSlop={8}>
                  <Ionicons name="checkmark-circle" size={22} color="#059669" />
                </Pressable>
                <Pressable onPress={() => setShowRenameParty(false)} hitSlop={8}>
                  <Ionicons name="close-circle" size={22} color="#9CA3AF" />
                </Pressable>
              </View>
            )}
            <Text className="text-[11px] text-gray-400">
              Required — this bill books against their ledger. Tap to search your saved customers and phone contacts,
              or the pencil to fix a name.
            </Text>
          </FormSection>

          <FormSection icon="cube-outline" title="Items">
            {items.length === 0 && (
              <Text className="mb-2 text-xs text-gray-400">No items yet — tap "+ Add item" below.</Text>
            )}
            {items.map((item, index) => (
              <ItemLineRow
                key={index}
                item={item}
                onEditProduct={() => openItemPicker(index)}
                onQtyChange={(v) => updateItem(index, { ...item, qty: v })}
                onRateChange={(v) => updateItem(index, { ...item, rate: v })}
                onRemove={() => removeItem(index)}
              />
            ))}
            <Pressable
              onPress={() => openItemPicker(null)}
              className="mt-1 flex-row items-center justify-center gap-1.5 rounded-lg bg-orange-500 py-2.5"
            >
              <Ionicons name="add-circle" size={16} color="white" />
              <Text className="text-sm font-semibold text-white">Add item</Text>
            </Pressable>
          </FormSection>

          <FormSection icon="calculator-outline" title="Totals">
            <View className="mb-3 rounded-lg border border-gray-100 bg-gray-50 px-3 py-1">
              <View className="flex-row items-center justify-between py-1.5">
                <Text className="text-xs text-gray-500">Subtotal</Text>
                <Text className="text-xs font-semibold text-gray-700">NPR {subtotal.toLocaleString()}</Text>
              </View>
              {/* The +/close toggle always sits in the same leading spot, whether the row
                  is collapsed or expanded, so tapping it never means aiming at a target
                  that just jumped somewhere else. */}
              <View className="flex-row items-center justify-between border-t border-gray-200 py-1.5">
                <Pressable
                  onPress={() => {
                    if (showDiscount) {
                      setShowDiscount(false);
                      setDiscountAmountInput('0');
                    } else {
                      setShowDiscount(true);
                    }
                  }}
                  className="flex-row items-center gap-1.5"
                >
                  <Ionicons name={showDiscount ? 'close-circle' : 'add-circle'} size={14} color={showDiscount ? '#9CA3AF' : '#EA580C'} />
                  <Text className={`text-xs ${showDiscount ? 'text-gray-500' : 'font-semibold text-orange-600'}`}>Discount</Text>
                </Pressable>
                {showDiscount && (
                  <View className="flex-row items-center gap-2">
                    <TextInput
                      value={discountAmountInput}
                      onChangeText={setDiscountAmountInput}
                      keyboardType="numeric"
                      className="w-14 rounded border border-gray-300 bg-white px-1 py-0.5 text-center text-xs text-gray-900"
                    />
                    <Text className="text-[10px] text-gray-400">({discountPercentDisplay.toFixed(1)}%)</Text>
                    <Text className="w-16 text-right text-xs text-gray-700">− NPR {discountAmount.toLocaleString()}</Text>
                  </View>
                )}
              </View>
              <View className="flex-row items-center justify-between border-t border-gray-200 py-1.5">
                <Pressable
                  onPress={() => {
                    if (showVat) {
                      setShowVat(false);
                      setVatPercent('0');
                    } else {
                      setShowVat(true);
                      setVatPercent((v) => (v === '0' ? '13' : v));
                    }
                  }}
                  className="flex-row items-center gap-1.5"
                >
                  <Ionicons name={showVat ? 'close-circle' : 'add-circle'} size={14} color={showVat ? '#9CA3AF' : '#EA580C'} />
                  <Text className={`text-xs ${showVat ? 'text-gray-500' : 'font-semibold text-orange-600'}`}>VAT</Text>
                </Pressable>
                {showVat && (
                  <View className="flex-row items-center gap-2">
                    <View className="flex-row items-center gap-1">
                      <TextInput
                        value={vatPercent}
                        onChangeText={setVatPercent}
                        keyboardType="numeric"
                        className="w-10 rounded border border-gray-300 bg-white px-1 py-0.5 text-center text-xs text-gray-900"
                      />
                      <Text className="text-[10px] text-gray-400">%</Text>
                    </View>
                    <Text className="w-16 text-right text-xs text-gray-700">+ NPR {vatAmount.toLocaleString()}</Text>
                  </View>
                )}
              </View>
            </View>
            <View className="flex-row items-center justify-between rounded-lg bg-gray-50 px-3 py-2.5">
              <Text className="text-sm font-bold text-gray-900">G. Total</Text>
              <Text className="text-base font-extrabold text-gray-900">NPR {grandTotal.toLocaleString()}</Text>
            </View>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="Remark"
              placeholderTextColor="#9CA3AF"
              className="mt-3 rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900"
            />
          </FormSection>

          <ItemPickerModal
            visible={showItemPicker}
            products={products}
            financeItems={financeItems ?? []}
            onPick={handlePickProduct}
            onPickFinanceItem={handlePickFinanceItem}
            onPickCustom={handlePickCustomItem}
            onClose={() => {
              setShowItemPicker(false);
              setEditingItemIndex(null);
            }}
          />
        </>
      ) : (
        <>
          <FormSection icon="document-text-outline" title="Details" first>
            <Text className="mb-1 text-xs font-medium text-gray-500">Date</Text>
            <View className="mb-2.5">
              <DateField value={expenseDate} onChange={setExpenseDate} />
            </View>

            <Text className="mb-1 text-xs font-medium text-gray-500">Name</Text>
            <View className="flex-row items-center gap-2">
              <Pressable
                onPress={() => {
                  phoneContacts.request();
                  setPartyPickerQuery('');
                  setShowPartyPicker(true);
                }}
                className="flex-1 flex-row items-center justify-between rounded-lg border border-gray-300 bg-white px-3 py-2.5"
              >
                <Text className={`flex-1 text-sm ${partyName ? 'text-gray-900' : 'text-gray-400'}`} numberOfLines={1}>
                  {partyName || 'Who was this paid to?'}
                </Text>
                <Ionicons name="chevron-down" size={16} color="#9CA3AF" />
              </Pressable>
              {!!customerId && (
                <Pressable
                  onPress={() => {
                    setRenamePartyValue(partyName);
                    setShowRenameParty(true);
                  }}
                  hitSlop={8}
                  className="rounded-lg border border-gray-300 bg-white p-2.5"
                >
                  <Ionicons name="pencil-outline" size={16} color="#6B7280" />
                </Pressable>
              )}
            </View>
            {showRenameParty && (
              <View className="mb-1 mt-1 flex-row items-center gap-2">
                <TextInput
                  value={renamePartyValue}
                  onChangeText={setRenamePartyValue}
                  autoFocus
                  placeholder="Name"
                  placeholderTextColor="#9CA3AF"
                  className="flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
                />
                <Pressable onPress={handleRenameParty} disabled={renamingParty} hitSlop={8}>
                  <Ionicons name="checkmark-circle" size={22} color="#059669" />
                </Pressable>
                <Pressable onPress={() => setShowRenameParty(false)} hitSlop={8}>
                  <Ionicons name="close-circle" size={22} color="#9CA3AF" />
                </Pressable>
              </View>
            )}
            <Text className="mb-2.5 mt-1 text-[11px] text-gray-400">
              Tap to search your saved customers and phone contacts.
            </Text>

            <Text className="mb-1 text-xs font-medium text-gray-500">Expense category</Text>
            <Pressable
              onPress={() => setShowCategoryPicker(true)}
              className="flex-row items-center justify-between rounded-lg border border-gray-300 px-3 py-2.5"
            >
              <Text className={`text-sm ${selectedCategory ? 'text-gray-900' : 'text-gray-400'}`}>
                {selectedCategory?.name ?? 'Select a category'}
              </Text>
              <Ionicons name="chevron-down" size={16} color="#9CA3AF" />
            </Pressable>
          </FormSection>

          <FormSection icon="cash-outline" title="Amount">
            <Text className="mb-1 text-xs font-medium text-gray-500">Amount (NPR)</Text>
            <TextInput
              value={amount}
              onChangeText={setAmount}
              placeholder="e.g. 500"
              placeholderTextColor="#9CA3AF"
              keyboardType="numeric"
              className="mb-2.5 rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900"
            />
            <Text className="mb-1 text-xs font-medium text-gray-500">Remark (optional)</Text>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="e.g. Office rent"
              placeholderTextColor="#9CA3AF"
              className="rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900"
            />
          </FormSection>

          <CategoryPickerModal
            visible={showCategoryPicker}
            categories={categories ?? []}
            selectedId={categoryId}
            onSelect={setCategoryId}
            onClose={() => setShowCategoryPicker(false)}
            onCreate={handleCreateCategory}
            onRename={handleRenameCategory}
            onDelete={handleDeleteCategory}
          />
        </>
      )}

      {type === 'expense' && (
        <FormSection icon="wallet-outline" title="Payment method">
          <Pressable
            onPress={() => setShowAccountPicker(true)}
            className="flex-row items-center justify-between rounded-lg border border-gray-300 px-3 py-2.5"
          >
            <View className="flex-row items-center gap-2">
              <Ionicons name={bankAccountId ? 'business-outline' : 'cash-outline'} size={16} color="#6B7280" />
              <Text className="text-sm text-gray-900">{selectedAccountName}</Text>
            </View>
            <Ionicons name="chevron-down" size={16} color="#9CA3AF" />
          </Pressable>
        </FormSection>
      )}
      <BankAccountPickerModal
        visible={showAccountPicker}
        accounts={bankAccounts.accounts}
        selectedId={bankAccountId}
        onSelect={setBankAccountId}
        onClose={() => setShowAccountPicker(false)}
        onRename={bankAccounts.rename}
        onDelete={bankAccounts.remove}
      />
      {confirmDialog}
      <ContactPickerModal
        visible={showPartyPicker}
        initialQuery={partyPickerQuery}
        customers={customers}
        phoneContacts={phoneContacts.contacts}
        onSelectCustomer={selectCustomer}
        onSelectNew={handleSelectPartyNew}
        onClose={() => setShowPartyPicker(false)}
      />
      <View className="flex-row gap-2">
        <Pressable onPress={onCancel} className="flex-1 items-center rounded-lg border border-gray-300 py-2.5">
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

function TransactionRow({
  tx,
  categoryName,
  bankAccountName,
  onPress,
  onDelete,
}: {
  tx: BusinessTransaction;
  categoryName: string | null;
  bankAccountName: string | null;
  onPress: () => void;
  onDelete: () => void;
}) {
  const meta = TYPE_META[tx.type];
  const accountLabel = tx.bank_account_id ? bankAccountName ?? 'Bank' : 'Cash';
  return (
    <Pressable onPress={onPress} className="mb-2.5 flex-row items-center gap-3 rounded-2xl border border-gray-200 bg-white p-4">
      <View className={`h-9 w-9 items-center justify-center rounded-full ${meta.bg}`}>
        <Ionicons name={meta.icon} size={16} color={meta.color} />
      </View>
      <View className="flex-1">
        <Text className="text-sm font-semibold text-gray-900">
          {meta.label}
          {tx.party_name ? ` · ${tx.party_name}` : ''}
          {tx.bill_no ? ` · Bill #${tx.bill_no}` : ''}
          {categoryName ? ` · ${categoryName}` : ''}
        </Text>
        <Text className="text-xs text-gray-400" numberOfLines={1}>
          {[
            tx.items.length > 0 ? `${tx.items.length} item${tx.items.length === 1 ? '' : 's'}` : tx.note,
            toBsHistoryLabel(tx.bill_date ?? tx.created_at),
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      </View>
      <View className="items-end">
        <Text className="text-sm font-extrabold" style={{ color: meta.color }}>
          NPR {tx.amount.toLocaleString()}
        </Text>
        {tx.type === 'expense' && (
          <View className="mt-0.5 flex-row items-center gap-1">
            <Ionicons name={tx.bank_account_id ? 'business-outline' : 'cash-outline'} size={10} color="#9CA3AF" />
            <Text className="text-[10px] text-gray-400" numberOfLines={1}>
              {accountLabel}
            </Text>
          </View>
        )}
      </View>
      <Pressable onPress={onDelete} hitSlop={8} className="ml-1">
        <Ionicons name="trash-outline" size={16} color="#9CA3AF" />
      </Pressable>
    </Pressable>
  );
}

// A read-only receipt view - tapping a past transaction should let you see
// what's in it without immediately dropping into an editable form. Edit is
// an explicit action from here, not the default. Exported so a customer/
// vendor's own page (CustomerDetailScreen) can reuse the same organized
// detail view for a linked bill instead of building a second one.
export function TransactionDetailModal({
  tx,
  categoryName,
  bankAccountName,
  onClose,
  onEdit,
}: {
  tx: BusinessTransaction | null;
  categoryName: string | null;
  bankAccountName: string | null;
  onClose: () => void;
  onEdit: () => void;
}) {
  if (!tx) return null;
  const meta = TYPE_META[tx.type];
  const accountLabel = tx.bank_account_id ? bankAccountName ?? 'Bank' : 'Cash';
  const isBill = tx.type !== 'expense';

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 items-center justify-center bg-black/40 px-6" onPress={onClose}>
        <Pressable onPress={() => {}} className="w-full max-w-sm rounded-2xl bg-white" style={{ maxHeight: '85%' }}>
          <ScrollView contentContainerStyle={{ padding: 18 }}>
            <View className="mb-3 flex-row items-center justify-between">
              <View className="flex-row items-center gap-2">
                <View className={`h-8 w-8 items-center justify-center rounded-full ${meta.bg}`}>
                  <Ionicons name={meta.icon} size={15} color={meta.color} />
                </View>
                <Text className="text-base font-bold text-gray-900">{meta.label}</Text>
              </View>
              <Pressable onPress={onClose} hitSlop={8}>
                <Ionicons name="close" size={20} color="#6B7280" />
              </Pressable>
            </View>

            <Text className="mb-4 text-2xl font-extrabold" style={{ color: meta.color }}>
              NPR {tx.amount.toLocaleString()}
            </Text>

            {isBill && !!tx.bill_no && (
              <View className="mb-2 flex-row justify-between">
                <Text className="text-xs text-gray-400">Bill No.</Text>
                <Text className="text-xs font-medium text-gray-900">{tx.bill_no}</Text>
              </View>
            )}
            {!!tx.bill_date && (
              <View className="mb-2 flex-row justify-between">
                <Text className="text-xs text-gray-400">Date</Text>
                <View className="items-end">
                  <Text className="text-xs font-bold text-gray-900">{toBsLabel(tx.bill_date)}</Text>
                  <Text className="text-[10px] text-gray-400">{new Date(tx.bill_date).toLocaleDateString()}</Text>
                </View>
              </View>
            )}
            {!!tx.party_name && (
              <View className="mb-2 flex-row justify-between">
                <Text className="text-xs text-gray-400">{tx.type === 'purchase' ? 'Vendor' : tx.type === 'expense' ? 'Paid to' : 'Party'}</Text>
                <Text className="text-xs font-medium text-gray-900">{tx.party_name}</Text>
              </View>
            )}
            {!!tx.party_address && (
              <View className="mb-2 flex-row justify-between">
                <Text className="text-xs text-gray-400">Address</Text>
                <Text className="flex-1 text-right text-xs font-medium text-gray-900">{tx.party_address}</Text>
              </View>
            )}
            {!!tx.vat_pan_no && (
              <View className="mb-2 flex-row justify-between">
                <Text className="text-xs text-gray-400">VAT/PAN</Text>
                <Text className="text-xs font-medium text-gray-900">{tx.vat_pan_no}</Text>
              </View>
            )}
            {!!categoryName && (
              <View className="mb-2 flex-row justify-between">
                <Text className="text-xs text-gray-400">Category</Text>
                <Text className="text-xs font-medium text-gray-900">{categoryName}</Text>
              </View>
            )}
            {tx.type === 'expense' && (
              <View className="mb-3 flex-row justify-between">
                <Text className="text-xs text-gray-400">Payment account</Text>
                <Text className="text-xs font-medium text-gray-900">{accountLabel}</Text>
              </View>
            )}

            {tx.items.length > 0 && (
              <View className="mb-3 rounded-xl border border-gray-100 bg-gray-50 p-3">
                <Text className="mb-2 text-xs font-semibold text-gray-500">Items</Text>
                {tx.items.map((item, idx) => (
                  <View key={idx} className="mb-1.5 flex-row items-center justify-between">
                    <Text className="flex-1 pr-2 text-xs text-gray-700" numberOfLines={2}>
                      {item.description} × {item.qty}
                    </Text>
                    <Text className="text-xs font-semibold text-gray-900">NPR {item.amount.toLocaleString()}</Text>
                  </View>
                ))}
                {(tx.discount_amount > 0 || tx.vat_amount > 0) && (
                  <View className="mt-2 border-t border-gray-200 pt-2">
                    {tx.discount_amount > 0 && (
                      <View className="mb-1 flex-row justify-between">
                        <Text className="text-xs text-gray-400">Discount</Text>
                        <Text className="text-xs text-gray-700">− NPR {tx.discount_amount.toLocaleString()}</Text>
                      </View>
                    )}
                    {tx.vat_amount > 0 && (
                      <View className="flex-row justify-between">
                        <Text className="text-xs text-gray-400">VAT</Text>
                        <Text className="text-xs text-gray-700">+ NPR {tx.vat_amount.toLocaleString()}</Text>
                      </View>
                    )}
                  </View>
                )}
                <View className="mt-2 flex-row justify-between border-t border-gray-200 pt-2">
                  <Text className="text-xs font-bold text-gray-900">Total</Text>
                  <Text className="text-xs font-bold text-gray-900">NPR {tx.amount.toLocaleString()}</Text>
                </View>
              </View>
            )}

            {!!tx.note && (
              <View className="mb-3">
                <Text className="mb-0.5 text-xs text-gray-400">Note</Text>
                <Text className="text-xs text-gray-700">{tx.note}</Text>
              </View>
            )}

            <Pressable
              onPress={onEdit}
              className="mt-2 flex-row items-center justify-center gap-1.5 rounded-lg bg-orange-500 py-3"
            >
              <Ionicons name="pencil" size={14} color="white" />
              <Text className="text-sm font-semibold text-white">Edit</Text>
            </Pressable>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// `date` is the transaction's own date (bill_date/entry_date) where it has
// one, falling back to created_at only for entries that don't - editing a
// Sale/Purchase's date (or a ledger entry's) used to leave it grouped and
// sorted under whichever day it was first *entered*, so an old bill's date
// edited to a past day would still show up under "Today" if that's when it
// was typed in.
export type FeedItem =
  | { kind: 'business'; id: string; date: string; tx: BusinessTransaction }
  | { kind: 'ledger'; id: string; date: string; entry: CustomerLedgerEntry; customerName: string | null }
  | { kind: 'vendor'; id: string; date: string; entry: VendorLedgerEntry; vendorName: string | null }
  | { kind: 'transfer'; id: string; date: string; transfer: AccountTransfer };

// "Today" / "Yesterday" / "N days ago" for anything in the past; falls back
// to a plain date for anything future-dated (shouldn't normally happen).
function dayLabel(dateStr: string): string {
  const d = new Date(dateStr);
  const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const diffDays = Math.round((todayStart - dayStart) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays > 1) return `${diffDays} days ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function LedgerRow({ item, customerName, basePath }: { item: CustomerLedgerEntry; customerName: string | null; basePath?: string }) {
  const isDebit = item.entry_type === 'debit';
  // Money we gave the customer is red; money they paid, or still owe us, is green.
  const isOut = isDebit && item.source === 'manual';
  return (
    <Pressable
      onPress={() => basePath && router.push(`${basePath}/customer/${item.customer_id}` as any)}
      className="mb-2.5 flex-row items-center gap-3 rounded-2xl border border-gray-200 bg-white p-4"
    >
      <View className={`h-9 w-9 items-center justify-center rounded-full ${isOut ? 'bg-red-50' : 'bg-emerald-50'}`}>
        <Ionicons name={isDebit ? 'arrow-up' : 'arrow-down'} size={16} color={isOut ? '#DC2626' : '#059669'} />
      </View>
      <View className="flex-1">
        <Text className="text-sm font-semibold text-gray-900" numberOfLines={1}>
          {isDebit ? 'Owes' : 'Paid'} · {customerName ?? 'Unknown customer'}
        </Text>
        <Text className="text-xs text-gray-400" numberOfLines={1}>
          {item.note ?? (item.source === 'booking' ? 'From a booked job' : 'Manual entry')} ·{' '}
          {toBsHistoryLabel(item.entry_date ?? item.created_at)}
        </Text>
      </View>
      <Text className="text-sm font-extrabold" style={{ color: isOut ? '#DC2626' : '#059669' }}>
        NPR {item.amount.toLocaleString()}
      </Text>
    </Pressable>
  );
}

function VendorFeedRow({ item, vendorName, basePath }: { item: VendorLedgerEntry; vendorName: string | null; basePath?: string }) {
  const isDebit = item.entry_type === 'debit';
  return (
    <Pressable
      onPress={() => basePath && router.push(`${basePath}/customer/${item.vendor_id}` as any)}
      className="mb-2.5 flex-row items-center gap-3 rounded-2xl border border-orange-100 bg-white p-4"
    >
      <View className={`h-9 w-9 items-center justify-center rounded-full bg-red-50`}>
        <Ionicons name={isDebit ? 'cart-outline' : 'arrow-down'} size={16} color="#DC2626" />
      </View>
      <View className="flex-1">
        <Text className="text-sm font-semibold text-gray-900" numberOfLines={1}>
          {isDebit ? 'Bought on credit' : 'You paid'} · {vendorName ?? 'Unknown vendor'}
        </Text>
        <Text className="text-xs text-gray-400" numberOfLines={1}>
          {item.note ?? (item.source === 'booking' ? 'From a credit purchase' : 'Manual entry')} ·{' '}
          {toBsHistoryLabel(item.entry_date ?? item.created_at)}
        </Text>
      </View>
      <Text className="text-sm font-extrabold" style={{ color: '#DC2626' }}>
        NPR {item.amount.toLocaleString()}
      </Text>
    </Pressable>
  );
}

// Moving money between the business's own accounts - not a Sale, Purchase,
// Expense, or party payment (see 0064_account_transfers.sql), so it's shown
// plainly here rather than tinted like the money-earned/spent rows around
// it, and tapping it offers to remove it instead of navigating anywhere.
function TransferFeedRow({
  transfer,
  accountName,
  onDelete,
}: {
  transfer: AccountTransfer;
  accountName: (id: string | null) => string;
  onDelete: () => void;
}) {
  return (
    <Pressable
      onPress={() =>
        showAlert('Remove this transfer?', 'This undoes the move between your accounts.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Remove', style: 'destructive', onPress: onDelete },
        ])
      }
      className="mb-2.5 flex-row items-center gap-3 rounded-2xl border border-gray-200 bg-white p-4"
    >
      <View className="h-9 w-9 items-center justify-center rounded-full bg-blue-50">
        <Ionicons name="swap-horizontal" size={16} color="#2563EB" />
      </View>
      <View className="flex-1">
        <Text className="text-sm font-semibold text-gray-900" numberOfLines={1}>
          Transfer · {accountName(transfer.from_account_id)} → {accountName(transfer.to_account_id)}
        </Text>
        <Text className="text-xs text-gray-400" numberOfLines={1}>
          {transfer.note ?? 'Between your own accounts'} · {toBsHistoryLabel(transfer.transfer_date ?? transfer.created_at)}
        </Text>
      </View>
      <Text className="text-sm font-extrabold text-gray-900">NPR {transfer.amount.toLocaleString()}</Text>
    </Pressable>
  );
}

export function TransactionsScreen({ basePath }: { basePath?: string }) {
  // voice* params arrive from Sagar AI Assistant (see FloatingAssistantChat)
  // - a spoken or typed command gets routed here the same way a Shortcuts
  // tap does (?type=...&add=1), just with these extra fields for
  // TransactionForm to pre-fill on that first render.
  const {
    type: typeParam,
    add: addParam,
    voiceAmount,
    voiceParty,
    voiceDate,
    voiceNote,
  } = useLocalSearchParams<{
    type?: string;
    add?: string;
    voiceAmount?: string;
    voiceParty?: string;
    voiceDate?: string;
    voiceNote?: string;
  }>();
  // Memoized on the actual param values (not recreated every render) so the
  // form's effect below can safely depend on this object's identity instead
  // of only running "on mount" - Expo Router doesn't always have these
  // hydrated on the very first render of a freshly-pushed route, so a plain
  // object literal here would otherwise still leave that first mount effect
  // seeing stale/empty values with no second chance to pick up the real ones.
  const voicePrefill = useMemo(
    () =>
      voiceAmount || voiceParty || voiceDate || voiceNote
        ? { amount: voiceAmount, party: voiceParty, date: voiceDate, note: voiceNote }
        : null,
    [voiceAmount, voiceParty, voiceDate, voiceNote]
  );
  const userId = useAuthStore((state) => state.session?.user.id);
  const role = useRole();
  const { data: products } = useSupabaseQuery('products', {
    filters: userId && role ? { seller_id: userId, seller_role: role } : {},
    enabled: !!userId && !!role,
  });
  const { data: transactions } = useSupabaseQuery('business_transactions', {
    filters: userId ? { owner_id: userId } : {},
    orderBy: { column: 'created_at', ascending: false },
    enabled: !!userId,
  });
  const { data: ledgerEntries } = useSupabaseQuery('customer_ledger_entries', {
    filters: userId ? { owner_id: userId } : {},
    orderBy: { column: 'created_at', ascending: false },
    enabled: !!userId,
  });
  const { data: vendorLedgerEntries } = useSupabaseQuery('vendor_ledger_entries', {
    filters: userId ? { owner_id: userId } : {},
    orderBy: { column: 'created_at', ascending: false },
    enabled: !!userId,
  });
  const { data: transfers } = useSupabaseQuery('account_transfers', {
    filters: userId ? { owner_id: userId } : {},
    orderBy: { column: 'created_at', ascending: false },
    enabled: !!userId,
  });
  const deleteTransfer = useSupabaseDelete('account_transfers');
  const { data: customers } = useSupabaseQuery('customers', {
    filters: userId ? { owner_id: userId } : {},
    enabled: !!userId,
  });
  const { data: categories } = useSupabaseQuery('expense_categories', {
    filters: userId ? { owner_id: userId } : {},
    enabled: !!userId,
  });
  const bankAccounts = useBankAccounts(userId);
  const deleteTx = useSupabaseDelete('business_transactions');

  const customerNameById = useMemo(() => {
    const map = new Map<string, string>();
    (customers ?? []).forEach((c) => map.set(c.id, c.name));
    return map;
  }, [customers]);

  const categoryNameById = useMemo(() => {
    const map = new Map<string, string>();
    (categories ?? []).forEach((c) => map.set(c.id, c.name));
    return map;
  }, [categories]);

  const bankAccountNameById = useMemo(() => {
    const map = new Map<string, string>();
    bankAccounts.accounts.forEach((a) => map.set(a.id, a.name));
    return map;
  }, [bankAccounts.accounts]);

  // Previously used expense payee names, so the Name field can suggest one
  // instead of always starting from scratch.
  const existingExpenseNames = useMemo(() => {
    const names = new Set<string>();
    (transactions ?? []).forEach((t) => {
      if (t.type === 'expense' && t.party_name) names.add(t.party_name);
    });
    return Array.from(names);
  }, [transactions]);

  const initialFilter = (typeParam as BusinessTransactionType) && ['sale', 'purchase', 'expense'].includes(typeParam ?? '')
    ? (typeParam as BusinessTransactionType)
    : 'all';
  // Only an explicit ?add=1 (set by the Shortcuts icons) means "open the
  // form to add one." Arriving at a type-locked view any other way (the
  // Sales/Purchase/Expense dashboard cards) is a view-only visit - entries
  // are only ever added from Shortcuts.
  const isAddFlow = addParam === '1';
  const [filter, setFilter] = useState<'all' | BusinessTransactionType>(initialFilter);
  const [showForm, setShowForm] = useState(isAddFlow);
  // Bumped after each save in the web quick-add flow so the form remounts
  // empty (see onDone below) instead of closing to the history list.
  const [formKey, setFormKey] = useState(0);
  const [editingTx, setEditingTx] = useState<BusinessTransaction | null>(null);
  const [viewingTx, setViewingTx] = useState<BusinessTransaction | null>(null);
  // The form renders inside the list's own header, so opening it while
  // scrolled down through history (which is exactly when someone taps Edit
  // on an older entry) leaves it off-screen above the current scroll
  // position - scroll back to the top whenever it opens so it's actually
  // visible instead of looking like nothing happened.
  const listRef = useRef<KeyboardAwareSectionList>(null);
  function openForm(tx: BusinessTransaction | null) {
    setEditingTx(tx);
    setShowForm(true);
    setTimeout(() => listRef.current?.scrollToPosition(0, 0, true), 0);
  }

  // Expo Router reuses this same screen instance when navigating between
  // shortcuts that share this route (Sales/Purchase/Expense/Net
  // Balance/Transactions all point here with a different or absent ?type=),
  // so the state above - set from typeParam only on first mount - would
  // otherwise go stale: the form would keep showing whatever type/filter was
  // active before, no matter which shortcut was actually tapped. Re-sync
  // whenever the param itself changes instead.
  useEffect(() => {
    setFilter(initialFilter);
    setShowForm(isAddFlow);
    setEditingTx(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeParam, addParam]);

  // Arriving with a specific ?type= (from the Sales/Purchase/Expense
  // shortcuts or dashboard cards) means "show me only this" - lock the view
  // to that one type instead of dropping the reseller into the shared
  // All/Sales/Purchase/Expense hub they'd then have to filter themselves.
  // The Transactions shortcut (no type param) still opens that full hub.
  const isLockedToType = !!typeParam && initialFilter !== 'all';
  // The form auto-opens on arrival only for the Shortcuts add flow - there's
  // nothing else to do there once it's dismissed (no + button to reopen it,
  // by design), so dismissing it should leave the screen entirely instead of
  // stranding the reseller on a dead end they'd have to back out of anyway.
  // Editing an existing row (tapped from the list) is a different flow and
  // should just close back to that list.
  const isQuickAddFlow = isLockedToType && isAddFlow && !editingTx;

  // Pressing the Android hardware back button while editing an existing
  // entry should close the form and stay on the list; during the locked
  // view's auto-opened quick-add form, let the default back navigation
  // happen instead of closing to a dead end with no way to reopen it.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (viewingTx) {
        setViewingTx(null);
        return true;
      }
      if (showForm && !isQuickAddFlow) {
        setShowForm(false);
        setEditingTx(null);
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [showForm, isQuickAddFlow, viewingTx]);

  // "All" is a full daily feed across every money-moving table (general
  // sales/purchase/expense entries plus per-customer debit/credit entries),
  // newest first. The type filters stay business_transactions-only, since
  // ledger entries don't have a sale/purchase/expense dimension.
  const feed = useMemo((): FeedItem[] => {
    if (filter !== 'all') {
      return (transactions ?? [])
        .filter((t) => t.type === filter)
        .map((tx) => ({ kind: 'business' as const, id: tx.id, date: tx.bill_date ?? tx.created_at, tx }))
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }
    const businessItems: FeedItem[] = (transactions ?? []).map((tx) => ({
      kind: 'business',
      id: tx.id,
      date: tx.bill_date ?? tx.created_at,
      tx,
    }));
    // Skip entries auto-synced from a Sale/Purchase's own ledger debt (see
    // 0061_sale_purchase_always_ledger.sql) - the business_transactions row
    // above already represents that bill, so showing both here would be the
    // same bill twice.
    const isAutoSyncedFromBill = (source: string, sourceType: string | null) => source === 'booking' && sourceType === 'business_transaction';
    const ledgerItems: FeedItem[] = (ledgerEntries ?? [])
      .filter((entry) => !isAutoSyncedFromBill(entry.source, entry.source_type))
      .map((entry) => ({
        kind: 'ledger',
        id: entry.id,
        date: entry.entry_date ?? entry.created_at,
        entry,
        customerName: customerNameById.get(entry.customer_id) ?? null,
      }));
    const vendorItems: FeedItem[] = (vendorLedgerEntries ?? [])
      .filter((entry) => !isAutoSyncedFromBill(entry.source, entry.source_type))
      .map((entry) => ({
        kind: 'vendor',
        id: entry.id,
        date: entry.entry_date ?? entry.created_at,
        entry,
        vendorName: customerNameById.get(entry.vendor_id) ?? null,
      }));
    const transferItems: FeedItem[] = (transfers ?? []).map((transfer) => ({
      kind: 'transfer',
      id: transfer.id,
      date: transfer.transfer_date ?? transfer.created_at,
      transfer,
    }));
    return [...businessItems, ...ledgerItems, ...vendorItems, ...transferItems].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );
  }, [transactions, ledgerEntries, vendorLedgerEntries, transfers, customerNameById, filter]);

  // feed is already newest-first, so grouping by day label as we walk it
  // naturally keeps each day's items together in one contiguous section.
  const sections = useMemo(() => {
    const groups: { title: string; data: FeedItem[] }[] = [];
    for (const item of feed) {
      const title = dayLabel(item.date);
      const lastGroup = groups[groups.length - 1];
      if (lastGroup && lastGroup.title === title) {
        lastGroup.data.push(item);
      } else {
        groups.push({ title, data: [item] });
      }
    }
    return groups;
  }, [feed]);

  // On web the open form already lists recent entries down its right side,
  // so repeating the whole history underneath it showed the same statement
  // twice - see RecentEntriesCard.
  const hideFeed = showForm && Platform.OS === 'web';

  function handleDelete(tx: BusinessTransaction) {
    showAlert('Delete this transaction?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteTx.mutate(tx.id) },
    ]);
  }

  // Web: the list view is a Day Book style cash-book table (the entry form
  // keeps its own layout below). Phones keep the card list.
  if (Platform.OS === 'web' && !showForm) {
    return (
      <>
        <TransactionsBook
          feed={feed}
          filters={FILTERS}
          filter={filter}
          onFilter={setFilter}
          locked={isLockedToType}
          title={isLockedToType ? `${TYPE_META[initialFilter].label}s` : 'Statement'}
          onBack={isLockedToType ? () => router.back() : undefined}
          basePath={basePath}
          categoryNameById={categoryNameById}
          bankAccountNameById={bankAccountNameById}
          accountName={(id) => (id ? (bankAccountNameById.get(id) ?? 'Bank') : 'Cash')}
          onOpenTx={setViewingTx}
          onDeleteTx={handleDelete}
          onDeleteTransfer={(transfer) =>
            showAlert('Remove this transfer?', 'This undoes the move between your accounts.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Remove', style: 'destructive', onPress: () => deleteTransfer.mutate(transfer.id) },
            ])
          }
        />
        <TransactionDetailModal
          tx={viewingTx}
          categoryName={viewingTx?.expense_category_id ? categoryNameById.get(viewingTx.expense_category_id) ?? null : null}
          bankAccountName={viewingTx?.bank_account_id ? bankAccountNameById.get(viewingTx.bank_account_id) ?? null : null}
          onClose={() => setViewingTx(null)}
          onEdit={() => {
            setViewingTx(null);
            openForm(viewingTx);
          }}
        />
      </>
    );
  }

  return (
    <View className="flex-1 bg-gray-50 px-6 pt-4">
      <KeyboardAwareSectionList
        ref={listRef}
        enableOnAndroid
        extraScrollHeight={20}
        sections={hideFeed ? [] : sections}
        keyExtractor={(item) => `${item.kind}-${item.id}`}
        ListHeaderComponent={
          <>
            {/* On web the top bar already carries the name. */}
            {Platform.OS !== 'web' && (
            <View className="mb-3 flex-row items-center justify-between">
              {isLockedToType ? (
                <View className="flex-row items-center gap-2">
                  <Pressable
                    onPress={() => {
                      if (showForm && !isQuickAddFlow) {
                        setShowForm(false);
                        setEditingTx(null);
                      } else {
                        router.back();
                      }
                    }}
                    hitSlop={8}
                    className="p-1"
                  >
                    <Ionicons name="chevron-back" size={20} color="#374151" />
                  </Pressable>
                  <Text className="text-base font-bold text-gray-900">{TYPE_META[initialFilter].label}</Text>
                </View>
              ) : (
                <View className="flex-row gap-2">
                  {FILTERS.map((f) => {
                    const selected = filter === f.key;
                    return (
                      <Pressable
                        key={f.key}
                        onPress={() => setFilter(f.key)}
                        className={`rounded-full px-3 py-1.5 ${selected ? 'bg-orange-500' : 'bg-white border border-gray-200'}`}
                      >
                        <Text className={`text-xs font-semibold ${selected ? 'text-white' : 'text-gray-600'}`}>
                          {f.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}
              {!isLockedToType && (
                <Pressable
                  onPress={() => {
                    setEditingTx(null);
                    setShowForm((v) => !v);
                  }}
                  className="h-10 w-10 items-center justify-center rounded-2xl bg-orange-500"
                >
                  <Ionicons name={showForm ? 'close' : 'add'} size={20} color="white" />
                </Pressable>
              )}
            </View>
            )}

            {!(showForm && isQuickAddFlow) && (
              <TrendChartCard key={filter} transactions={transactions ?? []} metrics={[filter]} />
            )}

            {showForm && userId && (
              <TransactionForm
                key={`${editingTx?.id ?? (filter === 'all' ? 'sale' : filter)}-${formKey}`}
                userId={userId}
                initial={editingTx ?? undefined}
                type={editingTx?.type ?? (filter === 'all' ? 'sale' : filter)}
                existingNames={existingExpenseNames}
                customers={customers ?? []}
                products={products ?? []}
                voicePrefill={editingTx || formKey > 0 ? null : voicePrefill}
                onDone={() => {
                  // Entering several bills in a row is the whole point of
                  // the web entry screen: stay on it with a blank form and a
                  // quick confirmation, rather than dropping back to history.
                  if (Platform.OS === 'web' && isQuickAddFlow) {
                    showAlert(`${TYPE_META[initialFilter].label} saved`, 'The form is ready for the next entry.');
                    setFormKey((k) => k + 1);
                    setTimeout(() => listRef.current?.scrollToPosition(0, 0, true), 0);
                    return;
                  }
                  setShowForm(false);
                  setEditingTx(null);
                  if (isQuickAddFlow) router.back();
                }}
                onCancel={() => {
                  setShowForm(false);
                  setEditingTx(null);
                  if (isQuickAddFlow) router.back();
                }}
              />
            )}
          </>
        }
        renderSectionHeader={({ section }) => (
          <Text className="mb-2 mt-3 text-xs font-bold uppercase tracking-wide text-gray-400">{section.title}</Text>
        )}
        renderItem={({ item }) =>
          item.kind === 'business' ? (
            <TransactionRow
              tx={item.tx}
              categoryName={item.tx.expense_category_id ? categoryNameById.get(item.tx.expense_category_id) ?? null : null}
              bankAccountName={item.tx.bank_account_id ? bankAccountNameById.get(item.tx.bank_account_id) ?? null : null}
              onPress={() => setViewingTx(item.tx)}
              onDelete={() => handleDelete(item.tx)}
            />
          ) : item.kind === 'ledger' ? (
            <LedgerRow item={item.entry} customerName={item.customerName} basePath={basePath} />
          ) : item.kind === 'vendor' ? (
            <VendorFeedRow item={item.entry} vendorName={item.vendorName} basePath={basePath} />
          ) : (
            <TransferFeedRow
              transfer={item.transfer}
              accountName={(id) => (id ? bankAccountNameById.get(id) ?? 'Bank' : 'Cash')}
              onDelete={() => deleteTransfer.mutate(item.transfer.id)}
            />
          )
        }
        stickySectionHeadersEnabled={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: 40 }}
        ListEmptyComponent={
          // While the web form is open the list is deliberately empty (the
          // form's own right column carries the recent entries), so there's
          // nothing missing to announce.
          hideFeed ? null : (
            <View className="items-center rounded-2xl border border-dashed border-gray-200 bg-white py-10">
              <Ionicons name="cash-outline" size={28} color="#D1D5DB" />
              <Text className="mt-2 text-gray-500">No transactions yet.</Text>
            </View>
          )
        }
      />

      <TransactionDetailModal
        tx={viewingTx}
        categoryName={viewingTx?.expense_category_id ? categoryNameById.get(viewingTx.expense_category_id) ?? null : null}
        bankAccountName={viewingTx?.bank_account_id ? bankAccountNameById.get(viewingTx.bank_account_id) ?? null : null}
        onClose={() => setViewingTx(null)}
        onEdit={() => {
          setViewingTx(null);
          openForm(viewingTx);
        }}
      />
    </View>
  );
}
