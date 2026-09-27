// lib/utils/parseStatement.ts
import * as XLSX from 'xlsx';
import { localTodayIso } from './localDate';

export type StatementAction = 'payment_out' | 'expense' | 'withdraw' | 'payment_in' | 'deposit';

export const DEBIT_TYPES: StatementAction[] = ['payment_out', 'expense', 'withdraw'];
export const CREDIT_TYPES: StatementAction[] = ['payment_in', 'deposit'];

export interface ParsedStatementRow {
  referenceCode: string;
  date: string;
  description: string;
  debit: number;
  credit: number;
  suggestedType: StatementAction;
  suggestedParty: string;
}

// "Withdraw"/"Deposit" are the reseller moving their own money in/out of the
// wallet (a bank transfer, a wallet fee, a loan) - not a party payment or a
// business expense, so they default there instead of Payment/Expense.
const OWN_MONEY_PATTERNS = [/^Charge on payment/i, /^Bank transfer charges/i, /^Loan Disbursement Charge/i, /^Cashback on/i];

function classify(description: string, direction: 'debit' | 'credit'): { type: StatementAction; party: string } {
  let m: RegExpMatchArray | null;
  if ((m = description.match(/^Fund Transferred to\s+(.+)$/i))) return { type: 'payment_out', party: m[1].trim() };
  if ((m = description.match(/^Fund Transferred by\s+(.+)$/i))) return { type: 'payment_in', party: m[1].trim() };
  if ((m = description.match(/^Money transferred to\s+(.+)$/i))) return { type: 'withdraw', party: m[1].trim() };
  if ((m = description.match(/^Money transferred from\s+(.+)$/i))) return { type: 'deposit', party: m[1].trim() };
  if ((m = description.match(/^Loan Disbursement from\s+(.+)$/i))) return { type: 'deposit', party: m[1].trim() };
  if ((m = description.match(/^Paid for\s+(.+)$/i))) return { type: 'expense', party: m[1].trim() };
  if ((m = description.match(/^(.+?)\s+topup to\s+.+$/i))) return { type: 'expense', party: m[1].trim() };

  for (const pattern of OWN_MONEY_PATTERNS) {
    if (pattern.test(description)) return { type: direction === 'debit' ? 'withdraw' : 'deposit', party: '' };
  }

  // No recognizable pattern - fall back to the most common bucket for that
  // direction; the reseller can still change it before importing.
  return { type: direction === 'debit' ? 'expense' : 'payment_in', party: '' };
}

/** Parses an eSewa-style statement export (Reference Code / Date Time /
 * Description / Dr. / Cr. / Status / Balance / Channel columns) into rows
 * ready for review. Only COMPLETE transactions are returned - pending or
 * failed ones were never real money movement. */
export function parseStatementWorkbook(base64: string): ParsedStatementRow[] {
  const workbook = XLSX.read(base64, { type: 'base64' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) return [];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });

  const headerIdx = rows.findIndex((row) => String(row[0]).trim() === 'Reference Code');
  if (headerIdx === -1) return [];

  const out: ParsedStatementRow[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    const referenceCode = String(row[0] ?? '').trim();
    if (!referenceCode) continue;
    const dateTime = String(row[1] ?? '').trim();
    const description = String(row[2] ?? '').trim();
    const debit = Number(row[3]) || 0;
    const credit = Number(row[4]) || 0;
    const status = String(row[5] ?? '').trim();
    if (status.toUpperCase() !== 'COMPLETE') continue;

    const { type, party } = classify(description, credit > 0 ? 'credit' : 'debit');
    out.push({
      referenceCode,
      date: dateTime.slice(0, 10) || localTodayIso(),
      description,
      debit,
      credit,
      suggestedType: type,
      suggestedParty: party,
    });
  }
  return out;
}
