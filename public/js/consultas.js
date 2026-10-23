// Generado desde supabase/02_api_web.sql: el SQL que se muestra es el que ejecuta cada vista.
window.BP_CONSULTAS = [
  {
    "id": "p1",
    "codigo": "P1",
    "pregunta": "¿Qué barbero registra más visitas y genera más ingresos en cada barbería?",
    "proposito": "Analíticas del gerente: une 5 tablas, agrupa por barbero y numera el puesto con RANK(). El barbero sale de la credencial, haya sellado por NFC o por QR.",
    "vista": "v_p1",
    "sql": "SELECT b.nombre                              AS barberia,\n       e.nombres || ' ' || e.apellidos       AS barbero,\n       COUNT(DISTINCT v.id_visita)           AS visitas,\n       SUM(d.precio_cobrado)                 AS ingresos,\n       RANK() OVER (PARTITION BY b.id_barberia\n                    ORDER BY SUM(d.precio_cobrado) DESC) AS puesto\nFROM   visita v\nJOIN   credencial     c ON c.id_credencial  = v.id_credencial\nJOIN   empleado       e ON e.id_empleado    = c.id_empleado\nJOIN   barberia       b ON b.id_barberia    = e.id_barberia\nJOIN   detalle_visita d ON d.id_visita      = v.id_visita\nGROUP  BY b.id_barberia, b.nombre, e.id_empleado, e.nombres, e.apellidos\nORDER  BY b.nombre, puesto;"
  },
  {
    "id": "p2",
    "codigo": "P2",
    "pregunta": "¿Qué clientes están a uno o dos sellos de su premio?",
    "proposito": "A quién mandar un aviso al Wallet. Calcula los sellos disponibles (atributo derivado) con subconsultas dentro de un WITH.",
    "vista": "v_p2",
    "sql": "WITH sellos AS (\n    SELECT t.id_tarjeta,\n           (SELECT COUNT(*) FROM visita v WHERE v.id_tarjeta = t.id_tarjeta)\n         - (SELECT COALESCE(SUM(c.sellos_usados), 0) FROM canje c WHERE c.id_tarjeta = t.id_tarjeta)\n           AS disponibles\n    FROM tarjeta_fidelizacion t\n)\nSELECT cl.nombres || ' ' || cl.apellidos                        AS cliente,\n       LEFT(cl.celular, 3) || '****' || RIGHT(cl.celular, 3)    AS celular,\n       b.nombre                                                 AS barberia,\n       s.disponibles,\n       p.sellos_requeridos,\n       p.sellos_requeridos - s.disponibles                      AS faltan\nFROM   sellos s\nJOIN   tarjeta_fidelizacion  t  ON t.id_tarjeta  = s.id_tarjeta\nJOIN   cliente               cl ON cl.id_cliente = t.id_cliente\nJOIN   barberia              b  ON b.id_barberia = t.id_barberia\nJOIN   programa_fidelizacion p  ON p.id_barberia = t.id_barberia\n                               AND p.fecha_fin IS NULL\nWHERE  p.sellos_requeridos - s.disponibles BETWEEN 1 AND 2\nORDER  BY faltan, b.nombre, cliente;"
  },
  {
    "id": "p3",
    "codigo": "P3",
    "pregunta": "¿Cuánto facturó cada barbería por servicio en el tercer trimestre de 2026?",
    "proposito": "Qué servicios mueven la caja de julio a septiembre. Filtra por fecha y usa COUNT, SUM y AVG.",
    "vista": "v_p3",
    "sql": "SELECT b.nombre                        AS barberia,\n       s.nombre                        AS servicio,\n       COUNT(*)                        AS veces_vendido,\n       SUM(d.precio_cobrado)           AS facturado,\n       ROUND(AVG(d.precio_cobrado), 0) AS precio_promedio\nFROM   detalle_visita d\nJOIN   servicio s ON s.id_servicio = d.id_servicio\nJOIN   barberia b ON b.id_barberia = s.id_barberia\nJOIN   visita   v ON v.id_visita   = d.id_visita\nWHERE  v.fecha_hora >= DATE '2026-07-01'\n  AND  v.fecha_hora <  DATE '2026-10-01'\nGROUP  BY b.nombre, s.nombre\nORDER  BY b.nombre, facturado DESC;"
  },
  {
    "id": "p4",
    "codigo": "P4",
    "pregunta": "¿Qué clientes llevan más de 45 días sin volver?",
    "proposito": "Clientes en riesgo de abandono, con fecha de corte 16 de octubre de 2026. Usa MAX y filtra el grupo con HAVING.",
    "vista": "v_p4",
    "sql": "SELECT cl.nombres || ' ' || cl.apellidos                        AS cliente,\n       LEFT(cl.celular, 3) || '****' || RIGHT(cl.celular, 3)    AS celular,\n       b.nombre                                                 AS barberia,\n       MAX(v.fecha_hora)::date                                  AS ultima_visita,\n       DATE '2026-10-16' - MAX(v.fecha_hora)::date              AS dias_sin_volver\nFROM   visita v\nJOIN   tarjeta_fidelizacion t  ON t.id_tarjeta  = v.id_tarjeta\nJOIN   cliente              cl ON cl.id_cliente = t.id_cliente\nJOIN   barberia             b  ON b.id_barberia = t.id_barberia\nGROUP  BY cl.id_cliente, cl.nombres, cl.apellidos, cl.celular, b.nombre\nHAVING DATE '2026-10-16' - MAX(v.fecha_hora)::date > 45\nORDER  BY dias_sin_volver DESC;"
  },
  {
    "id": "p5",
    "codigo": "P5",
    "pregunta": "¿Cuántos premios ha canjeado cada barbería y cuál es su tasa de canje?",
    "proposito": "Mide si el programa funciona. El LEFT JOIN cuenta también las tarjetas sin canjes.",
    "vista": "v_p5",
    "sql": "SELECT b.nombre                                   AS barberia,\n       COUNT(DISTINCT t.id_tarjeta)               AS tarjetas_emitidas,\n       COUNT(c.id_canje)                          AS premios_canjeados,\n       COUNT(DISTINCT c.id_tarjeta)               AS clientes_premiados,\n       ROUND(100.0 * COUNT(DISTINCT c.id_tarjeta)\n             / COUNT(DISTINCT t.id_tarjeta), 1)   AS tasa_canje_pct\nFROM   barberia b\nJOIN   tarjeta_fidelizacion t ON t.id_barberia = b.id_barberia\nLEFT   JOIN canje c           ON c.id_tarjeta  = t.id_tarjeta\nGROUP  BY b.nombre\nORDER  BY tasa_canje_pct DESC;"
  },
  {
    "id": "b1",
    "codigo": "B1",
    "pregunta": "Servicios de Navaja de Oro que cuestan máximo $40.000",
    "proposito": "Selección y filtro con WHERE.",
    "vista": "v_b1",
    "sql": "SELECT nombre, precio, duracion_min\nFROM   servicio\nWHERE  id_barberia = 4\n  AND  precio <= 40000\nORDER  BY precio;"
  },
  {
    "id": "b2",
    "codigo": "B2",
    "pregunta": "Credenciales que ya no deben sellar",
    "proposito": "Auditoría anti-fraude: tarjetas NFC y códigos QR perdidos o bloqueados, con su barbero (JOIN de 3 tablas).",
    "vista": "v_b2",
    "sql": "SELECT c.tipo,\n       c.estado,\n       e.nombres || ' ' || e.apellidos AS barbero,\n       b.nombre                        AS barberia,\n       c.fecha_asignacion\nFROM   credencial c\nJOIN   empleado   e ON e.id_empleado = c.id_empleado\nJOIN   barberia   b ON b.id_barberia = e.id_barberia\nWHERE  c.estado <> 'ACTIVA'\nORDER  BY b.nombre, c.tipo;"
  },
  {
    "id": "b3",
    "codigo": "B3",
    "pregunta": "Tarjetas por plataforma de Wallet",
    "proposito": "Cuántos clientes usan Apple Wallet y cuántos Google Wallet en cada barbería (GROUP BY).",
    "vista": "v_b3",
    "sql": "SELECT b.nombre AS barberia,\n       COUNT(*) FILTER (WHERE t.plataforma_wallet = 'APPLE')  AS apple,\n       COUNT(*) FILTER (WHERE t.plataforma_wallet = 'GOOGLE') AS google,\n       COUNT(*)                                               AS total\nFROM   tarjeta_fidelizacion t\nJOIN   barberia b ON b.id_barberia = t.id_barberia\nGROUP  BY b.nombre\nORDER  BY total DESC;"
  },
  {
    "id": "b4",
    "codigo": "B4",
    "pregunta": "Sellos registrados por NFC y por QR",
    "proposito": "Cuántos sellos llegan por QR porque el celular del cliente no tiene NFC (GROUP BY con porcentaje).",
    "vista": "v_b4",
    "sql": "SELECT b.nombre                                            AS barberia,\n       COUNT(*) FILTER (WHERE c.tipo = 'NFC')              AS sellos_nfc,\n       COUNT(*) FILTER (WHERE c.tipo = 'QR')               AS sellos_qr,\n       ROUND(100.0 * COUNT(*) FILTER (WHERE c.tipo = 'QR')\n             / COUNT(*), 1)                                AS pct_qr\nFROM   visita v\nJOIN   credencial c ON c.id_credencial = v.id_credencial\nJOIN   empleado   e ON e.id_empleado   = c.id_empleado\nJOIN   barberia   b ON b.id_barberia   = e.id_barberia\nGROUP  BY b.nombre\nORDER  BY pct_qr DESC;"
  }
];
