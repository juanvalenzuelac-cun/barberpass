-- =====================================================================
--  BarberPass - Funciones de la app del barbero y del panel de administración
--  Ejecutar DESPUÉS de 01_esquema_y_datos.sql y 02_api_web.sql. Re-ejecutable.
--
--  Cómo funciona el ingreso:
--    - El barbero entra con usuario + PIN de 4 dígitos (iniciar_sesion).
--    - El administrador entra con usuario + PIN (admin_iniciar_sesion).
--    - La base crea una fila en SESION con un token aleatorio de 64 caracteres
--      que vence en 12 horas. Cada función recibe ese token y valida quién es.
--    - El PIN nunca se guarda: solo su hash SHA-256 de 'usuario:PIN'.
--
--  Usuarios de prueba (cámbienlos antes de mostrar la página en público):
--    barberos: ver la columna usuario de EMPLEADO, PIN 1234 para todos
--    administrador: admin / PIN 2026
-- =====================================================================
SET search_path TO public;

-- ---------------------------------------------------------------------
-- Utilidades internas (no se exponen a la página)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION _hash_pin(p_usuario TEXT, p_pin TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT ENCODE(SHA256(CONVERT_TO(LOWER(p_usuario) || ':' || p_pin, 'UTF8')), 'hex');
$$;

CREATE OR REPLACE FUNCTION _ahora()
RETURNS TIMESTAMP LANGUAGE sql STABLE AS $$
  SELECT (NOW() AT TIME ZONE 'America/Bogota')::TIMESTAMP;
$$;

CREATE OR REPLACE FUNCTION _nuevo_token()
RETURNS TEXT LANGUAGE sql VOLATILE AS $$
  SELECT REPLACE(GEN_RANDOM_UUID()::TEXT, '-', '') || REPLACE(GEN_RANDOM_UUID()::TEXT, '-', '');
$$;

-- Sellos disponibles de una tarjeta (atributo derivado)
CREATE OR REPLACE FUNCTION _sellos(p_id_tarjeta INT)
RETURNS INT LANGUAGE sql STABLE AS $$
  SELECT ((SELECT COUNT(*) FROM visita WHERE id_tarjeta = p_id_tarjeta)
        - (SELECT COALESCE(SUM(sellos_usados), 0) FROM canje WHERE id_tarjeta = p_id_tarjeta))::INT;
$$;

-- Empleado dueño de una sesión vigente (NULL si no hay)
CREATE OR REPLACE FUNCTION _sesion_empleado(p_token TEXT,
  OUT id_empleado INT, OUT id_barberia INT, OUT usuario TEXT, OUT pin_hash TEXT, OUT nombres TEXT)
LANGUAGE sql STABLE AS $$
  SELECT e.id_empleado, e.id_barberia, e.usuario::TEXT, e.pin_hash::TEXT, e.nombres::TEXT
    FROM sesion s
    JOIN empleado e ON e.id_empleado = s.id_empleado
    JOIN barberia b ON b.id_barberia = e.id_barberia
   WHERE s.token = p_token AND s.expira > _ahora() AND e.activo AND b.activa;
$$;

CREATE OR REPLACE FUNCTION _sesion_admin(p_token TEXT)
RETURNS INT LANGUAGE sql STABLE AS $$
  SELECT a.id_admin
    FROM sesion s JOIN administrador a ON a.id_admin = s.id_admin
   WHERE s.token = p_token AND s.expira > _ahora() AND a.activo;
$$;

-- Credencial QR (la app) del empleado: con ella quedan registrados los sellos y canjes de la app
CREATE OR REPLACE FUNCTION _credencial_app(p_id_empleado INT)
RETURNS INT LANGUAGE sql STABLE AS $$
  SELECT id_credencial FROM credencial
   WHERE id_empleado = p_id_empleado AND tipo = 'QR' AND estado = 'ACTIVA'
   ORDER BY fecha_asignacion DESC, id_credencial DESC LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION _sin_sesion()
RETURNS JSON LANGUAGE sql IMMUTABLE AS $$
  SELECT json_build_object('estado', 'error', 'codigo', 'sesion', 'mensaje', 'Tu sesión venció. Vuelve a ingresar.');
$$;

-- tarjeta_por_codigo ahora también entrega el color secundario de la barbería
CREATE OR REPLACE FUNCTION tarjeta_por_codigo(p_codigo TEXT)
RETURNS JSON
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE r RECORD;
BEGIN
  SELECT t.id_tarjeta, t.codigo_wallet, t.plataforma_wallet, cl.nombres AS cliente,
         b.id_barberia, b.nombre AS barberia, b.color_primario, b.color_secundario, b.logo_url,
         p.sellos_requeridos, p.premio, _sellos(t.id_tarjeta) AS sellos,
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
    'estado', 'ok', 'codigo_wallet', r.codigo_wallet, 'plataforma', r.plataforma_wallet,
    'cliente', r.cliente, 'id_barberia', r.id_barberia, 'barberia', r.barberia,
    'color', r.color_primario, 'color2', r.color_secundario, 'logo_url', r.logo_url,
    'sellos', r.sellos, 'requeridos', r.sellos_requeridos, 'premio', r.premio,
    'ultima_visita', r.ultima_visita);
END;
$$;

-- =====================================================================
--  APP DEL BARBERO
-- =====================================================================

