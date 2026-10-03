// lib/components/finance/moneyColors.ts

export interface MoneyTone {
  /** Figures on a white or tinted background. */
  text: string;
  /** Icons and chart lines. */
  base: string;
  /** The soft tint behind a pill or tile. */
  bg: string;
  border: string;
}

/** One rule for every money figure in the app: money coming in (a sale, what
 * customers owe you, cash received) is green, money going out (a purchase, an
 * expense, what you owe vendors, cash paid) is red. Things that are neither -
 * a balance, a transfer between your own accounts, stock - keep their own
 * colours. */
export const MONEY: { in: MoneyTone; out: MoneyTone } = {
  in: { text: '#047857', base: '#059669', bg: '#ECFDF5', border: '#A7F3D0' },
  out: { text: '#B91C1C', base: '#DC2626', bg: '#FEF2F2', border: '#FECACA' },
};
