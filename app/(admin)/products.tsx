// app/(admin)/products.tsx
import { useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSupabaseQuery, useSupabaseUpdate, useSupabaseDelete } from '../../lib/hooks/useSupabase';
import { showAlert, getErrorMessage } from '../../lib/utils/alert';
import { parseAmount } from '../../lib/utils/number';
import type { Product } from '../../types/database.types';

function ProductRow({ product, sellerName }: { product: Product; sellerName: string }) {
  const updateProduct = useSupabaseUpdate('products');
  const deleteProduct = useSupabaseDelete('products');
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(product.name);
  const [price, setPrice] = useState(String(product.price));
  const [stockLevel, setStockLevel] = useState(String(product.stock_level));
  const [saving, setSaving] = useState(false);

  function startEditing() {
    setName(product.name);
    setPrice(String(product.price));
    setStockLevel(String(product.stock_level));
    setEditing(true);
  }

  async function handleSave() {
    const priceNum = parseAmount(price);
    const stockNum = stockLevel.trim() ? Number(stockLevel) : NaN;
    if (!name.trim()) {
      showAlert('Add a name', 'Product name is required.');
      return;
    }
    // A blank price used to save as NPR 0, and stock could be fractional.
    if (priceNum == null || priceNum < 0) {
      showAlert('Check the price', 'Enter a price (0 or more).');
      return;
    }
    if (!Number.isInteger(stockNum) || stockNum < 0) {
      showAlert('Check the stock', 'Stock must be a whole number, 0 or more.');
      return;
    }
    setSaving(true);
    try {
      await updateProduct.mutateAsync({
        id: product.id,
        values: { name: name.trim(), price: priceNum, stock_level: stockNum },
      });
      setEditing(false);
    } catch (err) {
      showAlert('Could not save', getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  function confirmRemove() {
    showAlert('Remove this listing?', `"${product.name}" will be delisted from the marketplace.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () =>
          deleteProduct.mutate(product.id, { onError: (err) => showAlert('Could not remove', getErrorMessage(err)) }),
      },
    ]);
  }

  if (editing) {
    return (
      <View className="mb-2.5 rounded-xl border border-blue-300 bg-white p-4">
        <Text className="mb-1 text-xs font-medium text-gray-500">Name</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          className="mb-2.5 rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
        <View className="mb-3 flex-row gap-2">
          <View className="flex-1">
            <Text className="mb-1 text-xs font-medium text-gray-500">Price (NPR)</Text>
            <TextInput
              value={price}
              onChangeText={setPrice}
              keyboardType="numeric"
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </View>
          <View className="flex-1">
            <Text className="mb-1 text-xs font-medium text-gray-500">Stock</Text>
            <TextInput
              value={stockLevel}
              onChangeText={setStockLevel}
              keyboardType="numeric"
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </View>
        </View>
        <View className="flex-row gap-2">
          <Pressable onPress={() => setEditing(false)} className="flex-1 items-center rounded-lg border border-gray-300 py-2">
            <Text className="text-sm font-semibold text-gray-600">Cancel</Text>
          </Pressable>
          <Pressable
            onPress={handleSave}
            disabled={saving}
            className="flex-1 items-center rounded-lg bg-orange-500 py-2 disabled:opacity-50"
          >
            <Text className="text-sm font-semibold text-white">{saving ? 'Saving…' : 'Save'}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View className="mb-2.5 rounded-xl border border-gray-200 bg-white p-4">
      <View className="flex-row items-center justify-between">
        <Text className="flex-1 font-semibold text-gray-900">{product.name}</Text>
        <View className="flex-row items-center gap-3">
          <Pressable onPress={startEditing} hitSlop={8}>
            <Ionicons name="pencil" size={16} color="#2563eb" />
          </Pressable>
          <Pressable onPress={confirmRemove} className="rounded-lg bg-red-50 px-3 py-1.5">
            <Text className="text-xs font-semibold text-red-700">Remove</Text>
          </Pressable>
        </View>
      </View>
      <View className="mt-1 flex-row items-center gap-2">
        <Text className="text-xs text-gray-400">Seller: {sellerName}</Text>
        <View
          className={`rounded-full px-2 py-0.5 ${product.seller_role === 'wholesaler' ? 'bg-purple-50' : 'bg-orange-50'}`}
        >
          <Text
            className={`text-[10px] font-bold uppercase ${
              product.seller_role === 'wholesaler' ? 'text-purple-600' : 'text-orange-600'
            }`}
          >
            {product.seller_role}
          </Text>
        </View>
      </View>
      <Text className="mt-1 text-sm text-gray-600">
        NPR {Number(product.price).toLocaleString()} · {product.stock_level} in stock
        {product.wholesale_price != null && ` · Wholesale NPR ${Number(product.wholesale_price).toLocaleString()}`}
      </Text>
    </View>
  );
}

export default function AdminProducts() {
  const { data: products, isLoading } = useSupabaseQuery('products', {
    orderBy: { column: 'created_at', ascending: false },
  });
  const { data: profiles } = useSupabaseQuery('profiles', {});

  const sellerMap = useMemo(() => new Map((profiles ?? []).map((p) => [p.id, p])), [profiles]);

  return (
    <ScrollView className="flex-1 bg-gray-50 px-6 pt-4" contentContainerStyle={{ paddingBottom: 40 }}>
      <Text className="mb-4 text-sm text-gray-500">
        Every product currently stocked by a wholesaler or reseller. New listings are self-service — manage what can
        be stocked from the Catalog tab.
      </Text>

      {isLoading && <Text className="text-gray-500">Loading…</Text>}
      {!isLoading && (products?.length ?? 0) === 0 && <Text className="text-gray-500">No listings yet.</Text>}

      {(products ?? []).map((item) => (
        <ProductRow key={item.id} product={item} sellerName={sellerMap.get(item.seller_id)?.full_name ?? 'Unknown'} />
      ))}
    </ScrollView>
  );
}
