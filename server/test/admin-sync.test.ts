import { describe, expect, it } from 'vitest'
import { parseGitLog, nextVersion, isSemanticCommit, errKeyOf } from '../src/routes/admin'

describe('nextVersion 版本号 patch 递增', () => {
  it('无冲突时原样返回', () => {
    expect(nextVersion('1.2.3', new Set())).toBe('1.2.3')
  })

  it('patch+1 跳过已存在版本', () => {
    expect(nextVersion('1.2.3', new Set(['1.2.3']))).toBe('1.2.4')
    expect(nextVersion('1.2.3', new Set(['1.2.3', '1.2.4', '1.2.5']))).toBe('1.2.6')
  })

  it('patch 进位 minor 后继续跳过冲突', () => {
    expect(nextVersion('1.2.999', new Set(['1.2.999', '1.3.0']))).toBe('1.3.1')
  })

  it('非 semver 输入原样返回', () => {
    expect(nextVersion('beta', new Set())).toBe('beta')
  })
})

describe('isSemanticCommit 语义化提交判定', () => {
  it('chore/docs 提交被拒', () => {
    expect(isSemanticCommit('chore: 更新依赖')).toBe(false)
    expect(isSemanticCommit('docs: 补注释')).toBe(false)
    expect(isSemanticCommit('chore(deps): 升级')).toBe(false)
  })

  it('feat/fix 基本形式被接受', () => {
    expect(isSemanticCommit('feat: 新功能')).toBe(true)
    expect(isSemanticCommit('fix: 修复问题')).toBe(true)
  })

  it('feat(scope): 与 ! 变体被接受', () => {
    expect(isSemanticCommit('feat(kline): 蜡烛图')).toBe(true)
    expect(isSemanticCommit('fix(api)!: 破坏性修复')).toBe(true)
    expect(isSemanticCommit('refactor(core): 重构')).toBe(true)
    expect(isSemanticCommit('perf: 性能优化')).toBe(true)
  })

  it('缺冒号 / 伪前缀 / 纯文本被拒', () => {
    expect(isSemanticCommit('feat 缺冒号')).toBe(false)
    expect(isSemanticCommit('feature: 伪前缀')).toBe(false)
    expect(isSemanticCommit('普通提交信息')).toBe(false)
  })
})

describe('parseGitLog 解析 git log 原始输出', () => {
  it('按 \\x1e 分段、\\x1f 切字段', () => {
    const raw =
      'a1b2c3\u001ffeat: x\u001ffeat: x\n\nbody line\n\u001fAlice\u001f2026-01-02 03:04:05 +0800\u001e' +
      'd4e5f6\u001ffix: y\u001ffix: y\n\u001fBob\u001f2026-01-03 00:00:00 +0800\u001e'
    const list = parseGitLog(raw)
    expect(list).toHaveLength(2)
    expect(list[0]).toEqual({
      hash: 'a1b2c3',
      first: 'feat: x',
      full: 'feat: x\n\nbody line\n',
      author: 'Alice',
      date: '2026-01-02 03:04:05 +0800'
    })
    expect(list[1].hash).toBe('d4e5f6')
    expect(list[1].author).toBe('Bob')
  })

  it('空段与缺 hash 段被过滤', () => {
    expect(parseGitLog('\u001e\u001e')).toEqual([])
    expect(parseGitLog('')).toEqual([])
    // 多行 body 含 \x1e 之外的 \x1f 也应安全 (只按第一个 \x1f 切)
    const raw = 'a1b2c3\u001ffeat: m\u001fbody with \u001f inside\n\u001fAnn\u001f2026-05-01 00:00:00 +0800\u001e'
    const list = parseGitLog(raw)
    expect(list[0].hash).toBe('a1b2c3')
    expect(list[0].first).toBe('feat: m')
    expect(list[0].author).toBe('Ann')
  })
})

describe('errKeyOf 错误 key 归一', () => {
  it('去首尾空白', () => {
    expect(errKeyOf('  boom: connection refused  ')).toBe('boom: connection refused')
  })

  it('超长消息截断到 120 字', () => {
    expect(errKeyOf('x'.repeat(300))).toHaveLength(120)
    expect(errKeyOf('a'.repeat(119) + 'b' + 'c'.repeat(50))).toBe('a'.repeat(119) + 'b')
  })
})
