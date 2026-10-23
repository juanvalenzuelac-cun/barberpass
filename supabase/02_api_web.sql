-- =====================================================================
--  BarberPass - API para la página web (Supabase)
--  Ejecutar DESPUÉS de 01_esquema_y_datos.sql, en el SQL Editor de Supabase.
--  Re-ejecutable.
--
--  Qué crea:
--    1. Vistas con las 9 consultas del proyecto (B1-B4, P1-P5) para el tablero.
--    2. Vistas de apoyo para la demo (barberos con QR, servicios, últimos sellos).
--    3. Funciones de la demo de sellado por QR:
--         qr_actual(id_credencial)        -> token vigente del QR del barbero
--         sellar_con_qr(...)              -> registra la visita y el sello
--         tarjeta_por_codigo(codigo)      -> datos de la tarjeta para Wallet
--    4. Seguridad: la página (rol anon) NO puede leer ni modificar tablas
--       directamente; solo leer las vistas y ejecutar las funciones.
--
--  Nota sobre privacidad: las vistas muestran el celular enmascarado
--  (313****931) porque la página es pública.
-- =====================================================================
SET search_path TO public;

-- ---------------------------------------------------------------------
-- 1. VISTAS DE LAS CONSULTAS DEL PROYECTO
-- ---------------------------------------------------------------------

-- B1. Servicios de Navaja de Oro que cuestan máximo $40.000
CREATE OR REPLACE VIEW v_b1 AS
SELECT nombre, precio, duracion_min
FROM   servicio
WHERE  id_barberia = 4
  AND  precio <= 40000
ORDER  BY precio;

-- B2. Credenciales (NFC o QR) que ya no deben sellar
CREATE OR REPLACE VIEW v_b2 AS
SELECT c.tipo,
       c.estado,
       e.nombres || ' ' || e.apellidos AS barbero,
       b.nombre                        AS barberia,
       c.fecha_asignacion
FROM   credencial c
JOIN   empleado   e ON e.id_empleado = c.id_empleado
JOIN   barberia   b ON b.id_barberia = e.id_barberia
WHERE  c.estado <> 'ACTIVA'
ORDER  BY b.nombre, c.tipo;

-- B3. Tarjetas por plataforma de Wallet
CREATE OR REPLACE VIEW v_b3 AS
SELECT b.nombre AS barberia,
       COUNT(*) FILTER (WHERE t.plataforma_wallet = 'APPLE')  AS apple,
       COUNT(*) FILTER (WHERE t.plataforma_wallet = 'GOOGLE') AS google,
       COUNT(*)                                               AS total
FROM   tarjeta_fidelizacion t
JOIN   barberia b ON b.id_barberia = t.id_barberia
GROUP  BY b.nombre
ORDER  BY total DESC;

-- B4. Sellos por NFC y por QR
CREATE OR REPLACE VIEW v_b4 AS
SELECT b.nombre                                            AS barberia,
       COUNT(*) FILTER (WHERE c.tipo = 'NFC')              AS sellos_nfc,
       COUNT(*) FILTER (WHERE c.tipo = 'QR')               AS sellos_qr,
       ROUND(100.0 * COUNT(*) FILTER (WHERE c.tipo = 'QR')
             / COUNT(*), 1)                                AS pct_qr
FROM   visita v
JOIN   credencial c ON c.id_credencial = v.id_credencial
JOIN   empleado   e ON e.id_empleado   = c.id_empleado
JOIN   barberia   b ON b.id_barberia   = e.id_barberia
GROUP  BY b.nombre
ORDER  BY pct_qr DESC;

-- P1. Barbero con más visitas e ingresos en cada barbería
CREATE OR REPLACE VIEW v_p1 AS
SELECT b.nombre                              AS barberia,
       e.nombres || ' ' || e.apellidos       AS barbero,
       COUNT(DISTINCT v.id_visita)           AS visitas,
       SUM(d.precio_cobrado)                 AS ingresos,
       RANK() OVER (PARTITION BY b.id_barberia
                    ORDER BY SUM(d.precio_cobrado) DESC) AS puesto
FROM   visita v
JOIN   credencial     c ON c.id_credencial  = v.id_credencial
JOIN   empleado       e ON e.id_empleado    = c.id_empleado
JOIN   barberia       b ON b.id_barberia    = e.id_barberia
JOIN   detalle_visita d ON d.id_visita      = v.id_visita
GROUP  BY b.id_barberia, b.nombre, e.id_empleado, e.nombres, e.apellidos
ORDER  BY b.nombre, puesto;

