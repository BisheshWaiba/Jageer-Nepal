// app/(reseller)/quotation/new.tsx
import { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Image, Platform } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { useAuthStore } from '../../../lib/hooks/useAuth';
import { useSupabaseInsert, useSupabaseQuery, useSupabaseUpdate } from '../../../lib/hooks/useSupabase';
import { supabase } from '../../../lib/supabase';
import { DateField } from '../../../lib/components/DateTimeFields';
import { FormSection } from '../../../lib/components/finance/FormSection';
import { ProductPickerModal } from '../../../lib/components/ProductPickerModal';
import { toSafeImageUri } from '../../../lib/utils/image';
import { resizeImageForUpload } from '../../../lib/utils/resizeImage';
import { showAlert, getErrorMessage } from '../../../lib/utils/alert';
import { adStringToBsOrToday, nepaliFiscalYearSuffix, toBsLabel } from '../../../lib/utils/nepaliDate';
import { localTodayIso } from '../../../lib/utils/localDate';
import { parseAmount, decimalInput, digitsInput } from '../../../lib/utils/number';
import type { Product, QuotationItem } from '../../../types/database.types';

const DEFAULT_TERMS = `Above price are Inclusive of VAT amount.
Order shall be confirmed only after the client company Purchase Order is received.
We will provide two-year parts replacement warranty from the date of purchase.
Warranty will be worthless, if one of the following is occurred:
Damage resulting from relocation, power fluctuation, and natural disasters.
Operating not with manufacturer specification or abuse or misuse.
Customer making himself any repair or modification.
50% in advance and remaining amount shall be paid within 15 days after the bill is received by the client after the completion of work.`;

// A business's initials from its own name, e.g. "MANSA TECHNOLOGY PVT.
// LTD." -> "MTPL" - used as the last segment of a quote number, matching
// the real letterhead's "562/083/84/MTPL" convention for any business name,
// not just this one.
function businessInitials(name: string): string {
  return name
    .split(/\s+/)
    .map((word) => word.replace(/[^A-Za-z]/g, '')[0])
    .filter(Boolean)
    .join('')
    .toUpperCase();
}

interface ItemRow {
  photoUrl: string | null;
  subject: string;
  description: string;
  mrp: string;
  discount: string;
  rate: string;
  qty: string;
}

function emptyRow(): ItemRow {
  return { photoUrl: null, subject: '', description: '', mrp: '', discount: '', rate: '', qty: '1' };
}

// The letterhead's columns read MRP -> Discount -> Rate: Rate is the
// already-discounted unit price, so when it's filled in the discount is
// already inside it. Subtracting the discount again (as this used to) quoted
// every discounted line too low. Without a Rate, the unit price is MRP less
// the per-unit discount.
function rowUnitPrice(row: ItemRow): number {
  const rate = parseAmount(row.rate) ?? 0;
  if (rate > 0) return rate;
  const mrp = parseAmount(row.mrp) ?? 0;
  const discount = parseAmount(row.discount) ?? 0;
  return Math.max(0, mrp - discount);
}

function rowAmount(row: ItemRow): number {
  return rowUnitPrice(row) * (Number(row.qty) || 0);
}

/** A line actually being quoted - blank rows left in the form are skipped
 * everywhere (total, PDF, saved copy) instead of printing as empty lines. */
