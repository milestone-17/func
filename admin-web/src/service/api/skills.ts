import { request } from '../request';

// ============ Skill 知识库 ============
export interface SkillMeta {
  name: string;
  description: string;
  globs: string[];
  alwaysApply: boolean;
}

export interface SkillFileMeta {
  relPath: string;
  updatedAt: string | null;
  lastCommit: string | null;
}

export interface SkillCommit {
  hash: string;
  date: string;
  author: string;
  subject: string;
  status: string;
}

export function fetchSkills() {
  return request<{ items: SkillMeta[] }>({ url: '/api/admin/panel/skills', method: 'get' });
}

export function fetchSkillFiles() {
  return request<{ items: SkillFileMeta[] }>({ url: '/api/admin/panel/skills/files', method: 'get' });
}

export function fetchSkillFile(relPath: string) {
  return request<{ content: string; updatedAt: string | null; lastCommit: string | null }>({
    url: '/api/admin/panel/skills/file',
    method: 'get',
    params: { path: relPath }
  });
}

export function fetchSkillHistory(relPath?: string) {
  return request<{ items: SkillCommit[] }>({
    url: '/api/admin/panel/skills/history',
    method: 'get',
    params: relPath ? { path: relPath } : undefined
  });
}

export function fetchSkillDiff(relPath: string, from: string, to = '') {
  return request<{ diff: string }>({
    url: '/api/admin/panel/skills/diff',
    method: 'get',
    params: { path: relPath, from, to }
  });
}