-- 1. Ingreso con usuario y PIN
CREATE OR REPLACE FUNCTION iniciar_sesion(p_usuario TEXT, p_pin TEXT)
RETURNS JSON LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r RECORD;
  v_token TEXT := _nuevo_token();
BEGIN
  SELECT e.id_empleado, e.nombres, e.apellidos, e.rol, b.id_barberia, b.nombre AS barberia,
         b.color_primario, b.color_secundario, b.logo_url
    INTO r
    FROM empleado e JOIN barberia b ON b.id_barberia = e.id_barberia
   WHERE e.usuario = LOWER(TRIM(p_usuario))
     AND e.pin_hash = _hash_pin(TRIM(p_usuario), COALESCE(p_pin, ''))
     AND e.activo AND b.activa;
  IF NOT FOUND THEN
    RETURN json_build_object('estado', 'error', 'mensaje', 'Usuario o PIN incorrectos.');
  END IF;

  DELETE FROM sesion WHERE id_empleado = r.id_empleado AND expira < _ahora();
  INSERT INTO sesion (token, id_empleado, creada, expira)
  VALUES (v_token, r.id_empleado, _ahora(), _ahora() + INTERVAL '12 hours');

  RETURN json_build_object(
    'estado', 'ok', 'token', v_token,
    'empleado', json_build_object('id', r.id_empleado, 'nombre', SPLIT_PART(r.nombres, ' ', 1),
                                  'nombre_completo', r.nombres || ' ' || r.apellidos, 'rol', r.rol),
    'barberia', json_build_object('id', r.id_barberia, 'nombre', r.barberia, 'color', r.color_primario,
                                  'color2', r.color_secundario, 'logo_url', r.logo_url),
    'tiene_qr', _credencial_app(r.id_empleado) IS NOT NULL);
END;
$$;

CREATE OR REPLACE FUNCTION cerrar_sesion(p_token TEXT)
RETURNS JSON LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM sesion WHERE token = p_token;
  SELECT json_build_object('estado', 'ok');
$$;

-- 2. Inicio: cifras del día y últimos sellos de la barbería
CREATE OR REPLACE FUNCTION app_inicio(p_token TEXT)
RETURNS JSON LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s RECORD;
  v_hoy DATE := _ahora()::DATE;
BEGIN
  SELECT * INTO s FROM _sesion_empleado(p_token);
  IF s.id_empleado IS NULL THEN RETURN _sin_sesion(); END IF;

  RETURN json_build_object(
    'estado', 'ok',
    'sellos_hoy', (SELECT COUNT(*) FROM visita v JOIN credencial c USING (id_credencial)
                    WHERE c.id_empleado = s.id_empleado AND v.fecha_hora::DATE = v_hoy),
    'sellos_barberia', (SELECT COUNT(*) FROM visita v JOIN tarjeta_fidelizacion t USING (id_tarjeta)
                         WHERE t.id_barberia = s.id_barberia AND v.fecha_hora::DATE = v_hoy),
    'premios', (SELECT COUNT(*) FROM tarjeta_fidelizacion t
                  JOIN programa_fidelizacion p ON p.id_barberia = t.id_barberia AND p.fecha_fin IS NULL
                 WHERE t.id_barberia = s.id_barberia AND _sellos(t.id_tarjeta) >= p.sellos_requeridos),
    'clientes_nuevos', (SELECT COUNT(*) FROM tarjeta_fidelizacion
                         WHERE id_barberia = s.id_barberia AND fecha_alta = v_hoy),
    'ultimos', COALESCE((
      SELECT json_agg(x ORDER BY x.fecha_hora DESC) FROM (
        SELECT cl.nombres || ' ' || cl.apellidos AS cliente, c.tipo AS metodo, v.fecha_hora,
               SPLIT_PART(e.nombres, ' ', 1) AS barbero,
               _sellos(t.id_tarjeta) AS sellos, p.sellos_requeridos AS requeridos
          FROM visita v
          JOIN tarjeta_fidelizacion t ON t.id_tarjeta = v.id_tarjeta
          JOIN cliente cl ON cl.id_cliente = t.id_cliente
          JOIN credencial c ON c.id_credencial = v.id_credencial
          JOIN empleado e ON e.id_empleado = c.id_empleado
          LEFT JOIN programa_fidelizacion p ON p.id_barberia = t.id_barberia AND p.fecha_fin IS NULL
         WHERE t.id_barberia = s.id_barberia
         ORDER BY v.fecha_hora DESC, v.id_visita DESC
         LIMIT 8) x), '[]'::JSON));
END;
$$;

-- 3. Mi QR: token vigente del QR del barbero que inició sesión
CREATE OR REPLACE FUNCTION app_qr(p_token TEXT)
RETURNS JSON LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s RECORD;
  v_cred INT;
  r JSON;
BEGIN
  SELECT * INTO s FROM _sesion_empleado(p_token);
  IF s.id_empleado IS NULL THEN RETURN _sin_sesion(); END IF;
  v_cred := _credencial_app(s.id_empleado);
  IF v_cred IS NULL THEN
    RETURN json_build_object('estado', 'error', 'mensaje', 'No tienes una credencial QR activa. Pídela al administrador.');
  END IF;
  r := qr_actual(v_cred);
  RETURN (r::JSONB || jsonb_build_object('id_credencial', v_cred))::JSON;
