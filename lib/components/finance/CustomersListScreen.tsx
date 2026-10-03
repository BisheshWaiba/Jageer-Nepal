// lib/components/finance/CustomersListScreen.tsx
import { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, FlatList, Platform } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useAuthStore } from '../../hooks/useAuth';
import { useSupabaseInsert, useSupabaseQuery } from '../../hooks/useSupabase';
import { supabase } from '../../supabase';
import { SearchBar } from '../SearchBar';
import { BookPage, BookStat, BookStats, BookTable, Pill, ToolbarButton, ToolbarSearch, money as bookMoney, useBookLayout, useBookToolbar, type BookColumn } from './BookKit';
import { showAlert, getErrorMessage } from '../../utils/alert';
import { isValidPhone10 } from '../../utils/phone';
import { getLastSyncedAt, isContactsSyncEnabled, requestAndSyncPhoneContacts } from '../../utils/contactsSync';
import { pickPhoneContact } from '../../utils/pickPhoneContact';
import type { Customer, Profile } from '../../../types/database.types';

function money(n: number): string {
  return Math.round(n).toLocaleString();
}

/** What a party owes this business (receivable) and what the business owes
 * them (payable). The two live in opposite tables with opposite polarity -
 * customer_ledger_entries for money coming in, vendor_ledger_entries for
 * money going out (see 0059_vendor_ledger.sql) - and one person can be both
 * a customer and a supplier, so they are kept apart rather than netted into
 * a single number that would hide half the story. */
type Balance = { receivable: number; payable: number };

function useLedgerBalances(userId: string | undefined) {
  const { data: customerEntries } = useSupabaseQuery('customer_ledger_entries', {
    filters: userId ? { owner_id: userId } : {},
    enabled: !!userId,
  });
  const { data: vendorEntries } = useSupabaseQuery('vendor_ledger_entries', {
    filters: userId ? { owner_id: userId } : {},
    enabled: !!userId,
  });

  return useMemo(() => {
    const byParty = new Map<string, Balance>();
    const at = (id: string) => {
      const found = byParty.get(id) ?? { receivable: 0, payable: 0 };
      byParty.set(id, found);
      return found;
    };
    for (const e of customerEntries ?? []) {
      const row = at(e.customer_id);
      row.receivable += e.entry_type === 'debit' ? e.amount : -e.amount;
    }
    for (const e of vendorEntries ?? []) {
      const row = at(e.vendor_id);
      row.payable += e.entry_type === 'debit' ? e.amount : -e.amount;
    }

    let totalReceivable = 0;
    let totalPayable = 0;
    for (const row of byParty.values()) {
      if (row.receivable > 0) totalReceivable += row.receivable;
      if (row.payable > 0) totalPayable += row.payable;
    }
    return { byParty, totalReceivable, totalPayable };
  }, [customerEntries, vendorEntries]);
}

/** The one line that says where a party stands. Anything at zero (or in
 * credit both ways) reads as settled rather than as a confusing 0. */
function BalanceLine({ balance }: { balance: Balance | undefined }) {
  const receivable = balance && balance.receivable > 0 ? balance.receivable : 0;
  const payable = balance && balance.payable > 0 ? balance.payable : 0;

  if (!receivable && !payable) {
    return <Text className="mt-1.5 text-[11.5px] font-medium text-gray-400">Settled</Text>;
  }

  return (
    <View className="mt-1.5 flex-row flex-wrap items-center" style={{ gap: 8 }}>
      {receivable > 0 && (
        <View className="rounded-full px-2 py-0.5" style={{ backgroundColor: '#ECFDF5' }}>
          <Text className="text-[11.5px] font-bold" style={{ color: '#047857' }}>
            To receive NPR {money(receivable)}
          </Text>
        </View>
      )}
      {payable > 0 && (
        <View className="rounded-full px-2 py-0.5" style={{ backgroundColor: '#FEF2F2' }}>
          <Text className="text-[11.5px] font-bold" style={{ color: '#B91C1C' }}>
            To pay NPR {money(payable)}
          </Text>
        </View>
      )}
    </View>
  );
}

/** Id of the existing customer already using `phone` for this owner, if any. */
async function findExistingCustomerByPhone(ownerId: string, phone: string, excludeCustomerId?: string) {
  let query = supabase.from('customers').select('id').eq('owner_id', ownerId).eq('phone', phone);
  if (excludeCustomerId) query = query.neq('id', excludeCustomerId);
  const { data, error } = await query.limit(1);
  if (error) throw error;
  return ((data ?? []) as { id: string }[])[0]?.id ?? null;
}

