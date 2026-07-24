# PeopleTrack — Documento de Contexto del Proyecto

> **Para qué sirve este documento:** sirve como handoff para retomar el proyecto en caso de que se pierda contexto, se rompa una conversación, o haya que empezar con un asistente nuevo. **Mantenelo actualizado en `docs/PROYECTO_PEOPLETRACK.md` del repo.**

> **Última actualización:** 28-Abr-2026 — sesión post-fix de Career + Recruiting (archivos)

---

## 1. ¿Qué es PeopleTrack?

Aplicación web de gestión de RR.HH. para **CTRL365 / INSTALNET SRL** (~349 empleados). Tipo Teamflect, pero propia. Maneja:

- Objetivos (Core empresa + personales + tasks)
- Plan de Carrera con milestones, certificaciones y badges
- Competencias (evaluación con ponderaciones)
- Reuniones 1:1 (bitácora con notas privadas/compartidas)
- Feedback 360° (anónimo o identificado)
- PIP — Plan de Improvement
- Onboarding (milestones + cursos + evidencia)
- Recruiting (Kanban de candidatos + archivos + entrevistas)
- Organigrama dinámico
- Alertas automáticas (umbrales de avance)
- Reportes + tab de cambios

Admin del sistema: **osanchez@ctrl365.com** (Orlando Sánchez).

---

## 2. Stack e Infraestructura

| Componente | Tecnología | URL / Path |
|---|---|---|
| Frontend | HTML + JS vanilla (sin framework) | Azure Static Web App → `yellow-water-0d91cc40f.1.azurestaticapps.net` |
| API | Azure Functions Node.js 20 (Flex Consumption), modelo v4 (`app.http()`) | `peopletrack-api-gjbbhhcefjbgc6bd.eastus2-01.azurewebsites.net/api` |
| DB | Azure SQL (Elastic Pool) | `ctrl365serverlogic.database.windows.net / PeopleTrackDB` |
| Repo | GitHub | `github.com/osanchezctrl365service/peopletrack-` |
| Auth | Azure AD | `/.auth/login/aad` y `/.auth/me` |
| Local FS | Windows | `C:\Agentes\peopletrack\frontend\index.html` y `C:\Agentes\peopletrack\api\index.js` |

**Deploy:**
- Frontend → `git push` a `main` → GitHub Actions auto-deploy
- API → manual desde VS Code (Azure Functions extension → Deploy to Function App)

**Branding visual:** dark theme. Naranja `#FF5400`, fondo `#0d0d0d`. Fuentes: Sora (títulos) + Inter (cuerpo).

---

## 3. Schema de base de datos (24+ tablas)

### Tablas core
- **Users** — colaboradores (UserID, FullName, Email, RoleID, AreaID, LeaderID, IsActive…)
- **Areas** — departamentos
- **Roles** — roles laborales
- **Periods** — períodos fiscales/quarters

### Módulo Objetivos
- **Objectives** — objetivos individuales
- **ObjectiveCheckins** — registros de avance
- **ObjectiveNotes** — notas

### Módulo Plan de Carrera
- **CareerPlans** — `PlanID, UserID, PeriodID, CurrentRoleID, TargetRoleID, OverallProgress, EvaluatorID, Notes, IsActive, PlanType, TargetRole, Description`
- **CareerMilestones** — `MilestoneID, **PlanID** (no CareerPlanID), MilestoneTitle (no Title), Description, SortOrder, Progress (decimal), Feedback, LastReviewDate, DueDate, **Status** (no IsCompleted), MilestoneCategory, CertificationName, BadgeURL, FileData, FileName, FileType, EmployeeComment, CompletedAt`
- **CertificationCatalog** — 27 certs predefinidas (Name, Category, Provider, Description, IsActive)

⚠️ **Trampa histórica del schema:** las primeras versiones del API usaban `CareerPlanID`, `Title`, `IsCompleted`. La DB real usa `PlanID`, `MilestoneTitle`, `Status` + `Progress`. Este desfase ya está corregido.

### Módulo Competencias (estructura por confirmar)
- **CompetencyCatalog**, **CompetencyEvaluations** — pendiente de revisión.

### Módulo Reuniones 1:1
- **OneOnOneMeetings** — `MeetingID, EmployeeID, MeetingDate, Title, GeneralNotes, NextSteps, IsDeleted, UpdatedAt`
- **OneOnOneNotes** — `NoteID, MeetingID, NoteText, NoteType, IsPrivate, ObjectiveID`

### Módulo Feedback 360
- **Feedback360**, tabla principal (estructura por confirmar)

### Módulo PIP
- **PIPs** — `PIPID, EmployeeID, CreatedByID, Reason, StartDate, Target15Days, Target30Days, Target60Days, Milestones, ReviewNotes, Achieved, Status, IsDeleted, CreatedAt`

### Módulo Onboarding
- **OnboardingPlans** — `OnboardingID, UserID, IsDeleted, CreatedAt`
- **OnboardingMilestones** — `Title, IsCompleted, CompletedAt`
- **OnboardingCourses** — `Title, IsCompleted`