END;
$$;

-- 4. Escanear pase: busca la tarjeta por el código del pase o por el celular
CREATE OR REPLACE FUNCTION app_buscar_pase(p_token TEXT, p_codigo TEXT)
RETURNS JSON LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s RECORD;
  r RECORD;
  v_cod TEXT := UPPER(TRIM(COALESCE(p_codigo, '')));
  v_cel TEXT := REGEXP_REPLACE(COALESCE(p_codigo, ''), '\D', '', 'g');
BEGIN
  SELECT * INTO s FROM _sesion_empleado(p_token);
  IF s.id_empleado IS NULL THEN RETURN _sin_sesion(); END IF;

  -- El QR del pase puede traer el código solo o el enlace a tarjeta.html?codigo=...
  IF v_cod LIKE '%CODIGO=%' THEN v_cod := SPLIT_PART(SPLIT_PART(v_cod, 'CODIGO=', 2), '&', 1); END IF;

  SELECT t.id_tarjeta, t.codigo_wallet, cl.nombres, cl.apellidos, cl.celular,
         p.sellos_requeridos, p.premio, _sellos(t.id_tarjeta) AS sellos
    INTO r
    FROM tarjeta_fidelizacion t
    JOIN cliente cl ON cl.id_cliente = t.id_cliente
    LEFT JOIN programa_fidelizacion p ON p.id_barberia = t.id_barberia AND p.fecha_fin IS NULL
   WHERE t.id_barberia = s.id_barberia
     AND (t.codigo_wallet = v_cod OR (LENGTH(v_cel) = 10 AND cl.celular = v_cel));
  IF NOT FOUND THEN
    RETURN json_build_object('estado', 'error', 'mensaje', 'Ese pase no es de un cliente de esta barbería.');
  END IF;

  RETURN json_build_object('estado', 'ok', 'id_tarjeta', r.id_tarjeta, 'codigo', r.codigo_wallet,
    'cliente', r.nombres || ' ' || r.apellidos, 'celular', r.celular,
    'sellos', r.sellos, 'requeridos', r.sellos_requeridos, 'premio', r.premio);
END;
$$;

-- 5. Sumar sello desde la app (el barbero confirma con su PIN)
CREATE OR REPLACE FUNCTION app_sumar_sello(p_token TEXT, p_codigo TEXT, p_id_servicio INT, p_pin TEXT)
RETURNS JSON LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s RECORD;
  v_tarjeta INT;
  v_cred INT;
  v_precio DECIMAL(10,2);
  v_visita INT;
BEGIN
  SELECT * INTO s FROM _sesion_empleado(p_token);
  IF s.id_empleado IS NULL THEN RETURN _sin_sesion(); END IF;
  IF _hash_pin(s.usuario, COALESCE(p_pin, '')) <> s.pin_hash THEN
    RETURN json_build_object('estado', 'error', 'mensaje', 'PIN incorrecto.');
  END IF;

  SELECT id_tarjeta INTO v_tarjeta FROM tarjeta_fidelizacion
   WHERE codigo_wallet = UPPER(TRIM(p_codigo)) AND id_barberia = s.id_barberia;
  IF v_tarjeta IS NULL THEN
    RETURN json_build_object('estado', 'error', 'mensaje', 'Ese pase no es de un cliente de esta barbería.');
  END IF;

  SELECT precio INTO v_precio FROM servicio
   WHERE id_servicio = p_id_servicio AND id_barberia = s.id_barberia AND activo;
  IF v_precio IS NULL THEN
    RETURN json_build_object('estado', 'error', 'mensaje', 'Elige un servicio de esta barbería.');
  END IF;

  v_cred := _credencial_app(s.id_empleado);
  IF v_cred IS NULL THEN
    RETURN json_build_object('estado', 'error', 'mensaje', 'No tienes una credencial activa para sellar.');
  END IF;

  INSERT INTO visita (id_tarjeta, id_credencial, fecha_hora, codigo_sello)
  VALUES (v_tarjeta, v_cred, _ahora(), UPPER(SUBSTR(_nuevo_token(), 1, 16)))
  RETURNING id_visita INTO v_visita;
  INSERT INTO detalle_visita (id_visita, id_servicio, precio_cobrado) VALUES (v_visita, p_id_servicio, v_precio);

  RETURN tarjeta_por_codigo(UPPER(TRIM(p_codigo)));
END;
$$;

-- 6. Clientes de la barbería, con filtros y búsqueda
--    p_filtro: todos | falta1 | cumple | inactivos | premio
CREATE OR REPLACE FUNCTION app_clientes(p_token TEXT, p_filtro TEXT DEFAULT 'todos', p_buscar TEXT DEFAULT NULL)
RETURNS JSON LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s RECORD;
  v_hoy DATE := _ahora()::DATE;
  v_q TEXT := '%' || LOWER(TRIM(COALESCE(p_buscar, ''))) || '%';
