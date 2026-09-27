// lib/components/OrderDetailScreen.tsx
import { useMemo, useState } from 'react';
import { View, Text, Image, Pressable, Linking } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../hooks/useAuth';
import { useSupabaseRow, useSupabaseQuery } from '../hooks/useSupabase';
import { useAdvanceOrder } from '../hooks/useAdvanceOrder';
import { showAlert } from '../utils/alert';
import { ChatThread } from './ChatThread';
import {
  DetailShell,
  ScrollTarget,
  useDetailScroll,
  DetailHero,
  DetailCard,
  DetailTimeline,
  NextStepCard,
  DetailButton,
  useWideDetail,
  type TimelineStep,
} from './detail/DetailLayout';
import { NEXT_STATUS, STATUS_ACTION_LABEL } from '../utils/orderStatus';
import type { OrderStatus } from '../../types/database.types';

const STATUS_LABEL: Record<OrderStatus, string> = {
  pending: 'Order placed',
  confirmed: 'Confirmed',
  shipped: 'On the way',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

function orderSteps(status: OrderStatus, isOwner: boolean): TimelineStep[] {
  const order: OrderStatus[] = ['pending', 'confirmed', 'delivered'];
  const currentIndex = order.indexOf(status === 'shipped' ? 'confirmed' : status);
  const meta = [
    null,
    isOwner ? 'You confirm and pack it' : 'The seller confirms it',
    isOwner ? 'Mark delivered when handed over' : 'Handed over to you',
  ];
  return order.map((step, index) => ({
    label: STATUS_LABEL[step],
    meta: index === currentIndex && status !== 'delivered' ? meta[index] : null,
    done: index < currentIndex || status === 'delivered',
    now: index === currentIndex && status !== 'delivered',
  }));
}

/** Small translucent action on the coloured band - call / message the
 * customer without a separate card taking up a row of the page. */
function HeroIconButton({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="h-10 w-10 items-center justify-center rounded-full"
      style={{ backgroundColor: 'rgba(255,255,255,0.22)' }}
    >
      <Ionicons name={icon} size={18} color="#fff" />
    </Pressable>
  );
}

/** "Message" means the thread on this page, not the phone's SMS app - that
 * is where the customer is actually writing from. Its own component so the
 * scroll hook runs inside the shell that provides it. */
function ChatIconButton({ onFocus }: { onFocus: () => void }) {
  const { scrollTo } = useDetailScroll();
  return (
    <HeroIconButton
      icon="chatbubble-outline"
      label="Message customer"
      onPress={() => {
        scrollTo('messages');
        onFocus();
      }}
    />
  );
}

export function OrderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const userId = useAuthStore((state) => state.session?.user.id);
  const wide = useWideDetail();

  const { data: order, isLoading } = useSupabaseRow('orders', id);
  const { data: orderItems } = useSupabaseQuery('order_items', {
    filters: id ? { order_id: id } : {},
    enabled: !!id,
  });
  const { data: products } = useSupabaseQuery('products', {});

  const counterpartyId = order && order.buyer_id === userId ? order.seller_id : order?.buyer_id;
  const counterpartyRole = order?.buyer_id === userId ? 'Sold by' : 'Ordered by';
  const { data: counterparty } = useSupabaseRow('profiles', counterpartyId);

  const { advance, cancel, isBusy } = useAdvanceOrder();
  const [chatFocus, setChatFocus] = useState(0);

  const productMap = useMemo(() => new Map((products ?? []).map((p) => [p.id, p])), [products]);

  if (isLoading || !order) {
    return (
      <View className="flex-1 items-center justify-center bg-gray-50">
        <Text className="text-gray-500">Loading…</Text>
      </View>
    );
  }

  const nextStatus = NEXT_STATUS[order.status];
  const nextLabel = STATUS_ACTION_LABEL[order.status];
  const isOwner = order.seller_id === userId;
  const canAdvance = isOwner && !!nextStatus && !!nextLabel;
  // The seller can call off an order until it's delivered; the buyer only
  // while it's still waiting for the seller to confirm.
  const isBuyer = order.buyer_id === userId;
  const canCancel =
    (isOwner && (order.status === 'pending' || order.status === 'confirmed' || order.status === 'shipped')) ||
    (isBuyer && order.status === 'pending');

  function confirmCancel() {
    if (!order) return;
    showAlert(
      'Cancel this order?',
      isOwner
        ? order.status === 'pending'
          ? 'The customer is told you declined it.'
          : 'Any stock set aside for it goes back to your listings.'
        : 'The seller is told you no longer want it.',
      [
        { text: 'Keep order', style: 'cancel' },
        { text: 'Cancel order', style: 'destructive', onPress: () => cancel(order) },
      ]
    );
  }

  const cancelButton = canCancel ? (
    <DetailButton
      label="Cancel order"
      icon="close-circle-outline"
      kind="ghost"
      height={42}
      disabled={isBusy}
      onPress={confirmCancel}
    />
  ) : null;

  // Same privacy rule as the order card in the list: photo, name, and
  // delivery address are always visible, but the contact number stays
  // hidden until the order has actually been accepted (confirmed onward).
  const isAccepted = order.status !== 'pending';
  const shipping = order.shipping_address as { address?: string; city?: string } | null;
  const shippingAddress = shipping ? [shipping.address, shipping.city].filter(Boolean).join(', ') : null;
  const itemCount = orderItems?.length ?? 0;
  const total = `NPR ${Number(order.total_amount).toLocaleString()}`;

  const advanceButton = canAdvance ? (
    <DetailButton
      label={isBusy ? 'Updating…' : nextLabel}
      icon="checkmark-circle"
      kind="green"
      disabled={isBusy}
      onPress={() => advance(order)}
    />
  ) : null;

  const rightColumn = (
    <>
      {/* On a phone the same action is already pinned to the bottom bar, so
          this card would only repeat it underneath the chat. */}
      {canAdvance && wide && (
        <NextStepCard
          wide={wide}
          title={order.status === 'pending' ? 'Confirm this order' : 'Hand it over'}
          hint={
            order.status === 'pending'
              ? 'Confirming shares your number with the customer and moves it to My Requests.'
              : 'Mark it delivered once the customer has the items.'
          }
        >
          {advanceButton}
          {cancelButton}
        </NextStepCard>
      )}
      {/* On a phone the advance button lives in the bottom bar, and a buyer
          has no next step - either way cancelling gets its own card. */}
      {canCancel && (!wide || !canAdvance) && (
        <DetailCard wide={wide} icon="close-circle-outline" title="Change of plan?">
          {cancelButton}
        </DetailCard>
      )}

      <DetailCard wide={wide} icon="time-outline" title="Progress">
        {order.status === 'cancelled' ? (
          <Text className="text-sm font-semibold text-red-600">This order was cancelled.</Text>
        ) : (
          <DetailTimeline steps={orderSteps(order.status, isOwner)} />
        )}
      </DetailCard>
    </>
  );

  return (
    <DetailShell
      right={rightColumn}
      bottomBar={
        canAdvance ? (
          <>
            <View className="flex-1">
              <Text className="text-[11px] font-bold uppercase tracking-wide text-gray-400">Next step</Text>
              <Text className="text-[13.5px] font-bold text-gray-900">{nextLabel}</Text>
            </View>
            <View style={{ minWidth: 168 }}>{advanceButton}</View>
          </>
        ) : null
      }
    >
      <DetailHero
        wide={wide}
        tone="blue"
        icon={
          <View
            className="items-center justify-center rounded-2xl"
            style={{ width: wide ? 62 : 52, height: wide ? 62 : 52, backgroundColor: 'rgba(255,255,255,0.18)' }}
          >
            <Ionicons name="gift" size={wide ? 30 : 26} color="#fff" />
          </View>
        }
        title={`Order #${order.id.slice(0, 8)}`}
        pill={STATUS_LABEL[order.status]}
        amountLabel="Order total"
        amount={total}
        facts={[
          {
            icon: 'person-outline',
            label: counterpartyRole,
            value: counterparty?.full_name ?? '…',
            sub: isAccepted ? counterparty?.phone : 'Phone unlocks when you confirm',
            photoUrl: counterparty?.avatar_url,
          },
          ...(shippingAddress
            ? ([{ icon: 'location-outline' as const, label: 'Deliver to', value: shippingAddress }] as const)
            : []),
        ]}
        actions={
          isAccepted && !!counterparty?.phone ? (
            <View className="flex-row" style={{ gap: 8 }}>
              <HeroIconButton icon="call-outline" label="Call customer" onPress={() => Linking.openURL(`tel:${counterparty.phone}`)} />
              <ChatIconButton onFocus={() => setChatFocus((n) => n + 1)} />
            </View>
          ) : null
        }
      />

      <DetailCard wide={wide} icon="bag-outline" title="Items">
        {/* Invoice-style columns: SN · Items · Qty · Rate · Amount. */}
        {wide && (
          <View className="flex-row items-center gap-3 px-3 pb-2.5">
            <Text className="text-[11px] font-bold uppercase tracking-wide text-gray-500" style={{ width: 28 }}>
              SN
            </Text>
            <View style={{ width: 48 }} />
            <Text className="flex-1 text-[11px] font-bold uppercase tracking-wide text-gray-500">Items</Text>
            <Text className="text-right text-[11px] font-bold uppercase tracking-wide text-gray-500" style={{ width: 60 }}>
              Qty
            </Text>
            <Text className="text-right text-[11px] font-bold uppercase tracking-wide text-gray-500" style={{ width: 120 }}>
              Rate
            </Text>
            <Text className="text-right text-[11px] font-bold uppercase tracking-wide text-gray-500" style={{ width: 130 }}>
              Amount
            </Text>
          </View>
        )}
        <View style={{ gap: 10 }}>
          {orderItems?.map((item, index) => {
            const product = productMap.get(item.product_id);
            const rate = `NPR ${Number(item.unit_price).toLocaleString()}`;
            const lineTotal = `NPR ${(Number(item.unit_price) * item.quantity).toLocaleString()}`;
            const thumb = (
              <View className="h-12 w-12 items-center justify-center overflow-hidden rounded-xl bg-gray-100">
                {product?.image_url ? (
                  <Image source={{ uri: product.image_url }} style={{ width: 48, height: 48 }} resizeMode="cover" />
                ) : (
                  <Ionicons name="cube-outline" size={22} color="#9CA3AF" />
                )}
              </View>
            );

            if (wide) {
              return (
                <View key={item.id} className="flex-row items-center gap-3 rounded-xl border border-gray-100 p-3">
                  <Text className="text-[13px] font-semibold text-gray-400" style={{ width: 28 }}>
                    {index + 1}
                  </Text>
                  {thumb}
                  <Text className="flex-1 text-[15px] font-semibold text-gray-900">{product?.name ?? 'Product'}</Text>
                  <Text className="text-right text-[14px] text-gray-700" style={{ width: 60 }}>
                    {item.quantity}
                  </Text>
                  <Text className="text-right text-[14px] text-gray-700" style={{ width: 120 }}>
                    {rate}
                  </Text>
                  <Text className="text-right text-[15px] font-bold text-gray-900" style={{ width: 130 }}>
                    {lineTotal}
                  </Text>
                </View>
              );
            }

            return (
              <View key={item.id} className="flex-row items-center gap-3 rounded-xl border border-gray-100 p-3">
                <Text className="text-[13px] font-semibold text-gray-400" style={{ width: 16 }}>
                  {index + 1}
                </Text>
                {thumb}
                <View className="flex-1" style={{ gap: 2 }}>
                  <Text className="text-[15px] font-semibold text-gray-900">{product?.name ?? 'Product'}</Text>
                  <Text className="text-[12.5px] text-gray-400">
                    {item.quantity} × {rate}
                  </Text>
                </View>
                <Text className="text-[15px] font-bold text-gray-900">{lineTotal}</Text>
              </View>
            );
          })}
        </View>
        <View className="mt-3.5 flex-row items-baseline justify-between border-t border-gray-100 pt-3.5">
          <Text className="text-[15px] font-bold text-gray-900">Total</Text>
          <Text className="text-xl font-extrabold text-gray-900">{total}</Text>
        </View>
      </DetailCard>

      <ScrollTarget name="messages">
        <DetailCard wide={wide} icon="chatbubble-outline" title="Messages">
          <ChatThread subjectType="order" subjectId={order.id} focusToken={chatFocus} />
        </DetailCard>
      </ScrollTarget>
    </DetailShell>
  );
}
