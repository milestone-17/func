import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { requestPersist, isPersisted } from '@/lib/persist'
import { shouldRemindBackup, daysSince } from '@/lib/backupReminder'
import { downloadBackup } from '@/lib/backup'
import { settingsRepo } from '@/repos/settingsRepo'
import { setActivePinia, createPinia } from 'pinia'
import { useSettingsStore } from '@/stores/settings'

const DAY = 86_400_000

// ---- persist ----
describe('persist (Storage API 封装)', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('不支持时返回 unsupported 且不抛错', async () => {
    const nav = navigator as any
    const saved = nav.storage
    delete nav.storage
    expect(await requestPersist()).toBe('unsupported')
    expect(await isPersisted()).toBeNull()
    nav.storage = saved
  })

  it('persist() 返回 true → granted', async () => {
    ;(navigator as any).storage = { persist: async () => true, persisted: async () => true }
    expect(await requestPersist()).toBe('granted')
    expect(await isPersisted()).toBe(true)
  })

  it('persist() 返回 false → denied', async () => {
    ;(navigator as any).storage = { persist: async () => false, persisted: async () => false }
    expect(await requestPersist()).toBe('denied')
  })

  it('persist() 抛错 → unsupported', async () => {
    ;(navigator as any).storage = { persist: async () => { throw new Error('x') } }
    expect(await requestPersist()).toBe('unsupported')
  })
})

// ---- daysSince ----
describe('daysSince', () => {
  it('null → Infinity', () => {
    expect(daysSince(null, 1000)).toBe(Infinity)
  })
  it('整数天', () => {
    expect(daysSince(0, 3 * DAY)).toBe(3)
  })
})

// ---- shouldRemindBackup ----
describe('shouldRemindBackup', () => {
  const now = 10_000_000 * DAY
  const base = { now, reminderDays: 30, lastBackupAt: null, snoozedAt: null }

  it('无数据 → 不提醒', () => {
    expect(shouldRemindBackup({ ...base, firstDataAt: null })).toBe(false)
  })
  it('从未备份 + 超过阈值(以首次数据时间为准) → 提醒', () => {
    expect(shouldRemindBackup({ ...base, firstDataAt: now - 31 * DAY })).toBe(true)
  })
  it('从未备份 + 未超阈值 → 不提醒', () => {
    expect(shouldRemindBackup({ ...base, firstDataAt: now - 10 * DAY })).toBe(false)
  })
  it('最近备份在阈值内 → 不提醒', () => {
    expect(shouldRemindBackup({ ...base, firstDataAt: now - 100 * DAY, lastBackupAt: now - 5 * DAY })).toBe(false)
  })
  it('距上次备份超过阈值 → 提醒', () => {
    expect(shouldRemindBackup({ ...base, firstDataAt: now - 100 * DAY, lastBackupAt: now - 31 * DAY })).toBe(true)
  })
  it('处于稍后提醒推迟期内 → 不提醒', () => {
    expect(shouldRemindBackup({ ...base, firstDataAt: now - 100 * DAY, lastBackupAt: now - 60 * DAY, snoozedAt: now - 3 * DAY })).toBe(false)
  })
  it('推迟期已过 → 重新提醒', () => {
    expect(shouldRemindBackup({ ...base, firstDataAt: now - 100 * DAY, lastBackupAt: now - 60 * DAY, snoozedAt: now - 31 * DAY })).toBe(true)
  })
  it('导出后(刚备份)→ 不提醒', () => {
    expect(shouldRemindBackup({ ...base, firstDataAt: now - 100 * DAY, lastBackupAt: now })).toBe(false)
  })
})

// ---- backup 写回 lastBackupAt ----
describe('backup 导出写回 lastBackupAt', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    return new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase('func-db')
      req.onsuccess = () => resolve()
      req.onerror = () => resolve()
      req.onblocked = () => resolve()
    })
  })

  it('downloadBackup 后 settings.lastBackupAt 被写入', async () => {
    // 模拟下载链路 (Blob/URL/click 在 node 下用 happy-dom 提供的 stub)
    downloadBackup()
    // 等待异步导出 + 写回
    await new Promise(r => setTimeout(r, 200))
    const s = await settingsRepo.get()
    expect(typeof s.lastBackupAt).toBe('number')
    expect(s.lastBackupAt!).toBeGreaterThan(0)
  })

  it('设置 store 读取新字段默认值', async () => {
    const s = useSettingsStore()
    await s.load()
    expect(s.settings?.backupReminderDays).toBe(30)
    expect(s.settings?.lastBackupAt).toBeNull()
    expect(s.settings?.storagePersisted).toBeNull()
  })
})
