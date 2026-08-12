/**
 * 本地密码哈希工具 (Web Crypto SHA-256 + 随机盐)
 * 注意: 这是"防君子"级别的客户端保护, 不替代服务端鉴权。
 */

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')
}

export function genSalt(): string {
  const a = crypto.getRandomValues(new Uint8Array(16))
  return [...a].map(b => b.toString(16).padStart(2, '0')).join('')
}

export async function hashPassword(password: string, salt: string): Promise<string> {
  const enc = new TextEncoder()
  // 多轮哈希增加暴力破解成本
  let data = enc.encode(`${salt}::${password}`)
  for (let i = 0; i < 1000; i++) {
    data = new Uint8Array(await crypto.subtle.digest('SHA-256', data))
  }
  return toHex(data.buffer as ArrayBuffer)
}

export async function verifyPassword(password: string, salt: string, expectedHash: string): Promise<boolean> {
  const h = await hashPassword(password, salt)
  // 常量时间比较
  if (h.length !== expectedHash.length) return false
  let diff = 0
  for (let i = 0; i < h.length; i++) diff |= h.charCodeAt(i) ^ expectedHash.charCodeAt(i)
  return diff === 0
}
