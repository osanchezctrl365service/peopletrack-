# PeopleTrack — Documento de Traspaso

> **Última actualización:** Mayo 2026
> **Autor:** Orlan Sanchez (osanchez@ctrl365.com)
> **Propósito:** Permitir retomar el desarrollo de PeopleTrack desde una cuenta nueva de Claude con todo el contexto necesario.

---

## 1. Descripción del proyecto

**PeopleTrack** es una aplicación web full-stack de gestión de Recursos Humanos desarrollada para **CTRL365 / INSTALNET SRL**. Es funcionalmente similar a Teamflect y administra el ciclo completo del empleado para una organización de aproximadamente **349 empleados**.

### Módulos funcionales

| Módulo | Descripción |
|---|---|
| **Dashboard** | Vista general con KPIs y alertas |
| **Usuarios** | Gestión de empleados (alta, baja, edición) |
| **Líderes** | Asignación de líderes y jerarquía |
| **Áreas** | Estructura departamental |
| **Períodos** | Ciclos de evaluación y revisión |
| **Objetivos** | OKRs y metas por empleado/área |
| **Plan Carrera** | Carrera dinámica con milestones, certificaciones, evidencia y badges |
| **Competencias** | Catálogo y evaluación de competencias |
| **Reuniones 1:1** | Agenda y registro de meetings con edición y soft-delete |
| **Feedback 360°** | Evaluaciones multifuente |
| **Onboarding** | Planes de incorporación con milestones, cursos y evidencia |
| **Recruiting** | Pipeline tipo Kanban con notas, archivos, avance y rechazo de candidatos |
| **PIP** | Performance Improvement Plans con detalle y soft-delete |
| **Ayuda** | Artículos de ayuda gestionados desde DB |
| **Alertas** | Notificaciones del sistema |
| **Reportes** | Reportes y pestaña de Cambios (auditoría) |
| **Organigrama** | Visualización jerárquica |

### Usuario administrador
- **Email:** osanchez@ctrl365.com
- **Rol:** Administrador del sistema

---

## 2. Arquitectura

### Stack tecnológico

```
┌─────────────────────────────────────────────────────────┐
│  FRONTEND (Azure Static Web App)                        │
│  - HTML/CSS/JS vanilla                                  │
│  - Branding CTRL365: dark theme, naranja #FF5400        │
│  - Fonts: Sora + Inter                                  │
│  - Auth: Azure AD via /.auth/login/aad                  │
└──────────────────────┬──────────────────────────────────┘
                       │ HTTPS / fetch
                       ▼
┌─────────────────────────────────────────────────────────┐
│  API (Azure Functions, Node.js 20, Flex Consumption)    │
│  - ~70 endpoints REST                                   │
│  - mssql para conexión a Azure SQL                      │
└──────────────────────┬──────────────────────────────────┘
                       │ TDS
                       ▼
┌─────────────────────────────────────────────────────────┐
│  AZURE SQL DATABASE (Elastic Pool)                      │
│  - 24 tablas                                            │
│  - Soft-delete via columna IsDeleted                    │
│  - Usuario aplicativo: peopletrack_app                  │
└─────────────────────────────────────────────────────────┘
```

### URLs de infraestructura

| Componente | URL / Recurso |
|---|---|
| **Frontend** | `https://yellow-water-0d91cc40f.1.azurestaticapps.net` |
| **API** | `https://peopletrack-api-gjbbhhcefjbgc6bd.eastus2-01.azurewebsites.net/api` |
| **DB Server** | `ctrl365serverlogic.database.windows.net` |
| **Database** | `PeopleTrackDB` |
| **Repo GitHub** | `github.com/osanchezctrl365service/peopletrack-` |
| **Auth endpoints** | `/.auth/login/aad`, `/.auth/me` |

### Archivos locales clave

```
C:\Agentes\peopletrack\
├── frontend\
│   └── index.html        ← Toda la UI (single-page)
└── api\
    └── index.js          ← Todas las Azure Functions
```

### Flujo de despliegue

| Componente | Método de deploy |
|---|---|
| **Frontend** | `git push` a `main` → GitHub Actions auto-deploy |
| **API** | Manual desde VS Code → extensión Azure Functions → "Deploy to Function App" |

---

## 3. Esquema de base de datos

### Tablas principales (24 totales a abril 2026)

