// Utilidades para Google Wallet desde una Cloudflare Pages Function.
// Firma JWT RS256 con la llave de la cuenta de servicio usando WebCrypto (sin librerías).

const WALLET_API = 'https://walletobjects.googleapis.com/walletobjects/v1';

function b64url(bytes) {
  let bin = '';
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const b64urlTexto = t => b64url(new TextEncoder().encode(t));

async function llavePrivada(pem) {
  // Acepta la llave con saltos de línea reales o escritos como \n
  const limpio = pem.replace(/\\n/g, '\n')
    .replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s+/g, '');
  const der = Uint8Array.from(atob(limpio), c => c.charCodeAt(0));
  return crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}

export async function firmarJWT(claims, pem) {
  const cabecera = b64urlTexto(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const cuerpo = b64urlTexto(JSON.stringify(claims));
  const llave = await llavePrivada(pem);
  const firma = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', llave, new TextEncoder().encode(cabecera + '.' + cuerpo));
  return cabecera + '.' + cuerpo + '.' + b64url(firma);
}

export function configurado(env) {
  return Boolean(env.GOOGLE_ISSUER_ID && env.GOOGLE_SA_EMAIL && env.GOOGLE_SA_PRIVATE_KEY &&
                 env.SUPABASE_URL && env.SUPABASE_ANON_KEY);
}

// Token OAuth de la cuenta de servicio para llamar la API de Google Wallet
export async function tokenAcceso(env) {
  const ahora = Math.floor(Date.now() / 1000);
  const assertion = await firmarJWT({
    iss: env.GOOGLE_SA_EMAIL,
    scope: 'https://www.googleapis.com/auth/wallet_object.issuer',
    aud: 'https://oauth2.googleapis.com/token',
    iat: ahora,
    exp: ahora + 3600
  }, env.GOOGLE_SA_PRIVATE_KEY);
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion })
  });
  const j = await r.json();
  if (!r.ok) throw new Error('Google OAuth: ' + (j.error_description || j.error || r.status));
  return j.access_token;
}

// Datos de la tarjeta desde Supabase (misma función que usa la página)
export async function tarjeta(env, codigo) {
  const r = await fetch(env.SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/rpc/tarjeta_por_codigo', {
    method: 'POST',
    headers: Object.assign(
      { apikey: env.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      /^eyJ/.test(env.SUPABASE_ANON_KEY) ? { Authorization: 'Bearer ' + env.SUPABASE_ANON_KEY } : {}
    ),
    body: JSON.stringify({ p_codigo: codigo })
  });
  const j = await r.json();
  if (!r.ok) throw new Error('Supabase: ' + (j.message || r.status));
  if (j.estado !== 'ok') throw new Error(j.mensaje);
  return j;
}

const idSeguro = s => String(s).replace(/[^A-Za-z0-9._-]/g, '_');
export const idClase = (env, t) => env.GOOGLE_ISSUER_ID + '.barberpass_barberia_' + t.id_barberia;
export const idObjeto = (env, t) => env.GOOGLE_ISSUER_ID + '.' + idSeguro(t.codigo_wallet);

// Una clase por barbería: nombre, logo y color propios de cada negocio
export function clase(env, t, origen) {
  return {
    id: idClase(env, t),
    issuerName: 'BarberPass',
    programName: t.barberia,
    programLogo: {
      sourceUri: { uri: new URL(t.logo_url || '/img/icono.png', origen).toString() },
      contentDescription: { defaultValue: { language: 'es-CO', value: 'Logo de ' + t.barberia } }
    },
    hexBackgroundColor: t.color || '#6E1F27',
    countryCode: 'CO',
    reviewStatus: 'UNDER_REVIEW'
  };
}

// Imagen con la fila de sellos (la dibuja /api/sellos); la URL cambia con cada sello
export function urlSellos(t, origen) {
  const q = new URLSearchParams({
    s: String(Math.min(Number(t.sellos), Number(t.requeridos))), r: String(t.requeridos),
    c: String(t.color || '#1A1A1A').replace('#', ''), c2: String(t.color2 || '#C9A35B').replace('#', '')
  });
  return new URL('/api/sellos?' + q.toString(), origen).toString();
}

// Campos que cambian con cada sello
export function camposVariables(t, origen) {
  const faltan = Math.max(0, Number(t.requeridos) - Number(t.sellos));
  return {
    heroImage: { sourceUri: { uri: urlSellos(t, origen) } },
    loyaltyPoints: { label: 'Sellos', balance: { string: t.sellos + ' de ' + t.requeridos } },
    textModulesData: [
      { id: 'premio', header: 'Premio', body: t.premio },
      { id: 'faltan', header: 'Te faltan', body: faltan === 0 ? '¡Tarjeta completa! Pide tu premio.' : faltan + (faltan === 1 ? ' sello' : ' sellos') }
    ]
  };
}

export function objeto(env, t, origen) {
  const enlace = new URL('/tarjeta.html?codigo=' + encodeURIComponent(t.codigo_wallet), origen).toString();
  return Object.assign({
    id: idObjeto(env, t),
    classId: idClase(env, t),
    state: 'ACTIVE',
    accountId: t.codigo_wallet,
    accountName: t.cliente,
    barcode: { type: 'QR_CODE', value: t.codigo_wallet, alternateText: t.codigo_wallet },
    linksModuleData: { uris: [{ id: 'tarjeta', uri: enlace, description: 'Ver mi tarjeta' }] }
  }, camposVariables(t, origen));
}

// Crea la clase de la barbería si no existe (409 = ya existe)
export async function asegurarClase(env, t, origen, acceso) {
  const r = await fetch(WALLET_API + '/loyaltyClass', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + acceso, 'Content-Type': 'application/json' },
    body: JSON.stringify(clase(env, t, origen))
  });
  if (!r.ok && r.status !== 409) throw new Error('Google Wallet (clase): ' + r.status + ' ' + (await r.text()).slice(0, 200));
}

// Actualiza los sellos de una tarjeta ya guardada. Devuelve false si el cliente aún no la guarda.
export async function actualizarObjeto(env, t, acceso, origen) {
  const r = await fetch(WALLET_API + '/loyaltyObject/' + encodeURIComponent(idObjeto(env, t)), {
    method: 'PATCH',
    headers: { Authorization: 'Bearer ' + acceso, 'Content-Type': 'application/json' },
    body: JSON.stringify(camposVariables(t, origen))
  });
  if (r.status === 404) return false;
  if (!r.ok) throw new Error('Google Wallet (actualizar): ' + r.status + ' ' + (await r.text()).slice(0, 200));
  return true;
}

// Enlace "Agregar a Google Wallet": JWT firmado con el objeto de la tarjeta
export async function enlaceGuardar(env, t, origen) {
  const jwt = await firmarJWT({
    iss: env.GOOGLE_SA_EMAIL,
    aud: 'google',
    typ: 'savetowallet',
    iat: Math.floor(Date.now() / 1000),
    origins: [origen],
    payload: { loyaltyObjects: [objeto(env, t, origen)] }
  }, env.GOOGLE_SA_PRIVATE_KEY);
  return 'https://pay.google.com/gp/v/save/' + jwt;
}
