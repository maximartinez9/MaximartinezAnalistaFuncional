# FUNTION ANALYTS — Documentación técnica y arquitectura propuesta

## 1. Estado actual (prototipo)

- **Archivo único:** `funtion-analyts.html` (HTML + CSS + JavaScript sin frameworks).
- **Lenguaje:** JavaScript (ES2020), sin dependencias ni compilación.
- **Fuentes:** Google Fonts (Bricolage Grotesque y Source Sans 3), con fallback a `system-ui`.
- **Estado:** objeto global `S` en memoria. Se guarda en `localStorage` (clave `funtion_analyts_v1`) cada 1,5 s y al cerrar la pestaña.
- **Render:** funciones que escriben HTML con template strings. Toda entrada de usuario pasa por `e()` para escapar HTML (previene XSS).
- **Temas:** variables CSS con modo claro y oscuro automático.
- **Limitaciones:** el login, los permisos y las integraciones son simulados; no hay datos compartidos entre usuarios.

### Mapa del código

| Elemento | Función |
|---|---|
| `ROLES`, `NAV` | Perfiles, permisos y menú. |
| `S` | Estado: requerimientos, tablas, checklist, tokens. |
| `analyze(r)` | Motor de puntuación y sugerencias (reglas en la sección 3). |
| `V.dash/req/bd/flow/qa/int/team` | Una vista por módulo. |
| `tok()` | Consumo de tokens del perfil Test. |
| `ddl()` | Genera SQL de tablas y columnas nuevas. |
| `flow()` | Dibuja el flujograma en SVG. |
| `save()` y carga inicial | Persistencia en el navegador. |

## 2. Cómo guardar los datos

**Nivel 1 — Navegador (ya implementado).** Los datos sobreviven a recargas, pero son privados de ese navegador. Se pierden si se borran los datos del sitio y no se comparten con el equipo. Sirve para prueba y perfil Test.

**Nivel 2 — Base de datos con servidor (necesario para el producto real).** Pasos:

1. Crear la API (sección 4) con PostgreSQL.
2. Reemplazar `save()` por llamadas `fetch('/api/requirements', {method:'PUT', credentials:'include', ...})` al cambiar un dato (con *debounce* de 800 ms).
3. Al iniciar sesión, cargar el estado con `GET /api/workspace` en lugar de `localStorage`.
4. Para trabajo simultáneo del equipo, usar control de versiones optimista (columna `version`; si difiere, avisar del conflicto) y, más adelante, WebSockets.

## 3. Reglas de puntuación (`analyze`)

- Objetivo: 100 si tiene 40 caracteres o más; 50 si tiene texto.
- Alcance: 50 por tener texto y 50 más por incluir "fuera de alcance".
- Casos de uso: 34 puntos por caso, máximo 100.
- Criterios: porcentaje que cumple Dado / Cuando / Entonces.
- Parámetros: 100 con 20 caracteres o más; 50 con texto.
- Penalización: 8 puntos por palabra ambigua, máximo 30.
- Total = promedio de las cinco secciones menos la penalización.

En producción, estas reglas deben ser configurables por el Administrador y se pueden complementar con IA.

## 4. Arquitectura propuesta (versión de producción)

### Stack recomendado
| Capa | Tecnología |
|---|---|
| Frontend | React + TypeScript + Vite; Tailwind CSS; TanStack Query; Zod |
| Backend | Node.js + NestJS (TypeScript) |
| Base de datos | PostgreSQL con migraciones (Prisma) |
| Caché y colas | Redis (sesiones, límites de uso, tareas de sincronización) |
| Archivos | Almacenamiento de objetos S3 o Azure Blob |
| Infra | Docker, HTTPS con proxy inverso, CI/CD, entornos dev / test / prod |
| Observabilidad | Logs estructurados, métricas y alertas |

Alternativas válidas: .NET 8 si el equipo trabaja en ecosistema Azure, o Django.

