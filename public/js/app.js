// BarberPass - app del barbero (una sola página con 5 secciones)
(function () {
  const $ = s => document.querySelector(s);
  const vista = $('#vista');
  const tabs = $('#tabs');
  const CLAVE = 'sesion_app';
  let ses = null;
  let limpiezas = [];          // temporizadores y cámara de la vista actual
  let servicios = [];

  // ---------- utilidades ----------
  function leerSesion() { try { return JSON.parse(BP.leer(CLAVE) || 'null'); } catch (e) { return null; } }
  function guardarSesion(s) { ses = s; BP.guardar(CLAVE, s ? JSON.stringify(s) : ''); }

  function limpiar() { limpiezas.forEach(f => { try { f(); } catch (e) { /* nada */ } }); limpiezas = []; }
  function cada(ms, fn) { const id = setInterval(fn, ms); limpiezas.push(() => clearInterval(id)); }
  function luego(ms, fn) { const id = setTimeout(fn, ms); limpiezas.push(() => clearTimeout(id)); return id; }

  async function llamar(fn, args) {
    const r = await BP.rpc(fn, Object.assign({ p_token: ses.token }, args || {}));
    if (r && r.codigo === 'sesion') { salir(r.mensaje); throw new Error(r.mensaje); }
    return r;
  }

  function toast(texto) {
    const t = document.createElement('div');
    t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = texto;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3200);
  }

  const iniciales = n => String(n || '').split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]).join('').toUpperCase();
  const celularBonito = c => String(c || '').replace(/^(\d{3})(\d{3})(\d{4})$/, '$1 $2 $3');

  // fecha_hora viene en hora de Bogotá sin zona: se compara contra "ahora" en Bogotá
  const ahoraBogota = () => Date.now() - 5 * 3600e3;
  const ms = ts => Date.parse(String(ts).replace(' ', 'T').slice(0, 19) + 'Z');
  function hace(ts) {
    const min = Math.round((ahoraBogota() - ms(ts)) / 60000);
    if (min < 1) return 'ahora';
    if (min < 60) return 'hace ' + min + ' min';
    const h = Math.round(min / 60);
    if (h < 24) return 'hace ' + h + ' h';
    const d = new Date(ms(ts));
    return d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  }
  function horaCorta(ts) {
    const d = new Date(ms(ts));
    const hoy = new Date(ahoraBogota()).toISOString().slice(0, 10) === String(ts).slice(0, 10);
    const hora = d.toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
    return (hoy ? 'hoy, ' : d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short', timeZone: 'UTC' }) + ', ') + hora;
  }
  const metodo = m => m === 'NFC' ? 'Toque NFC' : 'QR / app';

  // PIN de 4 cajas sobre un input numérico
  function htmlPin(id) {
    return '<div class="pin" id="' + id + '"><span></span><span></span><span></span><span></span>' +
      '<input type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="one-time-code" aria-label="PIN de 4 números"></div>';
  }
  function activarPin(id, alCompletar) {
    const caja = document.getElementById(id), inp = caja.querySelector('input'), spans = caja.querySelectorAll('span');
    const pintar = () => {
      inp.value = inp.value.replace(/\D/g, '').slice(0, 4);
      spans.forEach((s, i) => { s.classList.toggle('punto', i < inp.value.length); s.classList.toggle('actual', i === inp.value.length && document.activeElement === inp); });
      if (inp.value.length === 4 && alCompletar) alCompletar(inp.value);
    };
    inp.addEventListener('input', pintar); inp.addEventListener('focus', pintar); inp.addEventListener('blur', pintar);
    return { valor: () => inp.value, limpiar: () => { inp.value = ''; pintar(); }, foco: () => inp.focus() };
  }

  async function cargarServicios() {
    if (!servicios.length) {
      servicios = (await BP.vista('v_servicios', { id_barberia: 'eq.' + ses.barberia.id })).sort((x, y) => x.id_servicio - y.id_servicio);
    }
    return servicios;
  }
  function htmlServicios(id) {
    return '<div class="campo"><label for="' + id + '">Servicio</label><select class="entrada" id="' + id + '">' +
      servicios.map(s => '<option value="' + s.id_servicio + '">' + BP.esc(s.nombre) + ' · ' + BP.cop(s.precio) + '</option>').join('') + '</select></div>';
  }

  async function sincronizarWallet(codigo) {
    try { await fetch('/api/google-wallet', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ codigo }) }); } catch (e) { /* opcional */ }
  }

  // ---------- ingreso ----------
  function pantallaIngreso(mensaje) {
    limpiar(); tabs.hidden = true;
    vista.className = 'ingreso';
    vista.innerHTML =
      '<div class="logo">' + BPIcono('tijeras', 40) + '</div>' +
      '<h1>Panel del barbero</h1>' +
      '<p class="suave">Ingresa con el usuario que te dio la barbería y tu PIN.</p>' +
      '<form id="f-ingreso" style="display:grid;gap:22px" novalidate>' +
        '<div class="campo"><label for="usuario">Usuario</label><input class="entrada" id="usuario" autocomplete="username" autocapitalize="none" spellcheck="false" required></div>' +
        '<div class="campo"><span class="etiqueta">PIN</span>' + htmlPin('pin-ingreso') + '</div>' +
        '<div id="msg-ingreso" aria-live="polite">' + (mensaje ? '<p class="aviso error">' + BP.esc(mensaje) + '</p>' : '') + '</div>' +
        '<button class="btn bloque" id="entrar">Entrar</button>' +
      '</form>' +
      '<p class="pie">BarberPass<br>¿Olvidaste tu PIN? Pídeselo al administrador.</p>';
    const pin = activarPin('pin-ingreso');
    if (!BP.configurado) BP.avisoConfig($('#msg-ingreso'));
    $('#f-ingreso').addEventListener('submit', async ev => {
      ev.preventDefault();
      const b = $('#entrar'); b.disabled = true; b.textContent = 'Entrando…';
      try {
        const r = await BP.rpc('iniciar_sesion', { p_usuario: $('#usuario').value, p_pin: pin.valor() });
        if (r.estado !== 'ok') throw new Error(r.mensaje);
        guardarSesion({ token: r.token, empleado: r.empleado, barberia: r.barberia });
        servicios = [];
        location.hash = '#inicio'; mostrar();
      } catch (e) {
        $('#msg-ingreso').innerHTML = '<p class="aviso error">' + BP.esc(e.message) + '</p>';
        pin.limpiar(); b.disabled = false; b.textContent = 'Entrar';
      }
    });
  }

  async function salir(mensaje) {
    if (ses) { try { await BP.rpc('cerrar_sesion', { p_token: ses.token }); } catch (e) { /* ya vencida */ } }
    guardarSesion(null);
    history.replaceState(null, '', location.pathname);
    pantallaIngreso(mensaje && mensaje.includes('venció') ? mensaje : '');
  }

  // ---------- navegación ----------
  const SECCIONES = [
    ['inicio', 'Inicio', 'inicio'], ['qr', 'Mi QR', 'qr'], ['escanear', 'Escanear', 'escanear'],
    ['clientes', 'Clientes', 'clientes'], ['premios', 'Premios', 'premios']
  ];
  function pintarTabs(actual) {
    tabs.hidden = false;
    tabs.innerHTML = SECCIONES.map(([id, txt, ico]) =>
      '<button class="tab" data-ir="' + id + '"' + (id === actual ? ' aria-current="page"' : '') + '>' + BPIcono(ico, 26) + '<span>' + txt + '</span></button>').join('');
  }
  tabs.addEventListener('click', e => { const b = e.target.closest('[data-ir]'); if (b) location.hash = '#' + b.dataset.ir; });
  window.addEventListener('hashchange', mostrar);

  function mostrar() {
    if (!ses) return pantallaIngreso();
    limpiar();
    const id = (location.hash || '#inicio').slice(1);
    const fn = { inicio, qr: miQR, escanear, clientes, premios }[id] || inicio;
    pintarTabs(fn === inicio ? 'inicio' : id);
    vista.className = 'vista';
    vista.innerHTML = '<p class="suave">Cargando…</p>';
    fn().catch(e => { vista.innerHTML = '<p class="aviso error">' + BP.esc(e.message) + '</p>'; });
    vista.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }
  vista.addEventListener('click', e => { const b = e.target.closest('[data-ir]'); if (b) location.hash = '#' + b.dataset.ir; });

  // ---------- 2. inicio ----------
  async function inicio() {
    const r = await llamar('app_inicio');
    const fecha = new Date(ahoraBogota()).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
    vista.innerHTML =
      '<header class="titulo"><div><h1>Hola, ' + BP.esc(ses.empleado.nombre) + '</h1><p>' + BP.esc(fecha.charAt(0).toUpperCase() + fecha.slice(1)) + '</p></div>' +
      '<button class="avatar" id="perfil" aria-label="Cerrar sesión de ' + BP.esc(ses.empleado.nombre) + '" title="Cerrar sesión">' + BP.esc(iniciales(ses.empleado.nombre)) + '</button></header>' +
      '<section class="panel"><div class="grande num">' + r.sellos_hoy + '</div><p class="suave" style="margin-top:10px">sellos que has dado hoy</p>' +
        '<div class="stats"><div><b class="num">' + r.sellos_barberia + '</b><span>en la barbería</span></div>' +
        '<div><b class="num">' + r.premios + '</b><span>premios por canjear</span></div>' +
        '<div><b class="num">' + r.clientes_nuevos + '</b><span>clientes nuevos</span></div></div></section>' +
      '<div class="acciones">' +
        '<button class="accion oro" data-ir="qr">' + BPIcono('qr', 26) + '<b>Mostrar mi QR</b><span>Cliente sin NFC</span></button>' +
        '<button class="accion" data-ir="escanear">' + BPIcono('escanear', 26) + '<b>Escanear pase</b><span>Desde la Wallet</span></button>' +
      '</div>' +
      '<section><div class="seccion"><h2>Últimos sellos</h2><button data-ir="clientes">Ver todos</button></div>' +
      (r.ultimos.length ? '<ul class="lista">' + r.ultimos.map(u =>
        '<li class="fila"><div class="info"><b>' + BP.esc(u.cliente) + '</b><small>' + metodo(u.metodo) + ' · ' + hace(u.fecha_hora) + (u.barbero !== ses.empleado.nombre ? ' · ' + BP.esc(u.barbero) : '') + '</small></div>' +
        (u.sellos >= u.requeridos ? '<span class="chip verde">Premio</span>' : '<span class="chip num">' + u.sellos + '/' + u.requeridos + '</span>') + '</li>').join('') + '</ul>'
        : '<p class="vacio">Todavía no hay sellos en esta barbería.</p>') + '</section>';
    $('#perfil').addEventListener('click', () => { if (confirm('¿Cerrar sesión?')) salir(); });
  }

  // ---------- 3. mi QR ----------
  async function miQR() {
    await cargarServicios();
    vista.innerHTML =
      '<header class="titulo"><div><h1>Mi QR de sello</h1><p>Muéstralo al cliente</p></div></header>' +
      htmlServicios('qr-servicio') +
      '<section class="ticket" id="ticket" aria-live="polite"><p>Generando código…</p></section>' +
      '<p class="suave" style="text-align:center">Sirve para registrarse o sumar el sello. Si alguien lo fotografía, deja de valer en segundos.</p>' +
      '<button class="btn fantasma bloque" id="completa">' + BPIcono('pantalla', 20) + 'Pantalla completa</button>';
    let ultimoVisto = null;
    const R = 16, C = 2 * Math.PI * R;

    async function refrescar() {
      const r = await llamar('app_qr');
      if (r.estado !== 'ok') { $('#ticket').innerHTML = '<p class="aviso error">' + BP.esc(r.mensaje) + '</p>'; return; }
      const url = new URL('sellar.html', location.href);
      url.search = new URLSearchParams({ c: r.id_credencial, t: r.token, s: $('#qr-servicio').value }).toString();
      $('#ticket').innerHTML =
        '<h2>' + BP.esc(ses.empleado.nombre) + ' · ' + BP.esc(ses.barberia.nombre) + '</h2>' +
        '<p>Escanéalo con la cámara para recibir tu sello</p>' +
        '<div class="qr" id="qr">' + BPQR.svg(url.toString(), { etiqueta: 'Código QR para sellar la tarjeta' }) + '</div>' +
        '<div class="reloj"><svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="' + R + '" fill="none" stroke="#E2DED6" stroke-width="4"/>' +
        '<circle id="arco" cx="20" cy="20" r="' + R + '" fill="none" stroke="#C9A35B" stroke-width="4" stroke-linecap="round" stroke-dasharray="' + C + '"/></svg>' +
        '<span>Cambia en <b class="num" id="seg">' + r.segundos_restantes + '</b> s · un solo uso</span></div>';
      const fin = Date.now() + r.segundos_restantes * 1000;
      const tic = () => {
        const resta = Math.max(0, fin - Date.now());
        const seg = $('#seg'), arco = $('#arco');
        if (!seg) return;
        seg.textContent = Math.ceil(resta / 1000);
        arco.setAttribute('stroke-dashoffset', String(C * (1 - resta / 30000)));
      };
      tic();
      cada(250, tic);
      luego(r.segundos_restantes * 1000 + 400, () => { limpiar(); vigilar(); refrescar(); });
    }
    // Avisa cuando entra un sello nuevo hecho con este QR
    function vigilar() {
      const revisar = async () => {
        try {
          const r = await llamar('app_inicio');
          const u = r.ultimos[0];
          const clave = u ? u.fecha_hora + u.cliente : '';
          if (ultimoVisto !== null && clave !== ultimoVisto && u.metodo === 'QR' && u.barbero === ses.empleado.nombre) {
            toast('Sello registrado para ' + u.cliente);
            const q = $('#qr'); if (q) q.classList.add('usado');
          }
          ultimoVisto = clave;
        } catch (e) { /* reintenta en el siguiente ciclo */ }
      };
      if (ultimoVisto === null) revisar();
      cada(4000, revisar);
    }
    $('#qr-servicio').addEventListener('change', () => { limpiar(); vigilar(); refrescar(); });
    $('#completa').addEventListener('click', () => { const t = $('#ticket'); if (t.requestFullscreen) t.requestFullscreen(); });
    vigilar();
    await refrescar();
  }

  // ---------- 4. escanear pase ----------
  async function escanear() {
    await cargarServicios();
    vista.innerHTML =
      '<header class="titulo"><div><h1>Escanear pase</h1><p>Apunta al QR del pase del cliente</p></div></header>' +
      '<div class="visor" id="visor"><video id="video" playsinline muted hidden></video><div class="marco" aria-hidden="true"><i></i><i></i><i></i><i></i></div>' +
      '<p class="aviso-camara" id="aviso-camara">Activando la cámara…</p></div>' +
      '<section class="hoja" id="hoja">' +
        '<form id="f-buscar" class="buscador" role="search">' + BPIcono('buscar', 22) +
        '<input class="entrada" id="codigo" placeholder="Código del pase o celular" autocomplete="off" aria-label="Código del pase o celular"></form>' +
        '<div id="resultado"></div></section>';

    const video = $('#video');
    let stream = null;
    const parar = () => { if (stream) stream.getTracks().forEach(t => t.stop()); stream = null; video.hidden = true; };
    limpiezas.push(parar);

    async function camara() {
      if (!('BarcodeDetector' in window) || !navigator.mediaDevices) {
        $('#aviso-camara').textContent = 'Este navegador no lee QR con la cámara. Escribe el código del pase o el celular abajo.';
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        video.srcObject = stream; video.hidden = false; await video.play();
        $('#aviso-camara').textContent = '';
        const lector = new BarcodeDetector({ formats: ['qr_code'] });
        cada(400, async () => {
          if (!stream || video.readyState < 2) return;
          const r = await lector.detect(video).catch(() => []);
          if (r.length) { parar(); $('#codigo').value = r[0].rawValue; buscar(r[0].rawValue); }
        });
      } catch (e) {
        $('#aviso-camara').textContent = 'No se pudo abrir la cámara. Escribe el código del pase o el celular abajo.';
      }
    }

    async function buscar(codigo) {
      const res = $('#resultado');
      if (!res) return;
      res.innerHTML = '<p class="suave">Buscando…</p>';
      const r = await llamar('app_buscar_pase', { p_codigo: codigo });
      if (!document.body.contains(res)) return;   // el barbero ya cambió de sección
      if (r.estado !== 'ok') { res.innerHTML = '<p class="aviso error">' + BP.esc(r.mensaje) + '</p>'; return; }
      const faltan = Math.max(0, r.requeridos - r.sellos);
      res.innerHTML =
        '<div style="display:grid;gap:16px">' +
        '<div class="cliente"><span class="avatar lleno">' + BP.esc(iniciales(r.cliente)) + '</span><div><b>' + BP.esc(r.cliente) + '</b>' +
        '<span class="suave">Pase válido · ' + BP.esc(celularBonito(r.celular)) + '</span></div></div>' +
        '<div class="barra"><span style="width:' + Math.min(100, 100 * r.sellos / r.requeridos) + '%"></span></div>' +
        '<p class="suave">' + r.sellos + ' de ' + r.requeridos + ' sellos · ' +
          (faltan ? 'le faltan ' + faltan + ' para ' + BP.esc(String(r.premio).toLowerCase()) : 'tiene listo su premio') + '</p>' +
        htmlServicios('esc-servicio') +
        '<div class="campo"><span class="etiqueta">Tu PIN para confirmar</span>' + htmlPin('pin-sello') + '</div>' +
        '<div id="msg-sello" aria-live="polite"></div>' +
        '<button class="btn bloque" id="sumar">Sumar sello</button></div>';
      const pin = activarPin('pin-sello');
      $('#sumar').addEventListener('click', async () => {
        const b = $('#sumar'); b.disabled = true;
        try {
          const s = await llamar('app_sumar_sello', { p_codigo: r.codigo, p_id_servicio: Number($('#esc-servicio').value), p_pin: pin.valor() });
          if (s.estado !== 'ok') throw new Error(s.mensaje);
          sincronizarWallet(r.codigo);
          toast('Sello sumado: ' + s.sellos + ' de ' + s.requeridos);
          buscar(r.codigo);
        } catch (e) {
          $('#msg-sello').innerHTML = '<p class="aviso error">' + BP.esc(e.message) + '</p>';
          pin.limpiar(); b.disabled = false;
        }
      });
    }

    $('#f-buscar').addEventListener('submit', e => { e.preventDefault(); if ($('#codigo').value.trim()) buscar($('#codigo').value.trim()); });
    camara();
  }

  // ---------- 5. clientes ----------
  async function clientes() {
    let filtro = 'todos', buscarTxt = '', espera = null;
    const FILTROS = [['todos', 'Todos'], ['falta1', 'Les falta 1'], ['premio', 'Premio'], ['cumple', 'Cumpleaños'], ['inactivos', 'Inactivos']];
    vista.innerHTML =
      '<header class="titulo"><div><h1>Clientes</h1><p id="total">…</p></div></header>' +
      '<div class="buscador">' + BPIcono('buscar', 22) + '<input class="entrada" id="buscar" type="search" placeholder="Buscar por nombre o celular" aria-label="Buscar por nombre o celular"></div>' +
      '<div class="filtros" role="group" aria-label="Filtros">' + FILTROS.map(([id, t]) => '<button data-f="' + id + '" aria-pressed="' + (id === filtro) + '">' + t + '</button>').join('') + '</div>' +
      '<ul class="lista" id="lista"></ul>' +
      '<button class="btn fab" id="registrar">' + BPIcono('mas', 20) + 'Registrar cliente</button>';

    async function cargar() {
      const r = await llamar('app_clientes', { p_filtro: filtro, p_buscar: buscarTxt || null });
      if (!$('#total')) return;
      $('#total').textContent = r.total + ' registrados';
      $('#lista').innerHTML = r.clientes.length ? r.clientes.map(c => {
        const inactivo = c.dias == null || c.dias > 45;
        let chip = '<span class="chip num">' + Math.min(c.sellos, c.requeridos) + '/' + c.requeridos + '</span>';
        if (c.sellos >= c.requeridos) chip = '<span class="chip verde">Premio</span>';
        else if (inactivo) chip = '<span class="chip rojo">Inactivo</span>';
        let seg = '';
        for (let i = 0; i < c.requeridos; i++) seg += '<i' + (i < c.sellos ? ' class="lleno"' : '') + '></i>';
        const msj = 'Hola ' + c.nombre.split(' ')[0] + ', te escribimos de ' + ses.barberia.nombre + '. Llevas ' + Math.min(c.sellos, c.requeridos) + ' de ' + c.requeridos + ' sellos. ¡Te esperamos!';
        return '<li class="fila"><div class="info"><b>' + BP.esc(c.nombre) + '</b>' +
          (inactivo && c.sellos < c.requeridos ? '<small>' + (c.dias == null ? 'Aún no tiene visitas' : 'Sin venir hace ' + c.dias + ' días') + '</small>' : '<div class="segmentos" aria-hidden="true">' + seg + '</div>') +
          (c.cumple ? '<small> · cumple este mes</small>' : '') + '</div>' + chip +
          '<a class="redondo wa" href="https://wa.me/57' + encodeURIComponent(c.celular) + '?text=' + encodeURIComponent(msj) + '" target="_blank" rel="noopener" aria-label="Escribir a ' + BP.esc(c.nombre) + ' por WhatsApp">' + BPIcono('whatsapp', 24) + '</a></li>';
      }).join('') : '<li class="vacio">No hay clientes con ese filtro.</li>';
    }
    vista.querySelector('.filtros').addEventListener('click', e => {
      const b = e.target.closest('[data-f]'); if (!b) return;
      filtro = b.dataset.f;
      vista.querySelectorAll('[data-f]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      cargar();
    });
    $('#buscar').addEventListener('input', e => { clearTimeout(espera); espera = setTimeout(() => { buscarTxt = e.target.value.trim(); cargar(); }, 300); });
    $('#registrar').addEventListener('click', () => registrar(cargar));
    await cargar();
  }

  function registrar(despues) {
    const m = document.createElement('div');
    m.className = 'modal'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true'); m.setAttribute('aria-label', 'Registrar cliente');
    m.innerHTML = '<div><h2>Registrar cliente</h2>' +
      '<div class="campo"><label for="r-nom">Nombre</label><input class="entrada" id="r-nom" autocomplete="off"></div>' +
      '<div class="campo"><label for="r-ape">Apellido</label><input class="entrada" id="r-ape" autocomplete="off"></div>' +
      '<div class="campo"><label for="r-cel">Celular</label><input class="entrada" id="r-cel" type="tel" inputmode="numeric" placeholder="3001234567"></div>' +
      '<div class="campo"><label for="r-nac">Cumpleaños (opcional)</label><input class="entrada" id="r-nac" type="date"></div>' +
      '<div id="r-msg" aria-live="polite"></div>' +
      '<button class="btn bloque" id="r-ok">Registrar cliente</button><button class="btn secundario bloque" id="r-no">Cancelar</button></div>';
    document.body.appendChild(m);
    const cerrar = () => m.remove();
    m.addEventListener('click', e => { if (e.target === m) cerrar(); });
    m.querySelector('#r-no').addEventListener('click', cerrar);
    m.querySelector('#r-nom').focus();
    m.querySelector('#r-ok').addEventListener('click', async () => {
      const b = m.querySelector('#r-ok'); b.disabled = true;
      try {
        const r = await llamar('app_registrar_cliente', {
          p_nombres: m.querySelector('#r-nom').value, p_apellidos: m.querySelector('#r-ape').value,
          p_celular: m.querySelector('#r-cel').value, p_fecha_nacimiento: m.querySelector('#r-nac').value || null
        });
        if (r.estado !== 'ok') throw new Error(r.mensaje);
        const enlace = new URL('tarjeta.html?codigo=' + r.codigo, location.href).toString();
        const cel = m.querySelector('#r-cel').value.replace(/\D/g, '');
        m.firstElementChild.innerHTML = '<h2>' + (r.nuevo ? 'Cliente registrado' : 'Ya estaba registrado') + '</h2>' +
          '<p class="suave">Envíale su tarjeta para que la guarde en su Wallet.</p>' +
          '<a class="btn bloque" target="_blank" rel="noopener" href="https://wa.me/57' + cel + '?text=' + encodeURIComponent('Esta es tu tarjeta de sellos de ' + ses.barberia.nombre + ': ' + enlace) + '">' + BPIcono('whatsapp', 22) + 'Enviar tarjeta por WhatsApp</a>' +
          '<button class="btn secundario bloque" id="r-fin">Listo</button>';
        m.querySelector('#r-fin').addEventListener('click', () => { cerrar(); despues && despues(); });
      } catch (e) {
        m.querySelector('#r-msg').innerHTML = '<p class="aviso error">' + BP.esc(e.message) + '</p>';
        b.disabled = false;
      }
    });
  }

  // ---------- 6. premios ----------
  async function premios() {
    const r = await llamar('app_premios');
    vista.innerHTML =
      '<header class="titulo"><div><h1>Premios</h1><p>' + r.por_canjear.length + ' por canjear</p></div></header>' +
      (r.por_canjear.length ? r.por_canjear.map(p =>
        '<article class="premio" data-t="' + p.id_tarjeta + '" data-c="' + BP.esc(p.codigo) + '">' +
          '<div class="cab"><span class="regalo">' + BPIcono('premios', 26) + '</span><div><b style="font-size:1.15rem">' + BP.esc(p.cliente) + '</b>' +
          '<p class="suave">' + BP.esc(p.premio) + ' · ganado ' + BP.esc(horaCorta(p.ganado)) + '</p></div></div>' +
          '<div class="confirmar" hidden><div class="campo"><span class="etiqueta">Tu PIN para confirmar</span>' + htmlPin('pin-' + p.id_tarjeta) + '</div><div class="msg" aria-live="polite"></div></div>' +
          '<button class="btn bloque canjear">Canjear con PIN</button></article>').join('')
        : '<p class="vacio">No hay premios pendientes. Cuando un cliente complete sus sellos aparecerá aquí.</p>') +
      '<section><h2>Canjeados recientemente</h2>' +
      (r.canjeados.length ? '<ul class="lista">' + r.canjeados.map(c =>
        '<li class="fila"><div class="info"><b>' + BP.esc(c.cliente) + '</b><small>Canjeado por ' + BP.esc(c.barbero) + ' · ' +
        new Date(ms(c.fecha_hora)).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', timeZone: 'UTC' }) + '</small></div><span class="chip verde">Canjeado</span></li>').join('') + '</ul>'
        : '<p class="vacio">Aún no hay canjes.</p>') + '</section>';

    vista.querySelectorAll('.premio').forEach(card => {
      const id = card.dataset.t;
      const pin = activarPin('pin-' + id);
      card.querySelector('.canjear').addEventListener('click', async () => {
        const conf = card.querySelector('.confirmar');
        if (conf.hidden) { conf.hidden = false; pin.foco(); card.querySelector('.canjear').textContent = 'Confirmar canje'; return; }
        const b = card.querySelector('.canjear'); b.disabled = true;
        try {
          const c = await llamar('app_canjear', { p_id_tarjeta: Number(id), p_pin: pin.valor() });
          if (c.estado !== 'ok') throw new Error(c.mensaje);
          sincronizarWallet(card.dataset.c);
          toast('Premio canjeado: ' + c.premio);
          premios();
        } catch (e) {
          card.querySelector('.msg').innerHTML = '<p class="aviso error">' + BP.esc(e.message) + '</p>';
          pin.limpiar(); b.disabled = false;
        }
      });
    });
  }

  // ---------- arranque ----------
  ses = leerSesion();
  mostrar();
})();