| Tabla | Columnas clave / notas |
|---|---|
| `Users` | Empleados |
| `Leaders` | Asignaciones de liderazgo |
| `Areas` | Departamentos |
| `Periods` | Ciclos de evaluación |
| `Objectives` | OKRs |
| `CareerPlans` | Plan de carrera dinámico |
| `CareerMilestones` | `FileData`, `BadgeURL`, `CertName` |
| `CertificationCatalog` | 27 certificaciones precargadas |
| `Competencies` | Catálogo de competencias |
| `OneOnOneMeetings` | `IsDeleted`, `UpdatedAt`, `Title` |
| `Feedback360` | Feedback multifuente |
| `OnboardingPlans` | `IsDeleted`, `CreatedAt` |
| `OnboardingMilestones` | Hitos del onboarding |
| `OnboardingCourses` | Cursos del onboarding |
| `Candidates` | Pipeline de recruiting |
| `CandidateInterviews` | `InterviewerName`, `Result`, `Feedback` |
| `CandidateFiles` | Archivos adjuntos de candidatos |
| `PIPs` | `IsDeleted` (soft-delete) |
| `HelpArticles` | `IsActive` |
| `Alerts` | Notificaciones |
| `Changes` | Log de auditoría |
| `Reports` | Reportes guardados |

### Permisos críticos

El usuario aplicativo `peopletrack_app` tiene **GRANT DELETE** sobre 9 tablas (necesario para soft-delete y limpieza administrativa). Cualquier nueva tabla con borrado debe agregarse al mismo grant.

---

## 4. Decisiones técnicas y patrones

### 4.1 El problema de la acumulación de overrides (CRÍTICO)

**Problema histórico:** A lo largo de las sesiones se acumularon múltiples overrides de la función `showSection` y bloques de código huérfanos en el scope global, lo que rompía silenciosamente todos los handlers de click con `ReferenceError`.

**Solución definitiva (abril 2026):**
- Una **única** función `showSection` consolidada
- **Cero** overrides
- Verificación obligatoria antes de cualquier deploy

> ⚠️ **Regla inviolable:** Si necesitás cambiar el comportamiento de `showSection`, modificá la función original. **Nunca** redefinas la función al final del script.

### 4.2 Direct fetch vs apiGet wrapper

Para los loaders críticos, **usar `fetch` directo** en lugar del wrapper `apiGet`. El wrapper estaba tragándose errores silenciosamente.

**Loaders que usan fetch directo:**
- `loadHelpArticles`
- `loadAlertas`
- `cargarOnboardings`
- `cargarCandidatos`

### 4.3 Ubicación de secciones nuevas

Las secciones `sec-recruiting` y `sec-onboarding` se colocan en `html_after` (post-script), no en el cuerpo principal. Esto evita conflictos con el render inicial.

### 4.4 Botones de delete con overlay + closure

Los botones de delete usan patrón de overlay + closure para evitar romperse por anidamiento de comillas en strings de HTML.

```javascript
// PATRÓN CORRECTO
function bindDeleteButton(btnId, itemId) {
  document.getElementById(btnId).addEventListener('click', () => {
    confirmDelete(itemId);  // closure captura itemId
  });
}

// EVITAR
// `<button onclick="confirmDelete('${itemId}')">` ← se rompe con comillas
```

### 4.5 Soft-delete

Las tablas `PIPs`, `OneOnOneMeetings`, `OnboardingPlans` usan columna `IsDeleted` (BIT) en lugar de DELETE físico. Todas las queries de SELECT deben filtrar `WHERE IsDeleted = 0`.

### 4.6 Modales de dos columnas

Para forms complejos (PIP, Feedback 360°) se usa layout de dos columnas para entrar en resolución 1366×768 sin scroll.

### 4.7 Verificación JS antes de guardar

**Siempre** simular globals del browser y validar con Node.js antes de deployar. Esto previene `ReferenceError` en producción.

### 4.8 Backups con timestamp

Antes de cualquier modificación, crear un backup `index.html.bak.YYYYMMDD-HHMM`. **Nunca** acumular cambios sobre una base potencialmente rota.

### 4.9 Archivos completos, no diffs

**Preferencia firme:** todas las entregas deben ser archivos completos, listos para deploy. No diffs, no instrucciones de find-and-replace, no edición manual.

---

## 5. Código clave de referencia

### 5.1 Plantilla de showSection consolidada

