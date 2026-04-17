// frontend/api-client.js
// Conecta el frontend con las Azure Functions
// Incluir con: <script src="api-client.js"></script>

const API = {
 // baseUrl: '/api',   // En Azure Static Web App, /api apunta automáticamente a las Functions
  baseUrl: 'https://peopletrack-api-gjbbhhcefjbgc6bd.eastus2-01.azurewebsites.net/api',
  token:   null,

  // ── Auth ────────────────────────────────────────────────
  async getMe() {
    return this._get('auth/me');
  },

  // ── Dashboard ───────────────────────────────────────────
  async getDashboard(periodId) {
    const qs = periodId ? `?periodId=${periodId}` : '';
    return this._get('dashboard' + qs);
  },

  // ── Períodos ────────────────────────────────────────────
  async getPeriods() {
    return this._get('periods');
  },

  // ── Usuarios ────────────────────────────────────────────
  async getTeam() {
    return this._get('users');
  },
  async getUserReport(userId, periodId) {
    return this._get(`users/${userId}/report?periodId=${periodId}`);
  },

  // ── Objetivos ───────────────────────────────────────────
  async getObjectives(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return this._get('objectives' + (qs ? '?' + qs : ''));
  },
  async createObjective(data) {
    return this._post('objectives', data);
  },
  async updateObjective(id, data) {
    return this._put(`objectives/${id}`, data);
  },
  async registerCheckin(objectiveId, data) {
    return this._post(`objectives/${objectiveId}/checkin`, data);
  },

  // ── Carrera ─────────────────────────────────────────────
  async getCareer(userId) {
    return this._get(`career/${userId}`);
  },
  async updateMilestone(milestoneId, data) {
    return this._put(`career/milestone/${milestoneId}`, data);
  },

  // ── Competencias ────────────────────────────────────────
  async getCompetencies(type) {
    return this._get('competencies' + (type ? `?type=${type}` : ''));
  },
  async getEvaluation(userId, periodId) {
    return this._get(`competencies/evaluation/${userId}/${periodId}`);
  },
  async saveEvaluation(data) {
    return this._post('competencies/evaluation', data);
  },

  // ── Reuniones 1:1 ───────────────────────────────────────
  async getMeetings(employeeId) {
    return this._get(`meetings/${employeeId}`);
  },
  async createMeeting(data) {
    return this._post('meetings', data);
  },

  // ── Alertas ─────────────────────────────────────────────
  async getAlerts() {
    return this._get('alerts');
  },
  async resolveAlert(alertId) {
    return this._put(`alerts/${alertId}/resolve`, {});
  },
  async generateAlerts(periodId, threshold) {
    return this._post('alerts/generate', { periodId, threshold });
  },

  // ── Organigrama ─────────────────────────────────────────
  async getOrgChart(rootUserId) {
    return this._get(`orgchart/${rootUserId}`);
  },

  // ── Importación ─────────────────────────────────────────
  async importUsers(rows) {
    return this._post('import/users', { rows });
  },

  // ── Configuración ───────────────────────────────────────
  async getConfig() {
    return this._get('config');
  },
  async saveConfig(key, value) {
    return this._put('config', { key, value });
  },

  // ── HTTP helpers ────────────────────────────────────────
  async _get(path) {
    const res = await fetch(`${this.baseUrl}/${path}`, {
      headers: this._headers()
    });
    return res.json();
  },
  async _post(path, body) {
    const res = await fetch(`${this.baseUrl}/${path}`, {
      method:  'POST',
      headers: this._headers(),
      body:    JSON.stringify(body)
    });
    return res.json();
  },
  async _put(path, body) {
    const res = await fetch(`${this.baseUrl}/${path}`, {
      method:  'PUT',
      headers: this._headers(),
      body:    JSON.stringify(body)
    });
    return res.json();
  },
  _headers() {
    const h = { 'Content-Type': 'application/json' };
    if (this.token) h['Authorization'] = `Bearer ${this.token}`;
    return h;
  },

  // ── SSO: MSAL (Azure AD) ─────────────────────────────────
  // Requiere: <script src="https://alcdn.msauth.net/browser/2.38.3/js/msal-browser.min.js">
  initMsal(tenantId, clientId, redirectUri) {
    this.msalApp = new msal.PublicClientApplication({
      auth: { clientId, authority: `https://login.microsoftonline.com/${tenantId}`, redirectUri }
    });
  },
  async loginWithAzure() {
    try {
      const result = await this.msalApp.loginPopup({
        scopes: ['openid', 'profile', 'email', 'User.Read']
      });
      this.token = result.accessToken;
      return result.account;
    } catch (e) {
      console.error('Login error:', e);
      return null;
    }
  },
  async silentLogin() {
    try {
      const accounts = this.msalApp.getAllAccounts();
      if (!accounts.length) return null;
      const result = await this.msalApp.acquireTokenSilent({
        scopes:  ['openid', 'profile', 'email', 'User.Read'],
        account: accounts[0]
      });
      this.token = result.accessToken;
      return accounts[0];
    } catch (e) {
      return null;
    }
  }
};

// Exportar para uso en módulos ES
if (typeof module !== 'undefined') module.exports = API;