BEGIN
  SELECT * INTO s FROM _sesion_empleado(p_token);
  IF s.id_empleado IS NULL THEN RETURN _sin_sesion(); END IF;

  RETURN (
    WITH base AS (
      SELECT t.id_tarjeta, t.codigo_wallet AS codigo, cl.nombres || ' ' || cl.apellidos AS nombre,
             cl.celular, cl.fecha_nacimiento, _sellos(t.id_tarjeta) AS sellos, p.sellos_requeridos AS requeridos,
             (SELECT MAX(v.fecha_hora) FROM visita v WHERE v.id_tarjeta = t.id_tarjeta) AS ultima
        FROM tarjeta_fidelizacion t
        JOIN cliente cl ON cl.id_cliente = t.id_cliente
        LEFT JOIN programa_fidelizacion p ON p.id_barberia = t.id_barberia AND p.fecha_fin IS NULL
       WHERE t.id_barberia = s.id_barberia
    ), calc AS (
      SELECT b.*, (v_hoy - b.ultima::DATE) AS dias,
             (EXTRACT(MONTH FROM b.fecha_nacimiento) = EXTRACT(MONTH FROM v_hoy)) AS cumple
        FROM base b
    )
    SELECT json_build_object('estado', 'ok',
      'total', (SELECT COUNT(*) FROM base),
      'clientes', COALESCE(json_agg(json_build_object(
          'id_tarjeta', id_tarjeta, 'codigo', codigo, 'nombre', nombre, 'celular', celular,
          'sellos', sellos, 'requeridos', requeridos, 'ultima', ultima, 'dias', dias,
          'cumple', COALESCE(cumple, FALSE)) ORDER BY ultima DESC NULLS LAST), '[]'::JSON))
      FROM calc
     WHERE (LOWER(nombre) LIKE v_q OR celular LIKE v_q)
       AND CASE COALESCE(p_filtro, 'todos')
             WHEN 'falta1'    THEN requeridos - sellos = 1
             WHEN 'cumple'    THEN COALESCE(cumple, FALSE)
             WHEN 'inactivos' THEN dias IS NULL OR dias > 45
             WHEN 'premio'    THEN sellos >= requeridos
             ELSE TRUE END
  );
END;
$$;

-- 7. Registrar cliente desde la app (sin sello)
CREATE OR REPLACE FUNCTION app_registrar_cliente(p_token TEXT, p_nombres TEXT, p_apellidos TEXT,
  p_celular TEXT, p_fecha_nacimiento DATE DEFAULT NULL)
RETURNS JSON LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s RECORD;
  v_cel TEXT := REGEXP_REPLACE(COALESCE(p_celular, ''), '\D', '', 'g');
  v_cliente INT;
  v_codigo TEXT;
  v_nuevo BOOLEAN := FALSE;
BEGIN
  SELECT * INTO s FROM _sesion_empleado(p_token);
  IF s.id_empleado IS NULL THEN RETURN _sin_sesion(); END IF;
  IF v_cel !~ '^3[0-9]{9}$' THEN
    RETURN json_build_object('estado', 'error', 'mensaje', 'Escribe un celular de 10 dígitos que empiece por 3.');
  END IF;

  SELECT id_cliente INTO v_cliente FROM cliente WHERE celular = v_cel;
  IF v_cliente IS NULL THEN
    IF NULLIF(TRIM(p_nombres), '') IS NULL OR NULLIF(TRIM(p_apellidos), '') IS NULL THEN
      RETURN json_build_object('estado', 'error', 'mensaje', 'Escribe nombre y apellido.');
    END IF;
    INSERT INTO cliente (nombres, apellidos, celular, fecha_nacimiento, fecha_registro)
    VALUES (INITCAP(TRIM(p_nombres)), INITCAP(TRIM(p_apellidos)), v_cel, p_fecha_nacimiento, _ahora()::DATE)
    RETURNING id_cliente INTO v_cliente;
    v_nuevo := TRUE;
  END IF;

  SELECT codigo_wallet INTO v_codigo FROM tarjeta_fidelizacion
   WHERE id_cliente = v_cliente AND id_barberia = s.id_barberia;
  IF v_codigo IS NULL THEN
    v_codigo := 'BP-' || UPPER(SUBSTR(_nuevo_token(), 1, 20));
    INSERT INTO tarjeta_fidelizacion (id_cliente, id_barberia, codigo_wallet, plataforma_wallet, fecha_alta)
    VALUES (v_cliente, s.id_barberia, v_codigo, 'GOOGLE', _ahora()::DATE);
    v_nuevo := TRUE;
  END IF;

  RETURN json_build_object('estado', 'ok', 'codigo', v_codigo, 'nuevo', v_nuevo);
END;
$$;

