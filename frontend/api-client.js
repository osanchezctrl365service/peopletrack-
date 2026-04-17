// frontend/api-client.js — v2 con soporte x-user-email
const API_BASE = 'https://peopletrack-api-gjbbhhcefjbgc6bd.eastus2-01.azurewebsites.net/api';

const API = {
  userEmail: '',

  setUser(email) { this.userEmail = email; },

  _headers() {
    const h = { 'Content-Type': 'application/json' };
    if (this.userEmail) h['x-user-email'] = this.userEmail;
    return h;
  },

  async _get(path) {
    const res = await fetch(`${API_BASE}/${path}`, { headers: this._headers() });
    const data = await res.json();
    return data.data !== undefined ? data.data : data;
  },
  async _post(path, body) {
    const res = await fetch(`${API_BASE}/${path}`, { method: 'POST', headers: this._headers(), body: JSON.stringify(body) });
    const data = await res.json();
    return data.data !== undefined ? data.data : data;
  },
  async _put(path, body) {
    const res = await fetch(`${API_BASE}/${path}`, { method: 'PUT', headers: this._headers(), body: JSON.stringify(body) });
    const data = await res.json();
    return data.data !== undefined ? data.data : data;
  },

  async health()                        { return this._get('health'); },
  async getPeriods()                    { return this._get('periods'); },
  async getDashboard(periodId)          { return this._get('dashboard' + (periodId ? `?periodId=${periodId}` : '')); },
  async getTeam()                       { return this._get('users'); },
  async getUserReport(userId, periodId) { return this._get(`users/${userId}/report?periodId=${periodId}`); },
  async getObjectives(params = {})      { return this._get('objectives?' + new URLSearchParams(params)); },
  async createObjective(data)           { return this._post('objectives', data); },
  async updateObjective(id, data)       { return this._put(`objectives/${id}`, data); },
  async registerCheckin(objId, data)    { return this._post(`objectives/${objId}/checkin`, data); },
  async getCareer(userId)               { return this._get(`career/${userId}`); },
  async updateMilestone(id, data)       { return this._put(`career/milestone/${id}`, data); },
  async getCompetencies(type)           { return this._get('competencies' + (type ? `?type=${type}` : '')); },
  async getEvaluation(userId, periodId) { return this._get(`competencies/evaluation/${userId}/${periodId}`); },
  async saveEvaluation(data)            { return this._post('competencies/evaluation', data); },
  async getMeetings(employeeId)         { return this._get(`meetings/${employeeId}`); },
  async createMeeting(data)             { return this._post('meetings', data); },
  async getAlerts()                     { return this._get('alerts'); },
  async resolveAlert(alertId)           { return this._put(`alerts/${alertId}/resolve`, {}); },
  async generateAlerts(periodId, thr)   { return this._post('alerts/generate', { periodId, threshold: thr }); },
  async getOrgChart(rootUserId)         { return this._get(`orgchart/${rootUserId}`); },
  async importUsers(rows)               { return this._post('import/users', { rows }); },
  async getConfig()                     { return this._get('config'); },
  async saveConfig(key, value)          { return this._put('config', { key, value }); },
};

if (typeof module !== 'undefined') module.exports = API;
