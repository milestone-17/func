import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import { hashPassword, verifyPassword, genSalt } from '@/lib/crypto'
import { wipeAllData } from '@/repos/db'

export const useLockStore = defineStore('lock', () => {
  // 仅内存态: 刷新页面后回到锁定。解锁只在当前会话有效。
  const unlocked = ref(false)

  const hasPassword = computed(() => {
    const s = useSettingsStore().settings
    return !!(s?.passHash && s.passSalt)
  })

  /** 首次设置密码 */
  async function setPassword(password: string): Promise<void> {
    if (!password) throw new Error('密码不能为空')
    const salt = genSalt()
    const hash = await hashPassword(password, salt)
    const settings = useSettingsStore()
    await settings.save({ passSalt: salt, passHash: hash })
    unlocked.value = true
  }

  /** 验证密码 (用于解锁) */
  async function verify(password: string): Promise<boolean> {
    const s = useSettingsStore().settings
    if (!s?.passHash || !s?.passSalt) return false
    const ok = await verifyPassword(password, s.passSalt, s.passHash)
    if (ok) unlocked.value = true
    return ok
  }

  /** 修改密码 (需验证旧密码) */
  async function changePassword(oldPw: string, newPw: string): Promise<boolean> {
    const ok = await verify(oldPw)
    if (!ok) return false
    await setPassword(newPw)
    return true
  }

  /** 关闭应用锁 (需验证当前密码) */
  async function disablePassword(password: string): Promise<boolean> {
    const ok = await verify(password)
    if (!ok) return false
    const settings = useSettingsStore()
    await settings.save({ passSalt: null, passHash: null })
    unlocked.value = true
    return true
  }

  function lock() { unlocked.value = false }

  /** 紧急重置: 清除全部本地数据 (忘记密码逃生口) */
  async function emergencyReset(): Promise<void> {
    await wipeAllData()
    unlocked.value = true
    // 硬刷新以重建空数据库 + 重置所有 store 状态
    if (typeof location !== 'undefined') location.reload()
  }

  return { unlocked, hasPassword, setPassword, verify, changePassword, disablePassword, lock, emergencyReset }
})
