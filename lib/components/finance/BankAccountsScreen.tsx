// lib/components/finance/BankAccountsScreen.tsx
import { useState } from 'react';
import { View, Text, Pressable, TextInput, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../hooks/useAuth';
import { useBankAccounts, type BankAccountDetails } from '../../hooks/useBankAccounts';
import { showAlert, getErrorMessage } from '../../utils/alert';
import { ToolbarButton, useBarActions, useBookLayout } from './BookKit';
import type { BankAccount } from '../../../types/database.types';

const EMPTY_DETAILS: BankAccountDetails = { name: '', bank_name: null, account_number: null, account_holder_name: null, address: null };

function toDetails(acc: BankAccount): BankAccountDetails {
  return {
    name: acc.name,
    bank_name: acc.bank_name,
    account_number: acc.account_number,
    account_holder_name: acc.account_holder_name,
    address: acc.address,
  };
}

/** Full add/edit form for one bank account - a label alone used to be all
 * you could give it, which isn't enough to actually identify the account
 * for real bookkeeping (which bank, whose name it's under, the account
 * number). Shared between "add new" and editing an existing row. */
function AccountForm({
  initial,
  onSave,
  onCancel,
  onDelete,
}: {
  initial?: BankAccountDetails;
  onSave: (details: BankAccountDetails) => Promise<void>;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const [details, setDetails] = useState<BankAccountDetails>(initial ?? EMPTY_DETAILS);
  const [saving, setSaving] = useState(false);

  function setField(key: keyof BankAccountDetails, value: string) {
    setDetails((d) => ({ ...d, [key]: value }));
  }

  async function handleSave() {
    if (!details.name.trim()) {
      showAlert('Add a label', 'Give this account a short label, e.g. "Nabil Bank - Current".');
      return;
    }
    setSaving(true);
    try {
      await onSave({
        name: details.name.trim(),
        bank_name: details.bank_name?.trim() || null,
        account_number: details.account_number?.trim() || null,
        account_holder_name: details.account_holder_name?.trim() || null,
        address: details.address?.trim() || null,
      });
    } catch (err) {
      showAlert('Could not save', getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <View className="mb-2.5 rounded-2xl border border-gray-200 bg-white p-4">
      <Text className="mb-1 text-xs font-medium text-gray-500">Label</Text>
      <TextInput
        value={details.name}
        onChangeText={(v) => setField('name', v)}
        placeholder="e.g. Nabil Bank - Current"
        placeholderTextColor="#9CA3AF"
        className="mb-2.5 rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900"
      />
      <Text className="mb-1 text-xs font-medium text-gray-500">Bank name</Text>
      <TextInput
        value={details.bank_name ?? ''}
        onChangeText={(v) => setField('bank_name', v)}
        placeholder="e.g. Nabil Bank"
        placeholderTextColor="#9CA3AF"
        className="mb-2.5 rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900"
      />
      <Text className="mb-1 text-xs font-medium text-gray-500">Account number</Text>
      <TextInput
        value={details.account_number ?? ''}
        onChangeText={(v) => setField('account_number', v)}
        placeholder="e.g. 01234567890123"
        placeholderTextColor="#9CA3AF"
        keyboardType="number-pad"
        className="mb-2.5 rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900"
      />
      <Text className="mb-1 text-xs font-medium text-gray-500">Account holder name</Text>
      <TextInput
        value={details.account_holder_name ?? ''}
        onChangeText={(v) => setField('account_holder_name', v)}
        placeholder="e.g. Sagar Rayamajhi"
        placeholderTextColor="#9CA3AF"
        className="mb-2.5 rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900"
      />
      <Text className="mb-1 text-xs font-medium text-gray-500">Branch / Address</Text>
      <TextInput
        value={details.address ?? ''}
        onChangeText={(v) => setField('address', v)}
        placeholder="e.g. New Road Branch, Kathmandu"
        placeholderTextColor="#9CA3AF"
        className="mb-3 rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900"
      />
      <View className="flex-row gap-2">
        <Pressable onPress={onCancel} className="flex-1 items-center rounded-lg border border-gray-300 py-2.5">
          <Text className="text-sm font-semibold text-gray-600">Cancel</Text>
        </Pressable>
        {onDelete && (
          <Pressable
            onPress={() =>
              showAlert('Remove this bank account?', undefined, [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Remove', style: 'destructive', onPress: onDelete },
              ])
            }
            className="items-center rounded-lg border border-red-300 px-4 py-2.5"
          >
            <Ionicons name="trash-outline" size={16} color="#DC2626" />
          </Pressable>
        )}
        <Pressable onPress={handleSave} disabled={saving} className="flex-1 items-center rounded-lg bg-blue-600 py-2.5 disabled:opacity-50">
          <Text className="text-sm font-semibold text-white">{saving ? 'Saving…' : 'Save'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function BankAccountsScreen() {
  const userId = useAuthStore((state) => state.session?.user.id);
  const { accounts, create, update, remove } = useBankAccounts(userId);
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // The name, the back button (phones) and "Add account" live in the top bar.
  const layout = useBookLayout();
  useBarActions(
    {
      wide: layout.wide,
      right: showAdd
        ? undefined
        : () => (
            <ToolbarButton
              icon="add"
              label={layout.wide ? "Add account" : "Add"}
              onPress={() => {
                setEditingId(null);
                setShowAdd(true);
              }}
            />
          ),
    },
    [showAdd]
  );

  return (
    <ScrollView className="flex-1 bg-gray-50 px-6 pt-4" contentContainerStyle={{ paddingBottom: 40 }}>
      <Text className="mb-4 text-xs text-gray-400">
        Add every bank account your business uses — each one then shows up as an option (alongside Cash) when recording
        an Expense, and its balance shows up under Available Balance. Fill in the full detail so it's a real record,
        not just a label.
      </Text>

      {showAdd && (
        <AccountForm
          onSave={async (details) => {
            await create(details);
            setShowAdd(false);
          }}
          onCancel={() => setShowAdd(false)}
        />
      )}

      <View className="mb-2.5 flex-row items-center gap-3 rounded-2xl border border-gray-200 bg-white p-4">
        <View className="h-9 w-9 items-center justify-center rounded-full bg-gray-100">
          <Ionicons name="cash-outline" size={16} color="#6B7280" />
        </View>
        <Text className="flex-1 text-sm font-semibold text-gray-900">Cash</Text>
        <Text className="text-xs text-gray-400">Always available</Text>
      </View>

      {accounts.length === 0 && !showAdd ? (
        <View className="items-center rounded-2xl border border-dashed border-gray-200 bg-white py-10">
          <Ionicons name="business-outline" size={28} color="#D1D5DB" />
          <Text className="mt-2 text-gray-500">No bank accounts yet — add one above.</Text>
        </View>
      ) : (
        accounts.map((acc) =>
          editingId === acc.id ? (
            <AccountForm
              key={acc.id}
              initial={toDetails(acc)}
              onSave={async (details) => {
                await update(acc.id, details);
                setEditingId(null);
              }}
              onCancel={() => setEditingId(null)}
              onDelete={async () => {
                await remove(acc.id);
                setEditingId(null);
              }}
            />
          ) : (
            <Pressable
              key={acc.id}
              onPress={() => {
                setShowAdd(false);
                setEditingId(acc.id);
              }}
              className="mb-2.5 flex-row items-center gap-3 rounded-2xl border border-gray-200 bg-white p-4"
            >
              <View className="h-9 w-9 items-center justify-center rounded-full bg-blue-50">
                <Ionicons name="business-outline" size={16} color="#2563EB" />
              </View>
              <View className="flex-1">
                <Text className="text-sm font-semibold text-gray-900">{acc.name}</Text>
                {!!acc.account_number && <Text className="text-xs text-gray-400">A/C {acc.account_number}</Text>}
              </View>
              <Ionicons name="pencil-outline" size={17} color="#9CA3AF" />
            </Pressable>
          )
        )
      )}
    </ScrollView>
  );
}
