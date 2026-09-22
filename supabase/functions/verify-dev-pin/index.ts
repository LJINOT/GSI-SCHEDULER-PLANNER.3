import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const body = await req.json().catch(() => ({}));
    const pin = String(body?.pin ?? "").trim();
    const expected = Deno.env.get("DEV_MODE_PIN") || "";
    if (!expected) {
      return new Response(JSON.stringify({ ok: false, error: "Developer Mode is not configured on the server." }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    let match = pin.length === expected.length;
    for (let i = 0; i < Math.max(pin.length, expected.length); i++) {
      if ((pin.charCodeAt(i) || 0) !== (expected.charCodeAt(i) || 0)) match = false;
    }
    if (!match) {
      return new Response(JSON.stringify({ ok: false, error: "Invalid PIN" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ ok: true, unlocked_at: new Date().toISOString(), ttl_ms: 30 * 60 * 1000 }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