```javascript
function showSection(sectionId) {
  // Ocultar todas las secciones
  document.querySelectorAll('.section').forEach(s => {
    s.style.display = 'none';
  });

  // Mostrar la solicitada
  const section = document.getElementById(sectionId);
  if (!section) {
    console.error(`Section ${sectionId} not found`);
    return;
  }
  section.style.display = 'block';

  // Lazy-load del contenido según sección
  switch (sectionId) {
    case 'sec-help':       loadHelpArticles(); break;
    case 'sec-alertas':    loadAlertas(); break;
    case 'sec-onboarding': cargarOnboardings(); break;
    case 'sec-recruiting': cargarCandidatos(); break;
    // ... resto de casos
  }

  // Marcar item activo en sidebar
  document.querySelectorAll('.menu-item').forEach(m => m.classList.remove('active'));
  const activeItem = document.querySelector(`[data-section="${sectionId}"]`);
  if (activeItem) activeItem.classList.add('active');
}
```

### 5.2 Plantilla de loader con fetch directo

```javascript
async function loadHelpArticles() {
  const container = document.getElementById('help-articles-container');
  container.innerHTML = '<p>Cargando...</p>';

  try {
    const res = await fetch(`${API_BASE}/help-articles`, {
      credentials: 'include'
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    }

    const articles = await res.json();
    renderHelpArticles(articles);
  } catch (err) {
    console.error('Error cargando artículos:', err);
    container.innerHTML = `<p class="error">Error: ${err.message}</p>`;
  }
}
```

### 5.3 Plantilla de endpoint Azure Function

```javascript
const sql = require('mssql');

module.exports = async function (context, req) {
  try {
    const pool = await sql.connect(SQL_CONFIG);

    const result = await pool.request()
      .input('userId', sql.Int, parseInt(req.params.id))
      .query(`
        SELECT * FROM OneOnOneMeetings
        WHERE UserID = @userId AND IsDeleted = 0
        ORDER BY MeetingDate DESC
      `);

    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: result.recordset
    };
  } catch (err) {
    context.log.error(err);
    context.res = {
      status: 500,
      body: { error: err.message }
    };
  }
};
```

### 5.4 Soft-delete en API

```javascript
// PATRÓN: soft-delete
await pool.request()
  .input('id', sql.Int, id)
  .query(`UPDATE PIPs SET IsDeleted = 1, UpdatedAt = GETDATE() WHERE PIPID = @id`);

// PATRÓN: select que excluye borrados
await pool.request()
  .query(`SELECT * FROM PIPs WHERE IsDeleted = 0 ORDER BY CreatedAt DESC`);
```

---

## 6. Estado actual (mayo 2026)

### ✅ Módulos completados

- Dashboard
- Usuarios
- Líderes
- Áreas
- Períodos
- Objetivos
- Plan Carrera (dinámico + milestones + certifications + evidence + badge URL)
- Competencias
- Reuniones 1:1 (edit + soft-delete)
- Feedback 360°
- Ayuda (DB-driven)
- Alertas
- Reportes + tab Cambios
- Organigrama
- PIP (scroll + soft-delete + ver detalle)
- Onboarding (milestones + courses + evidence + soft-delete)
- Recruiting (Kanban + stage notes + files + advance + reject)

### 📊 Métricas técnicas

- **API endpoints:** ~70
- **Tablas:** 24
- **Branding:** dark CTRL365 (naranja `#FF5400`, fondo `#0d0d0d`, fonts Sora + Inter)
- **Resolución target:** 1366×768

---

## 7. Pendientes

### 7.1 Verificación en producción

- [ ] **Plan Carrera dinámico** — verificar funcionalidad completa en prod
- [ ] **Ayuda** — verificar carga de artículos (columna `IsActive` ya agregada)
- [ ] **Reuniones 1:1** — verificar comportamiento de soft-delete
- [ ] **Recruiting** — verificar funcionalidad de upload de archivos
- [ ] **Onboarding** — verificar comportamiento de carga

### 7.2 Desarrollo pendiente

- [ ] **Sistema de permisos por rol**
  - Roles: admin / manager / leader / employee
  - Visibilidad diferenciada por módulo y por dato
  - Backend: validación en cada endpoint
  - Frontend: ocultamiento/deshabilitación de UI según rol
- [ ] **Manuales actualizados**
  - Manual técnico cubriendo todos los cambios de la sesión de abril 2026
  - Manual de usuario por módulo