function isFilledRow(row: ItemRow): boolean {
  return !!row.subject.trim();
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export default function NewQuotation() {
  const userId = useAuthStore((state) => state.session?.user.id);
  const profile = useAuthStore((state) => state.profile);
  const setProfile = useAuthStore((state) => state.setProfile);
  const updateProfile = useSupabaseUpdate('profiles');
  const insertQuotation = useSupabaseInsert('quotations');

  const { data: myQuotations } = useSupabaseQuery('quotations', {
    filters: userId ? { owner_id: userId } : {},
    enabled: !!userId,
  });
  const { data: myProducts } = useSupabaseQuery('products', {
    filters: userId ? { seller_id: userId, seller_role: 'reseller' } : {},
    enabled: !!userId,
  });

  const nextSeq = useMemo(() => {
    const seqs = (myQuotations ?? []).map((q) => q.quote_seq).filter((n) => Number.isFinite(n));
    return (seqs.length ? Math.max(...seqs) : 0) + 1;
  }, [myQuotations]);

  // Business details: shown once until the reseller fills these in - every
  // future quote reuses what's saved on their profile.
  const hasBusinessInfo = !!profile?.business_name;
  const [editingBusiness, setEditingBusiness] = useState(false);
  const [bizName, setBizName] = useState(profile?.business_name ?? '');
  const [bizReg, setBizReg] = useState(profile?.business_reg_no ?? '');
  const [bizVat, setBizVat] = useState(profile?.business_vat_no ?? '');
  const [bizAddress, setBizAddress] = useState(profile?.business_address ?? '');
  const [bizPhone, setBizPhone] = useState(profile?.business_phone ?? '');
  const [bizLogoPath, setBizLogoPath] = useState(profile?.business_logo_path ?? null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [savingBusiness, setSavingBusiness] = useState(false);

  const [date, setDate] = useState(localTodayIso());
  const [quoteNo, setQuoteNo] = useState('');
  const [quoteNoTouched, setQuoteNoTouched] = useState(false);
  const [subject, setSubject] = useState('');
  const [clientName, setClientName] = useState('');
  const [clientAddress, setClientAddress] = useState('');
  const [salespersonName, setSalespersonName] = useState(profile?.full_name ?? '');
  const [salespersonPhone, setSalespersonPhone] = useState(profile?.phone ?? '');
  const [terms, setTerms] = useState(DEFAULT_TERMS);
  const [items, setItems] = useState<ItemRow[]>([emptyRow()]);
  const [pickerRowIndex, setPickerRowIndex] = useState<number | null>(null);
  const [generating, setGenerating] = useState(false);

  const businessName = profile?.business_name ?? '';
  const suggestedQuoteNo = useMemo(() => {
    if (!businessName) return String(nextSeq);
    const bs = adStringToBsOrToday(date);
    const suffix = nepaliFiscalYearSuffix(bs.year, bs.month);
    return `${nextSeq}/${suffix}/${businessInitials(businessName)}`;
  }, [nextSeq, date, businessName]);

  useEffect(() => {
    if (!quoteNoTouched) setQuoteNo(suggestedQuoteNo);
  }, [suggestedQuoteNo, quoteNoTouched]);

  // This screen stays mounted between visits (a hidden tab), so a finished
  // quotation's client, items and hand-edited quote number used to carry
  // straight into the next one - including a duplicate quote number.
  function resetQuoteForm() {
    setDate(localTodayIso());
    setQuoteNo('');
    setQuoteNoTouched(false);
    setSubject('');
    setClientName('');
    setClientAddress('');
    setSalespersonName(profile?.full_name ?? '');
    setSalespersonPhone(profile?.phone ?? '');
    setTerms(DEFAULT_TERMS);
    setItems([emptyRow()]);
  }

  const total = useMemo(() => items.filter(isFilledRow).reduce((sum, row) => sum + rowAmount(row), 0), [items]);

  async function handleSaveBusiness() {
    if (!userId || !bizName.trim()) {
      showAlert('Add a business name', 'Enter your company name to continue.');
      return;
    }
    setSavingBusiness(true);
    try {
      const values = {
        business_name: bizName.trim(),
        business_reg_no: bizReg.trim() || null,
        business_vat_no: bizVat.trim() || null,
        business_address: bizAddress.trim() || null,
        business_phone: bizPhone.trim() || null,
        business_logo_path: bizLogoPath,
      };
      await updateProfile.mutateAsync({ id: userId, values });
      setProfile(profile ? { ...profile, ...values } : profile);
      setEditingBusiness(false);
    } catch (err) {
      showAlert('Could not save', getErrorMessage(err));
    } finally {
      setSavingBusiness(false);
    }
  }

  async function handlePickLogo() {
    if (!userId) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      showAlert('Photo access needed', 'Allow photo library access to attach your logo.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.9 });
    if (result.canceled || !result.assets[0]) return;
    setUploadingLogo(true);
    try {
      const asset = result.assets[0];
      const resizedUri = await resizeImageForUpload(asset.uri, asset.width, 600);
      const arraybuffer = await fetch(resizedUri).then((res) => res.arrayBuffer());
      const path = `${userId}/logo-${Date.now()}.jpg`;
      const { error } = await supabase.storage
        .from('business-assets')
        .upload(path, arraybuffer, { contentType: 'image/jpeg' });
      if (error) throw error;
      setBizLogoPath(path);
    } catch (err) {
      showAlert('Could not upload logo', getErrorMessage(err));
    } finally {
      setUploadingLogo(false);
    }
  }

  async function uploadItemPhoto(uri: string, width: number | undefined): Promise<string> {
    if (!userId) throw new Error('Not signed in');
    const resizedUri = await resizeImageForUpload(uri, width ?? 1024, 800);
    const arraybuffer = await fetch(resizedUri).then((res) => res.arrayBuffer());
    const path = `${userId}/item-${Date.now()}.jpg`;
    const { error } = await supabase.storage
      .from('business-assets')
      .upload(path, arraybuffer, { contentType: 'image/jpeg' });
    if (error) throw error;
    return supabase.storage.from('business-assets').getPublicUrl(path).data.publicUrl;
  }

  function updateRow(index: number, patch: Partial<ItemRow>) {
    setItems((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function addRow() {
    setItems((prev) => [...prev, emptyRow()]);
  }

  function removeRow(index: number) {
    setItems((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));
  }

  async function handleUploadPhotoForRow(index: number) {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      showAlert('Photo access needed', 'Allow photo library access to attach a photo.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (result.canceled || !result.assets[0]) return;
    try {
      const url = await uploadItemPhoto(result.assets[0].uri, result.assets[0].width);
      updateRow(index, { photoUrl: url });
    } catch (err) {
      showAlert('Could not upload photo', getErrorMessage(err));
    }
  }

  function handleSelectProduct(product: Product) {
    if (pickerRowIndex == null) return;
    updateRow(pickerRowIndex, {
      photoUrl: product.image_url ? toSafeImageUri(product.image_url) : null,
      subject: product.name,
      description: product.description ?? '',
      mrp: String(product.price),
    });
    setPickerRowIndex(null);
  }

  function buildQuotationHtml(logoDataUri: string | null): string {
    const itemRows = items
      .filter(isFilledRow)
      .map((row) => {
        const amount = rowAmount(row);
        return `<tr>
          <td style="border:1px solid #999;padding:6px;text-align:center;">${row.photoUrl ? `<img src="${row.photoUrl}" style="width:70px;height:70px;object-fit:cover;" />` : ''}</td>
          <td style="border:1px solid #999;padding:6px;">${escapeHtml(row.subject)}</td>
          <td style="border:1px solid #999;padding:6px;font-size:11px;">${escapeHtml(row.description)}</td>
          <td style="border:1px solid #999;padding:6px;text-align:right;">${parseAmount(row.mrp) != null ? parseAmount(row.mrp)!.toLocaleString() : ''}</td>
          <td style="border:1px solid #999;padding:6px;text-align:right;">${parseAmount(row.discount) != null ? parseAmount(row.discount)!.toLocaleString() : ''}</td>
          <td style="border:1px solid #999;padding:6px;text-align:right;">${parseAmount(row.rate) != null ? parseAmount(row.rate)!.toLocaleString() : ''}</td>
          <td style="border:1px solid #999;padding:6px;text-align:center;">${escapeHtml(row.qty)}</td>
          <td style="border:1px solid #999;padding:6px;text-align:right;">${amount.toLocaleString()}</td>
        </tr>`;
      })
      .join('');

    return `<!DOCTYPE html><html><head><meta charset="utf-8" /><style>
      body { font-family: Arial, sans-serif; color: #111; padding: 24px; }
      table { width: 100%; border-collapse: collapse; margin-top: 12px; }
      th { border: 1px solid #999; padding: 6px; background: #f2f2f2; font-size: 12px; }
    </style></head><body>
      <div style="display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid #2563EB;padding-bottom:12px;">
        <div>
          ${logoDataUri ? `<img src="${logoDataUri}" style="height:60px;" />` : `<div style="font-size:22px;font-weight:bold;color:#2563EB;">${escapeHtml(businessName)}</div>`}
        </div>
        <div style="text-align:right;font-size:12px;">
          ${profile?.business_reg_no ? `REG. NO: ${escapeHtml(profile.business_reg_no)}<br/>` : ''}
          ${profile?.business_vat_no ? `VAT NO: ${escapeHtml(profile.business_vat_no)}<br/>` : ''}
          <b>${escapeHtml(businessName)}</b><br/>
          ${profile?.business_address ? `${escapeHtml(profile.business_address)}<br/>` : ''}
          ${profile?.business_phone ? `Contact No.: ${escapeHtml(profile.business_phone)}` : ''}
        </div>
      </div>

      <div style="margin-top:14px;font-size:13px;">
        <b>Quote no. ${escapeHtml(quoteNo)}</b>&nbsp;&nbsp;&nbsp;&nbsp;Date: ${toBsLabel(date)}
      </div>
      ${subject ? `<div style="margin-top:4px;font-size:13px;font-weight:bold;">Quotation for ${escapeHtml(subject)}</div>` : ''}

      <table>
        <tr>
          <td style="border:1px solid #999;padding:6px;"><b>CLIENT:</b> ${escapeHtml(clientName)}</td>
          <td colspan="7" style="border:1px solid #999;padding:6px;"><b>Address:</b> ${escapeHtml(clientAddress)}</td>
        </tr>
        <tr>
          <th>Item</th><th>Subject</th><th>Description</th><th>MRP<br/>(NRs.)</th>
          <th>Discount<br/>(NRs.)</th><th>Rate<br/>(NRs.)</th><th>Qty</th><th>Amount<br/>(NRs.)</th>
        </tr>
        ${itemRows}
        <tr>
          <td colspan="7" style="border:1px solid #999;padding:6px;text-align:right;"><b>TOTAL (NRs.)</b></td>
          <td style="border:1px solid #999;padding:6px;text-align:right;"><b>${total.toLocaleString()}</b></td>
        </tr>
      </table>

      <div style="margin-top:18px;font-size:12px;">
        <b>Terms &amp; Conditions:</b><br/>
        ${terms
          .split('\n')
          .map((line) => escapeHtml(line))
          .join('<br/>')}
      </div>

      <div style="margin-top:24px;font-size:13px;">
        With Thanks &amp; Regards,<br/>
        On Behalf of ${escapeHtml(businessName)},<br/>
        <br/>
        Marketing Manager<br/>
        <b>${escapeHtml(salespersonName)}</b><br/>
        ${escapeHtml(salespersonPhone)}
      </div>
    </body></html>`;
  }

  async function handleGenerate() {
    if (!userId) return;
    if (!clientName.trim()) {
      showAlert('Add a client', "Enter the client's name for this quotation.");
      return;
    }
    if (items.every((row) => !row.subject.trim())) {
      showAlert('Add an item', 'Add at least one line item to quote.');
      return;
    }
    setGenerating(true);
    try {
      let logoDataUri: string | null = null;
      if (profile?.business_logo_path) {
        logoDataUri = supabase.storage.from('business-assets').getPublicUrl(profile.business_logo_path).data.publicUrl;
      }
      const html = buildQuotationHtml(logoDataUri);
      const { uri } = await Print.printToFileAsync({ html });

      const quotationItems: QuotationItem[] = items.filter(isFilledRow).map((row) => ({
        photo_url: row.photoUrl,
        subject: row.subject.trim(),
        description: row.description.trim(),
        mrp: parseAmount(row.mrp),
        discount: parseAmount(row.discount),
        rate: parseAmount(row.rate),
        qty: Number(row.qty) || 0,
        amount: rowAmount(row),
      }));

      let pdfPath: string | null = null;
      try {
        const arraybuffer = await fetch(uri).then((res) => res.arrayBuffer());
        pdfPath = `${userId}/${quoteNo.replace(/[^A-Za-z0-9]/g, '-')}-${Date.now()}.pdf`;
        const { error } = await supabase.storage
          .from('quotations')
          .upload(pdfPath, arraybuffer, { contentType: 'application/pdf' });
        if (error) throw error;
      } catch {
        // Saving a copy is a nice-to-have - never block handing the PDF to
        // the reseller just because the upload step failed.
        pdfPath = null;
      }

      await insertQuotation.mutateAsync({
        owner_id: userId,
        quote_seq: nextSeq,
        quote_no: quoteNo,
        quote_date: date,
        subject: subject.trim() || null,
        client_name: clientName.trim(),
        client_address: clientAddress.trim() || null,
        salesperson_name: salespersonName.trim() || null,
        salesperson_phone: salespersonPhone.trim() || null,
        items: quotationItems,
        terms,
        total,
        pdf_path: pdfPath,
      } as any);

      if (Platform.OS !== 'web' && (await Sharing.isAvailableAsync())) {
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
      } else {
        showAlert('Quotation generated', `Saved as quote ${quoteNo}.`);
      }
      resetQuoteForm();
      router.back();
    } catch (err) {
      showAlert('Could not generate quotation', getErrorMessage(err));
    } finally {
      setGenerating(false);
    }
  }

  return (
    <ScrollView className="flex-1 bg-gray-50 px-6 pt-4" contentContainerStyle={{ paddingBottom: 100 }}>
      <Text className="mb-4 text-2xl font-bold text-gray-900">Generate Quotation</Text>

      {(!hasBusinessInfo || editingBusiness) && (
        <View className="mb-4 rounded-2xl border border-blue-200 bg-blue-50 p-4">
          <Text className="mb-3 text-sm font-bold text-blue-900">Business details</Text>
          <Text className="mb-1 text-xs font-medium text-gray-600">Business name</Text>
          <TextInput
            value={bizName}
            onChangeText={setBizName}
            placeholder="Your company name"
            className="mb-2.5 rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm"
          />
          <Text className="mb-1 text-xs font-medium text-gray-600">Registration no. (optional)</Text>
          <TextInput
            value={bizReg}
            onChangeText={setBizReg}
            className="mb-2.5 rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm"
          />
          <Text className="mb-1 text-xs font-medium text-gray-600">VAT no. (optional)</Text>
          <TextInput
            value={bizVat}
            onChangeText={setBizVat}
            className="mb-2.5 rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm"
          />
          <Text className="mb-1 text-xs font-medium text-gray-600">Address (optional)</Text>
          <TextInput
            value={bizAddress}
            onChangeText={setBizAddress}
            className="mb-2.5 rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm"
          />
          <Text className="mb-1 text-xs font-medium text-gray-600">Contact number (optional)</Text>
          <TextInput
            value={bizPhone}
            onChangeText={setBizPhone}
            className="mb-3 rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm"
          />
          <Pressable
            onPress={handlePickLogo}
            disabled={uploadingLogo}
            className="mb-3 flex-row items-center justify-center gap-1.5 rounded-lg border border-blue-600 bg-white py-2.5 disabled:opacity-50"
          >
            <Ionicons name={uploadingLogo ? 'hourglass-outline' : 'image-outline'} size={15} color="#2563EB" />
            <Text className="text-sm font-semibold text-blue-700">
              {uploadingLogo ? 'Uploading…' : bizLogoPath ? 'Logo added — tap to replace' : 'Add your logo (optional)'}
            </Text>
          </Pressable>
          <View className="flex-row gap-2">
            {/* Only when editing details already saved - there was no way to
                back out of an edit without saving it. */}
            {hasBusinessInfo && (
              <Pressable
                onPress={() => {
                  setBizName(profile?.business_name ?? '');
                  setBizReg(profile?.business_reg_no ?? '');
                  setBizVat(profile?.business_vat_no ?? '');
                  setBizAddress(profile?.business_address ?? '');
                  setBizPhone(profile?.business_phone ?? '');
                  setBizLogoPath(profile?.business_logo_path ?? null);
                  setEditingBusiness(false);
                }}
                disabled={savingBusiness}
                className="flex-1 items-center rounded-lg border border-gray-300 bg-white py-2.5 disabled:opacity-50"
              >
                <Text className="text-sm font-semibold text-gray-600">Cancel</Text>
              </Pressable>
            )}
            <Pressable
              onPress={handleSaveBusiness}
              disabled={savingBusiness}
              className="flex-1 items-center rounded-lg bg-blue-600 py-2.5 disabled:opacity-50"
            >
              <Text className="text-sm font-semibold text-white">{savingBusiness ? 'Saving…' : 'Save business details'}</Text>
            </Pressable>
          </View>
        </View>
      )}

      {hasBusinessInfo && !editingBusiness && (
        <Pressable onPress={() => setEditingBusiness(true)} className="mb-4 flex-row items-center justify-between rounded-xl border border-gray-200 bg-white p-3">
          <Text className="text-sm font-semibold text-gray-900">{profile?.business_name}</Text>
          <Text className="text-xs font-semibold text-blue-600">Edit</Text>
        </Pressable>
      )}

      <View className="rounded-2xl border border-gray-200 bg-white p-4">
        <FormSection icon="business-outline" title="Client" first>
          <Text className="mb-1 text-xs font-medium text-gray-500">Client name</Text>
          <TextInput
            value={clientName}
            onChangeText={setClientName}
            placeholder="Client / company name"
            className="mb-2.5 rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm"
          />
          <Text className="mb-1 text-xs font-medium text-gray-500">Address</Text>
          <TextInput
            value={clientAddress}
            onChangeText={setClientAddress}
            placeholder="Client address"
            className="rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm"
          />
        </FormSection>

        <FormSection icon="document-text-outline" title="Quote details">
          <Text className="mb-1 text-xs font-medium text-gray-500">Subject</Text>
          <TextInput
            value={subject}
            onChangeText={setSubject}
            placeholder="e.g. 4MP CCTV System Installation"
            className="mb-2.5 rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm"
          />
          <View className="mb-2.5 flex-row gap-2.5">
            <View className="flex-1">
              <Text className="mb-1 text-xs font-medium text-gray-500">Date</Text>
              <DateField value={date} onChange={setDate} />
            </View>
            <View className="flex-1">
              <Text className="mb-1 text-xs font-medium text-gray-500">Quote No.</Text>
              <TextInput
                value={quoteNo}
                onChangeText={(v) => {
                  setQuoteNo(v);
                  setQuoteNoTouched(true);
                }}
                className="rounded-lg border border-gray-300 bg-white px-3 py-3 text-sm"
              />
            </View>
          </View>
          <View className="flex-row gap-2.5">
            <View className="flex-1">
              <Text className="mb-1 text-xs font-medium text-gray-500">Salesperson</Text>
              <TextInput
                value={salespersonName}
                onChangeText={setSalespersonName}
                className="rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm"
              />
            </View>
            <View className="flex-1">
              <Text className="mb-1 text-xs font-medium text-gray-500">Phone</Text>
              <TextInput
                value={salespersonPhone}
                onChangeText={setSalespersonPhone}
                keyboardType="phone-pad"
                className="rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm"
              />
            </View>
          </View>
        </FormSection>

        <FormSection icon="cube-outline" title="Items">
          {items.map((row, index) => (
            <View key={index} className="mb-3 rounded-xl border border-gray-200 p-3">
              <View className="mb-2 flex-row items-center gap-2.5">
                <Pressable
                  onPress={() => setPickerRowIndex(index)}
                  className="h-14 w-14 items-center justify-center overflow-hidden rounded-lg bg-gray-100"
                >
                  {row.photoUrl ? (
                    <Image source={{ uri: row.photoUrl }} className="h-full w-full" resizeMode="cover" />
                  ) : (
                    <Ionicons name="images-outline" size={20} color="#9CA3AF" />
                  )}
                </Pressable>
                <View className="flex-1 gap-1.5">
                  <Pressable onPress={() => setPickerRowIndex(index)} className="self-start">
                    <Text className="text-xs font-semibold text-blue-600">Pick from catalog</Text>
                  </Pressable>
                  <Pressable onPress={() => handleUploadPhotoForRow(index)} className="self-start">
                    <Text className="text-xs font-semibold text-gray-500">Or upload a photo</Text>
                  </Pressable>
                </View>
                <Pressable onPress={() => removeRow(index)} hitSlop={8}>
                  <Ionicons name="trash-outline" size={18} color="#DC2626" />
                </Pressable>
              </View>
              <TextInput
                value={row.subject}
                onChangeText={(v) => updateRow(index, { subject: v })}
                placeholder="Subject (short name)"
                className="mb-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
              />
              <TextInput
                value={row.description}
                onChangeText={(v) => updateRow(index, { description: v })}
                placeholder="Description / specs"
                multiline
                className="mb-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                style={{ minHeight: 50, textAlignVertical: 'top' }}
              />
              <View className="flex-row gap-2">
                <TextInput
                  value={row.mrp}
                  onChangeText={(v) => updateRow(index, { mrp: decimalInput(v) })}
                  placeholder="MRP"
                  keyboardType="numeric"
                  className="flex-1 rounded-lg border border-gray-300 px-2.5 py-2 text-sm"
                />
                <TextInput
                  value={row.discount}
                  onChangeText={(v) => updateRow(index, { discount: decimalInput(v) })}
                  placeholder="Disc./unit"
                  keyboardType="numeric"
                  className="flex-1 rounded-lg border border-gray-300 px-2.5 py-2 text-sm"
                />
                <TextInput
                  value={row.rate}
                  onChangeText={(v) => updateRow(index, { rate: decimalInput(v) })}
                  placeholder="Rate"
                  keyboardType="numeric"
                  className="flex-1 rounded-lg border border-gray-300 px-2.5 py-2 text-sm"
                />
                <TextInput
                  value={row.qty}
                  onChangeText={(v) => updateRow(index, { qty: digitsInput(v) })}
                  placeholder="Qty"
                  keyboardType="numeric"
                  className="w-16 rounded-lg border border-gray-300 px-2.5 py-2 text-sm"
                />
              </View>
              <Text className="mt-2 text-right text-sm font-bold text-gray-900">
                NPR {rowAmount(row).toLocaleString()}
              </Text>
            </View>
          ))}
          <Pressable onPress={addRow} className="mb-2 self-start">
            <Text className="text-sm font-semibold text-blue-600">+ Add item</Text>
          </Pressable>
          <View className="mt-1 flex-row justify-end">
            <Text className="text-lg font-extrabold text-gray-900">Total NPR {total.toLocaleString()}</Text>
          </View>
        </FormSection>

        <FormSection icon="reader-outline" title="Terms & Conditions">
          <TextInput
            value={terms}
            onChangeText={setTerms}
            multiline
            numberOfLines={8}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-xs"
            style={{ minHeight: 140, textAlignVertical: 'top' }}
          />
        </FormSection>

        <Pressable
          onPress={handleGenerate}
          disabled={generating}
          className="items-center rounded-lg bg-blue-600 py-3 disabled:opacity-50"
        >
          <Text className="text-base font-semibold text-white">{generating ? 'Generating…' : 'Generate PDF'}</Text>
        </Pressable>
      </View>

      <ProductPickerModal
        visible={pickerRowIndex != null}
        products={myProducts ?? []}
        onSelect={handleSelectProduct}
        onClose={() => setPickerRowIndex(null)}
      />
    </ScrollView>
  );
}