### Módulo Recruiting
- **Candidates** — `CandidateID, FullName, Email, Phone, Status, TechStack, SalaryExpectation, Currency, AvailableFrom, SourceType, Notes, RejectionReason`. Estados: `screening, technical, client, offer, hired, rejected`
- **CandidateFiles** — `FileID, CandidateID, FileName, FileType (mime), FileData (base64), FileSize`
- **CandidateInterviews** — `InterviewID, CandidateID, InterviewerName, Result, Feedback, CreatedAt`
- **CandidateHistory** — log de cambios de estado

### Otras
- **HelpArticles** (con `IsActive`)
- **Alerts** (auto-generadas)
- **RoleChanges** (cambios de rol/área)
- **AppConfig** (configuración global)

### Permisos SQL (rol `peopletrack_app`)
- DELETE granted en 9 tablas (PIPs, OneOnOneMeetings, etc.)
- INSERT/UPDATE/SELECT en todas las tablas

---

## 4. Convenciones de código

### Frontend (`index.html`)

- **Una sola función `showSection(id)`** — sin overrides. Todos los handlers de menú la llaman. Si necesitás agregar comportamiento al cambiar de sección, modificá esa función directamente, **NO crees un override**. Los overrides acumulados rompieron el sistema en sesiones anteriores.
- **`apiGet(path)`** y direct `fetch` para datos críticos. `apiGet` ahora tiene timeout de 15s.
- **`loadUsuarios`, `loadPeriods`** — son defensivas, nunca rechazan. Aunque la API falle, devuelven array vacío.
- **`loadHelpArticles`, `loadAlertas`, `cargarOnboardings`, `cargarCandidatos`** — usan `fetch` directo (no `apiGet`) para que los errores aparezcan visibles en lugar de silenciarse.
- **Modales** se montan en `<body>` directamente (no anidados). Pattern típico: `document.body.appendChild(overlay)`.
- **Soft-delete** vía columna `IsDeleted=1` (PIPs, OneOnOneMeetings, OnboardingPlans). El GET correspondiente debe filtrar `WHERE IsDeleted=0 OR IsDeleted IS NULL`.
- **Layout fix runtime** — al final del HTML hay un wrapper de `showSection` que detecta si una sección queda en 0×0 píxeles y la mueve al `<body>` con `position:fixed` calculando dimensiones a partir de sidebar (240px) y topbar (60px). Esto fue necesario para resolver un bug de flexbox que dejaba 6 secciones invisibles. **No remover este wrapper.**

### API (`api/index.js`)

- Helpers globales: `ok(data)` y `err(message, status)`.
- Todas las queries van a través de `query(sql, params)` que usa `mssql` con prepared statements.
- Auth: `getAuthUser(req)` lee el header de Azure AD. Endpoints protegidos chequean `if (!user) return err('No autorizado', 401)`. Los públicos usan `authLevel: 'anonymous'`.
- **Defensiveness pattern**: cuando una query depende de una columna que puede no existir todavía en prod, envolver en try/catch y proveer fallback:

```js
try {
  res = await query(`SELECT ... WHERE IsDeleted = 0`);
} catch(e1) {
  res = await query(`SELECT ... -- query original sin IsDeleted`);
}
```

- **Nunca** asumir que la DB tiene columnas nuevas — siempre fallback al schema viejo.

---

## 5. Bugs históricos resueltos (lecciones)

| Bug | Causa raíz | Lección |
|---|---|---|
| Pantalla negra en 6 secciones | `getBoundingClientRect()` devolvía 0×0 por flexbox roto en `body display:flex` | El layout fix runtime mueve secciones al body con `position:fixed` |
| Override accumulation en `showSection` | Múltiples sesiones agregando overrides encadenados | UNA sola función `showSection`, cero overrides |
| `cargarPIPs` silenciosamente fallaba | `apiGet` swallow errors con `console.warn` | Para loaders críticos, `fetch` directo y `res.ok` check |
| Recruiting "guarda pero no guarda" | INSERT en `CandidateInterviews` envuelto en try/catch que tragaba errores | NO tragar errores en operaciones de escritura — propagarlos |
| `adjuntosSection` invisible | Variable declarada pero no insertada en HTML del modal | Validar visualmente cada cambio en modales |
| 2 funciones `guardarNuevoPlan` con mismo nombre | Refactor sin limpiar la versión vieja | Después de refactor, `grep -c "function nombreFn"` para detectar duplicados |
| Career: `Invalid column name 'CareerPlanID'` | API esperaba columna que se renombró a `PlanID` | Schema diagnostic SQL antes de tocar — no fiarse de memoria del proyecto |
| Modales async: data no aparecía | `cargarX(id)` ejecutado **antes** de `appendChild(overlay)` | Llamadas async DESPUÉS del appendChild |

---

## 6. Cómo deployar

### Pre-deploy
1. Backup del archivo actual antes de tocarlo:
   ```
   copy index.html index_BACKUP_AAAAMMDD_HHMM.html
   ```
