import { localStg } from '@/utils/storage';

/** 是否已登录 (本地标记) */
export function getToken() {
  return localStg.get('admin-logged') === '1' ? 'cookie-session' : '';
}

/** 清除登录标记 */
export function clearAuthStorage() {
  localStg.remove('admin-logged');
  localStg.remove('admin-email');
}
