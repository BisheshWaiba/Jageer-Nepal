// app/(wholesaler)/product/[id].tsx
import { useState } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useAuthStore } from '../../../lib/hooks/useAuth';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import { useSupabaseRow } from '../../../lib/hooks/useSupabase';
import { showAlert, getErrorMessage } from '../../../lib/utils/alert';

const PLATFORM_FEE_RATE = 0.075;

export default function WholesaleProductDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const userId = useAuthStore((state) => state.session?.user.id);
  const { data: product, isLoading } = useSupabaseRow('products', id);

  const queryClient = useQueryClient();

  const [quantity, setQuantity] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (isLoading || !product) {
    return (
      <View className="flex-1 items-center justify-center bg-gray-50">
        <Text className="text-gray-500">Loading…</Text>
      </View>
    );
  }

  const qty = quantity ?? product.min_order_qty;
  // The price place_order actually charges (it prices from `price`).
  const unitPrice = Number(product.price);
  const total = unitPrice * qty;
  const platformFee = Math.round(total * PLATFORM_FEE_RATE);

  async function handleRequestOrder() {
    if (!userId) return;
    if (qty < product!.min_order_qty) {
      showAlert('Below minimum order', `This listing requires at least ${product!.min_order_qty} units.`);
      return;
    }
    if (qty > product!.stock_level) {
      showAlert('Not enough stock', `Only ${product!.stock_level} units are available.`);
      return;
    }

    setSubmitting(true);
    try {
      // Orders can only be placed through place_order now (migration 0079),
      // which prices the line itself and checks stock and the minimum.
      const { error } = await (supabase as any).rpc('place_order', {
        p_seller_id: product!.seller_id,
        p_items: [{ product_id: product!.id, quantity: qty }],
        p_shipping: null,
      });
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      showAlert('Bulk order requested', 'The seller will confirm your order shortly.');
      router.replace('/(wholesaler)/orders');
    } catch (err) {
      showAlert('Could not place order', getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ScrollView className="flex-1 bg-gray-50 px-6 pt-4" contentContainerStyle={{ paddingBottom: 40 }}>
      <Text className="mb-1 text-2xl font-bold text-gray-900">{product.name}</Text>
      <Text className="mb-6 text-sm text-gray-500">Minimum order quantity: {product.min_order_qty} units</Text>

      <View className="mb-4 rounded-xl bg-white p-5">
        <View className="mb-1 flex-row justify-between">
          <Text className="text-sm text-gray-500">Unit price</Text>
          <Text className="text-sm font-semibold text-gray-900">NPR {unitPrice.toLocaleString()}</Text>
        </View>
        <View className="flex-row justify-between">
          <Text className="text-sm text-gray-500">Available stock</Text>
          <Text className="text-sm font-semibold text-gray-900">{product.stock_level} units</Text>
        </View>
      </View>

      <Text className="mb-2 text-sm font-semibold text-gray-900">Quantity</Text>
      <View className="mb-4 flex-row items-center gap-4 rounded-xl border border-gray-200 bg-white p-4">
        <Pressable onPress={() => setQuantity(Math.max(product.min_order_qty, qty - product.min_order_qty))}>
          <Text className="text-xl text-gray-500">−</Text>
        </Pressable>
        <Text className="flex-1 text-center text-base font-semibold text-gray-900">{qty}</Text>
        <Pressable onPress={() => setQuantity(qty + product.min_order_qty)}>
          <Text className="text-xl text-gray-500">+</Text>
        </Pressable>
      </View>

      <View className="mb-6 flex-row items-center gap-2.5 rounded-xl bg-[#F1E9FE] px-4 py-3.5">
        <Text className="text-xs font-semibold text-[#5B21B6]">Escrow protection available on this order</Text>
      </View>

      <View className="mb-4 rounded-xl bg-white p-5">
        <View className="flex-row justify-between">
          <Text className="text-sm text-gray-500">Total</Text>
          <Text className="text-base font-bold text-[#7C3AED]">NPR {total.toLocaleString()}</Text>
        </View>
      </View>

      <Pressable
        onPress={handleRequestOrder}
        disabled={submitting}
        className="items-center rounded-xl bg-[#7C3AED] py-3.5 disabled:opacity-50"
      >
        <Text className="text-base font-semibold text-white">
          {submitting ? 'Requesting…' : 'Request Bulk Order'}
        </Text>
      </Pressable>
    </ScrollView>
  );
}
