// A fast, minimal companion to chat-assistant: transcribes a voice message
// on its own (small schema, no conversational reasoning) so the chat can
// show what was said right away, instead of the words only appearing once
// the full understanding call (which re-derives its own transcript anyway,
// as a fallback) finishes a few seconds later.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { checkDailyAiLimit, tooLarge, MAX_BASE64_CHARS } from '../_shared/limits.ts';

// See chat-assistant for why: the free tier's "lite" model has a much
// larger daily request cap than the full "flash" model does.
const GEMINI_MODEL = 'gemini-flash-lite-latest';
const PROMPT =
  'Transcribe exactly what is said in this short audio clip, in whatever language and script it was spoken (Nepali, English, or a mix). Return only the transcription itself - no commentary, no translation.';
const RESPONSE_SCHEMA = { type: 'OBJECT', properties: { transcript: { type: 'STRING' } }, required: ['transcript'] };

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
      return new Response(JSON.stringify({ error: 'Not set up yet' }), {
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
            { parts: [{ text: PROMPT }, { inline_data: { mime_type: mimeType || 'audio/aac', data: audio } }] },
          ],
          generationConfig: { responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA },
        }),
      }
    );

    if (!geminiRes.ok) {
      return new Response(JSON.stringify({ error: `Transcription failed (${geminiRes.status})` }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const geminiData = await geminiRes.json();
    const text = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      return new Response(JSON.stringify({ error: 'Nothing usable in that recording' }), {
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
