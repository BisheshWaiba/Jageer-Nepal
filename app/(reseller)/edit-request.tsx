// app/(reseller)/edit-request.tsx
import { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSupabaseRow, useSupabaseUpdate } from '../../lib/hooks/useSupabase';
import { DateField, TimeField } from '../../lib/components/DateTimeFields';
import { FormSection } from '../../lib/components/finance/FormSection';
import { showAlert, getErrorMessage } from '../../lib/utils/alert';
import { isValidPhone10 } from '../../lib/utils/phone';
import { isPastDate } from '../../lib/utils/localDate';
import { parseAmount, digitsInput } from '../../lib/utils/number';

// Only reachable from a MyRequestCard "Edit" button, which only shows for
// the reseller's own self-sourced requests (origin='reseller') that aren't
// resolved/cancelled yet - see canManage in requests.tsx. Edits the core
// mutable fields (who, where, when, notes, price); category and photos stay
// as originally submitted, matching what actually needs fixing after the
// fact (a wrong phone number, a rescheduled date) rather than a full redo.
export default function EditRequestScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  // This screen stays mounted between visits (a hidden tab), so without a
  // per-request key the form kept the previous request's values - and
  // saving wrote them onto the next request opened.
  return <EditRequest key={id} id={id} />;
}

function EditRequest({ id }: { id: string }) {
  const { data: request, isLoading } = useSupabaseRow('service_requests', id);
  const updateRequest = useSupabaseUpdate('service_requests');

  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [address, setAddress] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [notes, setNotes] = useState('');
  const [quotedPrice, setQuotedPrice] = useState('');
  const [hydrated, setHydrated] = useState(false);
  const [saving, setSaving] = useState(false);

  // Fills the form once the request loads - only once, so a background
  // refetch (e.g. after saving) never clobbers what's still being typed.
  useEffect(() => {
    if (!request || hydrated) return;
    setCustomerName(request.customer_name ?? '');
    setCustomerPhone(request.customer_phone ?? '');
    setAddress(request.location_data?.address ?? '');
    setDate(request.scheduled_date ?? '');
    setTime(request.scheduled_time ?? '');
    setNotes(request.description ?? '');
    setQuotedPrice(request.quoted_price != null ? String(request.quoted_price) : '');
    setHydrated(true);
  }, [request, hydrated]);

  async function handleSave() {
    if (!request) return;
    if (!customerName.trim() || !customerPhone.trim()) {
      showAlert('Add customer details', "Enter the customer's name and phone.");
      return;
    }
    if (!isValidPhone10(customerPhone)) {
      showAlert('Check the phone number', "Enter the customer's 10-digit phone number.");
      return;
    }
    if (!date.trim() || !time.trim()) {
      showAlert('Add date and time', 'Let us know when this service is needed.');
      return;
    }
    if (date !== request.scheduled_date && isPastDate(date)) {
      showAlert('Pick a future date', "The visit date can't be in the past.");
      return;
    }
    const price = parseAmount(quotedPrice);
    if (quotedPrice.trim() && (price == null || price <= 0)) {
      showAlert('Invalid price', 'Enter a valid price in NPR, or leave it blank.');
      return;
    }
    // A changed address no longer matches the saved map pin - drop the
    // coordinates rather than send the technician to the old location.
    const addressChanged = address.trim() !== (request.location_data?.address ?? '').trim();
    const location_data = addressChanged
      ? { address: address.trim() }
      : { ...(request.location_data ?? {}), address: address.trim() };
    setSaving(true);
    try {
      await updateRequest.mutateAsync({
        id: request.id,
        values: {
          customer_name: customerName.trim(),
          customer_phone: customerPhone.trim(),
          contact_person_name: customerName.trim(),
          contact_person_phone: customerPhone.trim(),
          scheduled_date: date.trim(),
          scheduled_time: time.trim(),
          location_data,
          description: notes.trim() || null,
          quoted_price: price,
        } as any,
      });
      showAlert('Request updated', 'Your changes have been saved.');
      router.back();
    } catch (err) {
      showAlert('Could not save', getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  if (isLoading || !request) {
    return (
      <View className="flex-1 items-center justify-center bg-gray-50">
        <Text className="text-gray-500">Loading…</Text>
      </View>
    );
  }

  return (
    <ScrollView className="flex-1 bg-gray-50 px-6 pt-4" contentContainerStyle={{ paddingBottom: 100 }}>
      <Text className="mb-1 text-2xl font-bold text-gray-900">{request.issue_type}</Text>
      <Text className="mb-4 text-sm text-gray-500">Edit this request's details.</Text>

      <View className="rounded-2xl border border-gray-200 bg-white p-4">
        <FormSection icon="person-outline" title="Customer" first>
          <Text className="mb-1.5 text-sm font-medium text-gray-700">Name</Text>
          <TextInput
            value={customerName}
            onChangeText={setCustomerName}
            placeholder="Customer name"
            className="mb-3 rounded-lg border border-gray-300 bg-white px-4 py-3 text-base"
          />
          <Text className="mb-1.5 text-sm font-medium text-gray-700">Phone</Text>
          <TextInput
            value={customerPhone}
            onChangeText={(v) => setCustomerPhone(digitsInput(v))}
            placeholder="98XXXXXXXX"
            keyboardType="phone-pad"
            maxLength={10}
            className="rounded-lg border border-gray-300 bg-white px-4 py-3 text-base"
          />
        </FormSection>

        <FormSection icon="location-outline" title="Location">
          <TextInput
            value={address}
            onChangeText={setAddress}
            placeholder="House/street, city, area"
            multiline
            className="rounded-lg border border-gray-300 bg-white px-4 py-3 text-base"
            style={{ minHeight: 60, textAlignVertical: 'top' }}
          />
        </FormSection>

        <FormSection icon="calendar-outline" title="Schedule">
          <View className="flex-row gap-2.5">
            <View className="flex-1">
              <Text className="mb-1.5 text-sm font-medium text-gray-700">Date</Text>
              <DateField value={date} onChange={setDate} />
            </View>
            <View className="flex-1">
              <Text className="mb-1.5 text-sm font-medium text-gray-700">Time</Text>
              <TimeField value={time} onChange={setTime} />
            </View>
          </View>
        </FormSection>

        <FormSection icon="document-text-outline" title="Extra information (optional)">
          <TextInput
            value={notes}
            onChangeText={setNotes}
            placeholder="Anything else the technician should know?"
            multiline
            numberOfLines={4}
            className="rounded-lg border border-gray-300 bg-white px-4 py-3 text-base"
            style={{ minHeight: 100, textAlignVertical: 'top' }}
          />
        </FormSection>

        <FormSection icon="pricetag-outline" title="Pricing (optional)">
          <TextInput
            value={quotedPrice}
            onChangeText={setQuotedPrice}
            placeholder="e.g. 2000"
            keyboardType="numeric"
            className="rounded-lg border border-gray-300 bg-white px-4 py-3 text-base"
          />
        </FormSection>
      </View>

      <Pressable
        onPress={handleSave}
        disabled={saving}
        className="mt-5 items-center rounded-lg bg-orange-500 py-3 disabled:opacity-50"
      >
        <Text className="text-base font-semibold text-white">{saving ? 'Saving…' : 'Save changes'}</Text>
      </Pressable>
    </ScrollView>
  );
}
