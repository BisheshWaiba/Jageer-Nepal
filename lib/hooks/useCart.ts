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

/** A listing's minimum order (wholesale listings set this; retail is 1). */
function minQty(product: Product): number {
  return Math.max(1, product.min_order_qty ?? 1);
}

/** Keeps a quantity inside what the listing allows: at least its minimum
 * order, at most what's in stock. Checkout re-checks both on the server
 * (place_order), this just stops the cart offering something that would
 * be refused. */
function clampQty(product: Product, quantity: number): number {
  const capped = Math.min(quantity, Math.max(0, product.stock_level));
  return Math.max(capped, Math.min(minQty(product), product.stock_level));
}

export const useCartStore = create<CartState>((set, get) => ({
  sellerId: null,
  items: [],
  addItem: (product, quantity = 1) => {
    const { sellerId, items } = get();
    if (sellerId && sellerId !== product.seller_id) return false;

    if (product.stock_level <= 0) return true;

    const existing = items.find((i) => i.product.id === product.id);
    // A first add starts at the listing's minimum order ("Add" on a
    // wholesale listing with a 10-unit minimum used to add 1, which
    // checkout then couldn't honour).
    const next = clampQty(product, existing ? existing.quantity + quantity : Math.max(quantity, minQty(product)));
    set({
      sellerId: product.seller_id,
      items: existing
        ? items.map((i) => (i.product.id === product.id ? { ...i, quantity: next } : i))
        : [...items, { product, quantity: next }],
    });
    return true;
  },
  updateQuantity: (productId, quantity) =>
    set((state) => {
      const current = state.items.find((i) => i.product.id === productId);
      // Stepping below the listing's minimum removes the line rather than
      // leaving an order the seller can't accept.
      const remove = !current || quantity <= 0 || (quantity < current.quantity && quantity < minQty(current.product));
      const items = remove
        ? state.items.filter((i) => i.product.id !== productId)
        : state.items.map((i) => (i.product.id === productId ? { ...i, quantity: clampQty(i.product, quantity) } : i));
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
