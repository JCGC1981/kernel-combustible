# ⛽ Kernel Energy · Control de Combustible

Aplicación web instalable (PWA) y **100 % gratuita** para controlar el consumo de combustible
de la flota de **Kernel Energy S.A.S.**

| Rol | Qué puede hacer |
|---|---|
| **Administrador** | Panel completo: saldo, recargas en COP, todos los tanqueos con foto del recibo, aprobar/rechazar, gráficas, exportar a Excel (CSV), gestionar vehículos y conductores. También puede registrar sus propios tanqueos con foto (botón **📷 Registrar tanqueo**); quedan aprobados de inmediato. |
| **Conductor** | Únicamente: tomar la foto del recibo desde la app; **la app lee automáticamente los datos del recibo** (fecha, N° recibo, galones, $/galón, total, combustible, estación, placa, kilometraje), el conductor los verifica y envía. Ve el estado de sus propios envíos. No ve nada más. |

## 📊 Exportar a Excel en tiempo real

El panel siempre muestra los datos vivos (se actualiza solo cuando llega un recibo). Desde ahí:
- **Resumen → 📊 Exportar todo a Excel**: genera al instante un archivo `.xlsx` con 5 hojas:
  *Resumen* (saldo, recargas, gasto, pendientes, consumo por vehículo, gasto mensual), *Tanqueos*
  (todos los registros, con fila TOTAL con fórmulas y filtros automáticos), *Recargas*, *Vehículos*
  y *Conductores*. Fechas y valores en pesos con formato real de Excel.
- **Tanqueos → 📊 Excel (según filtros)**: solo los tanqueos que cumplen los filtros aplicados
  (placa, conductor, estado, fechas, texto). También está el botón **CSV**.

## 🔒 Ingreso con huella digital / Face ID

La primera vez se entra con correo y contraseña; la app pregunta *"¿Usar tu huella para entrar?"*.
Si se acepta, cada vez que se abra la app en ese dispositivo pedirá la huella (o el rostro) del
propio celular en lugar de la contraseña. Siempre está la opción **Ingresar con contraseña**, y el
botón **🔒 Huella** dentro de la app permite activarla o desactivarla. Se usa la tecnología
WebAuthn del dispositivo (la misma de las apps bancarias); la huella nunca sale del celular.

## 📁 Subir una foto recibida (solo administrador)

En **📷 Registrar tanqueo**, el administrador tiene además el botón **Subir foto recibida** para
cargar una imagen de la galería, de WhatsApp o un archivo, y el campo **Conductor que realizó el
tanqueo** para registrarlo a nombre de quien corresponda. Al elegir la placa se propone
automáticamente el conductor asignado a ese vehículo. La lectura automática funciona igual.

## 🔎 Lectura automática del recibo (OCR)

Al tomar la foto, la app reconoce el texto **en el mismo celular** (Tesseract.js, gratuito, sin
servidores ni claves) y rellena el formulario. Los campos leídos se resaltan en amarillo para que
el conductor los revise; los que no se detectaron se indican para completarlos a mano.
El texto reconocido y los valores leídos quedan guardados con el registro (el administrador los
ve en el detalle del tanqueo, marcado con 🔎).

Consejos para que la lectura sea buena:
- Recibo **plano**, con buena luz y sin sombras; encuadrar solo el recibo.
- Tomar la foto apenas se imprime (los recibos térmicos se borran con el tiempo).
- La primera lectura descarga el modelo de idioma (~5 MB, una sola vez); las siguientes son más rápidas (5-15 s).

Si se requiere una precisión aún mayor (recibos muy dañados o formatos poco comunes), la
arquitectura permite conectar más adelante un lector con inteligencia artificial en la nube
(por ejemplo, la API de Claude con visión) mediante una Supabase Edge Function; tendría un
costo aproximado de $10-15 COP por foto.

## ¿Cómo funciona? (arquitectura, todo gratis)