function AddCustomerForm({ userId, basePath, onDone }: { userId: string; basePath: string; onDone: () => void }) {
  const createCustomer = useSupabaseInsert('customers');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [saving, setSaving] = useState(false);

  async function handleUseMyLocation() {
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        showAlert('Location permission needed', 'Allow location access to attach a position.');
        return;
      }
      const position = await Location.getCurrentPositionAsync({});
      setCoords({ latitude: position.coords.latitude, longitude: position.coords.longitude });
    } catch (err) {
      showAlert('Could not get location', getErrorMessage(err));
    } finally {
      setLocating(false);
    }
  }

  async function handlePickContact() {
    const picked = await pickPhoneContact();
    if (!picked) return;
    if (picked.name) setName(picked.name);
    if (picked.phone) setPhone(picked.phone);
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
      const existingId = trimmedPhone ? await findExistingCustomerByPhone(userId, trimmedPhone) : null;
      if (existingId) {
        // Almost always means this contact was already pulled in by the
        // background phone-contacts sync (see contactsSync.ts) before the
        // user got to it manually - a flat "already exists" refusal with no
        // way forward reads as the app just blocking them, so take them
        // straight to the record that's already there instead.
        showAlert('Already saved', 'A customer with this phone number is already in your list.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'View customer', onPress: () => router.push(`${basePath}/customer/${existingId}` as any) },
        ]);
        onDone();
        return;
      }
      await createCustomer.mutateAsync({
        owner_id: userId,
        name: name.trim(),
        phone: trimmedPhone || null,
        address: address.trim() || null,
        latitude: coords?.latitude ?? null,
        longitude: coords?.longitude ?? null,
      });
      onDone();
    } catch (err) {
      showAlert('Could not save customer', getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <View className="mb-4 rounded-2xl border border-gray-200 bg-white p-4">
      <Text className="mb-3 text-sm font-semibold text-gray-900">Add a customer</Text>
      <View className="mb-2.5 flex-row items-center rounded-lg border border-gray-300">
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Name"
          className="flex-1 px-3 py-2.5 text-sm text-gray-900"
        />
        {Platform.OS !== 'web' && (
          <Pressable onPress={handlePickContact} hitSlop={8} className="px-2.5">
            <Ionicons name="person-add-outline" size={18} color="#1d4ed8" />
          </Pressable>
        )}
      </View>
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
        className="mb-2.5 rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900"
      />
      <Pressable
        onPress={handleUseMyLocation}
        disabled={locating}
        className="mb-3 items-center rounded-lg border border-blue-700 bg-blue-50 py-2 disabled:opacity-50"
      >
        <Text className="text-xs font-semibold text-blue-700">
          {locating ? 'Locating…' : coords ? '📍 Location captured' : '📍 Attach current location'}
        </Text>
      </Pressable>
      <View className="flex-row gap-2">
        <Pressable onPress={onDone} className="flex-1 items-center rounded-lg border border-gray-300 py-2.5">
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

function CustomerRow({ customer, basePath, isApp, balance }: { customer: Customer; basePath: string; isApp: boolean; balance: Balance | undefined }) {
  return (
    <Pressable
      onPress={() => router.push(`${basePath}/customer/${customer.id}` as any)}
      className="mb-2.5 rounded-2xl border border-gray-200 bg-white p-4"
    >
      <View className="mb-0.5 flex-row items-center justify-between gap-2">
        <Text className="flex-1 font-semibold text-gray-900" numberOfLines={1}>
          {customer.name}
        </Text>
        {isApp && (
          <View className="flex-row items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5">
            <Ionicons name="phone-portrait-outline" size={11} color="#2563eb" />
            <Text className="text-[10px] font-bold text-blue-700">APP</Text>
          </View>
        )}
      </View>
      {!!customer.phone && (
        <Text className="mt-0.5 text-xs text-gray-500">
          <Ionicons name="call-outline" size={11} color="#9CA3AF" /> {customer.phone}
        </Text>
      )}
      {!!customer.address && (
        <Text className="mt-0.5 text-xs text-gray-500" numberOfLines={1}>
          <Ionicons name="location-outline" size={11} color="#9CA3AF" /> {customer.address}
        </Text>
      )}
      <BalanceLine balance={balance} />
    </Pressable>
  );
}

interface AppCustomer {
  profile: Profile;
  requestCount: number;
  lastRequestAt: string;
}

// Real registered app users who have booked a service request with this
// reseller - distinct from the reseller's own hand-typed customer directory
// below. service_requests already scopes to this reseller via reseller_id,
// so this is every client they've actually served through the app.
function useAppCustomers(userId: string | undefined) {
  const { data: requests } = useSupabaseQuery('service_requests', {
    filters: userId ? { reseller_id: userId } : {},
    enabled: !!userId,
  });

  const statsByClient = useMemo(() => {
    const map = new Map<string, { requestCount: number; lastRequestAt: string }>();
    for (const r of requests ?? []) {
      const cur = map.get(r.client_id);
      if (cur) {
        cur.requestCount += 1;
        if (r.created_at > cur.lastRequestAt) cur.lastRequestAt = r.created_at;
      } else {
        map.set(r.client_id, { requestCount: 1, lastRequestAt: r.created_at });
      }
    }
    return map;
  }, [requests]);

  const clientIds = useMemo(() => Array.from(statsByClient.keys()).sort(), [statsByClient]);

  const { data: profiles } = useQuery({
    queryKey: ['app-customer-profiles', clientIds],
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('*').in('id', clientIds);
      if (error) throw error;
      return (data ?? []) as Profile[];
    },
    enabled: clientIds.length > 0,
  });

  return useMemo((): AppCustomer[] => {
    return (profiles ?? [])
      .map((profile) => ({ profile, ...statsByClient.get(profile.id)! }))
      .sort((a, b) => (a.lastRequestAt < b.lastRequestAt ? 1 : -1));
  }, [profiles, statsByClient]);
}

function AppCustomerRow({ entry }: { entry: AppCustomer }) {
  const { profile, requestCount, lastRequestAt } = entry;
  return (
    <View className="mb-2.5 rounded-2xl border border-gray-200 bg-white p-4">
      <View className="mb-1.5 flex-row items-center justify-between">
        <Text className="flex-1 font-semibold text-gray-900" numberOfLines={1}>
          {profile.full_name ?? 'Unnamed'}
        </Text>
        <View className="flex-row items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5">
          <Ionicons name="phone-portrait-outline" size={11} color="#2563eb" />
          <Text className="text-[10px] font-bold text-blue-700">APP</Text>
        </View>
      </View>
      {!!profile.phone && (
        <Text className="mt-0.5 text-xs text-gray-500">
          <Ionicons name="call-outline" size={11} color="#9CA3AF" /> {profile.phone}
        </Text>
      )}
      {!!profile.city && (
        <Text className="mt-0.5 text-xs text-gray-500">
          <Ionicons name="location-outline" size={11} color="#9CA3AF" /> {profile.city}
        </Text>
      )}
      <Text className="mt-1.5 text-xs text-gray-400">
        {requestCount} request{requestCount === 1 ? '' : 's'} · last on {new Date(lastRequestAt).toLocaleDateString()}
      </Text>
    </View>
  );
}

function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return `${Math.floor(hours / 24)} day ago`;
}

