// Pase del cliente: el mismo diseño en la tarjeta web, la vista previa del admin y la app.
// t = { barberia, cliente?, color, color2, sellos, requeridos, premio, codigo_wallet? }
window.BPTarjeta = function (t, opciones) {
  opciones = opciones || {};
  const req = Math.max(1, Number(t.requeridos) || 8);
  const sellos = Math.max(0, Number(t.sellos) || 0);
  const llenos = Math.min(sellos, req);
  const color = t.color || '#3B1D14';
  const color2 = t.color2 || '#F2C879';
  let circulos = '';
  for (let i = 0; i < req; i++) {
    const ultimo = i === req - 1;
    const icono = ultimo ? 'premios' : 'tijeras';
    circulos += '<li class="pase-sello' + (i < llenos ? ' lleno' : '') + '">' + BPIcono(icono, 22) +
      '<span class="visually-hidden">' + (i < llenos ? 'Sello ' + (i + 1) : (ultimo ? 'Premio' : 'Pendiente')) + '</span></li>';
  }
  const faltan = Math.max(0, req - sellos);
  const mensaje = faltan === 0
    ? '¡Tarjeta completa! Pide tu ' + BP.esc(String(t.premio || 'premio').toLowerCase()) + '.'
    : (faltan === 1 ? 'Te falta 1 sello' : 'Te faltan ' + faltan + ' sellos') + ' para ' + BP.esc(String(t.premio || 'tu premio').toLowerCase()) + '.';
  return (
    '<article class="pase" style="--pase:' + BP.esc(color) + ';--pase2:' + BP.esc(color2) + '">' +
      '<header class="pase-cab"><span class="pase-nombre">' + BP.esc(t.barberia || 'Tu barbería') + '</span>' +
      '<span class="pase-cuenta"><small>Sellos</small><b>' + llenos + '/' + req + '</b></span></header>' +
      '<ol class="pase-sellos" style="--cols:' + Math.min(5, Math.ceil(req / 2)) + '" aria-label="' + llenos + ' de ' + req + ' sellos">' + circulos + '</ol>' +
      (opciones.simple ? '' :
        '<footer class="pase-pie"><span>' + (t.cliente ? BP.esc(t.cliente) : '') + '</span><span>' + mensaje + '</span></footer>') +
    '</article>'
  );
};
