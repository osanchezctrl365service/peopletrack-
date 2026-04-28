// api/index.js — Todas las rutas de la API
const { app } = require('@azure/functions');
const { query, execute, sql } = require('./db');
const { validateToken, corsHeaders } = require('./auth');
// ── Health check sin auth ───────────────────────────────────
app.http('health', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'health',
  handler: async (req) => {
    try {
      const res = await query('SELECT COUNT(*) as cnt FROM FiscalPeriods');
      return { status: 200, headers: corsHeaders(), body: JSON.stringify({ status: 'ok', periods: res.recordset[0].cnt }) };
    } catch (e) {
      return { status: 500, headers: corsHeaders(), body: JSON.stringify({ status: 'error', error: e.message }) };
    }
  }
});
// ── Helper: respuesta estándar ──────────────────────────────
function ok(data)  { return { status: 200, headers: corsHeaders(), body: JSON.stringify({ ok: true,  data }) }; }
function err(msg, status = 400) { return { status, headers: corsHeaders(), body: JSON.stringify({ ok: false, error: msg }) }; }
// ── Helper: validar auth y traer user de BD ─────────────────
async function getAuthUser(req) {
  const auth = await validateToken(req);
  if (!auth.valid) return null;
  const res = await query(
    `SELECT u.*, a.AreaName, r.RoleName
     FROM Users u
     LEFT JOIN Areas a ON u.AreaID = a.AreaID
     LEFT JOIN Roles r ON u.RoleID = r.RoleID
     WHERE u.AzureObjectID = @azureId OR u.Email = @email`,
    { azureId: auth.user.azureId, email: auth.user.email }
  );
  if (res.recordset.length === 0) return null;
  return { ...auth.user, ...res.recordset[0] };
}
// ── CORS preflight ──────────────────────────────────────────
app.http('options', {
  methods: ['OPTIONS'],
  authLevel: 'anonymous',
  route: '{*path}',
  handler: () => ({ status: 204, headers: corsHeaders(), body: '' })
});
// ============================================================
// USUARIOS ADMIN
// ============================================================

// GET /api/users/all — Todos los usuarios para admin
app.http('getAllUsers', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'users/all',
  handler: async (req) => {
    try {
      const res = await query(
        `SELECT u.UserID, u.FullName, u.Email, u.AppRole, u.IsActive,
                u.AreaID, a.AreaName, r.RoleName,
                leader.FullName  AS LeaderName,  ur.LeaderID  AS LeaderID,
                manager.FullName AS ManagerName, ur.ManagerID AS ManagerID
         FROM Users u
         LEFT JOIN Areas a ON u.AreaID = a.AreaID
         LEFT JOIN Roles r ON u.RoleID = r.RoleID
         LEFT JOIN UserRelationships ur ON u.UserID = ur.EmployeeID AND ur.IsActive = 1
         LEFT JOIN Users leader  ON ur.LeaderID  = leader.UserID
         LEFT JOIN Users manager ON ur.ManagerID = manager.UserID
         ORDER BY u.FullName`
      );
      return ok(res.recordset);
    } catch (e) { return err(e.message, 500); }
  }
});

// PUT /api/users/:id — Actualizar usuario
app.http('updateUser', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: 'manage/users/{id}',
  handler: async (req) => {
    try {
      const body = await req.json();
      const uid  = parseInt(req.params.id);
      const fields = [];
      const params = { id: uid };
      if (body.FullName  !== undefined) { fields.push('FullName = @name');   params.name   = body.FullName; }
      if (body.Email     !== undefined) { fields.push('Email = @email');     params.email  = body.Email; }
      if (body.AppRole   !== undefined) { fields.push('AppRole = @role');    params.role   = body.AppRole; }
      if (body.IsActive !== undefined) { fields.push('IsActive = @active'); params.active = body.IsActive ? 1 : 0; }
      if (body.AreaID   !== undefined) { fields.push('AreaID = @areaId'); params.areaId = body.AreaID ? parseInt(body.AreaID) : null; }
      if (fields.length > 0) {
        await query(
          `UPDATE Users SET ${fields.join(', ')}, UpdatedAt = GETDATE() WHERE UserID = @id`,
          params
        );
      }
      // LeaderID y ManagerID se guardan en UserRelationships
      if (body.LeaderID !== undefined || body.ManagerID !== undefined) {
        // Desactivar relaciones actuales
        await query(`UPDATE UserRelationships SET IsActive=0 WHERE EmployeeID=@uid`, { uid });
        const newLeader  = body.LeaderID  ? parseInt(body.LeaderID)  : null;
        const newManager = body.ManagerID ? parseInt(body.ManagerID) : null;
        if (newLeader || newManager) {
          await query(
            `INSERT INTO UserRelationships (EmployeeID, LeaderID, ManagerID, IsPrimary, IsActive)
             VALUES (@uid, @lid, @mid, 1, 1)`,
            { uid, lid: newLeader, mid: newManager }
          );
        }
      }
      return ok({ updated: true });
    } catch (e) { return err(e.message, 500); }
  }
});

