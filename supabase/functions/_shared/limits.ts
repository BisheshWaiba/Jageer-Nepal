// Shared guards for the AI Edge Functions (chat-assistant, client-assistant,
// voice-command, scan-bill, transcribe-audio). Any signed-in account could
// previously send unbounded chat history, text, audio or images - and as
// often as it liked - all billed to the one Gemini key.
import { corsHeaders } from './cors.ts';

export const MAX_HISTORY_TURNS = 20;
export const MAX_TEXT_CHARS = 2000;
// Base64 of roughly 7.5 MB of image/audio - far above a phone photo or a
// short voice note after the app's own resizing.
export const MAX_BASE64_CHARS = 10_000_000;
// Calls per user per day across all AI functions.
export const DAILY_AI_CALL_LIMIT = 300;

/** Today as YYYY-MM-DD in Nepal time (UTC+5:45). Computed per request:
 * a module-level constant froze "today" at the instance's cold start, and
 * UTC alone reads as yesterday until 05:45 in Nepal. */
export function nepalToday(): string {
  return new Date(Date.now() + (5 * 60 + 45) * 60_000).toISOString().slice(0, 10);
}

export function tooLarge(message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 413,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/** Counts this call against the caller's daily allowance (migration 0079,
 * bump_ai_usage). Returns a 429 response once they're over it, else null.
 * `client` must be the caller's own JWT-scoped client. */
// deno-lint-ignore no-explicit-any
export async function checkDailyAiLimit(client: any): Promise<Response | null> {
  const { data, error } = await client.rpc('bump_ai_usage', { p_limit: DAILY_AI_CALL_LIMIT });
  // Never block the feature on the limiter itself failing (e.g. the
  // migration not applied yet) - only on a definite "over the limit".
  if (error || data !== false) return null;
  return new Response(JSON.stringify({ error: "You've reached today's limit for the assistant - try again tomorrow." }), {
    status: 429,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
