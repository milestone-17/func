import { request } from '@/service/request';

// ============ 类型 ============
export interface ReleaseItem {
  id: string;
  version: string;
  title: string;
  notes: string;
  source: 'auto' | 'manual' | string;
  createdAt: string;
}

export interface PitfallItem {
  id: string;
  title: string;
  content: string;
  severity: 'low' | 'medium' | 'high' | string;
  resolved: boolean;
  source: 'manual' | 'ai' | string;
  createdAt: string;
  updatedAt: string;
}

export interface IncidentItem {
  id: string;
  title: string;
  content: string;
  severity: 'low' | 'medium' | 'high' | string;
  status: 'open' | 'resolved' | string;
  startedAt: string;
  resolvedAt: string | null;
}

// ============ 版本更新记录 ============
export function fetchReleases() {
  return request<ReleaseItem[]>({ url: '/api/admin/panel/releases', method: 'get' });
}

export function fetchCreateRelease(body: { version: string; title?: string; notes?: string }) {
  return request<ReleaseItem>({ url: '/api/admin/panel/releases', method: 'post', data: body });
}

export function fetchDeleteRelease(id: string) {
  return request<{ ok: boolean }>({ url: `/api/admin/panel/releases/${id}`, method: 'delete' });
}

// ============ 开发坑 / 严重 Bug ============
export function fetchPitfalls() {
  return request<PitfallItem[]>({ url: '/api/admin/panel/pitfalls', method: 'get' });
}

export function fetchCreatePitfall(body: { title: string; content?: string; severity?: string; resolved?: boolean }) {
  return request<PitfallItem>({ url: '/api/admin/panel/pitfalls', method: 'post', data: body });
}

export function fetchUpdatePitfall(id: string, body: { title?: string; content?: string; severity?: string; resolved?: boolean }) {
  return request<PitfallItem>({ url: `/api/admin/panel/pitfalls/${id}`, method: 'patch', data: body });
}

export function fetchDeletePitfall(id: string) {
  return request<{ ok: boolean }>({ url: `/api/admin/panel/pitfalls/${id}`, method: 'delete' });
}

// ============ 线上事故 ============
export function fetchIncidents() {
  return request<IncidentItem[]>({ url: '/api/admin/panel/incidents', method: 'get' });
}

export function fetchCreateIncident(body: { title: string; content?: string; severity?: string }) {
  return request<IncidentItem>({ url: '/api/admin/panel/incidents', method: 'post', data: body });
}

export function fetchUpdateIncident(id: string, body: { title?: string; content?: string; severity?: string; status?: string }) {
  return request<IncidentItem>({ url: `/api/admin/panel/incidents/${id}`, method: 'patch', data: body });
}

export function fetchDeleteIncident(id: string) {
  return request<{ ok: boolean }>({ url: `/api/admin/panel/incidents/${id}`, method: 'delete' });
}

// ============ 记录同步 (git/错误日志 → 后台记录) ============
export function fetchSyncReleases() {
  return request<{ synced: number }>({ url: '/api/admin/panel/releases/sync', method: 'post' });
}
export function fetchSyncPitfalls() {
  return request<{ synced: number }>({ url: '/api/admin/panel/pitfalls/sync', method: 'post' });
}
export function fetchSyncIncidents() {
  return request<{ synced: number }>({ url: '/api/admin/panel/incidents/sync', method: 'post' });
}

// ============ 工具 ============
export function fmtTime2(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** severity → ElTag type */
export function severityTagType(s: string): 'success' | 'warning' | 'danger' | 'info' {
  if (s === 'high') return 'danger';
  if (s === 'medium') return 'warning';
  if (s === 'low') return 'success';
  return 'info';
}

export const severityLabel: Record<string, string> = {
  high: '严重',
  medium: '中等',
  low: '轻微'
};

