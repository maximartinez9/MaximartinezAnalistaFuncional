# FUNTION ANALYTS

Plataforma web para analistas funcionales: requerimientos con puntuación, modelo de datos, flujogramas, pruebas y release, perfiles de usuario e integraciones con Jira, Confluence y Azure DevOps.

- `server.js`: servidor Node.js + Express con login seguro, roles, datos compartidos e integraciones.
- `public/index.html`: la aplicación web. Si no encuentra el servidor, funciona sola en **modo demo**.
- `docs/`: manual de usuario y documentación técnica.

## 1. Probarlo en tu computadora

Necesitás Node.js 18 o superior y una base PostgreSQL (la del paso 3 sirve).

```bash
npm install
cp .env.example .env      # completá los valores
npm start                 # abrí http://localhost:3000
```

Para generar `JWT_SECRET` y `ENC_KEY` (uno para cada variable):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## 2. Subirlo a tu repositorio de GitHub

Desde la carpeta del proyecto:

```bash
git init
git add .
git commit -m "FUNTION ANALYTS: primera versión"
git branch -M main
git remote add origin https://github.com/maximartinez9/MaximartinezAnalistaFuncional.git
git push -u origin main
```

Si el repositorio ya tiene archivos (por ejemplo un README), usá antes `git pull origin main --allow-unrelated-histories`.

**Nunca subas el archivo `.env`.** Ya está en `.gitignore`. Si alguna vez subís una clave por error, cambiala de inmediato.

## 3. Publicarlo gratis con servidor (para mostrarlo a tus compañeros)

Los planes gratuitos cambian con el tiempo; verificá las condiciones vigentes en cada sitio.

### 3.1 Base de datos: Neon (PostgreSQL)
1. Creá una cuenta en neon.tech y un proyecto nuevo.
2. Copiá la cadena de conexión (*connection string*). Será tu `DATABASE_URL`.

### 3.2 Servidor: Render
1. Creá una cuenta en render.com y elegí **New → Web Service**.
2. Conectá tu repositorio de GitHub.
3. Configurá:
   - Runtime: Node
   - Build command: `npm install`
   - Start command: `npm start`
   - Plan: Free
4. En **Environment** cargá:

| Variable | Valor |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | la cadena de Neon |
| `JWT_SECRET` | 64 caracteres generados |
| `ENC_KEY` | 64 caracteres hexadecimales generados |
| `ADMIN_EMAIL` | tu correo |
| `ADMIN_PASSWORD` | una clave de 10 o más caracteres |
| `ALLOW_REGISTER` | `true` mientras probás con tus compañeros |

5. Pulsá **Deploy**. Render te da una URL `https://…onrender.com`: esa es tu plataforma.

Notas del plan gratuito:
- El servicio se "duerme" tras un rato sin uso y la primera visita tarda alrededor de un minuto en responder. Abrilo unos minutos antes de mostrarlo.
- Los datos viven en Neon, así que no se pierden cuando el servidor se reinicia.

### 3.3 Primer uso
1. Entrá con `ADMIN_EMAIL` y `ADMIN_PASSWORD`.
2. Tus compañeros usan **Crear cuenta de prueba** (perfil Test, 5 tokens).
3. En **Equipo y soporte** cambiás el perfil de cada usuario (Desarrollador, Soporte, Cliente…).
4. Cuando termine la demostración, poné `ALLOW_REGISTER=false` para cerrar el registro.

### Alternativa solo visual: GitHub Pages
En el repositorio: **Settings → Pages → Deploy from a branch → main / carpeta `public`** (si no aparece la carpeta, mové `index.html` a la raíz o a `/docs`). Publica solo la parte visual en modo demo, sin login real ni datos compartidos.

## 4. Conectar Jira, Confluence y Azure DevOps

Entrá con perfil Administrador o Cliente y abrí **Integraciones**.

- **Jira y Confluence (Atlassian Cloud):** ingresá el sitio (`empresa.atlassian.net`), tu correo y un *API token* creado en id.atlassian.com → Seguridad → Tokens de API. Después podés importar historias con una consulta JQL y publicar el requerimiento actual en un espacio de Confluence.
- **Azure DevOps:** ingresá organización, proyecto y un *Personal Access Token* con permiso de lectura de Work Items.

Las credenciales se guardan cifradas (AES-256-GCM) y nunca se envían de vuelta al navegador. Para una versión comercial se recomienda reemplazarlas por OAuth 2.0 (ver `docs`).

## 5. Seguridad incluida

- Contraseñas con bcrypt (costo 12), mínimo 10 caracteres.
- Bloqueo de 15 minutos tras 5 intentos fallidos, límite de intentos por IP y mensajes de error genéricos.
- Sesión en cookie `HttpOnly`, `Secure` y `SameSite=Strict` (dura 2 horas); el rol se lee de la base en cada pedido.
- Permisos por perfil validados en el servidor, no solo en pantalla.
- Cabeceras de seguridad con Helmet y política CSP; defensa CSRF con cabecera obligatoria.
- Consultas parametrizadas y escape de salida en el frontend.
- Registro de auditoría de altas, ingresos, cambios de perfil y conexiones.

## 6. Diferencias con la documentación técnica original

La documentación de `docs/` describe la arquitectura objetivo. Esta versión la simplifica para poder correr gratis:

- bcrypt en lugar de Argon2id, para evitar compilación nativa en el hosting.
- Una cookie de sesión de 2 horas en lugar de access + refresh token.
- Un único espacio de trabajo compartido (sin organizaciones ni proyectos), con control de versiones optimista: si dos personas guardan a la vez, la segunda recibe un aviso y se carga la última versión.
- CSP con `unsafe-inline` porque el frontend es un archivo único. Al migrar a React se puede endurecer.
- Faltan MFA, recuperación de contraseña por correo y OAuth; están en la hoja de ruta.
