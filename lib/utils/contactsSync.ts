// lib/utils/contactsSync.ts
import AsyncStorage from '@react-native-async-storage/async-storage';
// The default 'expo-contacts' export's getContactsAsync/requestPermissionsAsync
// are deprecated in favor of a new class-based API and now throw instead of
// just warning - the legacy import keeps the same function-based shape this
// file already uses (see also lib/hooks/usePhoneContacts.ts).
import * as Contacts from 'expo-contacts/legacy';
import { supabase } from '../supabase';
import { normalizePhone } from './phone';

const enabledKey = (userId: string) => `phone_contacts_sync_enabled:${userId}`;
const lastSyncedKey = (userId: string) => `phone_contacts_sync_last_at:${userId}`;

export async function isContactsSyncEnabled(userId: string): Promise<boolean> {
  const value = await AsyncStorage.getItem(enabledKey(userId));
  return value === 'true';
}

export async function setContactsSyncEnabled(userId: string, enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(enabledKey(userId), enabled ? 'true' : 'false');
}

export async function getLastSyncedAt(userId: string): Promise<Date | null> {
  const value = await AsyncStorage.getItem(lastSyncedKey(userId));
  return value ? new Date(value) : null;
}

/** Pulls every phone contact that has at least one usable 10-digit number
 * and upserts it into `customers`, keyed by primary key `id` (resolved
 * below) so repeat syncs update the same row instead of duplicating it.
 * The phone contact always wins for name/phone on rows it owns - it never
 * touches customers added by hand that don't match by phone_contact_id or
 * phone (those keep phone_contact_id = null). */
export async function syncPhoneContactsToCustomers(ownerId: string): Promise<number> {
  const { data } = await Contacts.getContactsAsync({
    fields: [Contacts.Fields.Name, Contacts.Fields.PhoneNumbers],
  });

  const candidates = (data ?? [])
    .map((contact) => {
      const rawPhone = contact.phoneNumbers?.[0]?.number;
      const phone = rawPhone ? normalizePhone(rawPhone) : null;
      const name = contact.name?.trim();
      if (!contact.id || !name || !phone) return null;
      return { phone_contact_id: contact.id, name, phone };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  if (candidates.length === 0) {
    await AsyncStorage.setItem(lastSyncedKey(ownerId), new Date().toISOString());
    return 0;
  }

  // A customer can already exist under this owner keyed by either column -
  // matched previously by phone_contact_id, or added by hand/via a request
  // with the same phone number. Resolving both up front and upserting on
  // the primary key (rather than a fixed onConflict column) means a single
  // phone-number collision with a hand-added customer can never abort the
  // whole batch the way onConflict: 'owner_id,phone_contact_id' could, since
  // that left the separate (owner_id, phone) unique index free to reject
  // the insert outright.
  // Cast to `any`: same postgrest-js generic-inference gap as the upsert
  // below - a partial-column `.select()` string can't be resolved against
  // the generic `Database['public']['Tables']['customers']['Row']` type.
  const { data: existing, error: fetchError } = await (supabase.from('customers') as any)
    .select('id, name, phone, phone_contact_id')
    .eq('owner_id', ownerId);
  if (fetchError) throw fetchError;

  type ExistingRow = { id: string; name: string; phone: string | null; phone_contact_id: string | null };
  const existingRows = (existing ?? []) as ExistingRow[];
  const byId = new Map(existingRows.map((c) => [c.id, c]));
  const byPhoneContactId = new Map(existingRows.filter((c) => c.phone_contact_id).map((c) => [c.phone_contact_id as string, c.id]));
  const byPhone = new Map(existingRows.filter((c) => c.phone).map((c) => [c.phone as string, c.id]));

  // Two phone contacts with the same number (very common - a person saved
  // twice) used to both go into one upsert: they'd collide on the
  // (owner_id, phone) unique index, or hit the same existing row twice,
  // failing the whole batch - and since background syncs swallow errors,
  // every sync after that silently did nothing. Keep one row per number and
  // one per target customer.
  const seenPhones = new Set<string>();
  const seenTargets = new Set<string>();
  const rows: Record<string, unknown>[] = [];
  for (const c of candidates) {
    if (seenPhones.has(c.phone)) continue;
    seenPhones.add(c.phone);
    const existingId = byPhoneContactId.get(c.phone_contact_id) ?? byPhone.get(c.phone);
    if (existingId) {
      if (seenTargets.has(existingId)) continue;
      seenTargets.add(existingId);
      const current = byId.get(existingId)!;
      // A customer added by hand keeps the name the business gave them
      // ("Ram Hardware", not whatever the phone calls them) - sync only
      // links it to the phone contact. Rows sync created keep following the
      // phone contact's name.
      const name = current.phone_contact_id ? c.name : current.name;
      const unchanged =
        current.name === name && current.phone === c.phone && current.phone_contact_id === c.phone_contact_id;
      if (unchanged) continue;
      rows.push({ id: existingId, owner_id: ownerId, phone_contact_id: c.phone_contact_id, name, phone: c.phone, updated_at: new Date().toISOString() });
    } else {
      rows.push({ owner_id: ownerId, phone_contact_id: c.phone_contact_id, name: c.name, phone: c.phone, updated_at: new Date().toISOString() });
    }
  }

  if (rows.length === 0) {
    await AsyncStorage.setItem(lastSyncedKey(ownerId), new Date().toISOString());
    return 0;
  }

  // Cast to `any`: postgrest-js can't infer a precise Insert[] shape here
  // since `Database['public']['Tables']['customers']['Insert']` is a bare
  // `Partial<Customer>` (see useSupabase.ts for the same pattern).
  // Updates and new rows go in separate calls: in one bulk upsert, a row
  // without an `id` is sent with id = null (supabase-js fills missing
  // columns with null), instead of letting the database generate one.
  const updates = rows.filter((r) => r.id);
  const inserts = rows.filter((r) => !r.id);
  if (updates.length > 0) {
    const { error } = await (supabase.from('customers') as any).upsert(updates, { onConflict: 'id' });
    if (error) throw error;
  }
  if (inserts.length > 0) {
    const { error } = await (supabase.from('customers') as any).insert(inserts);
    if (error) throw error;
  }

  await AsyncStorage.setItem(lastSyncedKey(ownerId), new Date().toISOString());
  return rows.length;
}

/** Requests contacts permission (if not already granted) and runs a sync.
 * Call this from an explicit user action (e.g. a "Sync phone contacts"
 * button) - the OS permission prompt should always follow user intent. */
export async function requestAndSyncPhoneContacts(ownerId: string): Promise<{ granted: boolean; synced: number }> {
  const { status } = await Contacts.requestPermissionsAsync();
  if (status !== 'granted') return { granted: false, synced: 0 };
  const synced = await syncPhoneContactsToCustomers(ownerId);
  await setContactsSyncEnabled(ownerId, true);
  return { granted: true, synced };
}

/** Silent sync for app-foreground/cold-start bootstrap: only runs if the
 * user has already opted in once (via requestAndSyncPhoneContacts) and the
 * OS permission is still granted, so it never surprises the user with a
 * permission prompt on its own. */
export async function silentSyncIfEnabled(ownerId: string): Promise<number | null> {
  const enabled = await isContactsSyncEnabled(ownerId);
  if (!enabled) return null;
  const { status } = await Contacts.getPermissionsAsync();
  if (status !== 'granted') return null;
  return syncPhoneContactsToCustomers(ownerId);
}
