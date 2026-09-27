// lib/components/CatalogProductDetail.tsx
import { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Image } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useAuthStore } from '../hooks/useAuth';
import { useSupabaseRow, useSupabaseQuery, useSupabaseUpsert } from '../hooks/useSupabase';
import { decimalInput } from '../utils/number';
import { showAlert, getErrorMessage } from '../utils/alert';
import { toSafeImageUri } from '../utils/image';

export function CatalogProductDetail({
  priceLabel,
  capToPurchasedStock = false,
}: {
  priceLabel: string;
  capToPurchasedStock?: boolean;
}) {
  const { id } = useLocalSearchParams<{ id: string }>();
  const userId = useAuthStore((state) => state.session?.user.id);

  const { data: item, isLoading } = useSupabaseRow('catalog_products', id);
  const { data: myProducts } = useSupabaseQuery('products', {
    filters: userId ? { seller_id: userId } : {},
    enabled: !!userId,
  });
  const existing = (myProducts ?? []).find((p) => p.catalog_id === id);

  const upsertProduct = useSupabaseUpsert('products', 'seller_id,catalog_id');
  const [qty, setQty] = useState(existing?.stock_level ?? 0);
  const [price, setPrice] = useState(existing ? String(existing.price) : '');
  const [saving, setSaving] = useState(false);

  // `existing` comes from a second, separately-loading query - it's almost
  // never ready by the time these useState initializers run, so re-sync once
  // it (or a different stocked item) actually arrives.
  useEffect(() => {
    if (existing) {
      setQty(existing.stock_level);
      setPrice(String(existing.price));
    }
  }, [existing?.id]);

  if (isLoading || !item) {
    return (
      <View className="flex-1 items-center justify-center bg-gray-50">
        <Text className="text-gray-500">Loading…</Text>
      </View>
    );
  }

  const isStocked = !!existing;
  const dirty = qty !== (existing?.stock_level ?? 0) || price !== (existing ? String(existing.price) : '');
  const purchasedStock = existing?.purchased_stock ?? 0;
  const purchasePrice = existing?.purchase_price ?? null;
  const atPurchasedCap = capToPurchasedStock && qty >= purchasedStock;
  const nothingPurchased = capToPurchasedStock && purchasedStock <= 0;

  const typedPrice = parseFloat(price);
  const resalePrice = Number.isNaN(typedPrice) ? null : typedPrice;
  const margin =
    purchasePrice != null && resalePrice != null
      ? { amount: resalePrice - purchasePrice, pct: purchasePrice > 0 ? ((resalePrice - purchasePrice) / purchasePrice) * 100 : 0 }
      : null;

  async function handleSave() {
    if (!userId) return;
    if (capToPurchasedStock && qty > purchasedStock) {
      showAlert('Not enough purchased stock', `You've only bought ${purchasedStock} of this item from wholesale.`);
      return;
    }
    const priceNum = parseFloat(price);
    if (qty > 0 && (Number.isNaN(priceNum) || priceNum <= 0)) {
      showAlert('Set a price', 'Enter a valid price before stocking this item.');
      return;
    }
    setSaving(true);
    try {
      await upsertProduct.mutateAsync({
        seller_id: userId,
        catalog_id: item!.id,
        name: item!.name,
        description: item!.description,
        category: item!.category,
        image_url: item!.image_url,
        price: Number.isNaN(priceNum) ? 0 : priceNum,
        stock_level: qty,
        min_order_qty: existing?.min_order_qty ?? 1,
      });
      showAlert('Saved', isStocked ? 'Your listing was updated.' : 'Added to your listings.');
    } catch (err) {
      showAlert('Could not update stock', getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView className="flex-1 bg-gray-50" contentContainerStyle={{ paddingBottom: 40 }}>
      <View className="px-6 pt-16">
        <View className="mb-4 aspect-square items-center justify-center overflow-hidden rounded-2xl bg-gray-100">
          {item.image_url ? (
            <Image source={{ uri: toSafeImageUri(item.image_url)! }} className="h-full w-full" resizeMode="cover" />
          ) : (
            <Text className="text-5xl">📦</Text>
          )}
        </View>

        {item.category && (
          <Text className="text-xs font-bold uppercase tracking-wide text-orange-600">{item.category}</Text>
        )}
        <Text className="mt-1 text-xl font-extrabold text-gray-900">{item.name}</Text>
        {isStocked && <Text className="mt-1 text-xs text-gray-400">Currently in your listings</Text>}

        {item.description && <Text className="mt-3.5 text-sm leading-6 text-gray-600">{item.description}</Text>}
      </View>

      <View className="mt-6 border-t border-gray-200 bg-white px-6 pt-5">
        <Text className="mb-3 text-sm font-semibold text-gray-900">
          {isStocked ? 'Update your listing' : 'Stock this item'}
        </Text>

        {capToPurchasedStock && purchasedStock <= 0 && (
          <Text className="mb-3 text-xs font-medium text-gray-500">
            Buy this from Wholesale first to list it here.
          </Text>
        )}

        {capToPurchasedStock && purchasePrice != null && (
          <>
            <Text className="mb-3 text-xs font-medium text-gray-500">
              Purchased from wholesale: {purchasedStock} unit{purchasedStock === 1 ? '' : 's'}
            </Text>
            <View className="mb-3 flex-row gap-3">
              <View className="flex-1 rounded-xl border border-gray-200 bg-gray-50 p-3.5">
                <Text className="text-[11px] text-gray-500">Wholesale price</Text>
                <Text className="mt-1 text-lg font-extrabold text-gray-900">
                  NPR {Number(purchasePrice).toLocaleString()}
                </Text>
              </View>
              <View className="flex-1 rounded-xl bg-emerald-50 p-3.5">
                <Text className="text-[11px] text-emerald-700">Your resale price</Text>
                <Text className="mt-1 text-lg font-extrabold text-emerald-700">
                  {resalePrice != null ? `NPR ${resalePrice.toLocaleString()}` : '—'}
                </Text>
              </View>
            </View>
            {margin && (
              <View className="mb-3 self-start rounded-full bg-orange-50 px-3 py-1.5">
                <Text className="text-xs font-bold text-orange-600">
                  Margin: NPR {margin.amount.toLocaleString()} ({margin.pct.toFixed(1)}%)
                </Text>
              </View>
            )}
          </>
        )}

        <View className="mb-5 flex-row items-center gap-3">
          <View className="flex-row items-center rounded-lg border border-gray-300">
            <Pressable onPress={() => setQty((q) => Math.max(0, q - 1))} className="px-4 py-2.5">
              <Text className="text-lg text-gray-500">−</Text>
            </Pressable>
            <Text className="w-12 text-center text-base font-semibold text-gray-900">{qty}</Text>
            <Pressable
              onPress={() => setQty((q) => (capToPurchasedStock ? Math.min(purchasedStock, q + 1) : q + 1))}
              disabled={atPurchasedCap}
              className="px-4 py-2.5 disabled:opacity-30"
            >
              <Text className="text-lg text-gray-500">+</Text>
            </Pressable>
          </View>

          <View className="flex-1">
            <Text className="mb-1 text-[11px] text-gray-400">{priceLabel} (NPR)</Text>
            <TextInput
              value={price}
              onChangeText={(v) => setPrice(decimalInput(v))}
              placeholder="0.00"
              keyboardType="decimal-pad"
              editable={!nothingPurchased}
              className="rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900"
            />
          </View>
        </View>

        <Pressable
          onPress={handleSave}
          disabled={saving || !dirty || nothingPurchased}
          className="items-center rounded-xl bg-orange-500 py-3.5 disabled:opacity-40"
        >
          <Text className="text-base font-semibold text-white">
            {saving ? 'Saving…' : isStocked ? 'Update listing' : 'Add to my listings'}
          </Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}