```
 Celular del conductor              Computador / celular del admin
 ┌────────────────────┐             ┌──────────────────────────┐
 │  conductor.html    │             │  admin.html (dashboard)  │
 │  📷 foto + datos   │             │  KPIs · tablas · fotos   │
 └─────────┬──────────┘             └────────────┬─────────────┘
           │        Sitio publicado en GitHub Pages (HTTPS)     │
           └───────────────────┬────────────────────────────────┘
                               ▼
                 ┌───────────────────────────┐
                 │  Supabase (plan Free)     │
                 │  • Auth: usuarios/claves  │
                 │  • PostgreSQL: datos      │
                 │  • Storage: fotos recibos │
                 │  • RLS: el conductor solo │
                 │    ve/crea lo suyo        │
                 └───────────────────────────┘
```

- **GitHub Pages** aloja la app (archivos estáticos, gratis, con HTTPS → la cámara funciona).
- **Supabase Free** aporta login, base de datos y almacenamiento de fotos (500 MB de datos, 1 GB de
  fotos ≈ 5.000 recibos comprimidos, sin tarjeta de crédito).
- La seguridad se aplica **en el servidor** (Row Level Security): aunque un conductor abriera
  `admin.html`, la base de datos le niega todo lo que no sea suyo.

---

## Puesta en marcha (≈ 20 minutos)

### Paso 1 · Crear el proyecto en Supabase

1. Entra a <https://supabase.com> → **Start your project** → crea la cuenta (gratis).
2. **New project**: nombre `kernel-combustible`, región *South America (São Paulo)*, define una
   contraseña de base de datos (guárdala) → **Create new project**. Espera 1-2 minutos.
3. Menú lateral **SQL Editor** → **New query** → pega **todo** el contenido de
   [`supabase/schema.sql`](supabase/schema.sql) → **Run**. Debe terminar en *Success*.
   Esto crea las tablas, las reglas de seguridad, el bucket de fotos y **registra los 5 vehículos**.
4. Menú **Project Settings → API** y copia:
   - **Project URL** (ej. `https://abcd1234.supabase.co`)
   - **anon public** key (una clave larga que empieza por `eyJ...`)

### Paso 2 · Crear tu usuario administrador

1. Menú **Authentication → Users → Add user → Create new user**.
2. Escribe tu correo y una contraseña, activa **Auto Confirm User** → **Create user**.
3. Vuelve a **SQL Editor** y ejecuta (con tu correo):
   ```sql
   update public.perfiles set rol = 'admin', nombre = 'Nombre del administrador'
   where email = 'tu-correo@kernelenergy.com';
   ```

### Paso 3 · Configurar la app

Abre [`js/config.js`](js/config.js) y reemplaza las dos primeras líneas con tus valores:

```js
SUPABASE_URL: "https://abcd1234.supabase.co",
SUPABASE_ANON_KEY: "eyJhbGciOi...",
```

> La clave *anon* es pública por diseño (va en el navegador). La protección real está en las
> reglas RLS del paso 1. **Nunca** pongas la clave `service_role` en la app.

### Paso 4 · Publicar en GitHub Pages

1. Entra a <https://github.com> (crea cuenta si no tienes) → **New repository**:
   nombre `kernel-combustible`, **Public** (Pages gratuito requiere repositorio público;
   el código no contiene datos sensibles) → **Create repository**.
2. Sube **todos** los archivos de esta carpeta (botón *uploading an existing file*, o arrastra
   la carpeta completa; también sirve `git push` si usas Git).
3. En el repositorio: **Settings → Pages → Build and deployment → Source: Deploy from a branch**
   → Branch `main` / carpeta `/ (root)` → **Save**.
4. En 1-2 minutos la app queda en:
   `https://TU-USUARIO.github.io/kernel-combustible/`

### Paso 5 · Autorizar la URL en Supabase (para "olvidé mi contraseña" e invitaciones)

**Authentication → URL Configuration**:
- *Site URL*: `https://TU-USUARIO.github.io/kernel-combustible/`
- *Redirect URLs*: agrega `https://TU-USUARIO.github.io/kernel-combustible/**`

### Paso 6 · Crear los conductores desde la app (ingresan con cédula)

Preparación (una sola vez):
1. **SQL Editor → New query** → pega y ejecuta [`supabase/actualizacion-conductores.sql`](supabase/actualizacion-conductores.sql).
2. **Authentication → Providers → Email** → desactiva **Confirm email** → Save.
   (Los conductores no tienen correo real; la app les crea una cuenta técnica `cedula@conductores.kernelenergy.com`.
   Una regla en la base de datos rechaza cualquier cuenta que el administrador no haya autorizado desde el panel.)