-- 8. Premios por canjear y canjeados recientemente
CREATE OR REPLACE FUNCTION app_premios(p_token TEXT)
RETURNS JSON LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE s RECORD;
BEGIN
  SELECT * INTO s FROM _sesion_empleado(p_token);
  IF s.id_empleado IS NULL THEN RETURN _sin_sesion(); END IF;

  RETURN json_build_object('estado', 'ok',
    'por_canjear', COALESCE((
      SELECT json_agg(x ORDER BY x.ganado DESC) FROM (
        SELECT t.id_tarjeta, t.codigo_wallet AS codigo, cl.nombres || ' ' || cl.apellidos AS cliente,
               p.premio, (SELECT MAX(v.fecha_hora) FROM visita v WHERE v.id_tarjeta = t.id_tarjeta) AS ganado
          FROM tarjeta_fidelizacion t
          JOIN cliente cl ON cl.id_cliente = t.id_cliente
          JOIN programa_fidelizacion p ON p.id_barberia = t.id_barberia AND p.fecha_fin IS NULL
         WHERE t.id_barberia = s.id_barberia AND _sellos(t.id_tarjeta) >= p.sellos_requeridos) x), '[]'::JSON),
    'canjeados', COALESCE((
      SELECT json_agg(x ORDER BY x.fecha_hora DESC) FROM (
        SELECT cl.nombres || ' ' || cl.apellidos AS cliente, SPLIT_PART(e.nombres, ' ', 1) AS barbero,
               c.fecha_hora, p.premio
          FROM canje c
          JOIN tarjeta_fidelizacion t ON t.id_tarjeta = c.id_tarjeta
          JOIN cliente cl ON cl.id_cliente = t.id_cliente
          JOIN credencial cr ON cr.id_credencial = c.id_credencial
          JOIN empleado e ON e.id_empleado = cr.id_empleado
          JOIN programa_fidelizacion p ON p.id_programa = c.id_programa
         WHERE t.id_barberia = s.id_barberia
         ORDER BY c.fecha_hora DESC LIMIT 8) x), '[]'::JSON));
END;
$$;

-- 9. Canjear premio (el barbero confirma con su PIN)
CREATE OR REPLACE FUNCTION app_canjear(p_token TEXT, p_id_tarjeta INT, p_pin TEXT)
RETURNS JSON LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s RECORD;
  p RECORD;
  v_cred INT;
  v_codigo TEXT;
BEGIN
  SELECT * INTO s FROM _sesion_empleado(p_token);
  IF s.id_empleado IS NULL THEN RETURN _sin_sesion(); END IF;
  IF _hash_pin(s.usuario, COALESCE(p_pin, '')) <> s.pin_hash THEN
    RETURN json_build_object('estado', 'error', 'mensaje', 'PIN incorrecto.');
  END IF;

  SELECT t.codigo_wallet INTO v_codigo FROM tarjeta_fidelizacion t
   WHERE t.id_tarjeta = p_id_tarjeta AND t.id_barberia = s.id_barberia;
  SELECT * INTO p FROM programa_fidelizacion WHERE id_barberia = s.id_barberia AND fecha_fin IS NULL;
  IF v_codigo IS NULL OR p.id_programa IS NULL THEN
    RETURN json_build_object('estado', 'error', 'mensaje', 'Tarjeta no encontrada en esta barbería.');
  END IF;
  IF _sellos(p_id_tarjeta) < p.sellos_requeridos THEN
    RETURN json_build_object('estado', 'error', 'mensaje', 'Este cliente todavía no completa sus sellos.');
  END IF;
  v_cred := _credencial_app(s.id_empleado);
  IF v_cred IS NULL THEN
    RETURN json_build_object('estado', 'error', 'mensaje', 'No tienes una credencial activa.');
  END IF;

  INSERT INTO canje (id_tarjeta, id_programa, id_credencial, fecha_hora, sellos_usados)
  VALUES (p_id_tarjeta, p.id_programa, v_cred, _ahora(), p.sellos_requeridos);
  RETURN json_build_object('estado', 'ok', 'codigo', v_codigo, 'premio', p.premio);
END;
$$;

-- =====================================================================
--  PANEL DE ADMINISTRACIÓN
-- =====================================================================

CREATE OR REPLACE FUNCTION admin_iniciar_sesion(p_usuario TEXT, p_pin TEXT)
RETURNS JSON LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r RECORD;
  v_token TEXT := _nuevo_token();
BEGIN
  SELECT id_admin, nombre INTO r FROM administrador
   WHERE usuario = LOWER(TRIM(p_usuario)) AND pin_hash = _hash_pin(TRIM(p_usuario), COALESCE(p_pin, '')) AND activo;
  IF NOT FOUND THEN
    RETURN json_build_object('estado', 'error', 'mensaje', 'Usuario o PIN incorrectos.');
  END IF;
  DELETE FROM sesion WHERE id_admin = r.id_admin AND expira < _ahora();
  INSERT INTO sesion (token, id_admin, creada, expira)
  VALUES (v_token, r.id_admin, _ahora(), _ahora() + INTERVAL '12 hours');
  RETURN json_build_object('estado', 'ok', 'token', v_token, 'nombre', r.nombre);
END;
$$;