// POST /api/users — Crear nuevo usuario
app.http('createUser', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'manage/users',
  handler: async (req) => {
    try {
      const body     = await req.json();
      const fullName = body.fullName  || body.FullName  || '';
      const email    = body.email     || body.Email     || '';
      const appRole  = body.appRole   || body.AppRole   || 'employee';
      const isActive = body.isActive  !== undefined ? (body.isActive ? 1 : 0) : 1;
      const leaderID = body.leaderID  || body.LeaderID  || null;
      const managerID= body.managerID || body.ManagerID || null;
      const areaID   = body.areaID    || body.AreaID    || null;
      if (!email)    return err('Email requerido', 400);
      if (!fullName) return err('Nombre requerido', 400);
      const res = await query(
        `INSERT INTO Users (FullName, Email, AppRole, IsActive, AreaID, CreatedAt, UpdatedAt)
         OUTPUT INSERTED.UserID
         VALUES (@name, @email, @role, @active, @areaID, GETDATE(), GETDATE())`,
        { name: fullName, email, role: appRole, active: isActive, areaID }
      );
      const newID = res.recordset[0].UserID;
      if (leaderID) await query(
        `IF NOT EXISTS (SELECT 1 FROM UserRelationships WHERE EmployeeID=@e AND LeaderID=@l AND IsActive=1)
         INSERT INTO UserRelationships (EmployeeID,LeaderID,IsPrimary,IsActive) VALUES (@e,@l,1,1)`,
        { e: newID, l: parseInt(leaderID) }
      );
      if (managerID) await query(
        `IF NOT EXISTS (SELECT 1 FROM UserRelationships WHERE EmployeeID=@e AND ManagerID=@m AND IsActive=1)
         INSERT INTO UserRelationships (EmployeeID,ManagerID,IsPrimary,IsActive) VALUES (@e,@m,1,1)`,
        { e: newID, m: parseInt(managerID) }
      );
      return ok({ UserID: newID, FullName: fullName, Email: email, AppRole: appRole, IsActive: isActive===1 });
    } catch (e) { return err(e.message, 500); }
  }
});
// ============================================================
// AUTH
// ============================================================
app.http('authMe', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'auth/me',
  handler: async (req) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return err('No autorizado', 401);
      return ok(user);
    } catch (e) { return err(e.message, 500); }
  }
});
// ============================================================
// DASHBOARD
// ============================================================
app.http('dashboard', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'dashboard',
  handler: async (req) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return err('No autorizado', 401);
      const periodId = req.query.get('periodId') || null;
      let data;
      if (user.AppRole === 'manager') {
        data = await execute('sp_GetManagerDashboard', { ManagerID: user.UserID, PeriodID: periodId });
      } else {
        data = await execute('sp_GetLeaderDashboard', { LeaderID: user.UserID, PeriodID: periodId });
      }
      const team = data.recordset;
      const total = team.length;
      const avgProg = total ? Math.round(team.reduce((a,r) => a + (r.WeightedProgress||0), 0) / total) : 0;
      const atRisk = team.filter(r => (r.WeightedProgress||0) < (process.env.ALERT_THRESHOLD||70)).length;
      return ok({ team, kpi: { total, avgProgress: avgProg, atRisk } });
    } catch (e) { return err(e.message, 500); }
  }
});
// ============================================================
// PERÍODOS
// ============================================================
app.http('periods', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'periods',
  handler: async (req) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return err('No autorizado', 401);
      const res = await query('SELECT * FROM FiscalPeriods WHERE IsActive=1 ORDER BY StartDate DESC');
      return ok(res.recordset);
    } catch (e) { return err(e.message, 500); }
  }
});
// ============================================================
// USUARIOS (equipo del lider)
// ============================================================
app.http('getUsers', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'users',
  handler: async (req) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return err('No autorizado', 401);
      const res = await query(
        `SELECT DISTINCT u.UserID, u.FullName, u.Email, u.AppRole,
                a.AreaName, r.RoleName, u.IsActive
         FROM Users u
         LEFT JOIN Areas a ON u.AreaID = a.AreaID
         LEFT JOIN Roles r ON u.RoleID = r.RoleID
         LEFT JOIN UserRelationships ur ON u.UserID = ur.EmployeeID
         WHERE ur.LeaderID = @uid OR ur.ManagerID = @uid AND u.IsActive = 1
         ORDER BY u.FullName`,
        { uid: user.UserID }
      );
      return ok(res.recordset);
    } catch (e) { return err(e.message, 500); }
  }
});
app.http('getUserReport', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'users/{userId}/report',
  handler: async (req) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return err('No autorizado', 401);
      const userId = parseInt(req.params.userId);
      const periodId = parseInt(req.query.get('periodId'));
      const res = await execute('sp_GetUserFullReport', { UserID: userId, PeriodID: periodId });
      return ok({ user: res.recordsets[0]?.[0], objectives: res.recordsets[1], career: res.recordsets[2], competencies: res.recordsets[3], meetings: res.recordsets[4] });
    } catch (e) { return err(e.message, 500); }
  }
});
// ============================================================
// OBJETIVOS
// ============================================================
app.http('getObjectives', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'objectives',
  handler: async (req) => {
    try {
      const userId = req.query.get('userId') || null;
      const periodId = req.query.get('periodId') || null;
      const type = req.query.get('type') || null;
      const res = await query(
        `SELECT o.*, u.FullName AS EmployeeName, fp.PeriodName, c.CompetencyName, a.AreaName
         FROM Objectives o
         LEFT JOIN Users u ON o.UserID = u.UserID
         LEFT JOIN FiscalPeriods fp ON o.PeriodID = fp.PeriodID
         LEFT JOIN ObjectiveTasks ot ON o.ObjectiveID = ot.ObjectiveID
         LEFT JOIN Competencies c ON ot.CompetencyID = c.CompetencyID
         LEFT JOIN Areas a ON o.AreaID = a.AreaID
         WHERE o.IsActive=1
           AND (@userId IS NULL OR o.UserID=@userId)
           AND (@periodId IS NULL OR o.PeriodID=@periodId)
           AND (@type IS NULL OR o.ObjectiveType=@type)
         ORDER BY o.CreatedAt DESC`,
        { userId, periodId, type }
      );
      return ok(res.recordset);
    } catch (e) { return err(e.message, 500); }
  }
});
app.http('createObjective', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'objectives',
  handler: async (req) => {
    try {
      const body = await req.json();
      let createdBy = body.createdBy || body.userId || 1;
      try { const u = await getAuthUser(req); if(u) createdBy = u.UserID; } catch(e) {}
      const res = await execute('sp_UpsertObjective', {
        ObjectiveID: null, Title: body.title, Description: body.description||null,
        ObjectiveType: body.objectiveType||'personal', PeriodID: body.periodId,
        UserID: body.userId||null, AreaID: body.areaId||null, Weight: body.weight||0,
        Status: body.status||'not_started', Progress: body.progress||0,
        DueDate: body.dueDate||null, CreatedBy: createdBy
      });
      return ok({ objectiveId: res.recordset[0]?.NewObjectiveID });
    } catch (e) { return err(e.message, 500); }
  }
});
app.http('updateObjective', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: 'objectives/{id}',
  handler: async (req) => {
    try {
      const body = await req.json();
      let createdBy = body.createdBy || 1;
      try { const u = await getAuthUser(req); if(u) createdBy = u.UserID; } catch(e) {}
      await execute('sp_UpsertObjective', {
        ObjectiveID: parseInt(req.params.id), Title: body.title,
        Description: body.description||null, ObjectiveType: body.objectiveType||'personal',
        PeriodID: body.periodId, UserID: body.userId||null, AreaID: body.areaId||null,
        Weight: body.weight||0, Status: body.status, Progress: body.progress,
        DueDate: body.dueDate||null, CreatedBy: createdBy
      });
      return ok({ updated: true });
    } catch (e) { return err(e.message, 500); }
  }
});
app.http('checkin', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'objectives/{id}/checkin',
  handler: async (req) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return err('No autorizado', 401);
      const body = await req.json();
      await execute('sp_RegisterCheckIn', {
        ObjectiveID: parseInt(req.params.id), TaskID: body.taskId||null,
        ProgressValue: body.progress, Status: body.status,
        Notes: body.notes||'', CheckedBy: user.UserID
      });
      return ok({ registered: true });
    } catch (e) { return err(e.message, 500); }
  }
});
// ============================================================
// PLAN DE CARRERA
// ============================================================
app.http('getCareer', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'career/{userId}',
  handler: async (req) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return err('No autorizado', 401);
      const uid = parseInt(req.params.userId);
      // Intento 1: usar la vista si existe
      try {
        const res = await query(`SELECT * FROM vw_CareerPlanDetails WHERE UserID = @uid`, { uid });
        return ok(res.recordset);
      } catch(e1) {
        // Fallback: query directa al schema real
        const res = await query(
          `SELECT cp.PlanID, cp.UserID, cp.PlanType, cp.TargetRole, cp.Description,
                  cp.OverallProgress, cp.Notes, cp.IsActive, cp.CreatedAt, cp.UpdatedAt,
                  u.FullName AS EmployeeName, u.Email AS EmployeeEmail
           FROM CareerPlans cp
           JOIN Users u ON cp.UserID = u.UserID
           WHERE cp.UserID = @uid AND (cp.IsActive IS NULL OR cp.IsActive = 1)`,
          { uid }
        );
        return ok(res.recordset);
      }
    } catch (e) { return err(e.message, 500); }
  }
});
// ============================================================
// COMPETENCIAS
// ============================================================
app.http('getCompetencies', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'competencies',
  handler: async (req) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return err('No autorizado', 401);
      const type = req.query.get('type') || null;
      const res = await query(
        `SELECT c.*, a.AreaName FROM Competencies c LEFT JOIN Areas a ON c.AreaID=a.AreaID
         WHERE c.IsActive=1 AND (@type IS NULL OR c.CompetencyType=@type) ORDER BY c.SortOrder`,
        { type }
      );
      return ok(res.recordset);
    } catch (e) { return err(e.message, 500); }
  }
});
app.http('getEvaluation', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'competencies/evaluation/{userId}/{periodId}',
  handler: async (req) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return err('No autorizado', 401);
      const res = await query(
        `SELECT * FROM vw_CompetencyReport WHERE UserID=@uid
         AND PeriodName=(SELECT PeriodName FROM FiscalPeriods WHERE PeriodID=@pid)`,
        { uid: parseInt(req.params.userId), pid: parseInt(req.params.periodId) }
      );
      return ok(res.recordset);
    } catch (e) { return err(e.message, 500); }
  }
});
app.http('saveEvaluation', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'competencies/evaluation',
  handler: async (req) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return err('No autorizado', 401);
      const body = await req.json();
      await query(
        `IF EXISTS (SELECT 1 FROM UserCompetencyEvaluations WHERE UserID=@uid AND CompetencyID=@cid AND PeriodID=@pid)
         UPDATE UserCompetencyEvaluations SET ScaleID=@scaleId,Score=@score,Feedback=@feedback,EvaluatedBy=@evalBy,EvalDate=CAST(GETDATE() AS DATE)
         WHERE UserID=@uid AND CompetencyID=@cid AND PeriodID=@pid
         ELSE INSERT INTO UserCompetencyEvaluations (UserID,CompetencyID,PeriodID,ScaleID,Score,Feedback,EvaluatedBy)
         VALUES (@uid,@cid,@pid,@scaleId,@score,@feedback,@evalBy)`,
        { uid: body.userId, cid: body.competencyId, pid: body.periodId,
          scaleId: body.scaleId||null, score: body.score, feedback: body.feedback||null, evalBy: user.UserID }
      );
      return ok({ saved: true });
    } catch (e) { return err(e.message, 500); }
  }
});
// ============================================================
// REUNIONES 1:1
// ============================================================
app.http('getMeetings', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'meetings/{employeeId}',
  handler: async (req) => {
    try {
      const empId = parseInt(req.params.employeeId);
      // Intento 1: filtrar IsDeleted
      let res;
      try {
        res = await query(
          `SELECT m.*, n.NoteID, n.NoteText, n.NoteType, n.IsPrivate, n.ObjectiveID
           FROM OneOnOneMeetings m LEFT JOIN OneOnOneNotes n ON m.MeetingID=n.MeetingID
           WHERE m.EmployeeID=@empId
             AND (m.IsDeleted IS NULL OR m.IsDeleted = 0)
           ORDER BY m.MeetingDate DESC`,
          { empId }
        );
      } catch(e1) {
        // Fallback: sin filtro si la columna no existe
        res = await query(
          `SELECT m.*, n.NoteID, n.NoteText, n.NoteType, n.IsPrivate, n.ObjectiveID
           FROM OneOnOneMeetings m LEFT JOIN OneOnOneNotes n ON m.MeetingID=n.MeetingID
           WHERE m.EmployeeID=@empId
           ORDER BY m.MeetingDate DESC`,
          { empId }
        );
      }
      const meetings = {};
      for (const row of res.recordset) {
        if (!meetings[row.MeetingID]) {
          meetings[row.MeetingID] = { ...row, notes: [] };
          delete meetings[row.MeetingID].NoteID;
          delete meetings[row.MeetingID].NoteText;
          delete meetings[row.MeetingID].NoteType;
        }
        if (row.NoteID) {
          meetings[row.MeetingID].notes.push({ noteId: row.NoteID, noteText: row.NoteText, noteType: row.NoteType, isPrivate: row.IsPrivate, objectiveId: row.ObjectiveID });
        }
      }
      return ok(Object.values(meetings));
    } catch (e) { return err(e.message, 500); }
  }
});
app.http('createMeeting', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'meetings',
  handler: async (req) => {
    try {
      const body = await req.json();
      // Intentar auth, si falla usar leaderId del body
      let leaderID = body.leaderId || body.LeaderID || 1;
      try {
        const user = await getAuthUser(req);
        if (user) leaderID = user.UserID;
      } catch(e) {}
      const res = await execute('sp_SaveOneOnOneMeeting', {
        MeetingID: null, LeaderID: leaderID, EmployeeID: body.employeeId,
        MeetingDate: body.meetingDate, MeetingType: body.meetingType||'monthly',
        Title: body.title||null, GeneralNotes: body.generalNotes||null,
        NextSteps: body.nextSteps||null, Status: body.status||'completed'
      });
      const meetingId = res.recordset[0].NewMeetingID;
      if (body.notes && body.notes.length > 0) {
        for (const note of body.notes) {
          await query(
            `INSERT INTO OneOnOneNotes (MeetingID,NoteType,ObjectiveID,NoteText,IsPrivate) VALUES (@mid,@type,@objId,@text,@priv)`,
            { mid: meetingId, type: note.noteType||'general', objId: note.objectiveId||null, text: note.noteText, priv: note.isPrivate||0 }
          );
        }
      }
      if (body.sendEmail) await sendMinuteEmail(meetingId, user, body);
      return ok({ meetingId });
    } catch (e) { return err(e.message, 500); }
  }
});
// ============================================================
// ALERTAS
// ============================================================
app.http('getAlerts', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'alerts',
  handler: async (req) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return err('No autorizado', 401);
      const res = await query(
        `SELECT a.* FROM vw_ActiveAlerts a
         INNER JOIN UserRelationships ur ON a.UserID=ur.EmployeeID
         WHERE ur.LeaderID=@uid OR ur.ManagerID=@uid ORDER BY a.CreatedAt DESC`,
        { uid: user.UserID }
      );
      return ok(res.recordset);
    } catch (e) { return err(e.message, 500); }
  }
});
app.http('generateAlerts', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'alerts/generate',
  handler: async (req) => {
    try {
      const user = await getAuthUser(req);
      if (!user || !['manager','admin'].includes(user.AppRole)) return err('Sin permisos', 403);
      const body = await req.json();
      await execute('sp_GenerateAlerts', { PeriodID: body.periodId, Threshold: body.threshold||70 });
      return ok({ generated: true });
    } catch (e) { return err(e.message, 500); }
  }
});
app.http('resolveAlert', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: 'alerts/{id}/resolve',
  handler: async (req) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return err('No autorizado', 401);
      await query(`UPDATE Alerts SET IsResolved=1,ResolvedAt=GETDATE() WHERE AlertID=@id`, { id: parseInt(req.params.id) });
      return ok({ resolved: true });
    } catch (e) { return err(e.message, 500); }
  }
});
// ============================================================
// CONFIGURACIÓN
// ============================================================
app.http('getConfig', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'config',
  handler: async (req) => {
    try {
      const user = await getAuthUser(req);
      if (!user || user.AppRole !== 'admin') return err('Sin permisos', 403);
      const res = await query(`SELECT ConfigKey,Description,UpdatedAt FROM AppConfig WHERE ConfigKey NOT IN ('SQL_PASSWORD','CLAUDE_API_KEY','AZURE_CLIENT_SECRET','SMTP_PASSWORD')`);
      return ok(res.recordset);
    } catch (e) { return err(e.message, 500); }
  }
});
app.http('saveConfig', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: 'config',
  handler: async (req) => {
    try {
      const user = await getAuthUser(req);
      if (!user || user.AppRole !== 'admin') return err('Sin permisos', 403);
      const body = await req.json();
      await query(`UPDATE AppConfig SET ConfigValue=@val,UpdatedAt=GETDATE(),UpdatedBy=@by WHERE ConfigKey=@key`, { key: body.key, val: body.value, by: user.Email });
      return ok({ saved: true });
    } catch (e) { return err(e.message, 500); }
  }
});
// ============================================================
// ORGANIGRAMA
// ============================================================
app.http('orgChart', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'orgchart/{rootUserId}',
  handler: async (req) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return err('No autorizado', 401);
      const res = await execute('sp_GetOrgChart', { RootUserID: parseInt(req.params.rootUserId) });
      return ok(res.recordset);
    } catch (e) { return err(e.message, 500); }
  }
});
// ============================================================
// IMPORTACIÓN
// ============================================================
app.http('importUsers', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'import/users',
  handler: async (req) => {
    try {
      const user = await getAuthUser(req);
      if (!user || !['manager','admin'].includes(user.AppRole)) return err('Sin permisos', 403);
      const body = await req.json();
      let success = 0, errors = [];
      for (const row of body.rows) {
        try {
          await execute('sp_ImportUsers', {
            Email: row.email, FullName: row.full_name, RoleName: row.role_name,
            AreaName: row.area_name, AppRole: row.app_role||'employee',
            LeaderEmail: row.leader_email||null, ManagerEmail: row.manager_email||null,
            ProjectName: row.project_name||null, HireDate: row.hire_date||null, ImportedBy: user.UserID
          });
          success++;
        } catch (e) { errors.push({ row: row.email, error: e.message }); }
      }
      await query(
        `INSERT INTO ImportLog (FileName,ImportType,TotalRows,SuccessRows,ErrorRows,ErrorDetails,ImportedBy)
         VALUES (@fn,'users',@total,@ok,@err,@det,@by)`,
        { fn: 'import_'+new Date().toISOString().slice(0,10), total: body.rows.length, ok: success, err: errors.length, det: errors.length?JSON.stringify(errors):null, by: user.UserID }
      );
      return ok({ total: body.rows.length, success, errors });
    } catch (e) { return err(e.message, 500); }
  }
});
// ============================================================
// EMAIL
// ============================================================
async function sendMinuteEmail(meetingId, leader, body) {
  try {
    const nodemailer = require('nodemailer');
    const transport = nodemailer.createTransport({
      host: process.env.SMTP_SERVER, port: parseInt(process.env.SMTP_PORT||'587'),
      secure: false, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
    });
    const empRes = await query(`SELECT Email,FullName FROM Users WHERE UserID=@id`, { id: body.employeeId });
    const emp = empRes.recordset[0];
    if (!emp) return;
    const html = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
      <div style="background:#1B3A5C;padding:20px;border-radius:8px 8px 0 0">
        <h2 style="color:#fff;margin:0">PeopleTrack — Minuta de Reunión 1:1</h2></div>
      <div style="padding:24px;border:1px solid #e0e0e0;border-top:none;border-radius:0 0 8px 8px">
        <p><strong>Colaborador:</strong> ${emp.FullName}</p>
        <p><strong>Líder:</strong> ${leader.name}</p>
        <p><strong>Fecha:</strong> ${body.meetingDate}</p>
        <hr style="border:none;border-top:1px solid #eee;margin:16px 0">
        <h3 style="color:#1B3A5C">Notas generales</h3>
        <p>${(body.generalNotes||'').replace(/\n/g,'<br>')}</p>
        ${body.nextSteps?`<h3 style="color:#1B3A5C">Próximos pasos</h3><p>${body.nextSteps.replace(/\n/g,'<br>')}</p>`:''}
        <p style="color:#888;font-size:12px">Enviado desde PeopleTrack · ${new Date().toLocaleDateString('es-AR')}</p>
      </div></div>`;
    await transport.sendMail({
      from: process.env.EMAIL_SENDER||process.env.SMTP_USER,
      to: emp.Email,
      subject: `Minuta 1:1 — ${body.meetingDate} — ${emp.FullName}`,
      html
    });
    await query(`UPDATE OneOnOneMeetings SET SendMinuteEmail=1,MinuteSentAt=GETDATE() WHERE MeetingID=@id`, { id: meetingId });
  } catch (e) { console.error('Error email:', e.message); }
}

// ============================================================
// ÁREAS
// ============================================================
app.http('getAreas', {
  methods: ['GET'], authLevel: 'anonymous', route: 'areas',
  handler: async (req) => {
    try {
      const res = await query(`SELECT AreaID, AreaName, Description, IsActive FROM Areas ORDER BY AreaName`);
      return ok(res.recordset);
    } catch (e) { return err(e.message, 500); }
  }
});
app.http('createArea', {
  methods: ['POST'], authLevel: 'anonymous', route: 'manage/areas',
  handler: async (req) => {
    try {
      const body = await req.json();
      const name = (body.areaName || body.AreaName || '').trim();
      const desc = (body.description || body.Description || '').trim();
      if (!name) return err('Nombre requerido', 400);
      const exists = await query(`SELECT 1 FROM Areas WHERE AreaName=@name`, { name });
      if (exists.recordset.length) return err('Ya existe', 400);
      const res = await query(
        `INSERT INTO Areas (AreaName,Description,IsActive) OUTPUT INSERTED.AreaID VALUES (@name,@desc,1)`,
        { name, desc }
      );
      return ok({ AreaID: res.recordset[0].AreaID, AreaName: name, IsActive: true });
    } catch (e) { return err(e.message, 500); }
  }
});
app.http('updateArea', {
  methods: ['PUT'], authLevel: 'anonymous', route: 'manage/areas/{id}',
  handler: async (req) => {
    try {
      const body = await req.json();
      const areaID = parseInt(req.params.id);
      const fields = [], params = { id: areaID };
      if (body.AreaName    !== undefined) { fields.push('AreaName=@name');    params.name   = body.AreaName; }
      if (body.Description !== undefined) { fields.push('Description=@desc'); params.desc   = body.Description; }
      if (body.IsActive    !== undefined) { fields.push('IsActive=@active');  params.active = body.IsActive ? 1 : 0; }
      if (!fields.length) return err('Nada que actualizar', 400);
      await query(`UPDATE Areas SET ${fields.join(',')} WHERE AreaID=@id`, params);
      return ok({ updated: true });
    } catch (e) { return err(e.message, 500); }
  }
});

// ============================================================
// PERÍODOS — crear y editar
// ============================================================
app.http('createPeriod', {
  methods: ['POST'], authLevel: 'anonymous', route: 'manage/periods',
  handler: async (req) => {
    try {
      const body = await req.json();
      const name   = (body.periodName || body.PeriodName || '').trim();
      const start  = body.startDate || body.StartDate || null;
      const end    = body.endDate   || body.EndDate   || null;
      const active = body.isActive  !== undefined ? (body.isActive ? 1 : 0) : 1;
      if (!name) return err('Nombre requerido', 400);
      const res = await query(
        `INSERT INTO FiscalPeriods (PeriodName, StartDate, EndDate, IsActive, CreatedAt)
         OUTPUT INSERTED.PeriodID
         VALUES (@name, @start, @end, @active, GETDATE())`,
        { name, start, end, active }
      );
      return ok({ PeriodID: res.recordset[0].PeriodID, PeriodName: name, IsActive: active===1 });
    } catch (e) { return err(e.message, 500); }
  }
});

app.http('updatePeriod', {
  methods: ['PUT'], authLevel: 'anonymous', route: 'manage/periods/{id}',
  handler: async (req) => {
    try {
      const body = await req.json();
      const id   = parseInt(req.params.id);
      const fields = [], params = { id };
      if (body.periodName !== undefined) { fields.push('PeriodName=@name');   params.name   = body.periodName; }
      if (body.startDate  !== undefined) { fields.push('StartDate=@start');   params.start  = body.startDate; }
      if (body.endDate    !== undefined) { fields.push('EndDate=@end');       params.end    = body.endDate; }
      if (body.isActive   !== undefined) { fields.push('IsActive=@active');   params.active = body.isActive ? 1 : 0; }
      if (!fields.length) return err('Nada que actualizar', 400);
      await query(`UPDATE FiscalPeriods SET ${fields.join(',')} WHERE PeriodID=@id`, params);
      return ok({ updated: true });
    } catch (e) { return err(e.message, 500); }
  }
});

// GET /api/periods/all — todos (activos e inactivos)
app.http('getAllPeriods', {
  methods: ['GET'], authLevel: 'anonymous', route: 'periods/all',
  handler: async (req) => {
    try {
      const res = await query('SELECT * FROM FiscalPeriods ORDER BY StartDate DESC');
      return ok(res.recordset);
    } catch (e) { return err(e.message, 500); }
  }
});

// ============================================================
// FEEDBACK 360
// ============================================================
app.http('createFeedback360', {
  methods: ['POST'], authLevel: 'anonymous', route: 'feedback360',
  handler: async (req) => {
    try {
      const body = await req.json();
      const { evaluatorId, evaluatedId, periodId, category, score, comment, isAnonymous } = body;
      if (!evaluatorId || !evaluatedId) return err('Datos incompletos', 400);
      if (score < 1 || score > 5) return err('Score debe ser 1-5', 400);
      const res = await query(
        `INSERT INTO Feedback360 (EvaluatorID, EvaluatedID, PeriodID, Category, Score, Comment, IsAnonymous)
         OUTPUT INSERTED.FeedbackID
         VALUES (@evId, @evedId, @perId, @cat, @score, @comment, @anon)`,
        { evId: evaluatorId, evedId: evaluatedId, perId: periodId||null,
          cat: category||'general', score, comment: comment||null, anon: isAnonymous?1:0 }
      );
      return ok({ feedbackId: res.recordset[0].FeedbackID });
    } catch(e) { return err(e.message, 500); }
  }
});

app.http('getFeedbackReceived', {
  methods: ['GET'], authLevel: 'anonymous', route: 'feedback360/received/{userId}',
  handler: async (req) => {
    try {
      // Solo admins pueden ver feedback individual
      let isAdmin = false;
      try {
        const user = await getAuthUser(req);
        if (user && user.AppRole === 'admin') isAdmin = true;
      } catch(e) {}
      
      const userId = parseInt(req.params.userId);
      const periodId = req.query.get('periodId') || null;
      
      const res = await query(
        `SELECT 
          f.FeedbackID, f.Category, f.Score, f.Comment, f.IsAnonymous,
          f.CreatedAt, f.PeriodID,
          fp.PeriodName,
          CASE WHEN f.IsAnonymous = 1 THEN 'Anónimo' 
               ELSE u.FullName END AS EvaluatorName,
          CASE WHEN f.IsAnonymous = 1 THEN NULL 
               ELSE u.Email END AS EvaluatorEmail
         FROM Feedback360 f
         LEFT JOIN Users u ON f.EvaluatorID = u.UserID
         LEFT JOIN FiscalPeriods fp ON f.PeriodID = fp.PeriodID
         WHERE f.EvaluatedID = @uid
           AND (@perId IS NULL OR f.PeriodID = @perId)
         ORDER BY f.CreatedAt DESC`,
        { uid: userId, perId: periodId }
      );
      
      // Si no es admin, solo devolver promedios (sin nombres ni comentarios)
      if (!isAdmin) {
        const rows = res.recordset;
        const byCategory = {};
        rows.forEach(r => {
          if (!byCategory[r.Category]) byCategory[r.Category] = { scores: [], count: 0 };
          byCategory[r.Category].scores.push(r.Score);
          byCategory[r.Category].count++;
        });
        const summary = Object.entries(byCategory).map(([cat, data]) => ({
          category: cat,
          avgScore: Math.round(data.scores.reduce((a,b)=>a+b,0)/data.scores.length * 10) / 10,
          count: data.count
        }));
        return ok({ summary, totalResponses: rows.length, isAdmin: false });
      }
      
      return ok({ feedback: res.recordset, totalResponses: res.recordset.length, isAdmin: true });
    } catch(e) { return err(e.message, 500); }
  }
});

app.http('getFeedbackGiven', {
  methods: ['GET'], authLevel: 'anonymous', route: 'feedback360/given/{userId}',
  handler: async (req) => {
    try {
      const userId = parseInt(req.params.userId);
      const res = await query(
        `SELECT f.FeedbackID, f.Category, f.Score, f.Comment, f.IsAnonymous,
                f.CreatedAt, u.FullName AS EvaluatedName, fp.PeriodName
         FROM Feedback360 f
         LEFT JOIN Users u ON f.EvaluatedID = u.UserID
         LEFT JOIN FiscalPeriods fp ON f.PeriodID = fp.PeriodID
         WHERE f.EvaluatorID = @uid
         ORDER BY f.CreatedAt DESC`,
        { uid: userId }
      );
      return ok(res.recordset);
    } catch(e) { return err(e.message, 500); }
  }
});

app.http('getFeedbackSummary', {
  methods: ['GET'], authLevel: 'anonymous', route: 'feedback360/summary',
  handler: async (req) => {
    try {
      // Solo admins
      let isAdmin = false;
      try { const u = await getAuthUser(req); if(u?.AppRole==='admin') isAdmin=true; } catch(e) {}
      if (!isAdmin) return err('Sin permisos', 403);
      
      const periodId = req.query.get('periodId') || null;
      const res = await query(
        `SELECT 
          u.UserID, u.FullName, u.AppRole,
          COUNT(f.FeedbackID) AS TotalFeedbacks,
          AVG(CAST(f.Score AS FLOAT)) AS AvgScore,
          SUM(CASE WHEN f.IsAnonymous=1 THEN 1 ELSE 0 END) AS AnonCount
         FROM Users u
         LEFT JOIN Feedback360 f ON u.UserID = f.EvaluatedID
           AND (@perId IS NULL OR f.PeriodID = @perId)
         WHERE u.AppRole IN ('leader','manager')
         GROUP BY u.UserID, u.FullName, u.AppRole
         ORDER BY AvgScore DESC`,
        { perId: periodId }
      );
      return ok(res.recordset);
    } catch(e) { return err(e.message, 500); }
  }
});

// ============================================================
// HELP ARTICLES
// ============================================================
app.http('getHelpArticles', {
  methods: ['GET'], authLevel: 'anonymous', route: 'help/articles',
  handler: async (req) => {
    try {
      const section = req.query.get('section') || null;
      const res = await query(
        `SELECT ArticleID, Section, Title, Content, SortOrder, UpdatedAt
         FROM HelpArticles
         WHERE (@section IS NULL OR Section = @section)
         ORDER BY SortOrder ASC`,
        { section }
      );
      return ok(res.recordset);
    } catch(e) { return err(e.message, 500); }
  }
});

app.http('updateHelpArticle', {
  methods: ['PUT'], authLevel: 'anonymous', route: 'help/articles/{id}',
  handler: async (req) => {
    try {
      let isAdmin = false;
      try { const u = await getAuthUser(req); if(u?.AppRole==='admin') isAdmin=true; } catch(e) {}
      if (!isAdmin) return err('Sin permisos', 403);
      const body = await req.json();
      const id = parseInt(req.params.id);
      await query(
        `UPDATE HelpArticles SET Title=@title, Content=@content, UpdatedBy=@by
         WHERE ArticleID=@id`,
        { title: body.title, content: body.content, by: body.updatedBy||'admin', id }
      );
      return ok({ updated: true });
    } catch(e) { return err(e.message, 500); }
  }
});

// ============================================================
// NOTAS DE EMPLEADO EN OBJETIVOS
// ============================================================
app.http('saveEmployeeNote', {
  methods: ['PUT'], authLevel: 'anonymous', route: 'objectives/{id}/note',
  handler: async (req) => {
    try {
      const body = await req.json();
      const id = parseInt(req.params.id);
      await query(
        `UPDATE Objectives SET EmployeeNotes=@notes, EmployeeNoteDate=GETDATE()
         WHERE ObjectiveID=@id`,
        { notes: body.note||'', id }
      );
      return ok({ saved: true });
    } catch(e) { return err(e.message, 500); }
  }
});

// ============================================================
// PIP - PLAN DE IMPROVEMENT
// ============================================================
app.http('getPIPs', {
  methods: ['GET'], authLevel: 'anonymous', route: 'pips',
  handler: async (req) => {
    try {
      const employeeId = req.query.get('employeeId') || null;
      const includeDeleted = req.query.get('includeDeleted') === '1';
      // Filtro defensivo: excluye PIPs con Status='deleted' (soft-delete actual)
      // y opcionalmente IsDeleted=1 si la columna existe
      let res;
      try {
        res = await query(
          `SELECT p.PIPID, p.Reason, p.StartDate, p.Target15Days, p.Target30Days, p.Target60Days,
                  p.Milestones, p.ReviewNotes, p.Achieved, p.Status, p.CreatedAt,
                  e.FullName AS EmployeeName, e.Email AS EmployeeEmail,
                  c.FullName AS CreatedByName
           FROM PIPs p
           JOIN Users e ON p.EmployeeID = e.UserID
           JOIN Users c ON p.CreatedByID = c.UserID
           WHERE (@eid IS NULL OR p.EmployeeID = @eid)
             AND (@inc = 1 OR (p.Status <> 'deleted' AND (p.IsDeleted IS NULL OR p.IsDeleted = 0)))
           ORDER BY p.CreatedAt DESC`,
          { eid: employeeId, inc: includeDeleted ? 1 : 0 }
        );
      } catch(e1) {
        // Fallback si IsDeleted no existe en la tabla
        res = await query(
          `SELECT p.PIPID, p.Reason, p.StartDate, p.Target15Days, p.Target30Days, p.Target60Days,
                  p.Milestones, p.ReviewNotes, p.Achieved, p.Status, p.CreatedAt,
                  e.FullName AS EmployeeName, e.Email AS EmployeeEmail,
                  c.FullName AS CreatedByName
           FROM PIPs p
           JOIN Users e ON p.EmployeeID = e.UserID
           JOIN Users c ON p.CreatedByID = c.UserID
           WHERE (@eid IS NULL OR p.EmployeeID = @eid)
             AND (@inc = 1 OR p.Status <> 'deleted')
           ORDER BY p.CreatedAt DESC`,
          { eid: employeeId, inc: includeDeleted ? 1 : 0 }
        );
      }
      return ok(res.recordset);
    } catch(e) { return err(e.message, 500); }
  }
});

app.http('createPIP', {
  methods: ['POST'], authLevel: 'anonymous', route: 'pips',
  handler: async (req) => {
    try {
      const b = await req.json();
      const res = await query(
        `INSERT INTO PIPs (EmployeeID, CreatedByID, Reason, StartDate, Target15Days, Target30Days, Target60Days, Milestones, Status)
         OUTPUT INSERTED.PIPID
         VALUES (@emp, @by, @reason, @start, @t15, @t30, @t60, @milestones, 'active')`,
        { emp: b.employeeId, by: b.createdById, reason: b.reason, start: b.startDate,
          t15: b.target15||null, t30: b.target30||null, t60: b.target60||null,
          milestones: b.milestones||null }
      );
      return ok({ pipId: res.recordset[0].PIPID });
    } catch(e) { return err(e.message, 500); }
  }
});

app.http('updatePIP', {
  methods: ['PUT'], authLevel: 'anonymous', route: 'pips/{id}',
  handler: async (req) => {
    try {
      const b = await req.json();
      const id = parseInt(req.params.id);
      await query(
        `UPDATE PIPs SET ReviewNotes=@notes, Achieved=@achieved, Status=@status
         WHERE PIPID=@id`,
        { notes: b.reviewNotes||null, achieved: b.achieved!=null?b.achieved:null, status: b.status||'active', id }
      );
      return ok({ updated: true });
    } catch(e) { return err(e.message, 500); }
  }
});

// ─── DELETE /pips/:id (soft delete) ────────────────────
app.http('deletePIP', {
  methods: ['DELETE'], authLevel: 'anonymous', route: 'pips/{id}',
  handler: async (req) => {
    try {
      const id = parseInt(req.params.id);
      // Intento 1: usar columna IsDeleted (más limpio)
      try {
        await query(
          `UPDATE PIPs SET IsDeleted=1, Status='deleted' WHERE PIPID=@id`,
          { id }
        );
        return ok({ deleted: true, method: 'isdeleted' });
      } catch(e1) {
        // Fallback: solo actualizar Status (compatible con esquema actual)
        await query(
          `UPDATE PIPs SET Status='deleted' WHERE PIPID=@id`,
          { id }
        );
        return ok({ deleted: true, method: 'status' });
      }
    } catch(e) { return err(e.message, 500); }
  }
});

// ============================================================
// CAMBIOS DE ROL / PROYECTO / LIDER
// ============================================================
app.http('getRoleChanges', {
  methods: ['GET'], authLevel: 'anonymous', route: 'rolechanges',
  handler: async (req) => {
    try {
      const res = await query(
        `SELECT rc.ChangeID, rc.ChangeType, rc.NewRole, rc.ChangeDate, rc.Observations, rc.Status, rc.CreatedAt,
                e.FullName AS EmployeeName, e.Email AS EmployeeEmail,
                r.FullName AS RequestedByName,
                nl.FullName AS NewLeaderName,
                nm.FullName AS NewManagerName
         FROM RoleChanges rc
         JOIN Users e  ON rc.EmployeeID    = e.UserID
         JOIN Users r  ON rc.RequestedByID = r.UserID
         LEFT JOIN Users nl ON rc.NewLeaderID  = nl.UserID
         LEFT JOIN Users nm ON rc.NewManagerID = nm.UserID
         ORDER BY rc.CreatedAt DESC`
      );
      return ok(res.recordset);
    } catch(e) { return err(e.message, 500); }
  }
});

app.http('createRoleChange', {
  methods: ['POST'], authLevel: 'anonymous', route: 'rolechanges',
  handler: async (req) => {
    try {
      const b = await req.json();
      const res = await query(
        `INSERT INTO RoleChanges (EmployeeID, RequestedByID, ChangeType, NewRole, NewLeaderID, NewManagerID, ChangeDate, Observations, Status)
         OUTPUT INSERTED.ChangeID
         VALUES (@emp, @by, @type, @role, @leader, @manager, @date, @obs, 'pending')`,
        { emp: b.employeeId, by: b.requestedById, type: b.changeType, role: b.newRole||null,
          leader: b.newLeaderId||null, manager: b.newManagerId||null,
          date: b.changeDate, obs: b.observations||null }
      );
      return ok({ changeId: res.recordset[0].ChangeID });
    } catch(e) { return err(e.message, 500); }
  }
});

app.http('updateRoleChange', {
  methods: ['PUT'], authLevel: 'anonymous', route: 'rolechanges/{id}',
  handler: async (req) => {
    try {
      const b = await req.json();
      const id = parseInt(req.params.id);
      await query(
        `UPDATE RoleChanges SET Status=@status WHERE ChangeID=@id`,
        { status: b.status, id }
      );
      return ok({ updated: true });
    } catch(e) { return err(e.message, 500); }
  }
});

// ============================================================
// ONBOARDING - ENDPOINTS
// ============================================================
app.http('getOnboardingPlans', {
  methods: ['GET'], authLevel: 'anonymous', route: 'onboarding',
  handler: async (req) => {
    try {
      const res = await query(
        `SELECT op.OnboardingID, op.StartDate, op.TargetEndDate, op.Status, op.RoleDescription,
                u.UserID, u.FullName AS EmployeeName, u.Email AS EmployeeEmail,
                hr.FullName AS AssignedToName,
                (SELECT COUNT(*) FROM OnboardingMilestones om WHERE om.OnboardingID=op.OnboardingID) AS TotalMilestones,
                (SELECT COUNT(*) FROM OnboardingMilestones om WHERE om.OnboardingID=op.OnboardingID AND om.IsCompleted=1) AS CompletedMilestones,
                (SELECT COUNT(*) FROM OnboardingCourses oc WHERE oc.OnboardingID=op.OnboardingID) AS TotalCourses,
                (SELECT COUNT(*) FROM OnboardingCourses oc WHERE oc.OnboardingID=op.OnboardingID AND oc.IsCompleted=1) AS CompletedCourses
         FROM OnboardingPlans op
         JOIN Users u ON op.UserID=u.UserID
         LEFT JOIN Users hr ON op.AssignedToID=hr.UserID
         ORDER BY op.OnboardingID DESC`
      );
      return ok(res.recordset);
    } catch(e) { return err(e.message, 500); }
  }
});

app.http('getOnboardingDetail', {
  methods: ['GET'], authLevel: 'anonymous', route: 'onboarding/{id}',
  handler: async (req) => {
    try {
      const id = parseInt(req.params.id);
      const [plan, milestones, courses] = await Promise.all([
        query(`SELECT op.*, u.FullName AS EmployeeName, u.Email AS EmployeeEmail, hr.FullName AS AssignedToName
               FROM OnboardingPlans op JOIN Users u ON op.UserID=u.UserID LEFT JOIN Users hr ON op.AssignedToID=hr.UserID
               WHERE op.OnboardingID=@id`, { id }),
        query(`SELECT * FROM OnboardingMilestones WHERE OnboardingID=@id ORDER BY SortOrder`, { id }),
        query(`SELECT * FROM OnboardingCourses WHERE OnboardingID=@id ORDER BY CourseID`, { id })
      ]);
      if (!plan.recordset.length) return err('Not found', 404);
      return ok({ plan: plan.recordset[0], milestones: milestones.recordset, courses: courses.recordset });
    } catch(e) { return err(e.message, 500); }
  }
});

app.http('createOnboarding', {
  methods: ['POST'], authLevel: 'anonymous', route: 'onboarding',
  handler: async (req) => {
    try {
      const b = await req.json();
      const res = await query(
        `INSERT INTO OnboardingPlans (UserID, CandidateID, StartDate, TargetEndDate, Status, RoleDescription, AssignedToID)
         OUTPUT INSERTED.OnboardingID
         VALUES (@uid, @cid, @start, @end, 'in_progress', @role, @assigned)`,
        { uid: b.userId, cid: b.candidateId||null, start: b.startDate,
          end: b.targetEndDate||null, role: b.roleDescription||null, assigned: b.assignedToId||null }
      );
      const obId = res.recordset[0].OnboardingID;
      // Milestones por defecto
      const defaultMilestones = [
        { title: 'Documentaci\xf3n legal firmada', type: 'documentation', days: 3, order: 1 },
        { title: 'Accesos al sistema otorgados', type: 'access', days: 5, order: 2 },
        { title: 'Entendimiento del proceso de onboarding', type: 'understanding', days: 7, order: 3 },
        { title: 'Descriptivo del rol presentado', type: 'documentation', days: 7, order: 4 },
        { title: 'Preocupacional realizado', type: 'documentation', days: 15, order: 5 },
        { title: 'Psicot\xe9cnico realizado', type: 'documentation', days: 15, order: 6 },
      ];
      for (const m of defaultMilestones) {
        await query(
          `INSERT INTO OnboardingMilestones (OnboardingID,Title,MilestoneType,DueDate,SortOrder) VALUES (@id,@t,@mt,DATEADD(DAY,@d,GETDATE()),@so)`,
          { id: obId, t: m.title, mt: m.type, d: m.days, so: m.order }
        );
      }
      await query(`INSERT INTO OnboardingCourses (OnboardingID,CourseName,CourseType,IsRequired) VALUES (@id,'Seguridad Inform\xe1tica','security',1)`, { id: obId });
      await query(`INSERT INTO OnboardingCourses (OnboardingID,CourseName,CourseType,IsRequired) VALUES (@id,'Microsoft Copilot','copilot',1)`, { id: obId });
      return ok({ onboardingId: obId });
    } catch(e) { return err(e.message, 500); }
  }
});

app.http('updateMilestoneOnboarding', {
  methods: ['PUT'], authLevel: 'anonymous', route: 'onboarding/milestone/{id}',
  handler: async (req) => {
    try {
      const b = await req.json();
      const id = parseInt(req.params.id);
      await query(
        `UPDATE OnboardingMilestones SET 
          IsCompleted=@completed, CompletedAt=CASE WHEN @completed=1 THEN GETDATE() ELSE NULL END,
          EmployeeComment=COALESCE(@comment, EmployeeComment),
          FileData=COALESCE(@fileData, FileData), FileName=COALESCE(@fileName, FileName), FileType=COALESCE(@fileType, FileType)
         WHERE MilestoneID=@id`,
        { completed: b.isCompleted?1:0, comment: b.comment||null,
          fileData: b.fileData||null, fileName: b.fileName||null, fileType: b.fileType||null, id }
      );
      return ok({ updated: true });
    } catch(e) { return err(e.message, 500); }
  }
});

app.http('updateCourseOnboarding', {
  methods: ['PUT'], authLevel: 'anonymous', route: 'onboarding/course/{id}',
  handler: async (req) => {
    try {
      const b = await req.json();
      const id = parseInt(req.params.id);
      await query(
        `UPDATE OnboardingCourses SET
          IsCompleted=@completed, CompletedAt=CASE WHEN @completed=1 THEN GETDATE() ELSE NULL END,
          Score=COALESCE(@score,Score), EmployeeComment=COALESCE(@comment,EmployeeComment),
          CertificatePath=COALESCE(@cert,CertificatePath)
         WHERE CourseID=@id`,
        { completed: b.isCompleted?1:0, score: b.score||null, comment: b.comment||null, cert: b.certificatePath||null, id }
      );
      return ok({ updated: true });
    } catch(e) { return err(e.message, 500); }
  }
});

app.http('updateOnboardingStatus', {
  methods: ['PUT'], authLevel: 'anonymous', route: 'onboarding/{id}',
  handler: async (req) => {
    try {
      const b = await req.json();
      const id = parseInt(req.params.id);
      await query(`UPDATE OnboardingPlans SET Status=@status WHERE OnboardingID=@id`,
        { status: b.status, id });
      return ok({ updated: true });
    } catch(e) { return err(e.message, 500); }
  }
});

// ============================================================
// CANDIDATES - RECRUITING
// ============================================================
app.http('getCandidates', {
  methods: ['GET'], authLevel: 'anonymous', route: 'candidates',
  handler: async (req) => {
    try {
      const status = req.query.get('status') || null;
      const res = await query(
        `SELECT c.CandidateID, c.FullName, c.Email, c.Phone, c.SourceType,
                c.TechStack, c.SalaryExpectation, c.Currency, c.AvailableFrom,
                c.HasPrepaga, c.Notes, c.Status, c.RejectionReason, c.CreatedAt,
                u.FullName AS AssignedToName,
                (SELECT COUNT(*) FROM CandidateInterviews ci WHERE ci.CandidateID=c.CandidateID) AS TotalInterviews
         FROM Candidates c
         LEFT JOIN Users u ON c.AssignedToID=u.UserID
         WHERE (@status IS NULL OR c.Status=@status)
         ORDER BY c.CandidateID DESC`,
        { status }
      );
      return ok(res.recordset);
    } catch(e) { return err(e.message, 500); }
  }
});

app.http('createCandidate', {
  methods: ['POST'], authLevel: 'anonymous', route: 'candidates',
  handler: async (req) => {
    try {
      const b = await req.json();
      const res = await query(
        `INSERT INTO Candidates (FullName, Email, Phone, SourceType, TechStack, SalaryExpectation, Currency, AvailableFrom, Notes, AssignedToID, Status)
         OUTPUT INSERTED.CandidateID
         VALUES (@name, @email, @phone, @source, @stack, @salary, @currency, @available, @notes, @assigned, 'screening')`,
        { name: b.fullName, email: b.email||null, phone: b.phone||null,
          source: b.sourceType||'Directo', stack: b.techStack||null,
          salary: b.salaryExpectation||null, currency: b.currency||'USD',
          available: b.availableFrom||null, notes: b.notes||null,
          assigned: b.assignedToId||null }
      );
      const candId = res.recordset[0].CandidateID;
      await query(
        `INSERT INTO CandidateHistory (CandidateID, ChangedByID, OldStatus, NewStatus, Note)
         VALUES (@cid, @by, NULL, 'screening', 'Candidato creado')`,
        { cid: candId, by: b.assignedToId||1 }
      );
      return ok({ candidateId: candId });
    } catch(e) { return err(e.message, 500); }
  }
});

app.http('advanceCandidate', {
  methods: ['POST'], authLevel: 'anonymous', route: 'candidates/{id}/advance',
  handler: async (req) => {
    try {
      const id = parseInt(req.params.id);
      const b = await req.json();
      const current = await query(`SELECT Status FROM Candidates WHERE CandidateID=@id`, { id });
      if (!current.recordset.length) return err('Not found', 404);
      const oldStatus = current.recordset[0].Status;
      const nextMap = { screening:'technical', technical:'client', client:'offer', offer:'hired' };
      const newStatus = nextMap[oldStatus] || oldStatus;
      if (newStatus === oldStatus) return ok({ status: oldStatus, message: 'Already at final stage' });
      await query(`UPDATE Candidates SET Status=@s WHERE CandidateID=@id`, { s: newStatus, id });
      await query(
        `INSERT INTO CandidateHistory (CandidateID, ChangedByID, OldStatus, NewStatus, Note)
         VALUES (@cid, @by, @old, @new, @note)`,
        { cid: id, by: b.changedById||1, old: oldStatus, new: newStatus, note: b.note||null }
      );
      return ok({ oldStatus, newStatus });
    } catch(e) { return err(e.message, 500); }
  }
});

app.http('rejectCandidate', {
  methods: ['POST'], authLevel: 'anonymous', route: 'candidates/{id}/reject',
  handler: async (req) => {
    try {
      const id = parseInt(req.params.id);
      const b = await req.json();
      const current = await query(`SELECT Status FROM Candidates WHERE CandidateID=@id`, { id });
      if (!current.recordset.length) return err('Not found', 404);
      const oldStatus = current.recordset[0].Status;
      await query(
        `UPDATE Candidates SET Status='rejected', RejectionReason=@reason WHERE CandidateID=@id`,
        { reason: b.reason||null, id }
      );
      await query(
        `INSERT INTO CandidateHistory (CandidateID, ChangedByID, OldStatus, NewStatus, Note)
         VALUES (@cid, @by, @old, 'rejected', @note)`,
        { cid: id, by: b.changedById||1, old: oldStatus, note: b.reason||null }
      );
      return ok({ rejected: true });
    } catch(e) { return err(e.message, 500); }
  }
});

// ─── PUT /meetings/:id (editar nota) ──────────────────
app.http('updateMeeting', {
  methods: ['PUT'], authLevel: 'anonymous', route: 'meetings/{id}',
  handler: async (req) => {
    try {
      const id = parseInt(req.params.id);
      const b  = await req.json();
      await query(
        `UPDATE OneOnOneMeetings
         SET Title        = COALESCE(@title, Title),
             GeneralNotes = COALESCE(@notes, GeneralNotes),
             NextSteps    = COALESCE(@steps, NextSteps),
             UpdatedAt    = GETDATE()
         WHERE MeetingID = @id`,
        { title: b.title||null, notes: b.generalNotes||null,
          steps: b.nextSteps||null, id }
      );
      return ok({ updated: true });
    } catch(e) { return err(e.message, 500); }
  }
});

// ─── DELETE /meetings/:id (eliminar nota) ─────────────
app.http('deleteMeeting', {
  methods: ['DELETE'], authLevel: 'anonymous', route: 'meetings/{id}',
  handler: async (req) => {
    try {
      const id = parseInt(req.params.id);
      // Soft delete: marcar como eliminado en vez de DELETE (evita problemas de permisos)
      await query(
        `UPDATE OneOnOneMeetings SET IsDeleted=1 WHERE MeetingID=@id`,
        { id }
      );
      return ok({ deleted: true });
    } catch(e) {
      // Si IsDeleted no existe, intentar DELETE directo
      try {
        await query('DELETE FROM OneOnOneMeetings WHERE MeetingID=@id', { id });
        return ok({ deleted: true });
      } catch(e2) { return err(e2.message, 500); }
    }
  }
});

// ─── PUT /candidates/:id/notes ────────────────────────
app.http('candidateNotes', {
  methods: ['PUT'], authLevel: 'anonymous', route: 'candidates/{id}/notes',
  handler: async (req) => {
    try {
      const id = parseInt(req.params.id);
      const b  = await req.json();
      await query(
        `UPDATE Candidates SET Notes=@notes WHERE CandidateID=@id`,
        { notes: b.notes||null, id }
      );
      if (b.interviewer || b.result || b.feedback) {
        try {
          await query(
            `INSERT INTO CandidateInterviews (CandidateID, InterviewerName, Result, Feedback, CreatedAt)
             VALUES (@cid, @interv, @result, @feed, GETDATE())`,
            { cid: id, interv: b.interviewer||null, result: b.result||null, feed: b.feedback||null }
          );
        } catch(e2) {
          // Si falla la entrevista, igual guardar nota
          console.log('Interview skip:', e2.message);
        }
      }
      return ok({ updated: true });
    } catch(e) { return err(e.message, 500); }
  }
});

// ─── GET /candidates/:id/interviews (historial de entrevistas) ─
app.http('getCandidateInterviews', {
  methods: ['GET'], authLevel: 'anonymous', route: 'candidates/{id}/interviews',
  handler: async (req) => {
    try {
      const id = parseInt(req.params.id);
      const res = await query(
        `SELECT InterviewID, CandidateID, InterviewerName, Result, Feedback, CreatedAt
         FROM CandidateInterviews
         WHERE CandidateID=@id
         ORDER BY CreatedAt DESC`,
        { id }
      );
      return ok(res.recordset);
    } catch(e) { return err(e.message, 500); }
  }
});

// ─── Archivos de candidatos ────────────────────────────
app.http('getCandidateFiles', {
  methods: ['GET'], authLevel: 'anonymous', route: 'candidates/{id}/files',
  handler: async (req) => {
    try {
      const id  = parseInt(req.params.id);
      const res = await query(
        `SELECT FileID, FileName, FileType, FileSize, CreatedAt
         FROM CandidateFiles WHERE CandidateID=@id ORDER BY CreatedAt DESC`,
        { id }
      );
      return ok(res.recordset);
    } catch(e) { return err(e.message, 500); }
  }
});

app.http('uploadCandidateFile', {
  methods: ['POST'], authLevel: 'anonymous', route: 'candidates/{id}/files',
  handler: async (req) => {
    try {
      const id = parseInt(req.params.id);
      const b  = await req.json();
      // Validaciones defensivas
      if (!b || !b.fileName) return err('Falta fileName', 400);
      if (!b.fileData)       return err('Falta fileData (base64)', 400);
      // Tamaño aproximado del archivo decodificado (base64 → bytes)
      const sizeBytes = Math.round(b.fileData.length * 3 / 4);
      // Limite razonable de Azure SQL (varbinary max ~ 2GB pero Functions tiene timeouts)
      if (sizeBytes > 50 * 1024 * 1024) {
        return err('Archivo demasiado grande (máx 50MB). Tamaño: ' + Math.round(sizeBytes/1024/1024) + 'MB', 400);
      }
      const res = await query(
        `INSERT INTO CandidateFiles (CandidateID, FileName, FileType, FileData, FileSize)
         OUTPUT INSERTED.FileID
         VALUES (@cid, @name, @type, @data, @size)`,
        { cid: id, name: b.fileName, type: b.fileType||'application/octet-stream',
          data: b.fileData, size: sizeBytes }
      );
      return ok({ fileId: res.recordset[0].FileID, size: sizeBytes });
    } catch(e) {
      // Devolver error con detalles útiles para diagnosticar en frontend
      return err('Upload falló: ' + e.message, 500);
    }
  }
});

app.http('getCandidateFileData', {
  methods: ['GET'], authLevel: 'anonymous', route: 'candidates/{id}/files/{fid}',
  handler: async (req) => {
    try {
      const id  = parseInt(req.params.id);
      const fid = parseInt(req.params.fid);
      const res = await query(
        `SELECT FileID, FileName, FileType, FileData FROM CandidateFiles WHERE CandidateID=@id AND FileID=@fid`,
        { id, fid }
      );
      if (!res.recordset.length) return err('Not found', 404);
      return ok(res.recordset[0]);
    } catch(e) { return err(e.message, 500); }
  }
});

app.http('deleteCandidateFile', {
  methods: ['DELETE'], authLevel: 'anonymous', route: 'candidates/{id}/files/{fid}',
  handler: async (req) => {
    try {
      const id  = parseInt(req.params.id);
      const fid = parseInt(req.params.fid);
      await query(`DELETE FROM CandidateFiles WHERE CandidateID=@id AND FileID=@fid`, { id, fid });
      return ok({ deleted: true });
    } catch(e) { return err(e.message, 500); }
  }
});

// ══════════════════════════════════════════════════════
// PLAN DE CARRERA - ENDPOINTS
// ══════════════════════════════════════════════════════
app.http('getAllCareerPlans', {
  methods: ['GET'], authLevel: 'anonymous', route: 'career/all',
  handler: async (req) => {
    try {
      const res = await query(
        `SELECT cp.PlanID, cp.PlanType, cp.TargetRole, cp.Description,
                u.FullName AS EmployeeName, u.Email AS EmployeeEmail,
                r.RoleName AS CurrentRole,
                (SELECT COUNT(*) FROM CareerMilestones cm WHERE cm.PlanID=cp.PlanID) AS TotalMilestones,
                (SELECT COUNT(*) FROM CareerMilestones cm WHERE cm.PlanID=cp.PlanID
                   AND (cm.Status IN ('completed','done','finished') OR cm.Progress >= 100)) AS CompletedMilestones,
                CASE WHEN (SELECT COUNT(*) FROM CareerMilestones cm WHERE cm.PlanID=cp.PlanID)=0 THEN 0
                  ELSE CAST((SELECT COUNT(*) FROM CareerMilestones cm WHERE cm.PlanID=cp.PlanID
                              AND (cm.Status IN ('completed','done','finished') OR cm.Progress >= 100))*100.0/
                       (SELECT COUNT(*) FROM CareerMilestones cm WHERE cm.PlanID=cp.PlanID) AS INT)
                END AS ProgressPct
         FROM CareerPlans cp
         JOIN Users u ON cp.UserID=u.UserID
         LEFT JOIN Roles r ON u.RoleID=r.RoleID
         WHERE (cp.IsActive IS NULL OR cp.IsActive = 1)
         ORDER BY cp.PlanID DESC`
      );
      return ok(res.recordset);
    } catch(e) { return err(e.message, 500); }
  }
});

app.http('getCareerPlanDetail', {
  methods: ['GET'], authLevel: 'anonymous', route: 'career/plan/{id}',
  handler: async (req) => {
    try {
      const id = parseInt(req.params.id);
      const [plan, milestones] = await Promise.all([
        query(`SELECT cp.*, u.FullName AS EmployeeName, u.Email AS EmployeeEmail
               FROM CareerPlans cp JOIN Users u ON cp.UserID=u.UserID
               WHERE cp.PlanID=@id`, { id }),
        query(`SELECT * FROM CareerMilestones WHERE PlanID=@id ORDER BY ISNULL(SortOrder,0), MilestoneID`, { id })
      ]);
      if (!plan.recordset.length) return err('Not found', 404);
      return ok({ plan: plan.recordset[0], milestones: milestones.recordset });
    } catch(e) { return err(e.message, 500); }
  }
});

app.http('createCareerPlan', {
  methods: ['POST'], authLevel: 'anonymous', route: 'career/{userid}',
  handler: async (req) => {
    try {
      const userId = parseInt(req.params.userid);
      const b = await req.json();
      // Verificar si ya tiene plan activo
      const existing = await query(`SELECT PlanID FROM CareerPlans WHERE UserID=@uid`, { uid: userId });
      if (existing.recordset.length) {
        return ok({ planId: existing.recordset[0].PlanID, existing: true });
      }
      const res = await query(
        `INSERT INTO CareerPlans (UserID, PlanType, TargetRole, Description)
         OUTPUT INSERTED.PlanID
         VALUES (@uid, @type, @target, @desc)`,
        { uid: userId, type: b.planType||'specialization', target: b.targetRole||null, desc: b.description||null }
      );
      return ok({ planId: res.recordset[0].PlanID });
    } catch(e) { return err(e.message, 500); }
  }
});

app.http('createCareerMilestone', {
  methods: ['POST'], authLevel: 'anonymous', route: 'career/milestone',
  handler: async (req) => {
    try {
      const b = await req.json();
      const res = await query(
        `INSERT INTO CareerMilestones (PlanID, MilestoneTitle, MilestoneCategory, CertificationName, BadgeURL, Description, DueDate, SortOrder, Status, Progress, CreatedAt, UpdatedAt)
         OUTPUT INSERTED.MilestoneID
         VALUES (@pid, @title, @cat, @cert, @badge, @desc, @due,
           (SELECT ISNULL(MAX(SortOrder),0)+1 FROM CareerMilestones WHERE PlanID=@pid),
           'pending', 0, GETDATE(), GETDATE())`,
        { pid: b.planId, title: b.title, cat: b.milestoneCategory||null,
          cert: b.certificationName||null, badge: b.badgeURL||null,
          desc: b.description||null, due: b.dueDate||null }
      );
      return ok({ milestoneId: res.recordset[0].MilestoneID });
    } catch(e) { return err(e.message, 500); }
  }
});

app.http('updateCareerMilestone', {
  methods: ['PUT'], authLevel: 'anonymous', route: 'career/milestone/{id}',
  handler: async (req) => {
    try {
      const id = parseInt(req.params.id);
      const b  = await req.json();
      // Mapear isCompleted booleano del frontend a Status + Progress + CompletedAt
      const completed = (b.isCompleted != null) ? (b.isCompleted ? 1 : 0) : null;
      await query(
        `UPDATE CareerMilestones SET
           Status          = CASE WHEN @completed = 1 THEN 'completed'
                                  WHEN @completed = 0 THEN 'pending'
                                  ELSE Status END,
           Progress        = CASE WHEN @completed = 1 THEN 100
                                  WHEN @completed = 0 THEN 0
                                  ELSE Progress END,
           CompletedAt     = CASE WHEN @completed = 1 THEN GETDATE()
                                  WHEN @completed = 0 THEN NULL
                                  ELSE CompletedAt END,
           EmployeeComment = COALESCE(@comment, EmployeeComment),
           FileData        = COALESCE(@fileData, FileData),
           FileName        = COALESCE(@fileName, FileName),
           FileType        = COALESCE(@fileType, FileType),
           UpdatedAt       = GETDATE()
         WHERE MilestoneID=@id`,
        { completed,
          comment: b.employeeComment != null ? b.employeeComment : null,
          fileData: b.fileData||null, fileName: b.fileName||null,
          fileType: b.fileType||null, id }
      );
      return ok({ updated: true });
    } catch(e) { return err(e.message, 500); }
  }
});

app.http('getCertifications', {
  methods: ['GET'], authLevel: 'anonymous', route: 'certifications',
  handler: async (req) => {
    try {
      const cat = req.query.get('category') || null;
      const res = await query(
        `SELECT CertID, Name, Category, Provider FROM CertificationCatalog
         WHERE IsActive=1 AND (@cat IS NULL OR Category=@cat)
         ORDER BY Category, Name`,
        { cat }
      );
      return ok(res.recordset);
    } catch(e) { return err(e.message, 500); }
  }
});
