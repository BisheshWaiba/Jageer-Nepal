// lib/components/CheckoutScreen.tsx
import { useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView } from 'react-native';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../supabase';
import { useAuthStore } from '../hooks/useAuth';
import { useCartStore } from '../hooks/useCart';
import { showAlert, getErrorMessage } from '../utils/alert';

export function CheckoutScreen({ redirectTo }: { redirectTo: string }) {
  const userId = useAuthStore((state) => state.session?.user.id);
  const items = useCartStore((state) => state.items);
  const sellerId = useCartStore((state) => state.sellerId);
  const updateQuantity = useCartStore((state) => state.updateQuantity);
  const clearCart = useCartStore((state) => state.clearCart);

  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const queryClient = useQueryClient();

  const total = items.reduce((sum, i) => sum + Number(i.product.price) * i.quantity, 0);

  async function handlePlaceOrder() {
    if (!userId || !sellerId || items.length === 0) return;
    if (!address.trim() || !city.trim()) {
      showAlert('Shipping address required', 'Please fill in an address and city.');
      return;
    }

    setSubmitting(true);
    try {
      // One server-side transaction (migration 0078): the order and all its
      // lines are saved together or not at all, so a failure can never
      // leave a half-filled order behind for a retry to duplicate.
      const { error } = await (supabase as any).rpc('place_order', {
        p_seller_id: sellerId,
        p_items: items.map((item) => ({ product_id: item.product.id, quantity: item.quantity })),
        p_shipping: { address: address.trim(), city: city.trim() },
      });
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['order_items'] });

      clearCart();
      showAlert('Order placed', 'The seller will confirm your order shortly.');
      router.replace(redirectTo as never);
    } catch (err) {
      showAlert('Could not place order', getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (items.length === 0) {
    return (
      <View className="flex-1 items-center justify-center bg-gray-50 px-6">
        <Text className="text-gray-500">Your cart is empty.</Text>
      </View>
    );
  }

  return (
    <ScrollView className="flex-1 bg-gray-50 px-6 pt-4" contentContainerStyle={{ paddingBottom: 40 }}>
      {items.map((item) => (
        <View
          key={item.product.id}
          className="mb-3 flex-row items-center justify-between rounded-lg border border-gray-200 bg-white p-4"
        >
          <View className="flex-1">
            <Text className="font-semibold text-gray-900">{item.product.name}</Text>
            <Text className="text-sm text-gray-500">NPR {Number(item.product.price).toLocaleString()} each</Text>
            <Text className="text-xs text-gray-400">
              {(item.product.min_order_qty ?? 1) > 1 ? `Min ${item.product.min_order_qty} · ` : ''}
              {item.product.stock_level} in stock
            </Text>
          </View>
          <View className="flex-row items-center gap-3">
            <Pressable onPress={() => updateQuantity(item.product.id, item.quantity - 1)} hitSlop={8}>
              <Text className="text-lg text-gray-500">−</Text>
            </Pressable>
            <Text className="min-w-[24px] text-center font-semibold">{item.quantity}</Text>
            <Pressable
              onPress={() => updateQuantity(item.product.id, item.quantity + 1)}
              disabled={item.quantity >= item.product.stock_level}
              hitSlop={8}
              className="disabled:opacity-30"
            >
              <Text className="text-lg text-gray-500">+</Text>
            </Pressable>
          </View>
        </View>
      ))}

      <View className="mb-4 mt-2 rounded-xl bg-white p-5">
        <Text className="mb-1 text-sm font-semibold text-gray-900">Shipping address</Text>
        <TextInput
          value={address}
          onChangeText={setAddress}
          placeholder="Street address"
          className="mb-2 rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
        <TextInput
          value={city}
          onChangeText={setCity}
          placeholder="City"
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
      </View>

      <View className="mb-4 rounded-xl bg-white p-5">
        <View className="mb-1 flex-row justify-between">
          <Text className="text-sm text-gray-500">Total</Text>
          <Text className="text-sm font-semibold text-gray-900">NPR {total.toLocaleString()}</Text>
        </View>
        <Text className="text-xs text-gray-400">Payment: Cash on Delivery</Text>
      </View>

      <Pressable
        onPress={handlePlaceOrder}
        disabled={submitting}
        className="items-center rounded-lg bg-orange-500 py-3 disabled:opacity-50"
      >
        <Text className="text-base font-semibold text-white">{submitting ? 'Placing order…' : 'Place order'}</Text>
      </Pressable>
    </ScrollView>
  );
}