/** Button + status line for the "Your Customers" tab: first tap asks for
 * contacts permission and does an initial pull; after that, the app keeps
 * this list in sync with the phone's contacts automatically in the
 * background (useContactsSyncBootstrap), and this button just lets the
 * user force an immediate re-sync. */
function PhoneContactsSyncButton({ userId }: { userId: string }) {
  const queryClient = useQueryClient();
  const [syncing, setSyncing] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [lastSynced, setLastSynced] = useState<Date | null>(null);

  useEffect(() => {
    isContactsSyncEnabled(userId).then(setEnabled);
    getLastSyncedAt(userId).then(setLastSynced);
  }, [userId]);

  async function handleSync() {
    setSyncing(true);
    try {
      const { granted, synced } = await requestAndSyncPhoneContacts(userId);
      if (!granted) {
        showAlert('Contacts access needed', 'Allow contacts access to sync your phone contacts here.');
        return;
      }
      setEnabled(true);
      setLastSynced(new Date());
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      showAlert('Synced', `${synced} phone contact${synced === 1 ? '' : 's'} synced to your customers.`);
    } catch (err) {
      showAlert('Could not sync contacts', getErrorMessage(err));
    } finally {
      setSyncing(false);
    }
  }

  return (
    <View className="mb-3">
      <Pressable
        onPress={handleSync}
        disabled={syncing}
        className="flex-row items-center justify-center gap-2 rounded-2xl border border-blue-700 bg-blue-50 py-2.5 disabled:opacity-50"
      >
        <Ionicons name="sync-outline" size={16} color="#1d4ed8" />
        <Text className="text-xs font-semibold text-blue-700">
          {syncing ? 'Syncing…' : enabled ? 'Sync phone contacts now' : 'Sync from phone contacts'}
        </Text>
      </Pressable>
      {enabled && (
        <Text className="mt-1 text-center text-[10px] text-gray-400">
          {lastSynced ? `Auto-synced with your phone · last synced ${timeAgo(lastSynced)}` : 'Auto-synced with your phone'}
        </Text>
      )}
    </View>
  );
}

