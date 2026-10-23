// /api/estado -> qué está configurado (útil para revisar el despliegue; no expone secretos)
export function onRequestGet({ env }) {
  return new Response(JSON.stringify({
    supabase: Boolean(env.SUPABASE_URL && env.SUPABASE_ANON_KEY),
    google_wallet: Boolean(env.GOOGLE_ISSUER_ID && env.GOOGLE_SA_EMAIL && env.GOOGLE_SA_PRIVATE_KEY),
    apple_wallet: false
  }), { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}
