// lib/hooks/useCart.ts
import { create } from 'zustand';
import type { Product } from '../../types/database.types';

interface CartItem {
  product: Product;
  quantity: number;
}

interface CartState {
  sellerId: string | null;
  items: CartItem[];
  /** Returns false (and adds nothing) if the cart already holds a different seller's items. */
  addItem: (product: Product, quantity?: number) => boolean;
  updateQuantity: (productId: string, quantity: number) => void;
  removeItem: (productId: string) => void;
  clearCart: () => void;
}

export const useCartStore = create<CartState>((set, get) => ({
  sellerId: null,
  items: [],
  addItem: (product, quantity = 1) => {
    const { sellerId, items } = get();
    if (sellerId && sellerId !== product.seller_id) return false;

    const existing = items.find((i) => i.product.id === product.id);
    set({
      sellerId: product.seller_id,
      items: existing
        ? items.map((i) => (i.product.id === product.id ? { ...i, quantity: i.quantity + quantity } : i))
        : [...items, { product, quantity }],
    });
    return true;
  },
  updateQuantity: (productId, quantity) =>
    set((state) => {
      const items =
        quantity <= 0
          ? state.items.filter((i) => i.product.id !== productId)
          : state.items.map((i) => (i.product.id === productId ? { ...i, quantity } : i));
      // Same as removeItem: an emptied cart isn't tied to a seller any more,
      // otherwise stepping the last item down to 0 blocked adding anything
      // from a different seller.
      return { items, sellerId: items.length ? state.sellerId : null };
    }),
  removeItem: (productId) =>
    set((state) => {
      const items = state.items.filter((i) => i.product.id !== productId);
      return { items, sellerId: items.length ? state.sellerId : null };
    }),
  clearCart: () => set({ sellerId: null, items: [] }),
}));