// One combined row: either a saved customer (tappable into the ledger) or,
// for a registered app user who's booked a request but was never saved to
// the customers directory, an app-only row (informational, same as the old
// "App Customers" tab - there's no customer_id to open a ledger for).
type MergedRow =
  | { kind: 'customer'; id: string; name: string; phone: string | null; customer: Customer; isApp: boolean }
  | { kind: 'app'; id: string; name: string; phone: string | null; entry: AppCustomer };

export function CustomersListScreen({ basePath }: { basePath: string }) {
  const { add } = useLocalSearchParams<{ add?: string }>();
  const userId = useAuthStore((state) => state.session?.user.id);
  const [search, setSearch] = useState('');
  const [showAddForm, setShowAddForm] = useState(add === '1');

  const { data: customers } = useSupabaseQuery('customers', {
    filters: userId ? { owner_id: userId } : {},
    orderBy: { column: 'name' },
    enabled: !!userId,
  });
  const appCustomers = useAppCustomers(userId);
  const { byParty, totalReceivable, totalPayable } = useLedgerBalances(userId);

  // A saved customer whose phone matches a registered app user is marked
  // "APP" on their existing row instead of being listed twice; an app user
  // with no matching saved customer still shows up, just without a ledger
  // to open.
  const merged = useMemo((): MergedRow[] => {
    const customerPhones = new Set((customers ?? []).map((c) => c.phone).filter((p): p is string => !!p));
    const appPhones = new Set(appCustomers.map((a) => a.profile.phone).filter((p): p is string => !!p));

    const customerRows: MergedRow[] = (customers ?? []).map((c) => ({
      kind: 'customer',
      id: c.id,
      name: c.name,
      phone: c.phone,
      customer: c,
      isApp: !!c.phone && appPhones.has(c.phone),
    }));
    const appOnlyRows: MergedRow[] = appCustomers
      .filter((a) => !a.profile.phone || !customerPhones.has(a.profile.phone))
      .map((a) => ({
        kind: 'app',
        id: a.profile.id,
        name: a.profile.full_name ?? 'Unnamed',
        phone: a.profile.phone,
        entry: a,
      }));

    return [...customerRows, ...appOnlyRows].sort((a, b) => a.name.localeCompare(b.name));
  }, [customers, appCustomers]);

  const filteredMerged = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return merged;
    return merged.filter((r) => r.name.toLowerCase().includes(q) || (r.phone ?? '').includes(q));
  }, [merged, search]);

  const layout = useBookLayout();

  // Search and New party live in the top bar on a wide screen (a plain row above
  // the tiles on a narrow one) - web only; the phone app keeps its own list below.
  const toolbar = useBookToolbar(
    {
      wide: layout.wide,
      right: (inBar) => (
        <>
          <ToolbarSearch value={search} onChange={setSearch} placeholder="Search by name or phone" wide={inBar} />
          <ToolbarButton icon={showAddForm ? 'close' : 'add'} label={showAddForm ? 'Close' : 'New party'} onPress={() => setShowAddForm((v) => !v)} />
        </>
      ),
    },
    [search, showAddForm]
  );

  // Web: the same cash-book look as the Day Book - header card, stat tiles,
  // one bordered table with totals. Phones keep the card list below.
  if (Platform.OS === 'web') {
    const owed = (row: MergedRow) => (row.kind === 'customer' ? Math.max(0, byParty.get(row.id)?.receivable ?? 0) : 0);
    const owing = (row: MergedRow) => (row.kind === 'customer' ? Math.max(0, byParty.get(row.id)?.payable ?? 0) : 0);
    const amount = (value: number, color: string) =>
      value > 0 ? (
        <Text className="text-[12.5px] font-bold" style={{ color }}>
          {bookMoney(value)}
        </Text>
      ) : (
        <Text className="text-[12.5px] text-gray-400">—</Text>
      );
    const net = (row: MergedRow) => {
      const diff = owed(row) - owing(row);
      if (diff === 0) return <Text className="text-[12px] font-medium text-gray-400">Settled</Text>;
      return (
        <Text className="text-[13px] font-bold" style={{ color: diff > 0 ? '#047857' : '#B91C1C' }}>
          {diff < 0 ? '−' : ''}
          {bookMoney(Math.abs(diff))}
        </Text>
      );
    };
    const party = (row: MergedRow, withPhone: boolean) => (
      <View style={{ minWidth: 0 }}>
        <View className="flex-row items-center" style={{ gap: 6 }}>
          <Text className="flex-shrink text-[13px] font-semibold text-gray-900" numberOfLines={1}>
            {row.name}
          </Text>
          {(row.kind === 'app' || (row.kind === 'customer' && row.isApp)) && <Pill text="APP" color="#1D4ED8" bg="#EFF6FF" />}
        </View>
        {(() => {
          const sub = [withPhone ? row.phone : null, row.kind === 'customer' ? row.customer.address : null].filter(Boolean).join(' · ');
          return sub ? (
            <Text className="text-[11px] text-gray-400" numberOfLines={1}>
              {sub}
            </Text>
          ) : null;
        })()}
      </View>
    );

    const columns: BookColumn<MergedRow>[] = layout.full
      ? [
          { key: 'party', label: 'Party', render: (row) => party(row, false) },
          { key: 'phone', label: 'Phone', width: 130, render: (row) => <Text className="text-[12.5px] text-gray-600">{row.phone ?? '—'}</Text> },
          { key: 'receive', label: 'To receive', width: 130, align: 'right', render: (row) => amount(owed(row), '#047857') },
          { key: 'pay', label: 'To pay', width: 130, align: 'right', render: (row) => amount(owing(row), '#B91C1C') },
          { key: 'net', label: 'Net balance', width: 140, align: 'right', render: (row) => net(row) },
        ]
      : [
          { key: 'party', label: 'Party', render: (row) => party(row, true) },
          { key: 'receive', label: 'To receive', width: 96, align: 'right', render: (row) => amount(owed(row), '#047857') },
          { key: 'pay', label: 'To pay', width: 92, align: 'right', render: (row) => amount(owing(row), '#B91C1C') },
        ];

    const shownReceive = filteredMerged.reduce((s, row) => s + owed(row), 0);
    const shownPay = filteredMerged.reduce((s, row) => s + owing(row), 0);
    const shownNet = shownReceive - shownPay;

    return (
      <BookPage wide={layout.wide}>
        {toolbar}

        <BookStats>
          <BookStat label="To receive" value={`NPR ${bookMoney(totalReceivable)}`} color="#047857" onPress={() => router.push(`${basePath}/to-receive` as any)} />
          <BookStat label="To pay" value={`NPR ${bookMoney(totalPayable)}`} color="#B91C1C" onPress={() => router.push(`${basePath}/to-give` as any)} />
          <BookStat
            label="Net position"
            value={`${totalReceivable - totalPayable < 0 ? '−' : ''}NPR ${bookMoney(Math.abs(totalReceivable - totalPayable))}`}
            color={totalReceivable - totalPayable >= 0 ? '#047857' : '#B91C1C'}
          />
          <BookStat label="Parties" value={String(merged.length)} color="#374151" />
        </BookStats>

        {showAddForm && userId && <AddCustomerForm userId={userId} basePath={basePath} onDone={() => setShowAddForm(false)} />}

        {filteredMerged.length === 0 ? (
          <View className="items-center rounded-xl border border-gray-300 bg-white py-10">
            <Ionicons name="people-outline" size={28} color="#D1D5DB" />
            <Text className="mt-2 text-gray-500">{merged.length > 0 ? 'No matches.' : 'No customers yet.'}</Text>
            <Text className="text-xs text-gray-400">Add one with New party, or they'll be saved when you record a bill for them.</Text>
          </View>
        ) : (
          <BookTable
            columns={columns}
            rows={filteredMerged}
            rowKey={(row) => `${row.kind}-${row.id}`}
            onRowPress={(row) => row.kind === 'customer' && router.push(`${basePath}/customer/${row.id}` as any)}
            footer={{
              label: `${filteredMerged.length} ${filteredMerged.length === 1 ? 'party' : 'parties'} · Totals`,
              cells: layout.full
                ? {
                    receive: <Text className="text-[13px] font-extrabold" style={{ color: '#047857' }}>{bookMoney(shownReceive)}</Text>,
                    pay: <Text className="text-[13px] font-extrabold" style={{ color: '#B91C1C' }}>{bookMoney(shownPay)}</Text>,
                    net: (
                      <Text className="text-[14px] font-extrabold" style={{ color: shownNet >= 0 ? '#047857' : '#B91C1C' }}>
                        {shownNet < 0 ? '−' : ''}
                        {bookMoney(Math.abs(shownNet))}
                      </Text>
                    ),
                  }
                : {
                    receive: <Text className="text-[13px] font-extrabold" style={{ color: '#047857' }}>{bookMoney(shownReceive)}</Text>,
                    pay: <Text className="text-[13px] font-extrabold" style={{ color: '#B91C1C' }}>{bookMoney(shownPay)}</Text>,
                  },
            }}
          />
        )}

        <Text className="px-1 text-[11.5px] leading-[17px] text-gray-400">
          Tap a party to open their ledger. To receive is what they owe you; To pay is what you owe them - one person can be both, so the two are kept apart and Net balance shows where they stand overall.
        </Text>
      </BookPage>
    );
  }

  return (
    <View className="flex-1 bg-gray-50 px-6 pt-4">
      <View className="mb-3 flex-row items-center gap-2">
        <View className="flex-1">
          <SearchBar value={search} onChangeText={setSearch} placeholder="Search by name or phone" />
        </View>
        <Pressable
          onPress={() => setShowAddForm((v) => !v)}
          className="h-11 w-11 items-center justify-center rounded-2xl bg-orange-500"
        >
          <Ionicons name={showAddForm ? 'close' : 'add'} size={22} color="white" />
        </Pressable>
      </View>

      {/* What every ledger adds up to, before the names themselves. */}
      <View className="mb-3 flex-row" style={{ gap: 10 }}>
        <Pressable
          onPress={() => router.push(`${basePath}/to-receive` as any)}
          className="flex-1 rounded-2xl border p-3.5"
          style={{ backgroundColor: '#ECFDF5', borderColor: '#A7F3D0' }}
        >
          <Text className="text-[11px] font-bold uppercase tracking-wide" style={{ color: '#047857' }}>
            To receive
          </Text>
          <Text className="mt-0.5 text-[19px] font-extrabold" style={{ color: '#047857' }}>
            NPR {money(totalReceivable)}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => router.push(`${basePath}/to-give` as any)}
          className="flex-1 rounded-2xl border p-3.5"
          style={{ backgroundColor: '#FEF2F2', borderColor: '#FECACA' }}
        >
          <Text className="text-[11px] font-bold uppercase tracking-wide" style={{ color: '#B91C1C' }}>
            To pay
          </Text>
          <Text className="mt-0.5 text-[19px] font-extrabold" style={{ color: '#B91C1C' }}>
            NPR {money(totalPayable)}
          </Text>
        </Pressable>
      </View>

      {userId && <PhoneContactsSyncButton userId={userId} />}

      {showAddForm && userId && <AddCustomerForm userId={userId} basePath={basePath} onDone={() => setShowAddForm(false)} />}

      <FlatList
        data={filteredMerged}
        keyExtractor={(item) => `${item.kind}-${item.id}`}
        renderItem={({ item }) =>
          item.kind === 'customer' ? (
            <CustomerRow customer={item.customer} basePath={basePath} isApp={item.isApp} balance={byParty.get(item.id)} />
          ) : (
            <AppCustomerRow entry={item.entry} />
          )
        }
        contentContainerStyle={{ paddingBottom: 40 }}
        ListEmptyComponent={
          <View className="items-center rounded-2xl border border-dashed border-gray-200 bg-white py-10">
            <Ionicons name="people-outline" size={28} color="#D1D5DB" />
            <Text className="mt-2 text-gray-500">{merged.length > 0 ? 'No matches.' : 'No customers yet.'}</Text>
            <Text className="text-xs text-gray-400">
              Add one above, or they'll be saved automatically when you book a job for them.
            </Text>
          </View>
        }
      />
    </View>
  );
}