-- P2. Clientes a uno o dos sellos de su premio
CREATE OR REPLACE VIEW v_p2 AS
WITH sellos AS (
    SELECT t.id_tarjeta,
           (SELECT COUNT(*) FROM visita v WHERE v.id_tarjeta = t.id_tarjeta)
         - (SELECT COALESCE(SUM(c.sellos_usados), 0) FROM canje c WHERE c.id_tarjeta = t.id_tarjeta)
           AS disponibles
    FROM tarjeta_fidelizacion t
)
SELECT cl.nombres || ' ' || cl.apellidos                        AS cliente,
       LEFT(cl.celular, 3) || '****' || RIGHT(cl.celular, 3)    AS celular,
       b.nombre                                                 AS barberia,
       s.disponibles,
       p.sellos_requeridos,
       p.sellos_requeridos - s.disponibles                      AS faltan
FROM   sellos s
JOIN   tarjeta_fidelizacion  t  ON t.id_tarjeta  = s.id_tarjeta
JOIN   cliente               cl ON cl.id_cliente = t.id_cliente
JOIN   barberia              b  ON b.id_barberia = t.id_barberia
JOIN   programa_fidelizacion p  ON p.id_barberia = t.id_barberia
                               AND p.fecha_fin IS NULL
WHERE  p.sellos_requeridos - s.disponibles BETWEEN 1 AND 2
ORDER  BY faltan, b.nombre, cliente;

-- P3. Facturación por barbería y servicio, tercer trimestre de 2026
CREATE OR REPLACE VIEW v_p3 AS
SELECT b.nombre                        AS barberia,
       s.nombre                        AS servicio,
       COUNT(*)                        AS veces_vendido,
       SUM(d.precio_cobrado)           AS facturado,
       ROUND(AVG(d.precio_cobrado), 0) AS precio_promedio
FROM   detalle_visita d
JOIN   servicio s ON s.id_servicio = d.id_servicio
JOIN   barberia b ON b.id_barberia = s.id_barberia
JOIN   visita   v ON v.id_visita   = d.id_visita
WHERE  v.fecha_hora >= DATE '2026-07-01'
  AND  v.fecha_hora <  DATE '2026-10-01'
GROUP  BY b.nombre, s.nombre
ORDER  BY b.nombre, facturado DESC;

-- P4. Clientes con más de 45 días sin volver (fecha de corte 2026-10-16)
CREATE OR REPLACE VIEW v_p4 AS
SELECT cl.nombres || ' ' || cl.apellidos                        AS cliente,
       LEFT(cl.celular, 3) || '****' || RIGHT(cl.celular, 3)    AS celular,
       b.nombre                                                 AS barberia,
       MAX(v.fecha_hora)::date                                  AS ultima_visita,
       DATE '2026-10-16' - MAX(v.fecha_hora)::date              AS dias_sin_volver
FROM   visita v
JOIN   tarjeta_fidelizacion t  ON t.id_tarjeta  = v.id_tarjeta
JOIN   cliente              cl ON cl.id_cliente = t.id_cliente
JOIN   barberia             b  ON b.id_barberia = t.id_barberia
GROUP  BY cl.id_cliente, cl.nombres, cl.apellidos, cl.celular, b.nombre
HAVING DATE '2026-10-16' - MAX(v.fecha_hora)::date > 45
ORDER  BY dias_sin_volver DESC;

-- P5. Premios canjeados y tasa de canje por barbería
CREATE OR REPLACE VIEW v_p5 AS
SELECT b.nombre                                   AS barberia,
       COUNT(DISTINCT t.id_tarjeta)               AS tarjetas_emitidas,
       COUNT(c.id_canje)                          AS premios_canjeados,
       COUNT(DISTINCT c.id_tarjeta)               AS clientes_premiados,
       ROUND(100.0 * COUNT(DISTINCT c.id_tarjeta)
             / COUNT(DISTINCT t.id_tarjeta), 1)   AS tasa_canje_pct
FROM   barberia b
JOIN   tarjeta_fidelizacion t ON t.id_barberia = b.id_barberia
LEFT   JOIN canje c           ON c.id_tarjeta  = t.id_tarjeta
GROUP  BY b.nombre
ORDER  BY tasa_canje_pct DESC;

-- ---------------------------------------------------------------------
-- 2. VISTAS DE APOYO PARA LA DEMO
-- ---------------------------------------------------------------------

