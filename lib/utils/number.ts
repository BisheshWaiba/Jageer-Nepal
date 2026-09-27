// lib/utils/number.ts

/** A typed money amount - accepts thousands separators and spaces
 * ("2,000", "1 500.50"). Null when blank or not a number. */
export function parseAmount(text: string): number | null {
  const cleaned = text.replace(/[,\s]/g, '');
  if (!cleaned) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

/** Keeps only what a non-negative decimal can contain, for numeric inputs
 * (drops minus signs, letters, and any second decimal point). */
export function decimalInput(text: string): string {
  const cleaned = text.replace(/[^0-9.]/g, '');
  const dot = cleaned.indexOf('.');
  return dot === -1 ? cleaned : cleaned.slice(0, dot + 1) + cleaned.slice(dot + 1).replace(/\./g, '');
}

/** Keeps only digits, for whole-number inputs (quantities, stock, phones). */
export function digitsInput(text: string): string {
  return text.replace(/[^0-9]/g, '');
}
