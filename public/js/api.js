// BarberPass - acceso a Supabase (API REST de PostgREST) y utilidades de la página.
(function () {
  const cfg = window.BP_CONFIG || {};
  const configurado = cfg.SUPABASE_URL && !cfg.SUPABASE_URL.includes('TU-PROYECTO') &&
                      cfg.SUPABASE_ANON_KEY && !cfg.SUPABASE_ANON_KEY.includes('PEGA-AQUI');

  // La llave nueva (sb_publishable_...) va solo en el header apikey.
  // La llave anon antigua (un JWT que empieza por eyJ) también se manda como Bearer.
  function cabeceras(extra) {
    const h = { apikey: cfg.SUPABASE_ANON_KEY };
    if (/^eyJ/.test(cfg.SUPABASE_ANON_KEY)) h.Authorization = 'Bearer ' + cfg.SUPABASE_ANON_KEY;
    return Object.assign(h, extra || {});
  }

  async function revisar(resp) {
    if (!resp.ok) {
      let detalle = '';
      try { const j = await resp.json(); detalle = j.message || j.hint || ''; } catch (e) { /* sin cuerpo */ }
      throw new Error('Supabase respondió ' + resp.status + (detalle ? ': ' + detalle : ''));
    }
    return resp.json();
  }

  const BP = {
    configurado,

    // Lee una vista. filtros = { columna: 'eq.valor' }
    async vista(nombre, filtros) {
      if (!configurado) throw new Error('Falta configurar js/config.js con la URL y la llave publicable de Supabase.');
      const url = new URL(cfg.SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/' + nombre);
      url.searchParams.set('select', '*');
      Object.entries(filtros || {}).forEach(([k, v]) => url.searchParams.set(k, v));
      return revisar(await fetch(url, { headers: cabeceras() }));
    },

    // Ejecuta una función de la base (RPC)
    async rpc(nombre, args) {
      if (!configurado) throw new Error('Falta configurar js/config.js con la URL y la llave publicable de Supabase.');
      const url = cfg.SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/rpc/' + nombre;
      return revisar(await fetch(url, {
        method: 'POST',
        headers: cabeceras({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(args || {})
      }));
    },

    esc(v) {
      return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    },

    cop(n) {
      return '$' + Number(n).toLocaleString('es-CO', { maximumFractionDigits: 0 });
    },

    hora(ts) {
      // fecha_hora se guarda en hora de Bogotá, sin zona
      const d = new Date(String(ts).replace(' ', 'T'));
      if (isNaN(d)) return ts;
      return d.toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
    },

    // Pinta una tabla a partir de filas y una definición de columnas
    tabla(filas, columnas, opciones) {
      opciones = opciones || {};
      if (!filas.length) return '<p class="aviso">' + (opciones.vacio || 'La consulta no devolvió filas.') + '</p>';
      const cols = columnas || Object.keys(filas[0]).map(k => ({ k, t: k }));
      const head = cols.map(c => '<th' + (c.n ? ' class="n"' : '') + ' scope="col">' + BP.esc(c.t) + '</th>').join('');
      const body = filas.map(f => {
        const cls = opciones.claseFila ? opciones.claseFila(f) : '';
        return '<tr' + (cls ? ' class="' + cls + '"' : '') + '>' + cols.map(c => {
          let v = f[c.k];
          if (c.fmt) v = c.fmt(v, f);
          return '<td' + (c.n ? ' class="n"' : '') + '>' + (c.html ? v : BP.esc(v)) + '</td>';
        }).join('') + '</tr>';
      }).join('');
      return '<div class="tabla-scroll"><table><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table></div>';
    },

    avisoConfig(el) {
      el.innerHTML = '<p class="aviso error">Falta conectar la página con Supabase: edita <b>js/config.js</b> con la URL del proyecto y la llave publicable.</p>';
    },

    guardar(k, v) { try { localStorage.setItem('bp_' + k, v); } catch (e) { /* almacenamiento no disponible */ } },
    leer(k) { try { return localStorage.getItem('bp_' + k); } catch (e) { return null; } }
  };

  window.BP = BP;
})();