### Módulos del backend
`auth`, `users`, `workspaces`, `requirements`, `datamodel`, `flows`, `testing-release`, `comments`, `billing-tokens`, `integrations`, `audit`, `ai`.

### Modelo de datos base (PostgreSQL)

```sql
CREATE TABLE organizations (id UUID PRIMARY KEY, name TEXT NOT NULL, plan TEXT NOT NULL DEFAULT 'test');
CREATE TABLE users (
  id UUID PRIMARY KEY, org_id UUID REFERENCES organizations(id),
  email CITEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','soporte','dev','test','cliente')),
  mfa_secret TEXT, tokens_left INT DEFAULT 5, failed_logins INT DEFAULT 0,
  locked_until TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE projects (id UUID PRIMARY KEY, org_id UUID REFERENCES organizations(id), name TEXT NOT NULL);
CREATE TABLE requirements (
  id UUID PRIMARY KEY, project_id UUID REFERENCES projects(id), title TEXT NOT NULL,
  objective TEXT, scope TEXT, use_cases TEXT, acceptance TEXT, parameters TEXT,
  score INT, assigned_to TEXT, version INT DEFAULT 1, updated_by UUID, updated_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE comments (id UUID PRIMARY KEY, requirement_id UUID REFERENCES requirements(id),
  author_id UUID REFERENCES users(id), section TEXT, body TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE data_tables (id UUID PRIMARY KEY, project_id UUID REFERENCES projects(id), name TEXT NOT NULL);
CREATE TABLE data_columns (id UUID PRIMARY KEY, table_id UUID REFERENCES data_tables(id),
  name TEXT, type TEXT, nullable BOOL, note TEXT, is_new BOOL DEFAULT true);
CREATE TABLE release_items (id UUID PRIMARY KEY, project_id UUID REFERENCES projects(id),
  stage TEXT, item TEXT, done BOOL DEFAULT false, done_by UUID, done_at TIMESTAMPTZ);
CREATE TABLE integrations (id UUID PRIMARY KEY, org_id UUID REFERENCES organizations(id),
  provider TEXT, encrypted_token BYTEA, status TEXT);
CREATE TABLE audit_log (id BIGSERIAL PRIMARY KEY, user_id UUID, action TEXT, entity TEXT, entity_id UUID, ip INET, at TIMESTAMPTZ DEFAULT now());
```

### API REST (resumen)
| Método y ruta | Descripción | Perfiles |
|---|---|---|
| `POST /auth/login`, `/auth/refresh`, `/auth/logout` | Sesión | Todos |
| `GET/POST/PUT /requirements` | Requerimientos | Editan: admin, cliente, test |
| `POST /requirements/:id/analyze` | Puntúa (descuenta token en test) | admin, cliente, test |
| `POST /requirements/:id/comments` | Comentar | Todos |
| `PUT /requirements/:id/assign` | Asignar a PO o desarrollo | admin, cliente |
| `GET/POST /datamodel/tables` | Modelo de datos | admin, cliente, test; lectura dev |
| `GET/PUT /release/items` | Checklist de pruebas y release | Todos según perfil |
| `GET/POST /integrations/:provider` | Conectar herramientas | admin, cliente |
| `GET/POST /admin/users` | Gestión de usuarios | admin |

## 5. Seguridad

### Autenticación
- Contraseñas con **Argon2id**; nunca se guardan en texto plano.
- Política: mínimo 12 caracteres y verificación contra listas de contraseñas filtradas.
- **MFA con TOTP** obligatorio para Administrador y opcional para el resto.
- Bloqueo temporal tras 5 intentos fallidos y mensajes de error genéricos (no revelar si el correo existe).
- Recuperación de contraseña con token de un solo uso y expiración corta (15 min).
- **Access token** JWT de 15 minutos y **refresh token** rotativo en cookie `HttpOnly; Secure; SameSite=Strict`. Nunca en `localStorage`.
- SSO opcional con Azure AD / OIDC.

### Autorización
- Control de acceso por rol (RBAC) **validado siempre en el servidor**; ocultar botones en el frontend no es seguridad.
- Aislamiento por organización: toda consulta filtra por `org_id`.
- Perfil Test: tokens descontados en el servidor.

