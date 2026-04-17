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
                a.AreaName, r.RoleName,
                leader.FullName  AS LeaderName,  leader.UserID  AS LeaderID,
                manager.FullName AS ManagerName, manager.UserID AS ManagerID
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
      const user = await getAuthUser(req);
      if (!user) return err('No autorizado', 401);
      const body = await req.json();
      const uid  = parseInt(req.params.id);
      const fields = [];
      const params = { id: uid };
      if (body.FullName  !== undefined) { fields.push('FullName = @name');   params.name   = body.FullName; }
      if (body.Email     !== undefined) { fields.push('Email = @email');     params.email  = body.Email; }
      if (body.AppRole   !== undefined) { fields.push('AppRole = @role');    params.role   = body.AppRole; }
      if (body.IsActive  !== undefined) { fields.push('IsActive = @active'); params.active = body.IsActive ? 1 : 0; }
      if (fields.length > 0) {
        await query(
          `UPDATE Users SET ${fields.join(', ')}, UpdatedAt = GETDATE() WHERE UserID = @id`,
          params
        );
      }
      if (body.LeaderID !== undefined) {
        await query(`UPDATE UserRelationships SET IsActive=0 WHERE EmployeeID=@uid AND LeaderID IS NOT NULL`, { uid });
        if (body.LeaderID) {
          await query(
            `IF NOT EXISTS (SELECT 1 FROM UserRelationships WHERE EmployeeID=@uid AND LeaderID=@lid AND IsActive=1)
             INSERT INTO UserRelationships (EmployeeID, LeaderID, IsPrimary, IsActive) VALUES (@uid, @lid, 1, 1)`,
            { uid, lid: body.LeaderID }
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
      const user = await getAuthUser(req);
      if (!user) return err('No autorizado', 401);
      const body = await req.json();
      const res  = await query(
        `INSERT INTO Users (FullName, Email, AppRole, IsActive, CreatedAt, UpdatedAt)
         OUTPUT INSERTED.UserID
         VALUES (@name, @email, @role, 1, GETDATE(), GETDATE())`,
        { name: body.FullName||'', email: body.Email||'', role: body.AppRole||'employee' }
      );
      return ok({ UserID: res.recordset[0].UserID, ...body, IsActive: true });
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
      const user = await getAuthUser(req);
      if (!user) return err('No autorizado', 401);
      const userId = req.query.get('userId') || null;
      const periodId = req.query.get('periodId') || null;
      const type = req.query.get('type') || null;
      const res = await query(
        `SELECT o.*, u.FullName AS EmployeeName, fp.PeriodName, c.CompetencyName
         FROM Objectives o
         LEFT JOIN Users u ON o.UserID = u.UserID
         LEFT JOIN FiscalPeriods fp ON o.PeriodID = fp.PeriodID
         LEFT JOIN ObjectiveTasks ot ON o.ObjectiveID = ot.ObjectiveID
         LEFT JOIN Competencies c ON ot.CompetencyID = c.CompetencyID
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
      const user = await getAuthUser(req);
      if (!user) return err('No autorizado', 401);
      const body = await req.json();
      const res = await execute('sp_UpsertObjective', {
        ObjectiveID: null, Title: body.title, Description: body.description||null,
        ObjectiveType: body.objectiveType||'personal', PeriodID: body.periodId,
        UserID: body.userId||null, AreaID: body.areaId||null, Weight: body.weight||0,
        Status: body.status||'not_started', Progress: body.progress||0,
        DueDate: body.dueDate||null, CreatedBy: user.UserID
      });
      return ok({ objectiveId: res.recordset[0].NewObjectiveID });
    } catch (e) { return err(e.message, 500); }
  }
});
app.http('updateObjective', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: 'objectives/{id}',
  handler: async (req) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return err('No autorizado', 401);
      const body = await req.json();
      await execute('sp_UpsertObjective', {
        ObjectiveID: parseInt(req.params.id), Title: body.title,
        Description: body.description||null, ObjectiveType: body.objectiveType||'personal',
        PeriodID: body.periodId, UserID: body.userId||null, AreaID: body.areaId||null,
        Weight: body.weight||0, Status: body.status, Progress: body.progress,
        DueDate: body.dueDate||null, CreatedBy: user.UserID
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
      const res = await query(`SELECT * FROM vw_CareerPlanDetails WHERE UserID = @uid`, { uid: parseInt(req.params.userId) });
      return ok(res.recordset);
    } catch (e) { return err(e.message, 500); }
  }
});
app.http('updateMilestone', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: 'career/milestone/{id}',
  handler: async (req) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return err('No autorizado', 401);
      const body = await req.json();
      await query(
        `UPDATE CareerMilestones SET Progress=@progress, Status=@status, Feedback=@feedback,
         LastReviewDate=CAST(GETDATE() AS DATE), UpdatedAt=GETDATE() WHERE MilestoneID=@id`,
        { id: parseInt(req.params.id), progress: body.progress, status: body.status, feedback: body.feedback||null }
      );
      await query(
        `UPDATE CareerPlans SET OverallProgress=(SELECT AVG(Progress) FROM CareerMilestones WHERE PlanID=CareerPlans.PlanID),
         UpdatedAt=GETDATE() WHERE PlanID=(SELECT PlanID FROM CareerMilestones WHERE MilestoneID=@id)`,
        { id: parseInt(req.params.id) }
      );
      return ok({ updated: true });
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
      const user = await getAuthUser(req);
      if (!user) return err('No autorizado', 401);
      const res = await query(
        `SELECT m.*, n.NoteID, n.NoteText, n.NoteType, n.IsPrivate, n.ObjectiveID
         FROM OneOnOneMeetings m LEFT JOIN OneOnOneNotes n ON m.MeetingID=n.MeetingID
         WHERE m.EmployeeID=@empId AND (m.LeaderID=@lid OR @role IN ('manager','admin'))
         ORDER BY m.MeetingDate DESC`,
        { empId: parseInt(req.params.employeeId), lid: user.UserID, role: user.AppRole }
      );
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
      const user = await getAuthUser(req);
      if (!user) return err('No autorizado', 401);
      const body = await req.json();
      const res = await execute('sp_SaveOneOnOneMeeting', {
        MeetingID: null, LeaderID: user.UserID, EmployeeID: body.employeeId,
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
      const exists = await query(`SELECT 1 FROM Areas WHERE AreaName = @name`, { name });
      if (exists.recordset.length) return err('Ya existe un área con ese nombre', 400);
      const res = await query(
        `INSERT INTO Areas (AreaName, Description, IsActive) OUTPUT INSERTED.AreaID VALUES (@name, @desc, 1)`,
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
