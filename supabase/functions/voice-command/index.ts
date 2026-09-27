// Understands a spoken Finance command (Nepali, English, or mixed) with
// Gemini's audio understanding and returns a structured action so the app
// can navigate to the right form pre-filled - the reseller still reviews
// and saves it themselves, nothing here writes to the database directly.
// Same shape as scan-bill: the Gemini key stays server-side.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { checkDailyAiLimit, tooLarge, nepalToday, MAX_BASE64_CHARS } from '../_shared/limits.ts';

// See chat-assistant for why: the free tier's "lite" model has a much
// larger daily request cap than the full "flash" model does.
const GEMINI_MODEL = 'gemini-flash-lite-latest';

// Built per request so "today" is always current (a module-level constant
// kept the date the instance started with).
const buildPrompt = () => `You are listening to a short voice command from a small business owner in Nepal, speaking Nepali, English, or a mix of both, about their bookkeeping app. Figure out which one of these five actions they mean, and pull out whatever details they mentioned:

- add_sale: recording a sale/bill to a customer
- add_purchase: recording a purchase/bill from a vendor or supplier
- add_expense: recording a business expense (rent, tea, transport, etc.)
- payment_in: recording a payment they RECEIVED from a customer, settling money owed to them
- payment_out: recording a payment they MADE to a vendor or customer

Return JSON with:
- transcript: your best transcription of what was said, in whatever script/language it was spoken (for the person to double check)
- understood: true only if you're confident it maps to exactly one of the five actions above
- action: one of "add_sale", "add_purchase", "add_expense", "payment_in", "payment_out", or null if not understood
- party_name: the customer/vendor name mentioned, or null
- amount: the amount in NPR as a plain number, or null
- date: a date if one was explicitly mentioned (e.g. "yesterday", "last Tuesday"), converted to YYYY-MM-DD (AD) relative to today being ${nepalToday()} - or null if no date was mentioned (meaning "today")
- note: a short note describing what it's for, or null
- items: an array of {description, qty, rate} ONLY if the command clearly itemizes a sale/purchase (rare in speech) - otherwise an empty array

Never fabricate a value that wasn't actually said - use null instead. If the command is unrelated to these five actions, or too unclear to map confidently, set understood to false and action to null, but still fill in transcript.`;

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    transcript: { type: 'STRING' },
    understood: { type: 'BOOLEAN' },
    action: { type: 'STRING', nullable: true },
    party_name: { type: 'STRING', nullable: true },
    amount: { type: 'NUMBER', nullable: true },
    date: { type: 'STRING', nullable: true },
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
  required: ['transcript', 'understood', 'action', 'party_name', 'amount', 'date', 'note', 'items'],
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
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

    const { audio, mimeType } = await req.json();
    if (typeof audio === 'string' && audio.length > MAX_BASE64_CHARS) {
      return tooLarge('That recording is too large - try a smaller one.');
    }
    if (!audio || typeof audio !== 'string') {
      return new Response(JSON.stringify({ error: 'audio is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const geminiKey = Deno.env.get('GEMINI_API_KEY');
    if (!geminiKey) {
      return new Response(JSON.stringify({ error: 'Voice commands are not set up yet' }), {
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
            { parts: [{ text: buildPrompt() }, { inline_data: { mime_type: mimeType || 'audio/aac', data: audio } }] },
          ],
          generationConfig: { responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA },
        }),
      }
    );

    if (!geminiRes.ok) {
      const detail = await geminiRes.text();
      return new Response(JSON.stringify({ error: `Could not understand that (${geminiRes.status})`, detail }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const geminiData = await geminiRes.json();
    const text = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      return new Response(JSON.stringify({ error: 'Could not hear anything usable in that recording' }), {
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
