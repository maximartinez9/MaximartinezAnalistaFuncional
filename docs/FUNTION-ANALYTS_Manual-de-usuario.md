# FUNTION ANALYTS — Manual de usuario

Plataforma para analistas funcionales y analistas de sistemas: desde el pedido del Product Owner hasta el release verificado por QA.

## 1. Primeros pasos

1. Ingresá con tu correo y contraseña. (En la versión demo elegís un perfil directamente.)
2. El menú de la izquierda muestra solo los módulos que tu perfil puede usar.
3. Tus datos se guardan automáticamente en tu navegador. Para compartir con el equipo se necesita la versión con servidor (ver documentación técnica).

## 2. Perfiles

| Perfil | Qué puede hacer |
|---|---|
| Administrador | Todo: usuarios, perfiles, integraciones y todos los módulos. |
| Soporte | Resolver bugs y fixes, ver requerimientos y pruebas, y asistir a analistas dentro de la plataforma. |
| Desarrollador | Ver cambios, dejar avances y comentar dudas o mejoras sobre cada parte del requerimiento. No edita el análisis. |
| Test | Probar la plataforma con tokens limitados. Cada análisis y puntuación consume 1 token. Al agotarse, puede pasar a Cliente. |
| Cliente | Perfil de pago con todas las funciones, soporte y asignación de requerimientos al Product Owner y al equipo de desarrollo. |

## 3. Panel

Muestra tres indicadores visibles para analistas, desarrollo, líder y Product Owner:

- **Calidad de requerimientos** (0 a 100): promedio de puntajes.
- **Avance de pruebas y release**: porcentaje de ítems completados.
- **Comentarios abiertos**.

Debajo, la lista de **qué falta y qué mejorar** por requerimiento.

## 4. Requerimientos

### Crear uno desde cero
1. Pulsá **Nuevo desde cero**.
2. Completá a partir de lo que pidió el Product Owner:
   - **Objetivo:** qué necesita el cliente y por qué (mínimo 40 caracteres).
   - **Alcance:** qué incluye. Agregá una línea que empiece con "Fuera de alcance".
   - **Casos de uso:** uno por línea. Incluí flujo principal, alternativos y de error (mínimo 3).
   - **Criterios de aceptación:** uno por línea, con formato *Dado… cuando… entonces…*.
   - **Parámetros:** reglas, límites, tiempos, valores configurables.
3. Pulsá **Analizar y puntuar**.

### Mejorar uno existente
Abrilo desde el selector, corregí según las sugerencias y volvé a analizar hasta llegar a un puntaje alto.

### Cómo se puntúa
| Sección | Puntaje completo cuando… |
|---|---|
| Objetivo | Tiene 40 caracteres o más. |
| Alcance | Está definido e incluye "Fuera de alcance". |
| Casos de uso | Hay 3 o más. |
| Criterios de aceptación | Todos siguen el formato Dado / Cuando / Entonces. |
| Parámetros | Están definidos con detalle. |

Se descuentan puntos por palabras ambiguas (rápido, fácil, adecuado, flexible, amigable, etc., óptimo). Reemplazalas por valores medibles: "responde en menos de 2 segundos".

**Semáforo:** 80 o más = verde; 50 a 79 = ámbar; menos de 50 = rojo.

### Asignar y comentar
- **Asignar a:** Product Owner, Equipo de desarrollo o ambos.
- **Comentarios:** cualquier perfil deja dudas, mejoras o avances.

## 5. Modelo de datos

- **Agregar columna:** escribí nombre (sin espacios) y tipo, y pulsá *Agregar columna*.
- **Nueva tabla:** escribí el nombre y pulsá *Crear tabla*.
- El recuadro **Script para desarrollo** genera los `CREATE TABLE` y `ALTER TABLE` para entregar al equipo.

## 6. Flujogramas

Escribí los pasos del proceso, uno por línea. Los que terminan en `?` se dibujan como decisiones (rombo). Pulsá **Generar flujograma**.

## 7. Pruebas y release

Cinco etapas, cada una con su checklist, barra de avance y aviso de lo que falta:

1. Pruebas técnicas
2. Pruebas UAT
3. Prueba piloto
4. Deploy
5. Verificación QA

Tildá cada ítem al completarlo. No pases a la siguiente etapa con ítems críticos pendientes.

## 8. Integraciones (Administrador y Cliente)

Jira, Confluence, Azure DevOps, IA, SSO de Azure AD y Notion/Trello. En la demo el botón es visual; en la versión con servidor abre el flujo de autorización de cada herramienta.

## 9. Equipo y soporte

Creá tickets para bugs, fixes o dudas de uso. Soporte los recibe y los deja visibles para el líder.

## 10. Buenas prácticas

- Un requerimiento debe poder probarse: si no podés escribir su criterio, todavía no está claro.
- Definí siempre lo que queda fuera del alcance.
- Reemplazá adjetivos por números.
- Revisá el panel antes de cada reunión con el Product Owner.

## 11. Preguntas frecuentes

**¿Se pierden mis datos al recargar?** No; se guardan en tu navegador. Si borrás los datos del sitio o cambiás de equipo, se pierden. Con la versión con servidor quedan en la nube.

**¿Qué pasa cuando se acaban mis tokens?** Podés seguir viendo tu contenido, pero para analizar necesitás pasar al perfil Cliente.