-- Todo lo que muestra la pantalla principal del panel
CREATE OR REPLACE FUNCTION admin_panel(p_token TEXT)
RETURNS JSON LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF _sesion_admin(p_token) IS NULL THEN RETURN _sin_sesion(); END IF;
  RETURN json_build_object('estado', 'ok',
    'kpis', json_build_object(
      'barberias_activas', (SELECT COUNT(*) FROM barberia WHERE activa),
      'ingreso_mensual', (SELECT COALESCE(SUM(p.precio_mensual), 0) FROM barberia b JOIN plan p USING (id_plan) WHERE b.activa),
      'clientes_wallet', (SELECT COUNT(*) FROM tarjeta_fidelizacion),
      'credenciales_inactivas', (SELECT COUNT(*) FROM credencial WHERE estado <> 'ACTIVA')),
    'planes', (SELECT json_agg(json_build_object('id', id_plan, 'nombre', nombre, 'precio', precio_mensual,
                                                 'max_barberos', max_barberos) ORDER BY precio_mensual) FROM plan),
    'barberias', COALESCE((SELECT json_agg(x ORDER BY x.nombre) FROM (
      SELECT b.id_barberia AS id, b.nombre, b.nit, b.dir_calle, b.dir_ciudad, b.activa,
             b.color_primario AS color, b.color_secundario AS color2, b.logo_url,
             b.id_plan, pl.nombre AS plan, pl.max_barberos,
             (SELECT COUNT(*) FROM empleado e WHERE e.id_barberia = b.id_barberia AND e.activo) AS barberos,
             (SELECT COUNT(*) FROM tarjeta_fidelizacion t WHERE t.id_barberia = b.id_barberia) AS clientes,
             pr.sellos_requeridos, pr.premio
        FROM barberia b
        JOIN plan pl ON pl.id_plan = b.id_plan
        LEFT JOIN programa_fidelizacion pr ON pr.id_barberia = b.id_barberia AND pr.fecha_fin IS NULL) x), '[]'::JSON));
END;
$$;

-- Crear (p_id NULL) o editar una barbería, su marca y su programa de sellos
CREATE OR REPLACE FUNCTION admin_guardar_barberia(p_token TEXT, p_id INT, p_nombre TEXT, p_nit TEXT,
  p_dir_calle TEXT, p_dir_ciudad TEXT, p_id_plan INT, p_color TEXT, p_color2 TEXT,
  p_sellos INT, p_premio TEXT, p_activa BOOLEAN DEFAULT TRUE, p_logo_url TEXT DEFAULT NULL)
RETURNS JSON LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id INT := p_id;
  v_hoy DATE := _ahora()::DATE;
  pr RECORD;
BEGIN
  IF _sesion_admin(p_token) IS NULL THEN RETURN _sin_sesion(); END IF;
  IF NULLIF(TRIM(p_nombre), '') IS NULL OR NULLIF(TRIM(p_premio), '') IS NULL THEN
    RETURN json_build_object('estado', 'error', 'mensaje', 'Escribe el nombre de la barbería y el premio.');
  END IF;

  BEGIN
    IF v_id IS NULL THEN
      INSERT INTO barberia (nit, nombre, dir_calle, dir_ciudad, color_primario, color_secundario, logo_url,
                            id_plan, fecha_registro, activa)
      VALUES (TRIM(p_nit), TRIM(p_nombre), TRIM(p_dir_calle), COALESCE(NULLIF(TRIM(p_dir_ciudad), ''), 'Bogotá'),
              UPPER(p_color), UPPER(p_color2), NULLIF(TRIM(p_logo_url), ''), p_id_plan, v_hoy, COALESCE(p_activa, TRUE))
      RETURNING id_barberia INTO v_id;
      INSERT INTO programa_fidelizacion (id_barberia, sellos_requeridos, premio, fecha_inicio)
      VALUES (v_id, p_sellos, TRIM(p_premio), v_hoy);
      -- servicios iniciales; la barbería los ajusta después
      INSERT INTO servicio (id_barberia, nombre, precio, duracion_min) VALUES
        (v_id, 'Corte clásico', 25000, 30), (v_id, 'Corte + barba', 35000, 50), (v_id, 'Arreglo de barba', 15000, 20);
    ELSE
      UPDATE barberia SET nombre = TRIM(p_nombre), nit = TRIM(p_nit), dir_calle = TRIM(p_dir_calle),
             dir_ciudad = COALESCE(NULLIF(TRIM(p_dir_ciudad), ''), dir_ciudad), id_plan = p_id_plan,
             color_primario = UPPER(p_color), color_secundario = UPPER(p_color2),
             logo_url = COALESCE(NULLIF(TRIM(p_logo_url), ''), logo_url), activa = COALESCE(p_activa, activa)
       WHERE id_barberia = v_id;
      IF NOT FOUND THEN RETURN json_build_object('estado', 'error', 'mensaje', 'Barbería no encontrada.'); END IF;

      -- Si cambia el programa: el vigente se cierra ayer y empieza uno nuevo hoy
      SELECT * INTO pr FROM programa_fidelizacion WHERE id_barberia = v_id AND fecha_fin IS NULL;
      IF pr.id_programa IS NULL THEN
        INSERT INTO programa_fidelizacion (id_barberia, sellos_requeridos, premio, fecha_inicio)
        VALUES (v_id, p_sellos, TRIM(p_premio), v_hoy);
      ELSIF pr.sellos_requeridos <> p_sellos OR pr.premio <> TRIM(p_premio) THEN
        IF pr.fecha_inicio >= v_hoy THEN
          UPDATE programa_fidelizacion SET sellos_requeridos = p_sellos, premio = TRIM(p_premio)
           WHERE id_programa = pr.id_programa;
        ELSE
          UPDATE programa_fidelizacion SET fecha_fin = v_hoy - 1 WHERE id_programa = pr.id_programa;
          INSERT INTO programa_fidelizacion (id_barberia, sellos_requeridos, premio, fecha_inicio)
          VALUES (v_id, p_sellos, TRIM(p_premio), v_hoy);
        END IF;
      END IF;
    END IF;
  EXCEPTION
    WHEN unique_violation THEN
      RETURN json_build_object('estado', 'error', 'mensaje', 'Ya existe una barbería con ese NIT.');
    WHEN check_violation THEN
      RETURN json_build_object('estado', 'error', 'mensaje', 'Revisa los datos: colores en formato #RRGGBB y entre 3 y 20 sellos.');
    WHEN not_null_violation OR foreign_key_violation THEN
      RETURN json_build_object('estado', 'error', 'mensaje', 'Faltan datos obligatorios (NIT, dirección o plan).');
  END;
  RETURN json_build_object('estado', 'ok', 'id', v_id);
