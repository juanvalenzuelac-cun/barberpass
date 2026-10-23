// /api/sellos?s=2&r=8&c=1A1A1A&c2=C9A35B
// Imagen PNG con la fila de sellos (tijeras y regalo) que se muestra en el pase de Google Wallet.
// Se dibuja aquí mismo, sin librerías: cada píxel es una mezcla entre el color de fondo (c)
// y el color de los sellos (c2), así que basta un PNG con paleta de 64 tonos.
const W = 774, H = 252, TONOS = 64;
const PLANTILLAS = new Map();   // se reutilizan entre peticiones mientras el servidor siga activo

const hex = (v, def) => /^[0-9a-fA-F]{6}$/.test(v || '') ? v : def;
const rgb = h => [0, 2, 4].map(i => parseInt(h.substr(i, 2), 16));

// Distancias con signo (en píxeles) de las figuras básicas
const len = (x, y) => Math.hypot(x, y);
const disco = (x, y, cx, cy, r) => len(x - cx, y - cy) - r;
const anillo = (x, y, cx, cy, r, g) => Math.abs(len(x - cx, y - cy) - r) - g / 2;
function linea(x, y, ax, ay, bx, by, g) {
  const px = x - ax, py = y - ay, dx = bx - ax, dy = by - ay;
  const h = Math.max(0, Math.min(1, (px * dx + py * dy) / (dx * dx + dy * dy)));
  return len(px - dx * h, py - dy * h) - g / 2;
}
function marco(x, y, cx, cy, hx, hy, g) {
  const qx = Math.abs(x - cx) - hx, qy = Math.abs(y - cy) - hy;
  const d = len(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0);
  return Math.abs(d) - g / 2;
}
const cubre = d => Math.max(0, Math.min(1, 0.5 - d));   // antialias de 1 píxel

// Íconos en coordenadas relativas al radio R del sello
function tijeras(x, y, cx, cy, R) {
  const u = (a, b) => [cx + a * R, cy + b * R], g = 0.08 * R;
  const [a1x, a1y] = u(-0.34, -0.24), [a2x, a2y] = u(-0.34, 0.24);
  const [b1x, b1y] = u(-0.2, -0.12), [b2x, b2y] = u(0.46, 0.26);
  const [c1x, c1y] = u(-0.2, 0.12), [c2x, c2y] = u(0.46, -0.26);
  return Math.min(anillo(x, y, a1x, a1y, 0.15 * R, g), anillo(x, y, a2x, a2y, 0.15 * R, g),
                  linea(x, y, b1x, b1y, b2x, b2y, g), linea(x, y, c1x, c1y, c2x, c2y, g));
}
function regalo(x, y, cx, cy, R) {
  const g = 0.08 * R;
  return Math.min(
    marco(x, y, cx, cy + 0.16 * R, 0.34 * R, 0.24 * R, g),
    marco(x, y, cx, cy - 0.16 * R, 0.42 * R, 0.08 * R, g),
    linea(x, y, cx, cy - 0.24 * R, cx, cy + 0.4 * R, g),
    anillo(x, y, cx - 0.12 * R, cy - 0.36 * R, 0.1 * R, g),
    anillo(x, y, cx + 0.12 * R, cy - 0.36 * R, 0.1 * R, g));
}

