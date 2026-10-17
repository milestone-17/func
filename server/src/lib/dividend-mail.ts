/**
 * 红利分数日报邮件渲染 (不发送, 仅生成 {subject, html, text})
 * 发送统一走 mailer.sendNotificationMail (全局节流), 由 cron/dividend.ts 调度
 */
import type { DividendSnapshot } from './dividend-engine'

const SITE_URL = 'https://milestoneluo.top/func/dividend'

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function renderDividendMail(snapshot: DividendSnapshot): { subject: string; html: string; text: string } {
  const { date, market, stocks } = snapshot
  const subject = `红利分数 ${date} · 市场环境${market.tierLabel}`
  const top = stocks.slice(0, 10)

  const rowsHtml = top.map(s => `
      <tr>
        <td style="padding:4px 10px;text-align:center;">${s.rank}</td>
        <td style="padding:4px 10px;">${esc(s.code)}</td>
        <td style="padding:4px 10px;">${esc(s.name)}</td>
        <td style="padding:4px 10px;text-align:right;"><b>${s.totalScore.toFixed(1)}</b></td>
        <td style="padding:4px 10px;text-align:right;">${s.yieldPct.toFixed(2)}%</td>
      </tr>`).join('')

  const html = `
<div style="font-family:-apple-system,'Segoe UI',Arial,sans-serif;max-width:560px;margin:0 auto;color:#222;">
  <h2 style="margin:8px 0 4px;">红利分数日报 <span style="font-weight:normal;color:#888;">${esc(date)}</span></h2>
  <p style="margin:4px 0 12px;">市场环境分 <b>${market.marketScore}</b> / 100 · <b>${esc(market.tierLabel)}</b>
    （股债利差 5 年分位 ${(market.spreadPctile * 100).toFixed(1)}%，MA250 信号 ${market.ma250Signal === 100 ? '满仓' : '空仓'}，指数收盘 ${market.indexClose} / MA250 ${market.ma250}）</p>
  <p style="margin:4px 0 12px;color:#666;">样本池 ${snapshot.sampleCount} 只（跳过 ${snapshot.skippedCount} 只：分红数据缺失/连续分红不足 3 年/非高息初筛）</p>
  <table style="border-collapse:collapse;width:100%;font-size:13px;">
    <thead>
      <tr style="background:#f5f5f5;">
        <th style="padding:6px 10px;">排名</th>
        <th style="padding:6px 10px;text-align:left;">代码</th>
        <th style="padding:6px 10px;text-align:left;">名称</th>
        <th style="padding:6px 10px;text-align:right;">红利总分</th>
        <th style="padding:6px 10px;text-align:right;">股息率</th>
      </tr>
    </thead>
    <tbody>${rowsHtml}
    </tbody>
  </table>
  <p style="margin:14px 0 4px;">完整榜单与因子明细：<a href="${SITE_URL}">${SITE_URL}</a></p>
  <p style="margin:12px 0 4px;color:#999;font-size:12px;">总分 = 个股因子分×80% + 市场环境分×20%；数据来源东方财富，可能有延迟或误差。本邮件不构成投资建议，据此操作风险自负。</p>
</div>`

  const textLines = [
    `红利分数日报 ${date}`,
    `市场环境分 ${market.marketScore}/100 (${market.tierLabel}) · 利差分位 ${(market.spreadPctile * 100).toFixed(1)}% · MA250 信号 ${market.ma250Signal === 100 ? '满仓' : '空仓'}`,
    `样本池 ${snapshot.sampleCount} 只`,
    '',
    'Top 10:',
    ...top.map(s => `${s.rank}. ${s.code} ${s.name} 总分${s.totalScore.toFixed(1)} 股息率${s.yieldPct.toFixed(2)}%`),
    '',
    `详情: ${SITE_URL}`,
    '不构成投资建议。'
  ]

  return { subject, html, text: textLines.join('\n') }
}