END;
$$;

-- Barberos de una barbería con sus credenciales
CREATE OR REPLACE FUNCTION admin_barberos(p_token TEXT, p_id_barberia INT)
RETURNS JSON LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF _sesion_admin(p_token) IS NULL THEN RETURN _sin_sesion(); END IF;
  RETURN json_build_object('estado', 'ok', 'barberos', COALESCE((
    SELECT json_agg(json_build_object(
      'id', e.id_empleado, 'nombre', e.nombres || ' ' || e.apellidos, 'usuario', e.usuario,
      'rol', e.rol, 'activo', e.activo,
      'credenciales', COALESCE((SELECT json_agg(json_build_object('id', c.id_credencial, 'tipo', c.tipo,
                                    'estado', c.estado, 'fecha', c.fecha_asignacion) ORDER BY c.tipo, c.id_credencial)
                                  FROM credencial c WHERE c.id_empleado = e.id_empleado), '[]'::JSON))
      ORDER BY e.activo DESC, e.rol DESC, e.nombres)
      FROM empleado e WHERE e.id_barberia = p_id_barberia), '[]'::JSON));
END;
$$;

-- Nuevo barbero o gerente: se crea con su credencial QR (la app)
CREATE OR REPLACE FUNCTION admin_crear_barbero(p_token TEXT, p_id_barberia INT, p_nombres TEXT, p_apellidos TEXT,
  p_documento TEXT, p_celular TEXT, p_usuario TEXT, p_pin TEXT, p_rol TEXT DEFAULT 'BARBERO')
RETURNS JSON LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id INT;
  v_usuario TEXT := LOWER(TRIM(p_usuario));
BEGIN
  IF _sesion_admin(p_token) IS NULL THEN RETURN _sin_sesion(); END IF;
  IF COALESCE(p_pin, '') !~ '^[0-9]{4}$' THEN
    RETURN json_build_object('estado', 'error', 'mensaje', 'El PIN debe tener 4 números.');
  END IF;
  BEGIN
    INSERT INTO empleado (id_barberia, documento, nombres, apellidos, celular, usuario, pin_hash, rol, fecha_ingreso)
    VALUES (p_id_barberia, TRIM(p_documento), INITCAP(TRIM(p_nombres)), INITCAP(TRIM(p_apellidos)),
            REGEXP_REPLACE(COALESCE(p_celular, ''), '\D', '', 'g'), v_usuario, _hash_pin(v_usuario, p_pin),
            CASE WHEN UPPER(p_rol) = 'GERENTE' THEN 'GERENTE' ELSE 'BARBERO' END, _ahora()::DATE)
    RETURNING id_empleado INTO v_id;
    INSERT INTO credencial (id_empleado, tipo, identificador, fecha_asignacion)
    VALUES (v_id, 'QR', 'QR-' || SUBSTR(_nuevo_token(), 1, 32), _ahora()::DATE);
  EXCEPTION
    WHEN unique_violation THEN
      RETURN json_build_object('estado', 'error', 'mensaje', 'Ese usuario o documento ya existe.');
    WHEN check_violation THEN
      RETURN json_build_object('estado', 'error', 'mensaje', 'El usuario solo puede tener minúsculas, números, punto o guion bajo (3 a 30).');
    WHEN not_null_violation OR foreign_key_violation THEN
      RETURN json_build_object('estado', 'error', 'mensaje', 'Faltan datos obligatorios.');
  END;
  RETURN json_build_object('estado', 'ok', 'id', v_id);
END;
$$;

-- Nuevo PIN para un empleado ("¿Olvidaste tu PIN? Pídeselo al administrador")
CREATE OR REPLACE FUNCTION admin_cambiar_pin(p_token TEXT, p_id_empleado INT, p_pin TEXT)
RETURNS JSON LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF _sesion_admin(p_token) IS NULL THEN RETURN _sin_sesion(); END IF;
  IF COALESCE(p_pin, '') !~ '^[0-9]{4}$' THEN
    RETURN json_build_object('estado', 'error', 'mensaje', 'El PIN debe tener 4 números.');
  END IF;
  UPDATE empleado SET pin_hash = _hash_pin(usuario, p_pin) WHERE id_empleado = p_id_empleado;
  DELETE FROM sesion WHERE id_empleado = p_id_empleado;   -- cierra sus sesiones abiertas
  RETURN json_build_object('estado', 'ok');
END;
$$;

