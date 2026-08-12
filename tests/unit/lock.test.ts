import { describe, it, expect } from 'vitest'
import 'fake-indexeddb/auto'
import { hashPassword, verifyPassword, genSalt } from '@/lib/crypto'
import { useLockStore } from '@/stores/lock'
import { useSettingsStore } from '@/stores/settings'
import { setActivePinia, createPinia } from 'pinia'
import { settingsRepo } from '@/repos/settingsRepo'

describe('crypto', () => {
  it('哈希 + 验证密码', async () => {
    const salt = genSalt()
    const hash = await hashPassword('123456', salt)
    expect(hash).not.toBe('123456')
    expect(await verifyPassword('123456', salt, hash)).toBe(true)
    expect(await verifyPassword('wrong', salt, hash)).toBe(false)
  })
  it('盐随机', () => {
    expect(genSalt()).not.toBe(genSalt())
  })
  it('相同密码不同盐 → 不同哈希', async () => {
    const h1 = await hashPassword('abc', 'salt1')
    const h2 = await hashPassword('abc', 'salt2')
    expect(h1).not.toBe(h2)
  })
})

describe('lock store', () => {
  it('设置 → 解锁 → 关闭应用锁', async () => {
    setActivePinia(createPinia())
    const settings = useSettingsStore()
    const lock = useLockStore()
    await settings.load()

    expect(lock.hasPassword).toBe(false)
    expect(lock.unlocked).toBe(false)

    await lock.setPassword('654321')
    expect(lock.hasPassword).toBe(true)
    expect(lock.unlocked).toBe(true)

    // 持久化到 settings
    const persisted = await settingsRepo.get()
    expect(persisted.passHash).toBeTruthy()
    expect(persisted.passSalt).toBeTruthy()

    // 错误密码不解锁
    lock.lock()
    expect(await lock.verify('000000')).toBe(false)
    expect(lock.unlocked).toBe(false)

    // 正确密码解锁
    expect(await lock.verify('654321')).toBe(true)
    expect(lock.unlocked).toBe(true)

    // 关闭应用锁
    expect(await lock.disablePassword('wrong')).toBe(false)
    expect(await lock.disablePassword('654321')).toBe(true)
    expect(lock.hasPassword).toBe(false)
  })
})
