/**
 * 持久化存储申请 (Storage Persistence API)
 *
 * 请求浏览器承诺不自动回收/清理本地数据。安卓 Chrome 与已安装 PWA 通常会授予;
 * iOS Safari 承诺较弱,但仍有一定帮助。无论结果如何都不得影响应用运行。
 *
 * 安全降级: navigator.storage 缺失或抛错时返回 'unsupported',绝不向上抛出。
 */

export type PersistResult = 'granted' | 'denied' | 'unsupported'

function storageAvailable(): boolean {
  return typeof navigator !== 'undefined'
    && !!navigator.storage
    && typeof navigator.storage.persist === 'function'
}

/** 主动申请持久化存储 */
export async function requestPersist(): Promise<PersistResult> {
  if (!storageAvailable()) return 'unsupported'
  try {
    const ok = await navigator.storage.persist()
    return ok ? 'granted' : 'denied'
  } catch {
    return 'unsupported'
  }
}

/** 查询当前是否已被持久化 (不主动申请) */
export async function isPersisted(): Promise<boolean | null> {
  if (!storageAvailable()) return null
  try {
    return await navigator.storage.persisted()
  } catch {
    return null
  }
}
