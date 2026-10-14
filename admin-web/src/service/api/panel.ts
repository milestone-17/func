import { request } from '../request';

export interface PanelSummary {
  users: { total: number; guests: number; disabled: number; activeToday: number };
  data: { transactions: number; holdings: number; indexRows: number; fundHistRows: number; dcaFunds: number };
  market: { latestDate: string | null; latestSource: string | null; sourcePriority: string[] };
  sourceHealth?: Record<string, { lastOkAt: number | null; failStreak: number }>;
}

export interface PanelUser {
  id: string;
  email: string;
  provider: string;
  role: string | null;
  disabled: boolean;
  emailVerified: boolean;
  createdAt: string;
  lastSeenAt: string | null;
  lastImportAt: string | null;
}

export interface AuditItem {
  id: string;
  actor: string;
  action: string;
  target: string | null;
  detail: unknown;
  createdAt: string;
}

export interface FundPoolItem {
  code: string;
  name: string;
  createdAt: string;
  histRows: number;
}

export interface FundSearchItem {
  code: string;
  name: string;
  type: string;
}

export function fetchPanelSummary() {
  return request<PanelSummary>({ url: '/api/admin/panel/summary' });
}

export function fetchPanelUsers() {
  return request<{ items: PanelUser[] }>({ url: '/api/admin/panel/users' });
}

export function fetchSetUserEnabled(id: string, disabled: boolean) {
  return request<{ ok: boolean }>({
    url: `/api/admin/panel/users/${id}`,
    method: 'patch',
    data: { disabled }
  });
}

export function fetchDeleteUser(id: string) {
  return request<{ ok: boolean }>({ url: `/api/admin/panel/users/${id}`, method: 'delete' });
}

export function fetchAudit(limit = 50) {
  return request<{ items: AuditItem[] }>({ url: `/api/admin/panel/audit?limit=${limit}` });
}

export function fetchFundPool() {
  return request<{ items: FundPoolItem[] }>({ url: '/api/admin/panel/fund-pool' });
}

export function fetchRemoveFund(code: string) {
  return request<{ ok: boolean }>({ url: `/api/admin/panel/fund-pool/${code}`, method: 'delete' });
}

export function fetchSetSourcePriority(priority: string[]) {
  return request<{ ok: boolean; priority: string[] }>({
    url: '/api/admin/panel/source-priority',
    method: 'post',
    data: { priority }
  });
}

export function fetchSyncMarket() {
  return request<{ ok: boolean; rows: number; source: string | null }>({
    url: '/api/admin/panel/sync-market',
    method: 'post'
  });
}

export function fetchSearchFunds(key: string) {
  return request<{ items: FundSearchItem[] }>({
    url: `/api/market/fund-search?key=${encodeURIComponent(key)}`
  });
}

export function fmtTime(v: string | Date | null | undefined): string {
  if (!v) return '—';
  try {
    return new Date(v).toLocaleString('zh-CN', {
      year: '2-digit',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return String(v);
  }
}