-- Cifras generales para el encabezado del tablero
CREATE OR REPLACE VIEW v_resumen AS
SELECT (SELECT COUNT(*) FROM barberia)                                  AS barberias,
       (SELECT COUNT(*) FROM cliente)                                   AS clientes,
       (SELECT COUNT(*) FROM tarjeta_fidelizacion)                      AS tarjetas,
       (SELECT COUNT(*) FROM visita)                                    AS sellos,
       (SELECT COUNT(*) FROM visita v JOIN credencial c USING (id_credencial)
         WHERE c.tipo = 'QR')                                           AS sellos_qr,
       (SELECT COUNT(*) FROM canje)                                     AS canjes;

-- Barberos que pueden sellar por QR (sin exponer la clave secreta)
CREATE OR REPLACE VIEW v_barberos_qr AS
SELECT c.id_credencial,
       e.nombres || ' ' || e.apellidos AS barbero,
       b.id_barberia,
       b.nombre                        AS barberia,
       b.color_primario
FROM   credencial c
JOIN   empleado   e ON e.id_empleado = c.id_empleado
JOIN   barberia   b ON b.id_barberia = e.id_barberia
WHERE  c.tipo = 'QR' AND c.estado = 'ACTIVA' AND e.activo AND b.activa
ORDER  BY b.nombre, barbero;

-- Servicios activos de cada barbería
CREATE OR REPLACE VIEW v_servicios AS
SELECT id_servicio, id_barberia, nombre, precio, duracion_min
FROM   servicio
WHERE  activo
ORDER  BY id_barberia, precio;

-- Últimos 12 sellos registrados (para ver la demo en vivo)
CREATE OR REPLACE VIEW v_ultimos_sellos AS
SELECT v.id_visita,
       v.fecha_hora,
       cl.nombres || ' ' || LEFT(cl.apellidos, 1) || '.'               AS cliente,
       b.nombre                                                        AS barberia,
       e.nombres || ' ' || e.apellidos                                 AS barbero,
       c.tipo                                                          AS metodo,
       (SELECT STRING_AGG(s.nombre, ' + ' ORDER BY s.nombre)
          FROM detalle_visita d JOIN servicio s USING (id_servicio)
         WHERE d.id_visita = v.id_visita)                              AS servicios
FROM   visita v
JOIN   tarjeta_fidelizacion t  ON t.id_tarjeta    = v.id_tarjeta
JOIN   cliente              cl ON cl.id_cliente   = t.id_cliente
JOIN   barberia             b  ON b.id_barberia   = t.id_barberia
JOIN   credencial           c  ON c.id_credencial = v.id_credencial
JOIN   empleado             e  ON e.id_empleado   = c.id_empleado
ORDER  BY v.fecha_hora DESC, v.id_visita DESC
LIMIT  12;

-- ---------------------------------------------------------------------
-- 3. FUNCIONES DE LA DEMO DE SELLADO POR QR
-- ---------------------------------------------------------------------