// ---- PNG mínimo (paleta) ----
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(bytes) { let c = 0xFFFFFFFF; for (const b of bytes) c = CRC[(c ^ b) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function bloque(tipo, datos) {
  const t = new TextEncoder().encode(tipo);
  const out = new Uint8Array(12 + datos.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, datos.length);
  out.set(t, 4); out.set(datos, 8);
  v.setUint32(8 + datos.length, crc32(out.subarray(4, 8 + datos.length)));
  return out;
}
async function zlib(datos) {
  const s = new Blob([datos]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

export async function dibujar(s, r, c, c2) {
  const req = Math.max(1, Math.min(20, r)), llenos = Math.max(0, Math.min(req, s));
  const filas = req > 5 ? 2 : 1, cols = Math.ceil(req / filas);
  const R = Math.min(46, (W - 60) / cols / 2 - 8, (H - 40) / filas / 2 - 8);
  const paso = 2 * R + 18, x0 = (W - (cols - 1) * paso) / 2, y0 = (H - (filas - 1) * paso) / 2;

  // Cada tipo de sello (lleno/pendiente, normal/último) se dibuja una sola vez y se copia
  const lado = Math.ceil(2 * R + 6), m = lado / 2;
  function plantilla(lleno, ultimo) {
    const clave = R + ':' + (lleno ? 1 : 0) + (ultimo ? 2 : 0);
    if (PLANTILLAS.has(clave)) return PLANTILLAS.get(clave);
    const p = new Uint8Array(lado * lado);
    for (let y = 0; y < lado; y++) for (let x = 0; x < lado; x++) {
      const px = x + 0.5, py = y + 0.5;
      const dentro = len(px - m, py - m) < R * 0.62;
      const icono = !dentro ? 0 : ultimo ? cubre(regalo(px, py, m, m, R)) : (lleno ? cubre(tijeras(px, py, m, m, R)) : 0);
      const v = lleno
        ? cubre(disco(px, py, m, m, R)) * (1 - icono)                         // sello lleno: disco con el ícono calado
        : Math.max(cubre(anillo(px, py, m, m, R - 1.5, 3)) * 0.55, icono * 0.9); // pendiente: aro tenue
      p[y * lado + x] = Math.round(v * (TONOS - 1));
    }
    PLANTILLAS.set(clave, p);
    return p;
  }

  // Imagen ya en índices de paleta (0 = fondo, 63 = color de los sellos); cada fila empieza con su byte de filtro
  const crudo = new Uint8Array(H * (W + 1));
  for (let i = 0; i < req; i++) {
    const p = plantilla(i < llenos, i === req - 1);
    const ox = Math.round(x0 + (i % cols) * paso - m), oy = Math.round(y0 + Math.floor(i / cols) * paso - m);
    for (let y = 0; y < lado; y++) {
      const ty = oy + y; if (ty < 0 || ty >= H) continue;
      for (let x = 0; x < lado; x++) {
        const tx = ox + x; if (tx < 0 || tx >= W) continue;
        const v = p[y * lado + x], k = ty * (W + 1) + 1 + tx;
        if (v > crudo[k]) crudo[k] = v;
      }
    }
  }

  // Paleta: 64 mezclas entre fondo y color de los sellos
  const a = rgb(c), b = rgb(c2), pal = new Uint8Array(TONOS * 3);
  for (let i = 0; i < TONOS; i++) for (let j = 0; j < 3; j++) pal[i * 3 + j] = Math.round(a[j] + (b[j] - a[j]) * i / (TONOS - 1));
  const ihdr = new Uint8Array(13), v = new DataView(ihdr.buffer);
  v.setUint32(0, W); v.setUint32(4, H); ihdr[8] = 8; ihdr[9] = 3;
  const partes = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), bloque('IHDR', ihdr), bloque('PLTE', pal),
                  bloque('IDAT', await zlib(crudo)), bloque('IEND', new Uint8Array(0))];
  const total = partes.reduce((n, p) => n + p.length, 0), png = new Uint8Array(total);
  let o = 0; for (const p of partes) { png.set(p, o); o += p.length; }
  return png;
}

export async function onRequestGet({ request, waitUntil }) {
  // La imagen depende solo de los parámetros: se guarda en la caché de Cloudflare
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  if (cache) { const guardada = await cache.match(request); if (guardada) return guardada; }
  const q = new URL(request.url).searchParams;
  const png = await dibujar(Number(q.get('s')) || 0, Number(q.get('r')) || 8,
                            hex(q.get('c'), '1A1A1A'), hex(q.get('c2'), 'C9A35B'));
  const resp = new Response(png, {
    headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=31536000, immutable' }
  });
  if (cache && waitUntil) waitUntil(cache.put(request, resp.clone()));
  return resp;
}
