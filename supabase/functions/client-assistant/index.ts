// The customer-facing counterpart to chat-assistant: helps a client
// describe a problem in conversation (text or voice, Nepali/English/mixed)
// and turns it into a service request - never books it directly, the app
// opens the request-details form pre-filled and the client still reviews
// and submits it themselves.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { checkDailyAiLimit, tooLarge, nepalToday, MAX_HISTORY_TURNS, MAX_TEXT_CHARS, MAX_BASE64_CHARS } from '../_shared/limits.ts';

// See chat-assistant for why: the free tier's "lite" model has a much
// larger daily request cap than the full "flash" model does.
const GEMINI_MODEL = 'gemini-flash-lite-latest';

interface HistoryTurn {
  role: 'user' | 'model';
  text: string;
}

function buildSystemInstruction(categories: string[]): string {
  return `You are a friendly assistant inside "Jageer", an app that connects customers to local technicians in Nepal. You help a customer describe what they need through a short natural conversation, in whatever language they use - Nepali, English, or a mix.

Your job is to help them book a service request. You need to figure out:
- category: which ONE of these exact categories their problem belongs to - ${JSON.stringify(categories)} - never invent a category outside this list
- action: either "Repair" (something is broken/not working) or "Installation" (something new needs to be set up)
- notes: a short description of the actual problem, in their own words, for the technician to read

Optionally, if they happen to mention it naturally (don't demand it, the form has its own fields for these):
- date / time: when they'd like the technician to come, converted to YYYY-MM-DD and HH:MM (24-hour) - today is ${nepalToday()}
- address: where the technician should come, if mentioned

Each turn, do three things:
1. Write a short, warm reply. If the category or action isn't clear yet, ask a natural clarifying question about the actual problem (not "what is your action") - one question at a time.
2. Transcribe ONLY the newest user message you were just sent this turn - never the earlier conversation, never your own reply.
3. Re-extract your current best understanding of category/action/notes/date/time/address from the WHOLE conversation so far - it should only ever improve turn to turn, never forget something already given.

Set ready=true once you have category, action, and notes. Never fabricate a value that wasn't actually said or clearly implied - use null instead. If the user says something unrelated to needing a repair/installation, reply naturally and helpfully, but keep category/action null and ready false.`;
}

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    reply: { type: 'STRING' },
    transcript: { type: 'STRING' },
    ready: { type: 'BOOLEAN' },
    category: { type: 'STRING', nullable: true },
    action: { type: 'STRING', nullable: true },
    notes: { type: 'STRING', nullable: true },
    date: { type: 'STRING', nullable: true },
    time: { type: 'STRING', nullable: true },
    address: { type: 'STRING', nullable: true },
  },
  required: ['reply', 'transcript', 'ready', 'category', 'action', 'notes', 'date', 'time', 'address'],
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

    const { history, input, categories } = await req.json();
    const turns: HistoryTurn[] = (Array.isArray(history) ? history : [])
      .slice(-MAX_HISTORY_TURNS)
      .map((t: HistoryTurn): HistoryTurn => ({ role: t.role === 'model' ? 'model' : 'user', text: String(t.text ?? '').slice(0, MAX_TEXT_CHARS) }));
    const categoryList: string[] = Array.isArray(categories) && categories.length > 0 ? categories : ['General'];
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
          systemInstruction: { parts: [{ text: buildSystemInstruction(categoryList) }] },
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
