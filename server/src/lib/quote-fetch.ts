/**
 * 行情 HTTP 客户端 (curl 子进程):
 *   服务器 IPv6 出口被部分行情源重置, node TLS 栈被 WAF 拒绝;
 *   curl -4 直连稳定 (保留 curl 默认 UA + HTTP/1.1)。
 */
import { execFile } from 'node:child_process'

/** GET JSON via curl -4 (25s 超时, 带重试) */
export function fetchQuoteJson<T>(url: string, retries = 2): Promise<T> {
  const once = (): Promise<T> => new Promise((resolve, reject) => {
    execFile('curl', ['-4', '-sS', '-m', '25', '--http1.1', url], {
      maxBuffer: 16 * 1024 * 1024,
      timeout: 28_000
    }, (err, stdout) => {
      if (err) {
        reject(new Error(`行情请求失败: ${(err as Error).message}`))
        return
      }
      try {
        resolve(JSON.parse(stdout) as T)
      } catch (e) {
        reject(new Error(`JSON 解析失败: ${(e as Error).message}`))
      }
    })
  })
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
