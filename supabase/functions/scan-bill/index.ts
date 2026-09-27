// Reads a photographed bill/receipt/payment slip with Gemini's vision model
// and returns structured fields so a Finance form (Sale, Purchase, Expense,
// Payment In/Out) can be pre-filled instead of typed by hand. The Gemini API
// key stays server-side here so it never ships inside the app bundle.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { checkDailyAiLimit, tooLarge, MAX_BASE64_CHARS } from '../_shared/limits.ts';

// See chat-assistant for why: the free tier's "lite" model has a much
// larger daily request cap than the full "flash" model does.
const GEMINI_MODEL = 'gemini-flash-lite-latest';

const PROMPT = `You are reading a photo of a business bill, receipt, invoice, or payment slip from Nepal. It may be handwritten or printed, in Nepali and/or English, and may use Nepali (Devanagari) digits or a Bikram Sambat (BS) date.

Extract these fields as JSON:
- vendor_name: the shop/business/party name on the bill (string, or null if not visible)
- amount: the final/grand total amount in NPR as a plain number (or null)
- date: the bill's date, converted to the Gregorian (AD) calendar, formatted YYYY-MM-DD (or null if no date is visible). If the date on the bill is a Bikram Sambat (BS) date, convert it to the equivalent AD date.
- vat_amount: the VAT amount in NPR if shown separately (or null)
- discount_amount: the discount amount in NPR if shown separately (or null)
- bill_no: the bill/invoice/receipt number if shown (or null)
- note: a short one-line description of what the bill is for (or null)
- items: an array of line items, each {description, qty, rate} with qty and rate as plain numbers - empty array if no itemized list is visible (e.g. a simple payment slip)

Only return the JSON object matching this shape. Never fabricate a value that isn't actually visible on the bill - use null (or an empty array for items) instead.`;

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    vendor_name: { type: 'STRING', nullable: true },
    amount: { type: 'NUMBER', nullable: true },
    date: { type: 'STRING', nullable: true },
    vat_amount: { type: 'NUMBER', nullable: true },
    discount_amount: { type: 'NUMBER', nullable: true },
    bill_no: { type: 'STRING', nullable: true },
    note: { type: 'STRING', nullable: true },
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          description: { type: 'STRING' },
          qty: { type: 'NUMBER' },
          rate: { type: 'NUMBER' },
        },
        required: ['description', 'qty', 'rate'],
      },
    },
  },
  required: ['vendor_name', 'amount', 'date', 'vat_amount', 'discount_amount', 'bill_no', 'note', 'items'],
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    // Just needs to be signed in - this isn't scoped to any particular row,
    // it's a stateless read of whatever photo is posted. Keeps the free
    // Gemini quota from being open to anonymous callers.
    const authHeader = req.headers.get('Authorization') ?? '';
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
    } = await callerClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: 'Sign in required' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const overLimit = await checkDailyAiLimit(callerClient);
    if (overLimit) return overLimit;

    const { image, mimeType } = await req.json();
    if (typeof image === 'string' && image.length > MAX_BASE64_CHARS) {
      return tooLarge('That photo is too large - try a smaller one.');
    }
    if (!image || typeof image !== 'string') {
      return new Response(JSON.stringify({ error: 'image is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const geminiKey = Deno.env.get('GEMINI_API_KEY');
    if (!geminiKey) {
      return new Response(JSON.stringify({ error: 'Bill scanning is not set up yet' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            { parts: [{ text: PROMPT }, { inline_data: { mime_type: mimeType || 'image/jpeg', data: image } }] },
          ],
          generationConfig: { responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA },
        }),
      }
    );

    if (!geminiRes.ok) {
      const detail = await geminiRes.text();
      return new Response(JSON.stringify({ error: `Could not read the bill (${geminiRes.status})`, detail }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const geminiData = await geminiRes.json();
    const text = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      return new Response(JSON.stringify({ error: 'Could not read anything off that photo' }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const parsed = JSON.parse(text);
    return new Response(JSON.stringify(parsed), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