-- Todas las credenciales (tarjetas NFC y QR) para el panel
CREATE OR REPLACE FUNCTION admin_credenciales(p_token TEXT)
RETURNS JSON LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF _sesion_admin(p_token) IS NULL THEN RETURN _sin_sesion(); END IF;
  RETURN json_build_object('estado', 'ok', 'credenciales', COALESCE((
    SELECT json_agg(json_build_object(
      'id', c.id_credencial, 'tipo', c.tipo, 'estado', c.estado, 'fecha', c.fecha_asignacion,
      'id_empleado', e.id_empleado, 'barbero', e.nombres || ' ' || e.apellidos, 'barberia', b.nombre,
      'color', b.color_primario,
      'sellos', (SELECT COUNT(*) FROM visita v WHERE v.id_credencial = c.id_credencial),
      -- del UID de una tarjeta NFC se muestran solo los últimos 4 caracteres
      'final', CASE WHEN c.tipo = 'NFC' THEN RIGHT(c.identificador, 4) ELSE NULL END)
      ORDER BY b.nombre, e.nombres, c.tipo)
      FROM credencial c JOIN empleado e USING (id_empleado) JOIN barberia b ON b.id_barberia = e.id_barberia), '[]'::JSON));
END;
$$;

CREATE OR REPLACE FUNCTION admin_cambiar_credencial(p_token TEXT, p_id_credencial INT, p_estado TEXT)
RETURNS JSON LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF _sesion_admin(p_token) IS NULL THEN RETURN _sin_sesion(); END IF;
  IF UPPER(p_estado) NOT IN ('ACTIVA', 'BLOQUEADA', 'PERDIDA') THEN
    RETURN json_build_object('estado', 'error', 'mensaje', 'Estado no válido.');
  END IF;
  UPDATE credencial SET estado = UPPER(p_estado) WHERE id_credencial = p_id_credencial;
  RETURN json_build_object('estado', 'ok');
END;
$$;

-- Asignar una tarjeta NFC nueva a un barbero (UID que trae impreso o que lee el celular)
CREATE OR REPLACE FUNCTION admin_asignar_nfc(p_token TEXT, p_id_empleado INT, p_uid TEXT)
RETURNS JSON LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid TEXT := UPPER(REGEXP_REPLACE(COALESCE(p_uid, ''), '[^0-9A-Fa-f]', '', 'g'));
BEGIN
  IF _sesion_admin(p_token) IS NULL THEN RETURN _sin_sesion(); END IF;
  IF LENGTH(v_uid) NOT BETWEEN 8 AND 20 THEN
    RETURN json_build_object('estado', 'error', 'mensaje', 'El UID debe tener entre 8 y 20 caracteres hexadecimales.');
  END IF;
  BEGIN
    INSERT INTO credencial (id_empleado, tipo, identificador, fecha_asignacion)
    VALUES (p_id_empleado, 'NFC', v_uid, _ahora()::DATE);
  EXCEPTION WHEN unique_violation THEN
    RETURN json_build_object('estado', 'error', 'mensaje', 'Esa tarjeta NFC ya está asignada.');
  END;
  RETURN json_build_object('estado', 'ok');
END;
$$;

-- ---------------------------------------------------------------------
-- SEGURIDAD
-- ---------------------------------------------------------------------
ALTER TABLE sesion        ENABLE ROW LEVEL SECURITY;
ALTER TABLE administrador ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sesion, administrador FROM anon, authenticated;

DO $$
DECLARE f TEXT;
BEGIN
  -- funciones internas: nadie de afuera las ejecuta
  FOREACH f IN ARRAY ARRAY['_hash_pin(TEXT,TEXT)', '_ahora()', '_nuevo_token()', '_sellos(INT)',
                           '_sesion_empleado(TEXT)', '_sesion_admin(TEXT)', '_credencial_app(INT)', '_sin_sesion()']
  LOOP
    EXECUTE 'REVOKE ALL ON FUNCTION ' || f || ' FROM PUBLIC, anon, authenticated';
  END LOOP;
  -- funciones públicas de la app y del panel (cada una valida la sesión por dentro)
  FOREACH f IN ARRAY ARRAY['tarjeta_por_codigo(TEXT)', 'iniciar_sesion(TEXT,TEXT)', 'cerrar_sesion(TEXT)',
                           'app_inicio(TEXT)', 'app_qr(TEXT)', 'app_buscar_pase(TEXT,TEXT)',
                           'app_sumar_sello(TEXT,TEXT,INT,TEXT)', 'app_clientes(TEXT,TEXT,TEXT)',
                           'app_registrar_cliente(TEXT,TEXT,TEXT,TEXT,DATE)', 'app_premios(TEXT)',
                           'app_canjear(TEXT,INT,TEXT)', 'admin_iniciar_sesion(TEXT,TEXT)', 'admin_panel(TEXT)',
                           'admin_guardar_barberia(TEXT,INT,TEXT,TEXT,TEXT,TEXT,INT,TEXT,TEXT,INT,TEXT,BOOLEAN,TEXT)',
                           'admin_barberos(TEXT,INT)',
                           'admin_crear_barbero(TEXT,INT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT)',
                           'admin_cambiar_pin(TEXT,INT,TEXT)', 'admin_credenciales(TEXT)',
                           'admin_cambiar_credencial(TEXT,INT,TEXT)', 'admin_asignar_nfc(TEXT,INT,TEXT)']
  LOOP
    EXECUTE 'REVOKE ALL ON FUNCTION ' || f || ' FROM PUBLIC';
    EXECUTE 'GRANT EXECUTE ON FUNCTION ' || f || ' TO anon, authenticated';
  END LOOP;
END $$;

-- Fin
