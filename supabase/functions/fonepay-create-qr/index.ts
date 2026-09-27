// Generates a Fonepay dynamic QR for a resolved service request so the
// customer can pay online. Called by the client (or the reseller, showing
// the QR on their own screen for a walk-in customer) once a job is resolved.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { createDynamicQr, generatePrn } from '../_shared/fonepay.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { service_request_id } = await req.json();
    if (!service_request_id) {
      return new Response(JSON.stringify({ error: 'service_request_id is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const authHeader = req.headers.get('Authorization') ?? '';
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // Scoped to the caller's own JWT - RLS decides whether they're allowed to
    // see this row at all (the client or the owning reseller only).
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: request, error: fetchError } = await callerClient
      .from('service_requests')
      .select('id, status, payment_status, quoted_price')
      .eq('id', service_request_id)
      .single();

    if (fetchError || !request) {
      return new Response(JSON.stringify({ error: 'Request not found or not accessible' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (request.status !== 'resolved') {
      return new Response(JSON.stringify({ error: 'This job is not resolved yet' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (request.payment_status === 'paid') {
      return new Response(JSON.stringify({ error: 'This job is already paid' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Service-role only past this point: reading job_cards and writing
    // payment_method/fonepay_prn back onto the row.
    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: jobCards } = await adminClient
      .from('job_cards')
      .select('labor_cost, parts_cost')
      .eq('service_request_id', service_request_id)
      .order('created_at')
      .limit(1);

    // Same rule as the SQL service_request_amount() (migration 0077) that
    // the ledger and payment triggers use: the price the customer agreed
    // to, or the job card total only for a job that was never priced.
    const jobCard = jobCards?.[0];
    const jobTotal = jobCard ? Number(jobCard.labor_cost) + Number(jobCard.parts_cost) : 0;
    const quoted = request.quoted_price != null ? Number(request.quoted_price) : 0;
    const amount = quoted > 0 ? quoted : jobTotal > 0 ? jobTotal : null;

    if (!amount || amount <= 0) {
      return new Response(JSON.stringify({ error: 'No payable amount is set on this job yet' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const prn = generatePrn(service_request_id);
    const result = await createDynamicQr(amount, prn, 'JageerNepal', service_request_id.slice(0, 8));

    if (!result.success) {
      return new Response(JSON.stringify({ error: result.errorMessage ?? 'Could not create QR' }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    await adminClient
      .from('service_requests')
      .update({ payment_method: 'online', fonepay_prn: prn })
      .eq('id', service_request_id);

    return new Response(JSON.stringify({ qrMessage: result.qrMessage, prn, amount }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
