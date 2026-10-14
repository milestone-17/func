import { request } from '../request';

/** 后台登录 (Cookie 会话) */
export function fetchLogin(email: string, password: string) {
  return request<{ ok: boolean }>({
    url: '/api/admin/auth/login',
    method: 'post',
    data: { email, password }
  });
}

/** 后台登出 */
export function fetchLogout() {
  return request<{ ok: boolean }>({ url: '/api/admin/auth/logout', method: 'post' });
}

/** 探测登录态 (后端无 getUserInfo 接口, 用需鉴权的 summary 探测) */
export function fetchCheckSession() {
  return request({
    url: '/api/admin/panel/summary',
    method: 'get'
  });
}