---

## 8. Aprendizajes y principios

### 8.1 El problema de las regresiones

**Frustración recurrente:** funciones que andaban se rompieron repetidamente al agregar features nuevas. La causa raíz casi siempre fue trabajar sobre una base potencialmente rota en lugar de un known-good backup.

**Principio:** siempre arrancar desde un backup conocido bueno, nunca desde el estado actual posiblemente roto.

### 8.2 Override accumulation

Múltiples sesiones agregando overrides "de más" terminaron rompiendo todo el sistema de navegación silenciosamente. **Una sola función, sin overrides.**

### 8.3 Surface real errors

Wrappers que esconden errores son la causa más común de bugs intermitentes. Para loaders críticos, **fetch directo + try/catch explícito**.

### 8.4 SQL incremental

Las adiciones de columnas/tablas deben hacerse con awareness del schema existente para evitar errores de duplicate column. Estos errores son inofensivos pero hay que registrarlos.

### 8.5 Verificación pre-deploy

Validar siempre el JS con Node.js (simulando globals del browser) antes de pushear. Esto atrapa el 90% de los errores que causaron regresiones históricas.

---

## 9. Herramientas y recursos

| Herramienta | Uso |
|---|---|
| **VS Code** | Edición + extensión Azure Functions para deploy manual de API |
| **GitHub Actions** | Auto-deploy del frontend en push a `main` |
| **Azure Static Web Apps** | Hosting del frontend |
| **Azure Functions (Node.js 20, Flex Consumption)** | Backend |
| **Azure SQL Database (Elastic Pool)** | Persistencia |
| **Azure AD** | Auth (`/.auth/login/aad`, `/.auth/me`) |

### Stack frontend

- HTML/CSS/JS vanilla (sin framework)
- UI dark CTRL365
- Color primario: `#FF5400` (naranja)
- Background: `#0d0d0d`
- Fonts: **Sora** (headings) + **Inter** (body)

---

## 10. Cómo retomar este proyecto en una cuenta nueva de Claude

### Paso 1: Subir este documento
Iniciá una conversación nueva y subí `HANDOVER.md` como adjunto, junto con el ZIP de la solución.

### Paso 2: Establecer las preferencias de trabajo
Decile a Claude explícitamente:
- "Siempre dame el archivo completo, nunca diffs ni edición manual"
- "Antes de cualquier cambio, creá un backup con timestamp"
- "Validá el JS con Node.js antes de entregar"
- "No agregues overrides a `showSection`; modificá la función original"

### Paso 3: Compartir credenciales con cuidado
- **NO** pegues credenciales en el chat
- Usá Azure Portal directamente para cualquier acción que requiera login
- Para queries SQL, usá Azure Data Studio o el portal

### Paso 4: Estado del repo
Antes de cualquier cambio, hacé:
```bash
cd C:\Agentes\peopletrack
git pull
git status
# Crear backup local
copy frontend\index.html frontend\index.html.bak.YYYYMMDD-HHMM
copy api\index.js api\index.js.bak.YYYYMMDD-HHMM
```

### Paso 5: Pedir el primer task
Dale a Claude un task chico y verificable primero (ej: "agregar un campo nuevo a la tabla Users") para validar que el contexto está bien transferido antes de meterse con el roadmap grande.

---

## 11. Roadmap sugerido para la próxima sesión

### Prioridad alta
1. **Sistema de permisos por rol** (admin/manager/leader/employee)
2. **Verificación end-to-end** de los módulos pendientes en producción
3. **Manual de usuario** módulo por módulo

### Prioridad media
4. **Auditoría completa** del log de cambios (tab Cambios)
5. **Notificaciones por email** desde el módulo de Alertas
6. **Export a Excel/PDF** desde Reportes

### Prioridad baja / nice to have
7. **Modo claro** (toggle dark/light)
8. **PWA / mobile-first** para uso desde teléfono
9. **Integración con Microsoft Teams** para notificaciones

---

## 12. Contactos y referencias

- **Empresa:** CTRL365 / INSTALNET SRL
- **Empleados:** ~349
- **Admin:** osanchez@ctrl365.com
- **Repo:** `github.com/osanchezctrl365service/peopletrack-`

---

> **Última nota:** Este documento es la fuente de verdad sobre el estado del proyecto a mayo 2026. Si algo cambia, actualizá este archivo **antes** de cerrar la sesión correspondiente.