### Protección de la plataforma
- HTTPS obligatorio, HSTS y TLS 1.2 o superior.
- Cabeceras: `Content-Security-Policy` estricta, `X-Content-Type-Options`, `Referrer-Policy`, `frame-ancestors 'none'`.
- Protección CSRF (cookies SameSite y token), límites de uso por IP y usuario, validación de entradas con Zod.
- Consultas parametrizadas (sin concatenar SQL) y escape de salida para evitar XSS.
- Tokens de integraciones cifrados con AES-256-GCM; claves en un gestor de secretos, nunca en el repositorio.
- Cifrado de disco y copias de seguridad cifradas con restauración probada.
- Auditoría de acciones sensibles (login, cambios de rol, exportaciones) en `audit_log`.
- Escaneo de dependencias, revisión OWASP Top 10 y pruebas de penetración antes de salir a producción.
- Cumplimiento de protección de datos personales (Ley 25.326 en Argentina) y política de retención.

## 6. Integraciones

| Herramienta | Enfoque |
|---|---|
| Jira / Confluence | OAuth 2.0 (3LO) de Atlassian; API REST para importar historias y publicar páginas. |
| Azure DevOps | OAuth de Microsoft Entra ID; API de Work Items y Boards. |
| IA | Servicio propio `ai` que llama a la API de Anthropic u otro proveedor desde el servidor, nunca desde el navegador, para no exponer claves. |
| Notion / Trello | OAuth y APIs REST. |

Patrón: un adaptador por proveedor con la misma interfaz (`connect`, `importItems`, `publish`) y sincronización mediante colas con reintentos.

## 7. Hoja de ruta sugerida

1. **Fase 1:** backend con autenticación, RBAC, requerimientos y comentarios.
2. **Fase 2:** modelo de datos, flujogramas guardados y checklist de release.
3. **Fase 3:** tokens y facturación (Test a Cliente), panel del líder / PO.
4. **Fase 4:** integraciones Jira, Confluence y Azure; IA para sugerencias.
5. **Fase 5:** auditoría de seguridad y salida a producción.

## 8. Código completo del prototipo actual

Archivo `funtion-analyts.html`, completo:

```html
<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><title>FUNTION ANALYTS</title>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@500;700&family=Source+Sans+3:wght@400;600&display=swap" rel="stylesheet">
<style>
:root{box-sizing:border-box;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px);--bg:#f3f5f2;--sf:#fff;--tx:#1b2521;--mu:#66736d;--ln:#d5dcd7;--ac:#0d6b5c;--ac2:#e0f0ec;--wa:#b4570b;--er:#b3261e;--ok:#18794e}
@media(prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#121816;--sf:#1a2320;--tx:#e6ede9;--mu:#93a39b;--ln:#2c3833;--ac:#4cc3ac;--ac2:#1d3a34;--wa:#e8a15a;--er:#f2867f;--ok:#5fd398}}
:root[data-theme="dark"]{--bg:#121816;--sf:#1a2320;--tx:#e6ede9;--mu:#93a39b;--ln:#2c3833;--ac:#4cc3ac;--ac2:#1d3a34;--wa:#e8a15a;--er:#f2867f;--ok:#5fd398}
html{scroll-padding-top:env(safe-area-inset-top,0px)}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--tx);font:16px/1.5 'Source Sans 3',system-ui,sans-serif}
h1,h2,h3{font-family:'Bricolage Grotesque',system-ui,sans-serif;margin:0 0 .5rem;line-height:1.15}
button,input,select,textarea{font:inherit;color:inherit}
.btn{background:var(--ac);color:var(--bg);border:0;border-radius:6px;padding:.5rem .9rem;cursor:pointer;font-weight:600}
.btn.g{background:transparent;color:var(--ac);border:1px solid var(--ln)}
.btn:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible,.nv:focus-visible{outline:2px solid var(--ac);outline-offset:2px}
input,select,textarea{width:100%;background:var(--sf);border:1px solid var(--ln);border-radius:6px;padding:.5rem;margin:.2rem 0 .7rem}
textarea{min-height:84px;resize:vertical}label{font-weight:600;font-size:.9rem}
.login{max-width:520px;margin:6vh auto;padding:1.2rem}
.logo{font:700 2rem 'Bricolage Grotesque';letter-spacing:-.02em}.logo i{color:var(--ac);font-style:normal}
.roles{display:grid;gap:.5rem;margin:1rem 0}.roles button{text-align:left;background:var(--sf);border:1px solid var(--ln);border-radius:8px;padding:.7rem;cursor:pointer}
.roles button:hover{border-color:var(--ac)}.roles b{display:block}.roles span{color:var(--mu);font-size:.88rem}
.app{display:grid;grid-template-columns:210px 1fr;min-height:100vh}
aside{background:var(--sf);border-right:1px solid var(--ln);padding:1rem .7rem;display:flex;flex-direction:column;gap:.15rem}
.nv{background:none;border:0;text-align:left;padding:.5rem .6rem;border-radius:6px;cursor:pointer}.nv.on{background:var(--ac2);color:var(--ac);font-weight:600}
main{padding:1.2rem;min-width:0;max-width:980px}
.top{display:flex;justify-content:space-between;align-items:center;gap:.5rem;flex-wrap:wrap;margin-bottom:1rem}
.pill{background:var(--ac2);color:var(--ac);border-radius:99px;padding:.15rem .6rem;font-size:.82rem;font-weight:600}
.card{background:var(--sf);border:1px solid var(--ln);border-radius:8px;padding:1rem;margin-bottom:.9rem}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:.8rem}
.bar{height:8px;background:var(--ln);border-radius:9px;overflow:hidden}.bar div{height:100%;background:var(--ac)}
.big{font:700 2.4rem 'Bricolage Grotesque'}.mu{color:var(--mu);font-size:.9rem}
.ok{color:var(--ok)}.wa{color:var(--wa)}.er{color:var(--er)}
.sc{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:.92rem}td,th{border-bottom:1px solid var(--ln);padding:.35rem .5rem;text-align:left}
pre{background:var(--bg);border:1px solid var(--ln);padding:.7rem;border-radius:6px;overflow-x:auto;font-size:.85rem}
.chk{display:flex;gap:.5rem;align-items:flex-start;margin:.25rem 0}.chk input{width:auto;margin:.3rem 0 0}
.row{display:flex;gap:.5rem;flex-wrap:wrap}.row>*{flex:1;min-width:110px}
@media(max-width:720px){.app{grid-template-columns:1fr}aside{flex-direction:row;overflow-x:auto;border-right:0;border-bottom:1px solid var(--ln)}.nv{white-space:nowrap}}
</style></head><body><div id="root"></div>
<script>
const ROLES={
admin:{n:'Administrador',d:'Acceso total, usuarios y configuración',nav:['dash','req','bd','flow','qa','int','team'],edit:1},
soporte:{n:'Soporte',d:'Resuelve bugs/fixes y asiste a analistas',nav:['dash','req','qa','team'],edit:0},
dev:{n:'Desarrollador',d:'Ve cambios, deja avances y comenta dudas',nav:['dash','req','bd','qa'],edit:0},
test:{n:'Test (prueba gratuita)',d:'Funciones limitadas por tokens',nav:['dash','req','bd','flow','qa'],edit:1},
cliente:{n:'Cliente (pago)',d:'Todo desbloqueado, asigna a PO y equipo',nav:['dash','req','bd','flow','qa','int','team'],edit:1}};
const NAV={dash:'Panel',req:'Requerimientos',bd:'Modelo de datos',flow:'Flujogramas',qa:'Pruebas y release',int:'Integraciones',team:'Equipo y soporte'};
const S={role:null,view:'dash',cur:0,tokens:5,
reqs:[{t:'Recuperar contraseña',obj:'Permitir al usuario recuperar su acceso.',alc:'Envío de mail con enlace temporal.',cu:'CU1 Solicitar recuperación\nCU2 Restablecer contraseña',ca:'Dado un usuario registrado, cuando solicita recuperación, entonces recibe un mail\nEl proceso debe ser rápido y fácil',par:'',asig:'Sin asignar',com:[{w:'Desarrollador',x:'¿Cuánto dura el enlace temporal?'}],ok:0}],
tables:[{n:'usuarios',c:[['id','INT','No','PK'],['email','VARCHAR(120)','No','Único'],['activo','BIT','No','']]}],
qa:{'Pruebas técnicas':['Casos de prueba derivados de criterios','Cobertura de casos de uso ≥ 90%','Pruebas de datos límite','Evidencia adjunta'],'Pruebas UAT':['Usuarios clave definidos','Guion UAT aprobado','Defectos críticos cerrados','Firma del Product Owner'],'Prueba piloto':['Grupo piloto definido','Métricas de éxito acordadas','Plan de marcha atrás','Feedback consolidado'],'Deploy':['Ventana de despliegue comunicada','Checklist de release','Backup previo','Aprobación del líder'],'Verificación QA':['Smoke test en producción','Regresión sobre módulos afectados','Monitoreo 24 h','Cierre y lecciones aprendidas']},
qd:{},ints:{}};
const INT=[['Jira','Sincronizar historias y épicas del backlog'],['Confluence','Publicar la documentación funcional'],['Azure DevOps','Work items, boards y pipelines'],['IA (Claude, OpenAI)','Sugerencias y redacción asistida'],['Azure AD / SSO','Login corporativo'],['Notion / Trello','Backlog y documentación']];
const e=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const $=id=>document.getElementById(id);
function lines(s){return s.split('\n').map(x=>x.trim()).filter(Boolean)}
function analyze(r){
 const amb=(`${r.obj} ${r.alc} ${r.ca}`.match(/\b(rápido|fácil|adecuado|flexible|amigable|etc|óptimo|cuando sea posible)\b/gi)||[]);
 const cu=lines(r.cu),ca=lines(r.ca),gwt=ca.filter(x=>/dado.*cuando.*entonces/i.test(x));
 const sec={'Objetivo':r.obj.length>=40?100:r.obj?50:0,'Alcance':(r.alc?50:0)+(/fuera de alcance/i.test(r.alc)?50:0),'Casos de uso':Math.min(100,cu.length*34),'Criterios de aceptación':ca.length?Math.round(100*gwt.length/ca.length):0,'Parámetros':r.par.length>=20?100:r.par?50:0};
 const tips=[];
 if(sec.Objetivo<100)tips.push('Objetivo: explicá qué problema resuelve y para quién (mín. 40 caracteres).');
 if(sec.Alcance<100)tips.push('Alcance: agregá una línea "Fuera de alcance" para evitar sobrealcance.');
 if(sec['Casos de uso']<100)tips.push(`Casos de uso: hay ${cu.length}; sumá flujos alternativos y de error (mín. 3).`);
 if(sec['Criterios de aceptación']<100)tips.push(`Criterios: ${ca.length-gwt.length} no siguen el formato Dado / Cuando / Entonces o no son verificables.`);
 if(sec.Parámetros<100)tips.push('Parámetros: definí reglas, límites, tiempos de vida y valores configurables.');
 if(amb.length)tips.push('Ambigüedad detectada: '+[...new Set(amb.map(x=>x.toLowerCase()))].join(', ')+'. Reemplazá por valores medibles.');
 const avg=Object.values(sec).reduce((a,b)=>a+b,0)/5,score=Math.max(0,Math.round(avg-Math.min(30,amb.length*8)));
 return{sec,tips,score}}
const col=n=>n>=80?'ok':n>=50?'wa':'er';
function login(){$('root').innerHTML=`<div class="login"><div class="logo">FUNTION <i>ANALYTS</i></div><p>Del pedido del Product Owner al release, con el análisis funcional bajo control.</p>
<label>Correo</label><input value="analista@empresa.com" aria-label="Correo"><label>Contraseña</label><input type="password" value="••••••••">
<p class="mu">Demo: elegí un perfil para entrar. En producción el acceso se valida en servidor (ver documentación técnica).</p>
<div class="roles">${Object.entries(ROLES).map(([k,v])=>`<button onclick="enter('${k}')"><b>${v.n}</b><span>${v.d}</span></button>`).join('')}</div></div>`}
function enter(r){S.role=r;S.view='dash';draw()}
function tok(){if(S.role!=='test')return true;if(S.tokens<=0){alert('Sin tokens. Pasá al perfil Cliente para desbloquear todo.');return false}S.tokens--;return true}
function draw(){const R=ROLES[S.role];
$('root').innerHTML=`<div class="app"><aside><div class="logo" style="font-size:1.15rem;padding:.3rem .6rem">FUNTION <i>ANALYTS</i></div>${R.nav.map(k=>`<button class="nv ${S.view===k?'on':''}" onclick="S.view='${k}';draw()">${NAV[k]}</button>`).join('')}<button class="nv" onclick="S.role=null;login()">Cerrar sesión</button></aside><main><div class="top"><h1>${NAV[S.view]}</h1><span><span class="pill">${R.n}</span> ${S.role==='test'?`<span class="pill">${S.tokens} tokens</span> <button class="btn g" onclick="S.role='cliente';draw()">Pasar a Cliente</button>`:''}</span></div><div id="v"></div></main></div>`;
V[S.view]()}
const V={
dash(){const r=S.reqs.map(analyze),avg=Math.round(r.reduce((a,b)=>a+b.score,0)/r.length),all=Object.values(S.qa).flat().length,dn=Object.keys(S.qd).filter(k=>S.qd[k]).length,pc=Math.round(100*dn/all);
$('v').innerHTML=`<div class="grid"><div class="card"><div class="mu">Calidad de requerimientos</div><div class="big ${col(avg)}">${avg}</div><div class="bar"><div style="width:${avg}%"></div></div></div><div class="card"><div class="mu">Avance de pruebas y release</div><div class="big">${pc}%</div><div class="bar"><div style="width:${pc}%"></div></div></div><div class="card"><div class="mu">Comentarios abiertos</div><div class="big">${S.reqs.reduce((a,x)=>a+x.com.length,0)}</div></div></div>
<div class="card"><h3>Qué falta y qué mejorar</h3>${S.reqs.map((q,i)=>`<p><b>${e(q.t)}</b> <span class="pill">${r[i].score}/100</span></p><ul>${r[i].tips.map(t=>`<li>${e(t)}</li>`).join('')||'<li>Sin observaciones</li>'}</ul>`).join('')}<p class="mu">Esta visibilidad la ven analistas, desarrollo, líder y Product Owner.</p></div>`},
req(){const q=S.reqs[S.cur],ed=ROLES[S.role].edit,d=ed?'':'readonly';
const f=(k,l,h)=>`<label>${l}</label><textarea ${d} oninput="S.reqs[S.cur].${k}=this.value" placeholder="${h||''}">${e(q[k])}</textarea>`;
$('v').innerHTML=`<div class="row" style="margin-bottom:.8rem"><select aria-label="Requerimiento" onchange="S.cur=+this.value;V.req()">${S.reqs.map((x,i)=>`<option value="${i}" ${i==S.cur?'selected':''}>${e(x.t)}</option>`).join('')}</select>${ed?'<button class="btn g" onclick="newReq()">Nuevo desde cero</button>':''}</div>
<div class="card"><label>Título</label><input ${d} value="${e(q.t)}" oninput="S.reqs[S.cur].t=this.value">${f('obj','Objetivo','¿Qué necesita el cliente y por qué?')}${f('alc','Alcance (incluí "Fuera de alcance")')}${f('cu','Casos de uso (uno por línea)')}${f('ca','Criterios de aceptación (Dado / Cuando / Entonces)')}${f('par','Parámetros a tener en cuenta')}
<div class="row"><button class="btn" onclick="run()">Analizar y puntuar</button><label style="align-self:center">Asignar a<select onchange="S.reqs[S.cur].asig=this.value">${['Sin asignar','Product Owner','Equipo de desarrollo','PO + Desarrollo'].map(o=>`<option ${q.asig===o?'selected':''}>${o}</option>`).join('')}</select></label></div></div><div id="an"></div>
<div class="card"><h3>Comentarios</h3>${q.com.map(c=>`<p><b>${e(c.w)}:</b> ${e(c.x)}</p>`).join('')||'<p class="mu">Sin comentarios todavía.</p>'}<input id="cm" placeholder="Duda, mejora o avance sobre este requerimiento"><button class="btn" onclick="addC()">Comentar</button></div>`},
bd(){const ed=ROLES[S.role].edit;$('v').innerHTML=`${S.tables.map((t,i)=>`<div class="card"><h3>${e(t.n)}</h3><div class="sc"><table><tr><th>Columna</th><th>Tipo</th><th>Nulo</th><th>Nota</th></tr>${t.c.map(c=>`<tr>${c.map(x=>`<td>${e(x)}</td>`).join('')}</tr>`).join('')}</table></div>${ed?`<div class="row" style="margin-top:.6rem"><input id="cn${i}" placeholder="nueva columna"><input id="ct${i}" placeholder="tipo, ej. VARCHAR(50)"><button class="btn g" onclick="addCol(${i})">Agregar columna</button></div>`:''}</div>`).join('')}
${ed?'<div class="card"><h3>Nueva tabla</h3><div class="row"><input id="tn" placeholder="nombre de tabla"><button class="btn" onclick="addTab()">Crear tabla</button></div></div>':''}
<div class="card"><h3>Script para desarrollo</h3><pre>${e(ddl())}</pre></div>`},
flow(){$('v').innerHTML=`<div class="card"><label>Pasos del proceso (uno por línea; los que terminan en ? son decisiones)</label><textarea id="fl" style="min-height:130px">Usuario solicita recuperación\n¿Email registrado?\nEnviar enlace temporal\nUsuario define nueva clave\nFin</textarea><button class="btn" onclick="flow()">Generar flujograma</button></div><div class="card sc" id="fo"><p class="mu">Generá el flujograma para verlo acá.</p></div>`;flow(1)},
qa(){$('v').innerHTML=Object.entries(S.qa).map(([s,it])=>{const n=it.filter(x=>S.qd[s+x]).length;return`<div class="card"><h3>${s} <span class="pill">${n}/${it.length}</span></h3><div class="bar"><div style="width:${100*n/it.length}%"></div></div>${it.map(x=>`<label class="chk"><input type="checkbox" ${S.qd[s+x]?'checked':''} onchange="S.qd['${s}${x}']=this.checked;V.qa()"><span style="font-weight:400">${x}</span></label>`).join('')}${n<it.length?`<p class="wa mu">Falta: ${it.filter(x=>!S.qd[s+x]).map(e).join('; ')}</p>`:'<p class="ok">Etapa completa</p>'}</div>`}).join('')},
int(){$('v').innerHTML=`<div class="grid">${INT.map(([n,d])=>`<div class="card"><h3>${n}</h3><p class="mu">${d}</p><button class="btn ${S.ints[n]?'':'g'}" onclick="S.ints[n]=!S.ints[n];V.int()">${S.ints[n]?'Conectado (demo)':'Conectar'}</button></div>`).join('')}</div><p class="mu">Demo visual: la conexión real usa OAuth 2.0 desde el servidor.</p>`},
team(){const ad=S.role==='admin';$('v').innerHTML=`<div class="card"><h3>${ad?'Usuarios y perfiles':'Soporte'}</h3>${ad?'<p>Administrador: alta, baja y cambio de perfil (Soporte, Desarrollador, Test, Cliente).</p>':''}<p>Soporte resuelve bugs y fixes, y ayuda a los analistas dentro de la plataforma. Los tickets se asignan al equipo y quedan visibles para el líder.</p><div class="row"><input placeholder="Describí el problema o duda"><button class="btn">Crear ticket</button></div></div>`}};
function run(){if(!tok())return draw();const a=analyze(S.reqs[S.cur]);if(S.role==='test'){const t=document.querySelector('.pill+.pill');if(t)t.textContent=S.tokens+' tokens'}
$('an').innerHTML=`<div class="card"><h3>Puntaje: <span class="${col(a.score)}">${a.score}/100</span></h3>${Object.entries(a.sec).map(([k,v])=>`<div class="mu">${k} · ${v}</div><div class="bar" style="margin-bottom:.5rem"><div style="width:${v}%"></div></div>`).join('')}<h3 style="margin-top:.8rem">Sugerencias</h3><ul>${a.tips.map(t=>`<li>${e(t)}</li>`).join('')||'<li>Excelente: listo para revisión del PO.</li>'}</ul></div>`}
function newReq(){S.reqs.push({t:'Nuevo requerimiento',obj:'',alc:'',cu:'',ca:'',par:'',asig:'Sin asignar',com:[],ok:0});S.cur=S.reqs.length-1;V.req()}
function addC(){const v=$('cm').value.trim();if(!v)return;S.reqs[S.cur].com.push({w:ROLES[S.role].n,x:v});V.req()}
function addCol(i){const n=$('cn'+i).value.trim(),t=$('ct'+i).value.trim();if(!n||!/^[\w]+$/.test(n))return alert('Usá un nombre sin espacios.');S.tables[i].c.push([n,t||'VARCHAR(50)','Sí','Nueva']);S.tables[i].nuevas=(S.tables[i].nuevas||[]).concat([[n,t||'VARCHAR(50)']]);V.bd()}
function addTab(){const n=$('tn').value.trim();if(!/^[\w]+$/.test(n))return alert('Usá un nombre sin espacios.');S.tables.push({n,c:[['id','INT','No','PK']],nueva:1});V.bd()}
function ddl(){return S.tables.map(t=>(t.nueva?`CREATE TABLE ${t.n} (\n  id INT PRIMARY KEY\n);\n`:'')+(t.nuevas||[]).map(c=>`ALTER TABLE ${t.n} ADD ${c[0]} ${c[1]} NULL;`).join('\n')).filter(x=>x.trim()).join('\n')||'-- Sin cambios pendientes'}
function flow(){const L=lines($('fl').value),h=64;let s=`<svg width="340" height="${L.length*h+10}" role="img" aria-label="Flujograma">`;
L.forEach((x,i)=>{const y=i*h+8,d=x.endsWith('?'),t=e(x.length>34?x.slice(0,33)+'…':x);
s+=i?`<line x1="170" y1="${y-14}" x2="170" y2="${y}" stroke="var(--mu)"/>`:'';
s+=d?`<polygon points="170,${y} 320,${y+22} 170,${y+44} 20,${y+22}" fill="var(--ac2)" stroke="var(--ac)"/>`:`<rect x="20" y="${y}" width="300" height="44" rx="${i==0||i==L.length-1?22:6}" fill="var(--sf)" stroke="var(--ac)"/>`;
s+=`<text x="170" y="${y+26}" text-anchor="middle" font-size="13" fill="var(--tx)">${t}</text>`});
$('fo').innerHTML=s+'</svg>'}
/* Persistencia local (por navegador). Para datos compartidos del equipo se necesita backend: ver documentación técnica. */
const KEY='funtion_analyts_v1';
function save(){try{localStorage.setItem(KEY,JSON.stringify({reqs:S.reqs,tables:S.tables,qd:S.qd,ints:S.ints,tokens:S.tokens,cur:S.cur}))}catch(_){}}
try{const d=JSON.parse(localStorage.getItem(KEY)||'null');if(d)Object.assign(S,d)}catch(_){}
setInterval(save,1500);addEventListener('pagehide',save);
login();
</script></body></html>

```