Luego, en la app como administrador → pestaña **Conductores → Agregar conductor**: nombre, cédula,
teléfono, contraseña inicial y vehículo asignado → **Crear conductor**. Aparece el botón
**📲 Copiar mensaje para enviarle** con el enlace, la cédula, la contraseña y las instrucciones
de instalación (para WhatsApp). El botón **📲 Compartir app** arma el mensaje genérico.

Conductores iniciales:

| Conductor | Cédula | Vehículo |
|---|---|---|
| Jorge Alberto Prieto Castro | 14135620 | LPN205 |
| Johana Karina Paniza Erazo | 1116780506 | LZQ931 |
| Castor Paul Gonzalez Hernandez | 17595357 | (asignar) |

El conductor entra con **cédula + contraseña**, puede cambiarla con el botón 🔑 dentro de la app y
activar la huella. Si la olvida, el administrador le asigna una nueva: **Conductores → clic en el
conductor → 🔑 Nueva contraseña**. Para desactivar a un conductor: mismo cuadro → Estado → Inactivo.

### Paso 7 · Instalar en el celular como app

- **Android (Chrome)**: abre la URL → menú ⋮ → **Instalar aplicación** / *Agregar a pantalla de inicio*.
- **iPhone (Safari)**: abre la URL → botón Compartir → **Añadir a pantalla de inicio**.

Al abrirla, el conductor solo ve la pantalla de registro con el botón **Tomar foto del recibo**.

---

## Uso diario

**Conductor**: abre la app → toma la foto → la app lee el recibo y llena placa, fecha, N° recibo,
tipo de combustible, galones, valor por galón (el total se calcula solo), kilometraje y estación →
el conductor verifica/corrige → **Enviar al administrador**.

**Administrador** (`admin.html`):
- **Resumen**: saldo disponible (recargas − tanqueos), gasto del mes, galones, pendientes, gráficas
  por mes y por vehículo, $/galón promedio y km recorridos por placa.
- **Tanqueos**: llega cada envío en tiempo real. Clic en una fila → ves la **foto del recibo**,
  puedes corregir datos, **Aprobar** o **Rechazar** (con motivo que el conductor verá).
  Filtros por placa, conductor, estado, fechas y texto. **Exportar CSV** abre en Excel.
- **Recargas**: registra el dinero (COP) que cargas al fondo de combustible: fecha, valor,
  medio, referencia.
- **Vehículos** y **Conductores**: administración de la flota y de quién conduce qué.

## Trazabilidad que queda registrada por cada tanqueo

Fecha y hora del tanqueo · número de recibo (único por placa) · placa · conductor · tipo de
combustible · galones · valor por galón · valor total · kilometraje · estación · ciudad ·
observaciones · **foto del recibo** · estado (pendiente/aprobado/rechazado) · motivo de rechazo ·
quién revisó y cuándo · fecha/hora en que fue enviado desde la app.

## Estructura del proyecto

```
kernel-combustible/
├── index.html            Inicio de sesión (redirige según rol)
├── admin.html            Panel del administrador
├── conductor.html        App del conductor (cámara + formulario)
├── css/styles.css
├── js/config.js          ← Tus credenciales de Supabase
├── js/common.js          Utilidades, sesión, compresión de fotos
├── js/ocr.js             Lectura automática del recibo (OCR + intérprete de recibos colombianos)
├── js/admin.js
├── js/conductor.js
├── sw.js                 Service worker (PWA)
├── manifest.webmanifest
├── assets/icon-*.png
└── supabase/schema.sql   Base de datos + seguridad + flota inicial
```

## Preguntas frecuentes

- **¿Tiene algún costo?** No. GitHub Pages y Supabase Free bastan de sobra para una flota de
  5 vehículos durante años. Supabase pausa proyectos gratuitos tras **7 días sin uso**; basta con
  entrar al panel de Supabase y presionar *Restore*. Con uso semanal normal no ocurre.
- **¿Y si un conductor abre `admin.html`?** Lo redirige a su pantalla; además la base de datos
  le niega el acceso a datos ajenos aunque manipule la página.
- **¿Puedo cambiar los tipos de combustible o medios de recarga?** Sí, en `js/config.js`.
- **¿Copia de seguridad?** Exporta CSV desde Tanqueos, o en Supabase: *Database → Backups*.