-- Token del QR: primeros 16 caracteres del SHA-256 de (clave secreta : ventana).
-- La ventana cambia cada 30 segundos, así el QR cambia solo y no se puede predecir
-- sin conocer la clave (identificador de la credencial, que nunca sale de la base).
CREATE OR REPLACE FUNCTION _token_qr(p_identificador TEXT, p_ventana BIGINT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE
AS $$
  SELECT UPPER(SUBSTR(ENCODE(SHA256(CONVERT_TO(p_identificador || ':' || p_ventana, 'UTF8')), 'hex'), 1, 16));
$$;

-- Datos de una tarjeta de fidelización (para la tarjeta web y Google Wallet)
CREATE OR REPLACE FUNCTION tarjeta_por_codigo(p_codigo TEXT)
RETURNS JSON
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
BEGIN
  SELECT t.id_tarjeta, t.codigo_wallet, t.plataforma_wallet, t.fecha_alta,
         cl.nombres AS cliente,
         b.id_barberia, b.nombre AS barberia, b.color_primario, b.logo_url,
         p.sellos_requeridos, p.premio,
         (SELECT COUNT(*) FROM visita v WHERE v.id_tarjeta = t.id_tarjeta)
       - (SELECT COALESCE(SUM(c.sellos_usados), 0) FROM canje c WHERE c.id_tarjeta = t.id_tarjeta)
           AS sellos,
         (SELECT MAX(v.fecha_hora) FROM visita v WHERE v.id_tarjeta = t.id_tarjeta) AS ultima_visita
    INTO r
    FROM tarjeta_fidelizacion t
    JOIN cliente  cl ON cl.id_cliente = t.id_cliente
    JOIN barberia b  ON b.id_barberia = t.id_barberia
    LEFT JOIN programa_fidelizacion p ON p.id_barberia = t.id_barberia AND p.fecha_fin IS NULL
   WHERE t.codigo_wallet = p_codigo;

  IF NOT FOUND THEN
    RETURN json_build_object('estado', 'error', 'mensaje', 'No existe una tarjeta con ese código.');
  END IF;

  RETURN json_build_object(
    'estado', 'ok',
    'codigo_wallet', r.codigo_wallet,
    'plataforma', r.plataforma_wallet,
    'cliente', r.cliente,
    'id_barberia', r.id_barberia,
    'barberia', r.barberia,
    'color', r.color_primario,
    'logo_url', r.logo_url,
    'sellos', r.sellos,
    'requeridos', r.sellos_requeridos,
    'premio', r.premio,
    'ultima_visita', r.ultima_visita
  );
END;
$$;

-- Token vigente del QR de un barbero (lo llama la pantalla del barbero cada 30 s)
CREATE OR REPLACE FUNCTION qr_actual(p_id_credencial INT)
RETURNS JSON
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ident   TEXT;
  v_epoch   NUMERIC := EXTRACT(EPOCH FROM CLOCK_TIMESTAMP());
  v_ventana BIGINT;
BEGIN
  SELECT c.identificador INTO v_ident
    FROM credencial c JOIN empleado e USING (id_empleado)
   WHERE c.id_credencial = p_id_credencial
     AND c.tipo = 'QR' AND c.estado = 'ACTIVA' AND e.activo;

  IF v_ident IS NULL THEN
    RETURN json_build_object('estado', 'error', 'mensaje', 'Credencial QR no válida o inactiva.');
  END IF;

  v_ventana := FLOOR(v_epoch / 30);
  RETURN json_build_object(
    'estado', 'ok',
    'token', _token_qr(v_ident, v_ventana),
    'segundos_restantes', CEIL((v_ventana + 1) * 30 - v_epoch)::INT
  );
END;
$$;

-- Registra un sello escaneando el QR del barbero.
-- Valida: credencial QR activa, token vigente (hasta 90 s de antigüedad),
-- token no usado antes (codigo_sello es UNIQUE), servicio de la misma barbería.
-- Si el celular no existe pide nombre y apellido (estado = 'cliente_nuevo').
CREATE OR REPLACE FUNCTION sellar_con_qr(
  p_id_credencial INT,
  p_token         TEXT,
  p_id_servicio   INT,
  p_celular       TEXT,
  p_nombres       TEXT DEFAULT NULL,
  p_apellidos     TEXT DEFAULT NULL,
  p_plataforma    TEXT DEFAULT 'GOOGLE'
)
RETURNS JSON
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_celular    TEXT := REGEXP_REPLACE(COALESCE(p_celular, ''), '\D', '', 'g');
  v_token      TEXT := UPPER(TRIM(COALESCE(p_token, '')));
  v_ident      TEXT;
  v_barberia   INT;
  v_ventana    BIGINT := FLOOR(EXTRACT(EPOCH FROM CLOCK_TIMESTAMP()) / 30);
  v_precio     DECIMAL(10,2);
  v_cliente    INT;
  v_tarjeta    INT;
  v_codigo     TEXT;
  v_visita     INT;
  v_plataforma TEXT := CASE WHEN UPPER(p_plataforma) = 'APPLE' THEN 'APPLE' ELSE 'GOOGLE' END;
BEGIN
  IF v_celular !~ '^3[0-9]{9}$' THEN
    RETURN json_build_object('estado', 'error', 'mensaje', 'Escribe un celular colombiano de 10 dígitos que empiece por 3.');
  END IF;

  -- 1. Credencial QR del barbero
  SELECT c.identificador, e.id_barberia INTO v_ident, v_barberia
    FROM credencial c JOIN empleado e USING (id_empleado)
   WHERE c.id_credencial = p_id_credencial
     AND c.tipo = 'QR' AND c.estado = 'ACTIVA' AND e.activo;
  IF v_ident IS NULL THEN
    RETURN json_build_object('estado', 'error', 'mensaje', 'Este código no pertenece a un barbero activo.');
  END IF;

  -- 2. Token vigente: se aceptan las dos ventanas anteriores (hasta 90 s) para dar
  --    tiempo a que un cliente nuevo escriba su nombre después de escanear.
  IF v_token NOT IN (_token_qr(v_ident, v_ventana), _token_qr(v_ident, v_ventana - 1),
                     _token_qr(v_ident, v_ventana - 2)) THEN
    RETURN json_build_object('estado', 'error', 'mensaje', 'El código QR ya venció. Escanea el código que aparece ahora en la pantalla del barbero.');
  END IF;

  -- 3. El mismo QR no sirve dos veces
  IF EXISTS (SELECT 1 FROM visita WHERE codigo_sello = v_token) THEN
    RETURN json_build_object('estado', 'error', 'mensaje', 'Este código QR ya se usó. Espera a que el barbero muestre uno nuevo.');
  END IF;

  -- 4. Servicio de la misma barbería
  SELECT precio INTO v_precio
    FROM servicio
   WHERE id_servicio = p_id_servicio AND id_barberia = v_barberia AND activo;
  IF v_precio IS NULL THEN
    RETURN json_build_object('estado', 'error', 'mensaje', 'El servicio no pertenece a esta barbería.');
  END IF;

  -- 5. Cliente (se identifica por el celular)
  SELECT id_cliente INTO v_cliente FROM cliente WHERE celular = v_celular;
  IF v_cliente IS NULL THEN
    IF NULLIF(TRIM(p_nombres), '') IS NULL OR NULLIF(TRIM(p_apellidos), '') IS NULL THEN
      RETURN json_build_object('estado', 'cliente_nuevo', 'mensaje', 'Es tu primera vez: escribe tu nombre y apellido.');
    END IF;
    INSERT INTO cliente (nombres, apellidos, celular, fecha_registro)
    VALUES (INITCAP(TRIM(p_nombres)), INITCAP(TRIM(p_apellidos)), v_celular,
            (NOW() AT TIME ZONE 'America/Bogota')::DATE)
    RETURNING id_cliente INTO v_cliente;
  END IF;

  -- 6. Tarjeta de fidelización en esa barbería (se crea la primera vez)
  SELECT id_tarjeta, codigo_wallet INTO v_tarjeta, v_codigo
    FROM tarjeta_fidelizacion
   WHERE id_cliente = v_cliente AND id_barberia = v_barberia;
  IF v_tarjeta IS NULL THEN
    v_codigo := 'BP-' || UPPER(SUBSTR(MD5(v_cliente || '-' || v_barberia || '-' || CLOCK_TIMESTAMP()), 1, 20));
    INSERT INTO tarjeta_fidelizacion (id_cliente, id_barberia, codigo_wallet, plataforma_wallet, fecha_alta)
    VALUES (v_cliente, v_barberia, v_codigo, v_plataforma, (NOW() AT TIME ZONE 'America/Bogota')::DATE)
    RETURNING id_tarjeta INTO v_tarjeta;
  END IF;

  -- 7. Visita + sello (el token del QR queda como codigo_sello) + servicio prestado
  BEGIN
    INSERT INTO visita (id_tarjeta, id_credencial, fecha_hora, codigo_sello)
    VALUES (v_tarjeta, p_id_credencial, NOW() AT TIME ZONE 'America/Bogota', v_token)
    RETURNING id_visita INTO v_visita;
  EXCEPTION WHEN unique_violation THEN
    RETURN json_build_object('estado', 'error', 'mensaje', 'Este código QR ya se usó. Espera a que el barbero muestre uno nuevo.');
  END;

  INSERT INTO detalle_visita (id_visita, id_servicio, precio_cobrado)
  VALUES (v_visita, p_id_servicio, v_precio);

  RETURN tarjeta_por_codigo(v_codigo);
END;
$$;

-- ---------------------------------------------------------------------
-- 4. SEGURIDAD
--    RLS activado y sin políticas: nadie con la llave pública (anon) puede
--    leer ni escribir las tablas. Las vistas y funciones corren con los
--    permisos de su dueño, así que exponen solo lo que definen.
-- ---------------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['plan','barberia','telefono_barberia','empleado','credencial','cliente',
                           'programa_fidelizacion','tarjeta_fidelizacion','servicio','visita',
                           'detalle_visita','canje']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON %I FROM anon, authenticated', t);
  END LOOP;
END $$;

GRANT SELECT ON v_b1, v_b2, v_b3, v_b4, v_p1, v_p2, v_p3, v_p4, v_p5,
                v_resumen, v_barberos_qr, v_servicios, v_ultimos_sellos
      TO anon, authenticated;

REVOKE ALL ON FUNCTION _token_qr(TEXT, BIGINT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION qr_actual(INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION tarjeta_por_codigo(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION sellar_con_qr(INT, TEXT, INT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION qr_actual(INT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION tarjeta_por_codigo(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION sellar_con_qr(INT, TEXT, INT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;

-- Fin
