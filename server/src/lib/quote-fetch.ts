/**
 * 行情 HTTP 客户端 (curl 子进程):
 *   服务器 IPv6 出口被部分行情源重置, node TLS 栈被 WAF 拒绝;
 *   curl -4 直连稳定 (保留 curl 默认 UA + HTTP/1.1)。
 */
import { execFile } from 'node:child_process'

/** GET via curl -4 → 原始 Buffer (GBK 等非 UTF-8 解码用) */
export function curlFetch(url: string, opts?: { headers?: string[]; timeoutSec?: number; retries?: number; curlArgs?: string[] }): Promise<Buffer> {
  const once = (): Promise<Buffer> => new Promise((resolve, reject) => {
    const args = ['-4', '-sS', '-m', String(opts?.timeoutSec ?? 25), '--http1.1', ...(opts?.headers || []).flatMap(h => ['-H', h]), ...(opts?.curlArgs || []), url]
    execFile('curl', args, {
      encoding: 'binary', // 原始字节经 latin1 往返, GBK 解码不损坏 (默认 utf8 会产生 U+FFFD)
      maxBuffer: 16 * 1024 * 1024,
      timeout: (opts?.timeoutSec ?? 25) * 1000 + 3000
    }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`curl 请求失败: ${(err as Error).message}${stderr ? ' / ' + stderr : ''}`))
        return
      }
      resolve(Buffer.from(stdout, 'binary'))
    })
  })
  const retries = opts?.retries ?? 0
  return (async () => {
    let last: unknown
    for (let i = 0; i <= retries; i++) {
      try {
        return await once()
      } catch (e) {
        last = e
        if (i < retries) await new Promise(r => setTimeout(r, 1000 * (i + 1)))
      }
    }
    throw last
  })()
}

/** GET JSON via node fetch (push2 等对 curl 指纹 WAF 的源; 默认 15s 超时无重试) */
export async function fetchQuoteJsonDirect<T>(url: string, timeoutMs = 15_000): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (func-server)' }, signal: ctrl.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json() as T
  } finally {
    clearTimeout(timer)
  }
}

/** GET JSON via curl -4 (25s 超时, 带重试) */
export function fetchQuoteJson<T>(url: string, retries = 2): Promise<T> {
  const once = async (): Promise<T> => {
    const buf = await curlFetch(url, { timeoutSec: 25 })
    try {
      return JSON.parse(buf.toString('utf8')) as T
    } catch (e) {
      throw new Error(`JSON 解析失败: ${(e as Error).message}`)
    }
  }
  return (async () => {
    let last: unknown
    for (let i = 0; i <= retries; i++) {
      try {
        return await once()
      } catch (e) {
        last = e
        await new Promise(r => setTimeout(r, 1500 * (i + 1)))
      }
    }
    throw last
  })()
}
