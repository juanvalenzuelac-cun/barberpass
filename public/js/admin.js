// BarberPass - panel de administración de la plataforma
(function () {
  const raiz = document.getElementById('raiz');
  const $ = s => raiz.querySelector(s);
  const CLAVE = 'sesion_admin';
  let ses = null, datos = null, seleccion = null, vistaActual = 'barberias';

  try { ses = JSON.parse(BP.leer(CLAVE) || 'null'); } catch (e) { ses = null; }
  const guardar = s => { ses = s; BP.guardar(CLAVE, s ? JSON.stringify(s) : ''); };

  async function llamar(fn, args) {
    const r = await BP.rpc(fn, Object.assign({ p_token: ses.token }, args || {}));
    if (r && r.codigo === 'sesion') { guardar(null); ingreso(r.mensaje); throw new Error(r.mensaje); }
    return r;
  }
  const millones = n => n >= 1e6 ? (n / 1e6).toLocaleString('es-CO', { maximumFractionDigits: 1 }) + ' M' : BP.cop(n);
  const iniciales = n => String(n || '').split(/\s+/).filter(w => w.length > 2 || /^[A-Z]/.test(w)).slice(0, 2).map(p => p[0]).join('').toUpperCase() || 'BP';
  const hex = v => /^#[0-9A-Fa-f]{6}$/.test(v) ? v.toUpperCase() : null;
  const aviso = (el, txt, tipo) => { el.innerHTML = txt ? '<p class="aviso ' + (tipo || '') + '">' + BP.esc(txt) + '</p>' : ''; };

  // ---------- ingreso ----------
  function ingreso(msg) {
    raiz.innerHTML = '<div class="ingreso"><form class="caja" id="f" novalidate>' +
      '<div class="marca" style="color:var(--tinta);margin:0"><i>' + BPIcono('tijeras', 20) + '</i>BarberPass · Admin</div>' +
      '<p class="suave">Panel para dar de alta barberías, personalizar su marca y administrar barberos y credenciales.</p>' +
      '<div class="campo"><label for="u">Usuario</label><input class="entrada" id="u" autocomplete="username" autocapitalize="none"></div>' +
      '<div class="campo"><label for="p">PIN</label><input class="entrada" id="p" type="password" inputmode="numeric" maxlength="4" autocomplete="current-password"></div>' +
      '<div id="m" aria-live="polite"></div><button class="btn" id="b">Entrar</button></form></div>';
    if (msg) aviso($('#m'), msg, 'error');
    if (!BP.configurado) BP.avisoConfig($('#m'));
    $('#f').addEventListener('submit', async e => {
      e.preventDefault();
      $('#b').disabled = true;
      try {
        const r = await BP.rpc('admin_iniciar_sesion', { p_usuario: $('#u').value, p_pin: $('#p').value });
        if (r.estado !== 'ok') throw new Error(r.mensaje);
        guardar({ token: r.token, nombre: r.nombre });
        marco();
      } catch (err) { aviso($('#m'), err.message, 'error'); $('#b').disabled = false; }
    });
  }

  // ---------- estructura ----------
  function marco() {
    raiz.innerHTML = '<div class="marco"><aside class="lateral">' +
      '<div class="marca"><i>' + BPIcono('tijeras', 20) + '</i>BarberPass · Admin</div>' +
      '<button class="nav" data-v="barberias">' + BPIcono('inicio', 20) + 'Barberías</button>' +
      '<button class="nav" data-v="credenciales">' + BPIcono('tarjeta', 20) + 'Credenciales NFC y QR</button>' +
      '<button class="nav" data-v="planes">' + BPIcono('lista', 20) + 'Planes</button>' +
      '<a class="nav" href="index.html">' + BPIcono('tablero', 20) + 'Consultas del proyecto</a>' +
      '<a class="nav" href="app.html">' + BPIcono('qr', 20) + 'App del barbero</a>' +
      '<button class="nav abajo" id="salir">' + BPIcono('salir', 20) + 'Cerrar sesión</button>' +
      '</aside><main class="contenido" id="contenido"></main></div>';
    raiz.querySelector('.lateral').addEventListener('click', e => {
      const b = e.target.closest('[data-v]'); if (b) { vistaActual = b.dataset.v; pintar(); }
    });
    $('#salir').addEventListener('click', () => { guardar(null); ingreso(); });
    pintar();
  }

  function pintar() {
    raiz.querySelectorAll('[data-v]').forEach(b => b.setAttribute('aria-current', b.dataset.v === vistaActual ? 'page' : 'false'));
    const c = $('#contenido');
    c.innerHTML = '<p class="suave">Cargando…</p>';
    ({ barberias, credenciales, planes })[vistaActual]().catch(e => aviso(c, e.message, 'error'));
  }

  // ---------- barberías ----------
  async function barberias() {
    datos = await llamar('admin_panel');
    const k = datos.kpis;
    $('#contenido').innerHTML =
      '<div class="cabeza"><div><h1>Barberías</h1><p>Todos tus clientes en un lugar</p></div><button class="btn" id="nueva">' + BPIcono('mas', 18) + 'Nueva barbería</button></div>' +
      '<section class="kpis">' +
        '<div class="kpi"><b class="num">' + k.barberias_activas + '</b><span>barberías activas</span></div>' +
        '<div class="kpi"><b class="num">' + millones(Number(k.ingreso_mensual)) + '</b><span>ingreso mensual (COP)</span></div>' +
        '<div class="kpi"><b class="num">' + Number(k.clientes_wallet).toLocaleString('es-CO') + '</b><span>clientes con pase en Wallet</span></div>' +
        '<div class="kpi"><b class="num">' + k.credenciales_inactivas + '</b><span>credenciales bloqueadas o perdidas</span></div>' +
      '</section>' +
      '<div class="dos"><div class="caja tabla-scroll"><table><thead><tr><th>Barbería</th><th>Plan</th><th>Barberos</th><th>Clientes</th><th>Estado</th></tr></thead><tbody>' +
        datos.barberias.map(b => '<tr tabindex="0" data-id="' + b.id + '"' + (seleccion === b.id ? ' aria-selected="true"' : '') + '>' +
          '<td><span class="nombre"><span class="cuadro" style="background:' + BP.esc(b.color) + '"></span>' + BP.esc(b.nombre) + '</span></td>' +
          '<td>' + BP.esc(b.plan) + '</td><td class="num">' + b.barberos + ' <span class="suave">/ ' + b.max_barberos + '</span></td><td class="num">' + b.clientes + '</td>' +
          '<td>' + (b.activa ? '<span class="chip verde">Activa</span>' : '<span class="chip rojo">Inactiva</span>') + '</td></tr>').join('') +
      '</tbody></table></div><section class="caja pad" id="editor"></section></div>';
    const tbody = raiz.querySelector('tbody');
    const elegir = tr => { if (!tr) return; seleccion = Number(tr.dataset.id); tbody.querySelectorAll('tr').forEach(x => x.setAttribute('aria-selected', String(x === tr))); editor(datos.barberias.find(b => b.id === seleccion)); };
    tbody.addEventListener('click', e => elegir(e.target.closest('tr')));
    tbody.addEventListener('keydown', e => { if (e.key === 'Enter') elegir(e.target.closest('tr')); });
    $('#nueva').addEventListener('click', () => { seleccion = null; tbody.querySelectorAll('tr').forEach(x => x.removeAttribute('aria-selected')); editor(null); });
    editor(datos.barberias.find(b => b.id === seleccion) || datos.barberias[0]);
    if (!seleccion && datos.barberias[0]) { seleccion = datos.barberias[0].id; tbody.querySelector('tr').setAttribute('aria-selected', 'true'); }
  }

  function editor(b) {
    const nueva = !b;
    b = b || { nombre: '', nit: '', dir_calle: '', dir_ciudad: 'Bogotá', id_plan: datos.planes[0].id, color: '#3B1D14', color2: '#F2C879', sellos_requeridos: 8, premio: 'Corte gratis', activa: true, logo_url: '' };
    const ed = $('#editor');
    ed.innerHTML =
      '<h2>' + (nueva ? 'Nueva barbería' : BP.esc(b.nombre) + ' · marca') + '</h2>' +
      '<div class="campo"><label for="e-nom">Nombre que ve el cliente</label><input class="entrada" id="e-nom" value="' + BP.esc(b.nombre) + '"></div>' +
      '<div class="campo"><span class="etq">Logo</span><div class="logo"><span class="ini" id="e-ini"></span>' +
        '<div class="campo" style="flex:1"><input class="entrada" id="e-logo" placeholder="URL del logo (opcional; sin logo se usan las iniciales)" value="' + BP.esc(b.logo_url || '') + '"></div></div>' +
        '<small class="suave">Se usa en el pase, la app y la web.</small></div>' +
      '<div class="campo"><span class="etq">Colores</span><div class="fila2">' +
        '<label class="color"><input type="color" id="e-c1" value="' + BP.esc(b.color) + '" aria-label="Color principal"><input type="text" id="e-c1t" value="' + BP.esc(b.color) + '" maxlength="7" aria-label="Color principal en hexadecimal"></label>' +
        '<label class="color"><input type="color" id="e-c2" value="' + BP.esc(b.color2) + '" aria-label="Color de los sellos"><input type="text" id="e-c2t" value="' + BP.esc(b.color2) + '" maxlength="7" aria-label="Color de los sellos en hexadecimal"></label></div></div>' +
      '<div class="fila2"><div class="campo"><label for="e-sel">Sellos para el premio</label><input class="entrada" id="e-sel" type="number" min="3" max="20" value="' + (b.sellos_requeridos || 8) + '"></div>' +
        '<div class="campo"><label for="e-pre">Premio</label><input class="entrada" id="e-pre" value="' + BP.esc(b.premio || '') + '"></div></div>' +
      '<span class="etq">Así se ve el pase del cliente</span><div id="e-pase"></div>' +
      '<hr class="separador">' +
      '<div class="fila2"><div class="campo"><label for="e-nit">NIT</label><input class="entrada" id="e-nit" value="' + BP.esc(b.nit) + '"></div>' +
        '<div class="campo"><label for="e-plan">Plan</label><select class="entrada" id="e-plan">' + datos.planes.map(p => '<option value="' + p.id + '"' + (p.id === b.id_plan ? ' selected' : '') + '>' + BP.esc(p.nombre) + ' · ' + BP.cop(p.precio) + '/mes</option>').join('') + '</select></div></div>' +
      '<div class="fila2"><div class="campo"><label for="e-dir">Dirección</label><input class="entrada" id="e-dir" value="' + BP.esc(b.dir_calle) + '"></div>' +
        '<div class="campo"><label for="e-ciu">Ciudad</label><input class="entrada" id="e-ciu" value="' + BP.esc(b.dir_ciudad) + '"></div></div>' +
      '<label class="interruptor"><input type="checkbox" id="e-act"' + (b.activa ? ' checked' : '') + '>Barbería activa (sus barberos pueden entrar a la app)</label>' +
      '<div id="e-msg" aria-live="polite"></div>' +
      '<button class="btn" id="e-guardar">' + (nueva ? 'Crear barbería' : 'Guardar cambios') + '</button>' +
      (nueva ? '' : '<hr class="separador"><div class="cabeza"><h2>Barberos</h2><button class="btn borde peq" id="e-nuevo-b">' + BPIcono('mas', 16) + 'Agregar barbero</button></div>' +
        '<form id="f-barbero" class="caja pad" hidden>' +
          '<div class="fila2"><div class="campo"><label for="b-nom">Nombres</label><input class="entrada" id="b-nom"></div><div class="campo"><label for="b-ape">Apellidos</label><input class="entrada" id="b-ape"></div></div>' +
          '<div class="fila2"><div class="campo"><label for="b-doc">Documento</label><input class="entrada" id="b-doc" inputmode="numeric"></div><div class="campo"><label for="b-cel">Celular</label><input class="entrada" id="b-cel" inputmode="numeric"></div></div>' +
          '<div class="fila2"><div class="campo"><label for="b-usu">Usuario</label><input class="entrada" id="b-usu" autocapitalize="none"></div><div class="campo"><label for="b-pin">PIN (4 números)</label><input class="entrada" id="b-pin" inputmode="numeric" maxlength="4"></div></div>' +
          '<div class="campo"><label for="b-rol">Rol</label><select class="entrada" id="b-rol"><option value="BARBERO">Barbero</option><option value="GERENTE">Gerente</option></select></div>' +
          '<div id="b-msg" aria-live="polite"></div><button class="btn">Crear barbero</button></form>' +
        '<ul class="lista-b" id="e-barberos"><li class="suave">Cargando…</li></ul>');

    const val = id => ed.querySelector(id).value;
    function vista() {
      const c1 = hex(val('#e-c1t')) || b.color, c2 = hex(val('#e-c2t')) || b.color2;
      const ini = ed.querySelector('#e-ini'), logo = val('#e-logo').trim();
      ini.style.background = c1; ini.style.color = c2;
      ini.innerHTML = logo ? '<img src="' + BP.esc(logo) + '" alt="">' : BP.esc(iniciales(val('#e-nom') || 'BarberPass'));
      const req = Math.min(20, Math.max(3, Number(val('#e-sel')) || 8));
      ed.querySelector('#e-pase').innerHTML = BPTarjeta({ barberia: val('#e-nom') || 'Tu barbería', color: c1, color2: c2, sellos: Math.floor(req / 2), requeridos: req, premio: val('#e-pre') }, { simple: true });
    }
    // sincroniza selector de color y texto hexadecimal
    [['#e-c1', '#e-c1t'], ['#e-c2', '#e-c2t']].forEach(([a, t]) => {
      ed.querySelector(a).addEventListener('input', e => { ed.querySelector(t).value = e.target.value.toUpperCase(); vista(); });
      ed.querySelector(t).addEventListener('input', e => { if (hex(e.target.value)) ed.querySelector(a).value = e.target.value; vista(); });
    });
    ['#e-nom', '#e-sel', '#e-pre', '#e-logo'].forEach(s => ed.querySelector(s).addEventListener('input', vista));
    vista();

    ed.querySelector('#e-guardar').addEventListener('click', async ev => {
      const btn = ev.currentTarget; btn.disabled = true;
      try {
        const r = await llamar('admin_guardar_barberia', {
          p_id: nueva ? null : b.id, p_nombre: val('#e-nom'), p_nit: val('#e-nit'), p_dir_calle: val('#e-dir'),
          p_dir_ciudad: val('#e-ciu'), p_id_plan: Number(val('#e-plan')), p_color: val('#e-c1t'), p_color2: val('#e-c2t'),
          p_sellos: Number(val('#e-sel')), p_premio: val('#e-pre'), p_activa: ed.querySelector('#e-act').checked, p_logo_url: val('#e-logo') || null
        });
        if (r.estado !== 'ok') throw new Error(r.mensaje);
        seleccion = r.id;
        await barberias();
        aviso($('#e-msg'), nueva ? 'Barbería creada. Agrégale sus barberos.' : 'Cambios guardados.', 'ok');
      } catch (e) { aviso(ed.querySelector('#e-msg'), e.message, 'error'); btn.disabled = false; }
    });

    if (!nueva) {
      ed.querySelector('#e-nuevo-b').addEventListener('click', () => { const f = ed.querySelector('#f-barbero'); f.hidden = !f.hidden; if (!f.hidden) ed.querySelector('#b-nom').focus(); });
      ed.querySelector('#f-barbero').addEventListener('submit', async e => {
        e.preventDefault();
        try {
          const r = await llamar('admin_crear_barbero', {
            p_id_barberia: b.id, p_nombres: val('#b-nom'), p_apellidos: val('#b-ape'), p_documento: val('#b-doc'),
            p_celular: val('#b-cel'), p_usuario: val('#b-usu'), p_pin: val('#b-pin'), p_rol: val('#b-rol')
          });
          if (r.estado !== 'ok') throw new Error(r.mensaje);
          aviso(ed.querySelector('#b-msg'), 'Barbero creado. Ya puede entrar a la app con su usuario y PIN.', 'ok');
          e.target.reset();
          listaBarberos(b.id);
        } catch (err) { aviso(ed.querySelector('#b-msg'), err.message, 'error'); }
      });
      listaBarberos(b.id);
    }
  }

  async function listaBarberos(id) {
    const r = await llamar('admin_barberos', { p_id_barberia: id });
    const ul = $('#e-barberos'); if (!ul) return;
    ul.innerHTML = r.barberos.length ? r.barberos.map(e =>
      '<li><div><b>' + BP.esc(e.nombre) + '</b> <small>' + BP.esc(e.usuario) + ' · ' + (e.rol === 'GERENTE' ? 'Gerente' : 'Barbero') + (e.activo ? '' : ' · retirado') + '</small><br>' +
      e.credenciales.map(c => '<span class="chip ' + (c.estado === 'ACTIVA' ? 'verde' : c.estado === 'PERDIDA' ? 'ambar' : 'rojo') + '">' + c.tipo + ' ' + c.estado.toLowerCase() + '</span>').join(' ') + '</div>' +
      '<button class="btn borde peq" data-pin="' + e.id + '">Nuevo PIN</button></li>').join('') : '<li class="suave">Esta barbería todavía no tiene barberos.</li>';
    ul.querySelectorAll('[data-pin]').forEach(btn => btn.addEventListener('click', async () => {
      const pin = prompt('Nuevo PIN de 4 números para este barbero:');
      if (!pin) return;
      const r2 = await llamar('admin_cambiar_pin', { p_id_empleado: Number(btn.dataset.pin), p_pin: pin });
      alert(r2.estado === 'ok' ? 'PIN actualizado. Se cerraron sus sesiones abiertas.' : r2.mensaje);
    }));
  }

  // ---------- credenciales ----------
  async function credenciales() {
    const r = await llamar('admin_credenciales');
    const empleados = [...new Map(r.credenciales.map(c => [c.id_empleado, c])).values()];
    $('#contenido').innerHTML =
      '<div class="cabeza"><div><h1>Credenciales</h1><p>Tarjetas NFC de los barberos y su QR en la app. Bloquea una si se pierde.</p></div></div>' +
      '<form class="caja pad" id="f-nfc"><h2>Asignar tarjeta NFC</h2><div class="fila2">' +
        '<div class="campo"><label for="n-emp">Barbero</label><select class="entrada" id="n-emp">' + empleados.map(e => '<option value="' + e.id_empleado + '">' + BP.esc(e.barbero) + ' · ' + BP.esc(e.barberia) + '</option>').join('') + '</select></div>' +
        '<div class="campo"><label for="n-uid">UID del chip</label><input class="entrada" id="n-uid" placeholder="04:A2:3B:9C:11:22:80"></div></div>' +
        '<div id="n-msg" aria-live="polite"></div><button class="btn" style="justify-self:start">Asignar tarjeta</button></form>' +
      '<div class="caja tabla-scroll"><table><thead><tr><th>Barbero</th><th>Barbería</th><th>Credencial</th><th>Sellos</th><th>Desde</th><th>Estado</th></tr></thead><tbody>' +
      r.credenciales.map(c => '<tr><td>' + BP.esc(c.barbero) + '</td>' +
        '<td><span class="nombre"><span class="cuadro" style="background:' + BP.esc(c.color) + ';width:16px;height:16px;border-radius:5px"></span>' + BP.esc(c.barberia) + '</span></td>' +
        '<td>' + (c.tipo === 'NFC' ? 'Tarjeta NFC ···· ' + BP.esc(c.final) : 'QR en la app') + '</td><td class="num">' + c.sellos + '</td><td>' + BP.esc(c.fecha) + '</td>' +
        '<td><select class="entrada" data-cred="' + c.id + '" aria-label="Estado de la credencial" style="min-height:36px;padding:6px 10px">' +
        ['ACTIVA', 'BLOQUEADA', 'PERDIDA'].map(s => '<option' + (s === c.estado ? ' selected' : '') + ' value="' + s + '">' + s.charAt(0) + s.slice(1).toLowerCase() + '</option>').join('') + '</select></td></tr>').join('') +
      '</tbody></table></div>';
    raiz.querySelectorAll('[data-cred]').forEach(s => s.addEventListener('change', async () => {
      const r2 = await llamar('admin_cambiar_credencial', { p_id_credencial: Number(s.dataset.cred), p_estado: s.value });
      if (r2.estado !== 'ok') alert(r2.mensaje);
    }));
    $('#f-nfc').addEventListener('submit', async e => {
      e.preventDefault();
      const r2 = await llamar('admin_asignar_nfc', { p_id_empleado: Number($('#n-emp').value), p_uid: $('#n-uid').value });
      if (r2.estado !== 'ok') return aviso($('#n-msg'), r2.mensaje, 'error');
      credenciales();
    });
  }

  // ---------- planes ----------
  async function planes() {
    datos = datos || await llamar('admin_panel');
    const uso = id => datos.barberias.filter(b => b.id_plan === id && b.activa).length;
    $('#contenido').innerHTML = '<div class="cabeza"><div><h1>Planes</h1><p>Lo que paga cada barbería por mes</p></div></div><div class="planes">' +
      datos.planes.map(p => '<article class="caja pad"><h2>' + BP.esc(p.nombre) + '</h2><b style="font-size:1.7rem" class="num">' + BP.cop(p.precio) + '</b>' +
        '<p class="suave">por mes · hasta ' + p.max_barberos + ' barberos</p><p>' + uso(p.id) + ' barberías activas en este plan</p></article>').join('') + '</div>';
  }

  if (ses) marco(); else ingreso();
})();
