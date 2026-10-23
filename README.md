# BarberPass: página de presentación

Página web del proyecto de Bases de Datos (CUN), con la base de datos en Supabase y la página publicada en Cloudflare Pages. Es el mismo esquema de trabajo que Mueve.

Qué incluye:

- **App del barbero** (`app.html`): pensada para el celular. Se entra con usuario y PIN, y tiene cinco secciones:
  - **Inicio:** sellos del día y últimos sellos.
  - **Mi QR:** QR dinámico para el cliente sin NFC.
  - **Escanear pase:** con la cámara o escribiendo el código o el celular; el sello se confirma con el PIN.
  - **Clientes:** búsqueda, filtros, WhatsApp y registro.
  - **Premios:** canje con PIN.
- **Panel de administración** (`admin.html`):
  - Barberías con cifras generales.
  - Editor de marca (nombre, logo, colores, sellos y premio) con vista previa del pase.
  - Barberos y cambio de PIN.
  - Credenciales NFC y QR.
  - Planes.
- **Tablero del proyecto** (`index.html`): las 9 consultas (P1–P5 y B1–B4) con su resultado en vivo y su SQL.
- **Páginas del cliente:**
  - `sellar.html` se abre al escanear el QR del barbero.
  - `tarjeta.html` muestra la tarjeta de sellos y el botón **Agregar a Google Wallet**.
- **Función `/api/google-wallet`** (Cloudflare Pages Functions): crea y actualiza el pase de Google Wallet.

### Usuarios de prueba

| Dónde | Usuario | PIN |
| --- | --- | --- |
| App del barbero | `ricardo` (El Patrón), `sebastian` (Clásicos), `david` (Fade Studio), `julian` (Navaja de Oro). Los demás están en la columna `usuario` de `empleado`. | `1234` |
| Panel admin | `admin` | `2026` |

Cambia el PIN del administrador antes de publicar el enlace. Desde el SQL Editor:

```sql
UPDATE administrador SET pin_hash = _hash_pin('admin', 'NUEVO') WHERE usuario = 'admin';
```

Los PIN de los barberos se cambian desde el panel con el botón **Nuevo PIN**.

```
barberpass-web/
├── supabase/
│   ├── 01_esquema_y_datos.sql   14 tablas + datos de prueba (esquema public)
│   ├── 02_api_web.sql           vistas de las consultas y sellado por QR
│   └── 03_app_admin.sql         ingreso con PIN, app del barbero y panel admin
├── public/                      la página (HTML + JS, sin compilar)
│   └── js/config.js             aquí van la URL y la llave publicable de Supabase
└── functions/                   código del servidor para Google Wallet
```

---

## 1. Base de datos en Supabase

1. Entra a <https://supabase.com/dashboard> y crea un proyecto nuevo llamado `barberpass` (región: East US o São Paulo).
2. Abre **SQL Editor → New query**, pega todo `supabase/01_esquema_y_datos.sql` y dale **Run**.
3. Abre otra query, pega `supabase/02_api_web.sql` y dale **Run**. Haz lo mismo con `supabase/03_app_admin.sql`.
4. Copia dos datos del proyecto:
   - **Project URL** (ej. `https://abcdxyz.supabase.co`), en **Project Settings → Data API**.
   - La **Publishable key** (`sb_publishable_…`), en **Project Settings → API Keys**. Si tu proyecto solo muestra la llave antigua **anon** (`eyJ…`), usa esa; la página acepta las dos.
5. Pega los dos valores en `public/js/config.js`.

La llave publicable es pública por diseño. Con ella la página solo puede leer las vistas y ejecutar las funciones. Las tablas tienen RLS activado y no son accesibles directamente. Las funciones de la app y del panel exigen un token de sesión, que se obtiene solo con usuario y PIN correctos.

Si quieres reiniciar los datos después de las pruebas, vuelve a ejecutar 01, 02 y 03 en ese orden.

## 2. Subir a GitHub

```bash
cd ~/proyectos
unzip barberpass-web-v2.0.0.zip
cd barberpass-web
git init
git add .
git commit -m "BarberPass v2.0.0: app del barbero y panel admin"
git branch -M main
git remote add origin https://github.com/TU-USUARIO/barberpass.git
git push -u origin main
```

(Crea antes el repositorio vacío `barberpass` en GitHub.)

## 3. Publicar en Cloudflare Pages

1. En <https://dash.cloudflare.com> ve a **Workers & Pages → Create → Pages → Connect to Git** y elige el repositorio `barberpass`.
2. Configuración del build:
   - Framework preset: **None**
   - Build command: *(vacío)*
   - Build output directory: **`public`**
