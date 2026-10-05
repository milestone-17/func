/**
 * 自选定投基金 repo
 * - dcaFunds: 用户自选标的 CRUD (服务端 DcaFund 表, userId 隔离)
 * - fund-search / fund-history: 服务端东财代理 (搜索/历史净值)
 */
import { api } from '@/lib/api'
import { makeRemoteRepo } from '@/repos/remote-base'

export interface DcaFund {
  id: string
  code: string
  name: string
  createdAt: number
  updatedAt: number
  deletedAt?: number | null
}

export const dcaFundRepo = makeRemoteRepo<DcaFund>('dcaFunds')

export interface FundSearchItem {
  code: string
  name: string
  type: string
}

export interface FundNavBar {
  date: string
  nav: number
  accNav?: number
}

export interface FundHistoryResp {
  code: string
  bars: FundNavBar[]
  latest: FundNavBar | null
}

export const fundApi = {
  /** 关键词搜索基金 (东财) */
  async search(key: string): Promise<FundSearchItem[]> {
    const r = await api.get<{ items: FundSearchItem[] }>(`/api/market/fund-search?key=${encodeURIComponent(key)}`)
    return r.items || []
  },
  /** 基金历史净值 (服务端缓存 + DB 增量) */
  async history(code: string, days = 500): Promise<FundHistoryResp> {
    return api.get<FundHistoryResp>(`/api/market/fund-history?code=${encodeURIComponent(code)}&days=${days}`)
  }
}
