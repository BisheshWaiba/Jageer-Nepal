// A short back-and-forth conversation (text or voice, Nepali/English/mixed)
// that helps the business owner log a Finance entry - it can ask a
// clarifying question ("who's it for?") instead of the one-shot guess
// voice-command makes. Never writes to the database itself: once `ready`
// is true, the app opens the matching form pre-filled and the owner still
// saves it themselves. Same key-handling shape as scan-bill/voice-command.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { checkDailyAiLimit, tooLarge, nepalToday, MAX_HISTORY_TURNS, MAX_TEXT_CHARS, MAX_BASE64_CHARS } from '../_shared/limits.ts';

// Google tracks the free-tier daily request cap separately per model - the
// full "flash" tier gets a very small daily allowance, while the "lite"
// tier (weaker but plenty for this) gets a much larger one for free.
// "-latest" instead of a pinned version so this doesn't go stale the way
// gemini-2.0-flash did.
const GEMINI_MODEL = 'gemini-flash-lite-latest';

// Built per request so "today" is always current (a module-level constant
// kept the date the instance started with).
const systemInstruction = () => `You are a friendly assistant inside "Jageer", a Nepali small-business bookkeeping app. You help the business owner log a Finance entry through a short natural conversation, in whatever language they use - Nepali, English, or a mix.

There are exactly five kinds of entries you can help with:
- add_sale: a sale/bill to a customer
- add_purchase: a purchase/bill from a vendor or supplier
- add_expense: a business expense (rent, tea, transport, etc.)
- payment_in: a payment RECEIVED from a customer
- payment_out: a payment MADE to a vendor or customer

Each turn, do four things:
1. Write a short, warm reply continuing the conversation. If the amount is missing, ask for it. For add_sale/add_purchase/payment_in/payment_out, if the party's name is missing, ask who it's with (expenses don't need a party). Keep replies brief - one short question at a time, not a checklist.
2. Transcribe ONLY the newest user message you were just sent this turn - never the earlier conversation, never your own reply. For text input this is just that text verbatim; for audio input it's what you heard in that one recording.
3. Re-extract your current best understanding of action/party_name/amount/date/note/items from the WHOLE conversation so far (not just the latest message) - it should only ever improve turn to turn, never forget something already given.
4. Set ready=true once you have an action and an amount, and (for add_sale/add_purchase/payment_in/payment_out) a party_name - or the user has clearly said there isn't one. Otherwise ready=false.

If today's date matters, today is ${nepalToday()} - convert relative dates ("yesterday", "last Tuesday") to YYYY-MM-DD.

Never fabricate a value that wasn't actually said - use null instead. If the user is just chatting or asks something unrelated to these five actions, reply naturally and helpfully, but keep action null and ready false.`;

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    reply: { type: 'STRING' },
    transcript: { type: 'STRING', description: 'Only the newest user message this turn - never the earlier conversation.' },
    ready: { type: 'BOOLEAN' },
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
  required: ['reply', 'transcript', 'ready', 'action', 'party_name', 'amount', 'date', 'note', 'items'],
};

interface HistoryTurn {
  role: 'user' | 'model';
  text: string;
}

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

    const { history, input } = await req.json();
    const turns: HistoryTurn[] = (Array.isArray(history) ? history : [])
      .slice(-MAX_HISTORY_TURNS)
      .map((t: HistoryTurn): HistoryTurn => ({ role: t.role === 'model' ? 'model' : 'user', text: String(t.text ?? '').slice(0, MAX_TEXT_CHARS) }));
    if (!input || (input.type !== 'text' && input.type !== 'audio')) {
      return new Response(JSON.stringify({ error: 'input (text or audio) is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Only the recent part of the conversation is needed, and each piece is
    // bounded - unbounded history/text/audio was all billed to one key.
    if (input.type === 'text' && String(input.text ?? '').length > MAX_TEXT_CHARS) {
      return tooLarge('That message is too long - keep it under 2000 characters.');
    }
    if (input.type === 'audio' && String(input.audio ?? '').length > MAX_BASE64_CHARS) {
      return tooLarge('That recording is too long - keep it short.');
    }

    const geminiKey = Deno.env.get('GEMINI_API_KEY');
    if (!geminiKey) {
      return new Response(JSON.stringify({ error: 'The assistant is not set up yet' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const contents = [
      ...turns.map((t) => ({ role: t.role, parts: [{ text: t.text }] })),
      {
        role: 'user',
        parts:
          input.type === 'text'
            ? [{ text: input.text }]
            : [{ inline_data: { mime_type: input.mimeType || 'audio/aac', data: input.audio } }],
      },
    ];

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemInstruction() }] },
          contents,
          generationConfig: { responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA },
        }),
      }
    );

    if (!geminiRes.ok) {
      const detail = await geminiRes.text();
      return new Response(JSON.stringify({ error: `Could not reach the assistant (${geminiRes.status})`, detail }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const geminiData = await geminiRes.json();
    const text = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      return new Response(JSON.stringify({ error: 'The assistant had nothing to say - please try again' }), {
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