3. **Save and Deploy**. Quedará en `https://barberpass.pages.dev`. Si el nombre está ocupado, Cloudflare le agrega un sufijo.
4. En **Settings → Variables and Secrets** agrega:

| Variable | Valor | Tipo |
| --- | --- | --- |
| `SUPABASE_URL` | Project URL de Supabase | Text |
| `SUPABASE_ANON_KEY` | la misma llave publicable (o anon) | Text |
| `GOOGLE_ISSUER_ID` | ver paso 4 | Text |
| `GOOGLE_SA_EMAIL` | `client_email` del JSON de la cuenta de servicio | Text |
| `GOOGLE_SA_PRIVATE_KEY` | `private_key` del JSON (completa, con `-----BEGIN…`) | **Secret** |

5. Vuelve a desplegar (**Deployments → Retry deployment**) para que tome las variables.
6. Revisa `https://barberpass.pages.dev/api/estado`. Debe decir `"supabase": true` y, cuando termines el paso 4, `"google_wallet": true`.

Cada `git push` a `main` vuelve a publicar la página sola.

## 4. Google Wallet (gratis)

1. **Cuenta de emisor:** entra a <https://pay.google.com/business/console>, crea la cuenta de emisor (Issuer) y abre **Google Wallet API**. Copia el **Issuer ID** en `GOOGLE_ISSUER_ID`.
2. **API:** en <https://console.cloud.google.com> crea un proyecto y habilita **Google Wallet API**.
3. **Cuenta de servicio:** en **IAM y administración → Cuentas de servicio** crea una (ej. `barberpass-wallet`). Luego ve a **Claves → Agregar clave → JSON** y descarga el archivo.
   - Nunca subas ese JSON a GitHub (el `.gitignore` ya lo excluye).
   - Copia `client_email` en `GOOGLE_SA_EMAIL` y `private_key` en `GOOGLE_SA_PRIVATE_KEY`.
4. **Dar acceso:** en la consola de Google Pay & Wallet ve a **Usuarios** e invita el correo de la cuenta de servicio con rol **Desarrollador**.
5. **Usuarios de prueba:** mientras la cuenta esté en modo demo, solo los usuarios de prueba pueden guardar el pase. En **Google Wallet API → Manage → Set up test accounts** agrega los correos Gmail de los tres integrantes y del profesor. El pase aparecerá con la marca *[TEST ONLY]*.

Cada barbería tiene su propia clase de pase, con su nombre, logo y color. La función la crea sola la primera vez. Cuando el cliente recibe un sello nuevo, la página llama `POST /api/google-wallet` y el pase se actualiza ("3 de 8").

### Apple Wallet

Para firmar pases `.pkpass`, Apple exige un certificado *Pass Type ID*. Ese certificado solo se obtiene con la cuenta Apple Developer Program, que cuesta 99 USD al año. Mientras no exista esa cuenta, en iPhone la tarjeta se guarda en la pantalla de inicio desde Safari (Compartir → Agregar a pantalla de inicio). Si más adelante tienen la cuenta, se agrega una función `/api/apple-wallet` que genere el `.pkpass`.

## 5. Guion para la presentación

1. **Tablero** (`/`): proyecta las preguntas P1 a P5 y muestra el SQL con "Ver el SQL".
2. **Panel admin** (`/admin.html`): muestra las barberías y cambia los colores de una. El pase se actualiza en vivo. Si quieren, creen una barbería nueva con un barbero.
3. **App del barbero** (`/app.html`): entra en el celular o en el portátil con `ricardo` / `1234`. En **Mi QR**, el profesor escanea el código con su celular, escribe su número y su nombre, y recibe su tarjeta. En la app aparece "Sello registrado para…".
4. En **Escanear pase**, busca al profesor por su celular, escribe el PIN y toca **Sumar sello**. Su tarjeta pasa a 2 de 8.
5. En **Clientes**, muestra los filtros y el botón de WhatsApp. En **Premios**, canjea uno con PIN.
6. Vuelve al tablero: las cifras y B4 cambiaron. Para mostrar el anti-fraude, abre otra vez el mismo enlace del QR: dice "ya se usó", porque `codigo_sello` es UNIQUE.

Para leer el QR del pase con la cámara, la app usa el lector de códigos del navegador. Funciona en Chrome para Android. En iPhone, escribe el código o el celular en el buscador de **Escanear pase**.

## Probar en tu computador (opcional)

```bash
cd barberpass-web
npx wrangler pages dev public      # sirve la página y las funciones en http://localhost:8788
```

Para las funciones de Google Wallet en local, crea un archivo `.dev.vars` con las mismas variables del paso 3. Ese archivo está en `.gitignore`.
