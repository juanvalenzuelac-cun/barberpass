// /api/google-wallet
//   GET  ?codigo=BP-...   -> { url } enlace "Agregar a Google Wallet"
//   POST { codigo }       -> sincroniza los sellos de una tarjeta ya guardada
// Variables de entorno (Cloudflare Pages -> Settings -> Variables and Secrets):
//   SUPABASE_URL, SUPABASE_ANON_KEY, GOOGLE_ISSUER_ID, GOOGLE_SA_EMAIL, GOOGLE_SA_PRIVATE_KEY (secreta)
import { configurado, tarjeta, tokenAcceso, asegurarClase, enlaceGuardar, actualizarObjeto } from '../_lib/google-wallet.js';

const json = (cuerpo, estado = 200) => new Response(JSON.stringify(cuerpo), {
  status: estado,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
});

const codigoValido = c => typeof c === 'string' && /^BP-[A-Z0-9]{8,40}$/.test(c);

export async function onRequestGet({ request, env }) {
  if (!configurado(env)) {
    return json({ mensaje: 'Google Wallet todavía no está configurado en este sitio.' }, 501);
  }
  const url = new URL(request.url);
  const codigo = url.searchParams.get('codigo');
  if (!codigoValido(codigo)) return json({ mensaje: 'Código de tarjeta no válido.' }, 400);
  try {
    const t = await tarjeta(env, codigo);
    const acceso = await tokenAcceso(env);
    await asegurarClase(env, t, url.origin, acceso);
    return json({ url: await enlaceGuardar(env, t, url.origin) });
  } catch (e) {
    return json({ mensaje: 'No se pudo crear el pase: ' + e.message }, 502);
  }
}

export async function onRequestPost({ request, env }) {
  if (!configurado(env)) return json({ sincronizado: false, motivo: 'no configurado' });
  let codigo;
  try { ({ codigo } = await request.json()); } catch (e) { /* cuerpo inválido */ }
  if (!codigoValido(codigo)) return json({ mensaje: 'Código de tarjeta no válido.' }, 400);
  try {
    const t = await tarjeta(env, codigo);
    const acceso = await tokenAcceso(env);
    const ok = await actualizarObjeto(env, t, acceso);
    return json({ sincronizado: ok, sellos: t.sellos });
  } catch (e) {
    return json({ sincronizado: false, mensaje: e.message }, 502);
  }
}