2. Validar JS antes de pushear:
   ```
   node --check api\index.js
   ```

### Frontend
```
cd C:\Agentes\peopletrack\frontend
git status
git add .
git commit -m "fix: descripción clara de qué se cambió"
git push
```
GitHub Actions hace el deploy automático. Esperar 2-3 min y refrescar la URL del Static Web App con `Ctrl+Shift+R` (sin cache).

### API
1. Abrir VS Code en `C:\Agentes\peopletrack\api`
2. Extension Azure Functions → Deploy to Function App → seleccionar `peopletrack-api-gjbbhhcefjbgc6bd`
3. Confirmar overwrite cuando lo pida
4. Esperar al "Deploy succeeded" en la terminal

### SQL migrations
1. Azure Portal → SQL Database `PeopleTrackDB` → Query Editor
2. Login con admin SQL
3. Pegar script `IF NOT EXISTS` idempotente y Run
4. Verificar el resultado de la sentencia de verificación final

---

## 7. Cómo retomar el proyecto con un asistente nuevo

> **Tip:** copiá-pegá esta sección al chat del nuevo asistente como primer mensaje.

```
Soy Orlando, dueño/admin de PeopleTrack — una webapp de gestión de RR.HH. para
CTRL365 / INSTALNET SRL. Stack: HTML+JS vanilla (frontend) + Azure Functions
Node.js (API) + Azure SQL.

Te paso 3 archivos:
1. PROYECTO_PEOPLETRACK.md → contexto completo del proyecto
2. index.html → frontend actual (en C:\Agentes\peopletrack\frontend\)
3. api/index.js → backend actual (en C:\Agentes\peopletrack\api\)

Reglas que necesito que sigas:
- Trabajar SIEMPRE sobre archivo conocido funcional, no acumular cambios
  sobre versiones rotas.
- Hacer backup con timestamp ANTES de cualquier cambio importante.
- Validar JS con node --check antes de entregar.
- Entregarme archivos completos listos para deploy, NUNCA diffs ni "and así".
- Mantener una sola función showSection sin overrides.
- Para cambios de DB schema, primero un diagnostic SQL que me diga qué hay.
- Para writes (INSERT/UPDATE/DELETE), NO tragar errores con try/catch
  silencioso. Que el frontend se entere si falla.

Mi flujo de trabajo: vos me das archivos, yo los pego en disco, deployo
(git push para frontend, VS Code para API), y validamos en
yellow-water-0d91cc40f.1.azurestaticapps.net.

Empezamos por...
```

---

## 8. Estado actual de los módulos (28-Abr-2026)

| Módulo | Estado | Notas |
|---|---|---|
| Dashboard | ✅ OK | KPIs + donut por colaborador |
| Usuarios / Líderes / Áreas / Períodos | ✅ OK | CRUD completo |
| Objetivos | ✅ OK | Core + Personales + Tasks con tabs |
| Plan de Carrera | ✅ OK | Schema PlanID/MilestoneTitle/Status corregido. Crear plan + ver detalle + marcar milestones funciona |
| Competencias | ⚠️ PARCIAL | Lista carga, falta el flujo de evaluación con período |
| Reuniones 1:1 | ✅ OK | Soft-delete con IsDeleted funciona |
| Feedback 360° | ⚠️ POR VERIFICAR | Carga sin error, falta confirmar flujo completo |
| PIP | ⚠️ PARCIAL | Crear funciona, eliminar lo hacen manualmente desde DB |
| Onboarding | ✅ OK | Milestones + courses + evidencia |
| Recruiting | ⚠️ CASI OK | Kanban + archivos OK, falta validar guardado de entrevistador/feedback (en sesión actual) |
| Organigrama | ✅ OK | Dinámico desde DB |
| Alertas | ⚠️ VACÍO | Carga sin datos, falta poblarla |
| Reportes | ✅ OK | Con tab de cambios |
| Ayuda | ✅ OK | Artículos desde DB con IsActive |
| Configuración | ⚠️ VACÍO | Carga la sección pero falta funcionalidad real |

---

## 9. Cosas pendientes / roadmap

- **Sistema de permisos por rol** — admin / manager / leader / employee con visibilidad acotada
- **Manuales actualizados** — técnico y de usuario, con todos los cambios de Apr 2026
- **Configuración: import/export de schema y datos** — para migración o reconstrucción
- **Competencias: flujo de evaluación completo** — colaborador + período + ponderaciones
- **PIP: botón eliminar en UI** (ahora se hace desde DB directamente)

---

## 10. Contactos y accesos

- Admin sistema: osanchez@ctrl365.com
- Repo GitHub: `github.com/osanchezctrl365service/peopletrack-`
- Azure Subscription: (gestionada por Orlando)
- Azure resources naming: `peopletrack-api-*`, `ctrl365serverlogic`, etc.

---

**Fin del documento.** Mantener actualizado en cada sesión donde haya cambios importantes.
