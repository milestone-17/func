import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma'

export async function marketRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/market/index-data', async (_req, reply) => {
    const rows = await prisma.indexData.findMany({ orderBy: { date: 'asc' } })
    reply.header('cache-control', 'public, max-age=300')
    const bySymbol: Record<string, { bars: Array<{ date: string; close: number }>; latest?: object }> = {}
    for (const r of rows) {
      const d = r.data as { symbol: string; name?: string; date: string; close: number }
      if (!bySymbol[d.symbol]) bySymbol[d.symbol] = { bars: [] }
      bySymbol[d.symbol].bars.push({ date: d.date, close: d.close })
      bySymbol[d.symbol].latest = d
    }
    return { indices: bySymbol }
  })

  app.get('/api/market/:symbol', async (req, reply) => {
    const { symbol } = req.params as { symbol: string }
    const rows = await prisma.indexData.findMany({
      where: { symbol },
      orderBy: { date: 'asc' }
    })
    reply.header('cache-control', 'public, max-age=300')
    return { symbol, bars: rows.map(r => (r.data as { date: string; close: number })) }
  })
}
