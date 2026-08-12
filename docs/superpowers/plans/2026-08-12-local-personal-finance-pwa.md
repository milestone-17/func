# 本地个人财务 PWA 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付一个本地优先的 PWA,实现 5 个核心功能(流水/预算/持仓/永久组合/智能定投),数据存手机 IndexedDB,部署到 GitHub Pages 供手机安装使用。

**Architecture:** Vue 3 SPA + IndexedDB 持久化 + Pinia 状态 + vite-plugin-pwa 离线 + GitHub Pages 部署。算法层用纯函数 + Vitest 单测,UI 层用 SFC 组件。

**Tech Stack:** Vue 3.4 / Vite 5 / TypeScript 5 / Pinia 2 / vue-router 4 / idb 8 / Chart.js 4 / vue-chartjs / Vitest 1.x / happy-dom / vite-plugin-pwa

**Spec:** `docs/superpowers/specs/2026-08-12-local-personal-finance-pwa-design.md`

---

## Global Constraints

- 金额一律**整数\"分\"**存储,UI 显示时除以 100
- IndexedDB 名 `func-db`,初始 schemaVersion 1
- 单用户/单账户/CNY+USD/仅中文
- 部署 URL `https://<user>.github.io/<repo>`,vite base = `/<repo>/`
- 软删除:`deletedAt` 字段,非物理删除
- TS strict;覆盖率:核心算法 100% 行,总体 ≥ 70%
- commit: conventional commits;不引入 ESLint/Prettier/CI

---

## 任务清单 (26 个)

- **Phase 1 基础**: Task 1-3 (脚手架 / DB / 金额工具)
- **Phase 2 算法 TDD**: Task 4-9 (档位表 / MA / 偏离 / DCA / PnL / 永久 / 汇率)
- **Phase 3 备份+数据源**: Task 10-11
- **Phase 4 仓储**: Task 12-14
- **Phase 5 Pinia**: Task 15-17
- **Phase 6 组件**: Task 18-19
- **Phase 7 页面**: Task 20-23
- **Phase 8 装配+部署**: Task 24-26

---

## Phase 1: 基础设施

### Task 1: 项目脚手架

**Files:**
- Create: `package.json`, `vite.config.ts`, `tsconfig.json`, `tsconfig.node.json`, `index.html`, `src/main.ts`, `src/App.vue`, `src/vite-env.d.ts`, `.gitignore`, `README.md`

**Interfaces:**
- Consumes: 无
- Produces: 可 `npm run dev` / `npm run build` / `npm test` 的项目骨架

- [ ] **Step 1: 初始化 package.json + 安装依赖**

```bash
cd /home/wf/workspace/func
npm init -y
npm i vue@^3.4 pinia@^2.1 vue-router@^4.3 idb@^8.0 chart.js@^4.4 vue-chartjs@^5.3
npm i -D vite@^5.2 @vitejs/plugin-vue@^5.0 vue-tsc@^2.0 typescript@^5.4 \
  vitest@^1.6 @vue/test-utils@^2.4 happy-dom@^14.0 \
  vite-plugin-pwa@^0.20 workbox-window@^7.1
```

- [ ] **Step 2: 写 tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2020", "useDefineForClassFields": true,
    "module": "ESNext", "moduleResolution": "bundler",
    "strict": true, "noUnusedLocals": true, "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "jsx": "preserve", "resolveJsonModule": true,
    "isolatedModules": true, "esModuleInterop": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable", "WebWorker"],
    "types": ["vite/client", "vitest/globals"],
    "skipLibCheck": true,
    "baseUrl": ".", "paths": { "@/*": ["src/*"] }
  },
  "include": ["src", "tests"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

- [ ] **Step 3: 写 tsconfig.node.json**

```json
{ "compilerOptions": { "composite": true, "module": "ESNext", "moduleResolution": "bundler", "skipLibCheck": true }, "include": ["vite.config.ts"] }
```

- [ ] **Step 4: 写 vite.config.ts**

```ts
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  base: '/func/',
  plugins: [vue(), VitePWA({
    registerType: 'autoUpdate',
    manifest: { name: '本地财务', short_name: '财务', theme_color: '#1f7a4d', icons: [] }
  })],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: { environment: 'happy-dom', globals: true, setupFiles: ['./tests/setup.ts'] }
})
```

- [ ] **Step 5: 写 index.html / src/main.ts / src/App.vue / vite-env.d.ts / .gitignore**

`index.html`:
```html
<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>本地财务</title></head><body><div id="app"></div><script type="module" src="/src/main.ts"></script></body></html>
```

`src/main.ts`:
```ts
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
createApp(App).use(createPinia()).mount('#app')
```

`src/App.vue`:
```vue
<script setup lang="ts"></script>
<template><h1>本地财务</h1></template>
```

`src/vite-env.d.ts`:
```ts
/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />
```

`.gitignore`:
```
node_modules dist .DS_Store *.local coverage
```

- [ ] **Step 6: 写 package.json scripts**

`package.json` 加 scripts 段:
```json
"scripts": {
  "dev": "vite", "build": "vue-tsc -b && vite build",
  "preview": "vite preview", "test": "vitest run", "test:watch": "vitest"
}
```

- [ ] **Step 7: 跑通测试套件**

```bash
mkdir -p tests
cat > tests/setup.ts <<'EOF'
import { afterEach } from 'vitest'
afterEach(() => {})
EOF
echo 'import { describe, it, expect } from "vitest"; describe("smoke",()=>{it("runs",()=>{expect(1).toBe(1)})})' > tests/smoke.test.ts
npm test
```
Expected: PASS, 1 test

- [ ] **Step 8: 跑通 build**

```bash
npm run build
```
Expected: `dist/` 目录创建,无 TS 错误

- [ ] **Step 9: 初始化 git 并 commit**

```bash
git init && git add -A && git commit -m "chore: scaffold vite+vue+ts+pwa project"
```

---

### Task 2: IndexedDB 数据库初始化

**Files:**
- Create: `src/repos/db.ts`, `src/types/common.ts`, `tests/unit/db.test.ts`

**Interfaces:**
- Consumes: `idb` 库
- Produces: `openDb()` 返回 `DBSchema` 类型的 Promise<IDBPDatabase>;`schemaVersion` 导出常量

- [ ] **Step 1: 写 src/types/common.ts**

```ts
export type ID = string
export type Timestamp = number  // ms
export type ISODate = string  // 'YYYY-MM-DD'
```

- [ ] **Step 2: 写失败的测试 tests/unit/db.test.ts**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { openDb, DB_NAME, SCHEMA_VERSION } from '@/repos/db'

describe('openDb', () => {
  beforeEach(async () => { indexedDB.deleteDatabase(DB_NAME) })

  it('exports DB_NAME and SCHEMA_VERSION', () => {
    expect(DB_NAME).toBe('func-db')
    expect(SCHEMA_VERSION).toBe(1)
  })

  it('creates database with all required object stores', async () => {
    const db = await openDb()
    const stores = [...db.objectStoreNames]
    expect(stores).toContain('transactions')
    expect(stores).toContain('categories')
    expect(stores).toContain('budgets')
    expect(stores).toContain('holdings')
    expect(stores).toContain('holdingTxns')
    expect(stores).toContain('permanentTargets')
    expect(stores).toContain('dcaConfigs')
    expect(stores).toContain('indexData')
    expect(stores).toContain('dcaExecutions')
    expect(stores).toContain('settings')
    expect(stores).toContain('meta')
    db.close()
  })

  it('opens same DB on second call', async () => {
    const a = await openDb(); a.close()
    const b = await openDb()
    expect(b.version).toBe(SCHEMA_VERSION)
    b.close()
  })
})
```

- [ ] **Step 3: 跑测试,确认失败**

```bash
npm test -- tests/unit/db.test.ts
```
Expected: FAIL (openDb not defined)

- [ ] **Step 4: 实现 src/repos/db.ts**

```ts
import { openDB, type DBSchema, type IDBPDatabase } from 'idb'

export const DB_NAME = 'func-db'
export const SCHEMA_VERSION = 1

export interface FuncDB extends DBSchema {
  transactions: { key: string; value: any; indexes: { 'by-date': string; 'by-type': string } }
  categories: { key: string; value: any }
  budgets: { key: string; value: any; indexes: { 'by-month': string } }
  holdings: { key: string; value: any; indexes: { 'by-symbol': string; 'by-type': string } }
  holdingTxns: { key: string; value: any; indexes: { 'by-holding': string; 'by-date': string } }
  permanentTargets: { key: string; value: any }
  dcaConfigs: { key: string; value: any }
  indexData: { key: string; value: any; indexes: { 'by-symbol': string; 'by-date': string } }
  dcaExecutions: { key: string; value: any; indexes: { 'by-config': string } }
  settings: { key: string; value: any }
  meta: { key: string; value: any }
}

let dbPromise: Promise<IDBPDatabase<FuncDB>> | null = null

export function openDb(): Promise<IDBPDatabase<FuncDB>> {
  if (!dbPromise) {
    dbPromise = openDB<FuncDB>(DB_NAME, SCHEMA_VERSION, {
      upgrade(db) {
        const tx = db.createObjectStore('transactions', { keyPath: 'id' })
        tx.createIndex('by-date', 'date'); tx.createIndex('by-type', 'type')
        db.createObjectStore('categories', { keyPath: 'id' })
        const b = db.createObjectStore('budgets', { keyPath: 'id' })
        b.createIndex('by-month', 'month')
        const h = db.createObjectStore('holdings', { keyPath: 'id' })
        h.createIndex('by-symbol', 'symbol'); h.createIndex('by-type', 'type')
        const ht = db.createObjectStore('holdingTxns', { keyPath: 'id' })
        ht.createIndex('by-holding', 'holdingId'); ht.createIndex('by-date', 'date')
        db.createObjectStore('permanentTargets', { keyPath: 'id' })
        db.createObjectStore('dcaConfigs', { keyPath: 'id' })
        const idx = db.createObjectStore('indexData', { keyPath: ['symbol', 'date'] })
        idx.createIndex('by-symbol', 'symbol'); idx.createIndex('by-date', 'date')
        const dx = db.createObjectStore('dcaExecutions', { keyPath: 'id' })
        dx.createIndex('by-config', 'configId')
        db.createObjectStore('settings', { keyPath: 'id' })
        db.createObjectStore('meta', { keyPath: 'key' })
      }
    })
  }
  return dbPromise
}

export function resetDbForTests() { dbPromise = null }
```

- [ ] **Step 5: 跑测试,确认通过**

```bash
npm test -- tests/unit/db.test.ts
```
Expected: PASS, 3 tests

- [ ] **Step 6: 改 tests/setup.ts 避免跨测试污染**

```ts
import { afterEach } from 'vitest'
import 'fake-indexeddb/auto'
afterEach(() => { indexedDB.deleteDatabase('func-db') })
```
并 `npm i -D fake-indexeddb`

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(db): init IndexedDB schema with 11 object stores"
```

---

### Task 3: 金额工具 (money)

**Files:**
- Create: `src/lib/money.ts`, `tests/unit/money.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: `yuanToFen(yuan: number): number`, `fenToYuan(fen: number): number`, `formatYuan(fen: number): string`, `roundYuanToFen(yuan: number): number`

- [ ] **Step 1: 写测试 tests/unit/money.test.ts**

```ts
import { describe, it, expect } from 'vitest'
import { yuanToFen, fenToYuan, formatYuan, roundYuanToFen } from '@/lib/money'

describe('money', () => {
  it('yuanToFen handles integers', () => { expect(yuanToFen(1)).toBe(100); expect(yuanToFen(0)).toBe(0) })
  it('yuanToFen rounds to nearest fen', () => { expect(yuanToFen(1.005)).toBe(101); expect(yuanToFen(1.004)).toBe(100) })
  it('yuanToFen handles negative', () => { expect(yuanToFen(-1.5)).toBe(-150) })
  it('fenToYuan', () => { expect(fenToYuan(100)).toBe(1); expect(fenToYuan(0)).toBe(0); expect(fenToYuan(1)).toBe(0.01) })
  it('roundYuanToFen', () => { expect(roundYuanToFen(1.005)).toBe(1.01); expect(roundYuanToFen(1.004)).toBe(1.00) })
  it('formatYuan formats with thousand separator and 2 decimals', () => {
    expect(formatYuan(0)).toBe('0.00')
    expect(formatYuan(100)).toBe('1.00')
    expect(formatYuan(123456789)).toBe('1,234,567.89')
    expect(formatYuan(-5000)).toBe('-50.00')
  })
})
```

- [ ] **Step 2: 跑测试,确认失败**

```bash
npm test -- tests/unit/money.test.ts
```

- [ ] **Step 3: 实现 src/lib/money.ts**

```ts
export function roundYuanToFen(yuan: number): number {
  return Math.round(yuan * 100) / 100
}

export function yuanToFen(yuan: number): number {
  return Math.round(yuan * 100)
}

export function fenToYuan(fen: number): number {
  return fen / 100
}

export function formatYuan(fen: number): string {
  const yuan = fen / 100
  return yuan.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
```

- [ ] **Step 4: 跑测试,确认通过**

```bash
npm test -- tests/unit/money.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(money): yuan<->fen conversion and formatting"
```

---

## Phase 2: 核心算法 TDD

### Task 4: 档位表查找 (lookupBucket)

**Files:**
- Create: `src/lib/table.ts`, `src/types/dca.ts`, `tests/unit/table.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: `lookupBucket(deviationPct: number): { rate: number; label: string; side: 'high'|'low'|'flat' }`

- [ ] **Step 1: 写 src/types/dca.ts (占位)**

```ts
export interface BucketResult {
  rate: number  // 相对扣款率,0.0~2.8
  label: string
  side: 'high' | 'low' | 'flat'
}
```

- [ ] **Step 2: 写测试 tests/unit/table.test.ts**

```ts
import { describe, it, expect } from 'vitest'
import { lookupBucket } from '@/lib/table'

describe('lookupBucket - 闭-开区间 [低,高),上界归下一档', () => {
  it('基准: deviation = 0 → 100%', () => {
    expect(lookupBucket(0)).toEqual({ rate: 1.0, label: '基准', side: 'flat' })
  })

  it('高位: 0 < x < 15 → 70%', () => {
    expect(lookupBucket(0.01).rate).toBe(0.7)
    expect(lookupBucket(7.5).rate).toBe(0.7)
    expect(lookupBucket(14.99).rate).toBe(0.7)
  })
  it('高位上界: deviation = 15 → 归下一档 40%', () => {
    expect(lookupBucket(15).rate).toBe(0.4)
  })
  it('高位: 15 ≤ x < 50 → 40%', () => {
    expect(lookupBucket(15).rate).toBe(0.4)
    expect(lookupBucket(49.99).rate).toBe(0.4)
  })
  it('高位: 50 ≤ x < 100 → 10%', () => {
    expect(lookupBucket(50).rate).toBe(0.1)
    expect(lookupBucket(99.99).rate).toBe(0.1)
  })
  it('高位: x ≥ 100 → 0%', () => {
    expect(lookupBucket(100).rate).toBe(0)
    expect(lookupBucket(200).rate).toBe(0)
  })

  it('低位: -5 < x ≤ 0 → 130%', () => {
    expect(lookupBucket(-0.01).rate).toBe(1.3)
    expect(lookupBucket(-2.5).rate).toBe(1.3)
    expect(lookupBucket(0).rate).toBe(1.0)  // 0 归基准
  })
  it('低位上界: deviation = -5 → 归下一档 160%', () => {
    expect(lookupBucket(-5).rate).toBe(1.6)
  })
  it('低位: -10 < x ≤ -5 → 160%', () => {
    expect(lookupBucket(-5).rate).toBe(1.6)
    expect(lookupBucket(-9.99).rate).toBe(1.6)
  })
  it('低位: -20 < x ≤ -10 → 190%', () => {
    expect(lookupBucket(-10).rate).toBe(1.9)
    expect(lookupBucket(-19.99).rate).toBe(1.9)
  })
  it('低位: -30 < x ≤ -20 → 220%', () => {
    expect(lookupBucket(-20).rate).toBe(2.2)
  })
  it('低位: -40 < x ≤ -30 → 250%', () => {
    expect(lookupBucket(-30).rate).toBe(2.5)
  })
  it('低位: x ≤ -40 → 280%', () => {
    expect(lookupBucket(-40).rate).toBe(2.8)
    expect(lookupBucket(-100).rate).toBe(2.8)
  })

  it('label 正确', () => {
    expect(lookupBucket(0).label).toBe('基准')
    expect(lookupBucket(10).label).toBe('高位 0-15%')
    expect(lookupBucket(-10).label).toBe('低位 5-10%')
    expect(lookupBucket(-50).label).toBe('低位 40%以上')
  })

  it('side 正确', () => {
    expect(lookupBucket(10).side).toBe('high')
    expect(lookupBucket(-10).side).toBe('low')
    expect(lookupBucket(0).side).toBe('flat')
  })
})
```

- [ ] **Step 3: 跑测试,确认失败**

```bash
npm test -- tests/unit/table.test.ts
```

- [ ] **Step 4: 实现 src/lib/table.ts**

```ts
import type { BucketResult } from '@/types/dca'

export function lookupBucket(deviationPct: number): BucketResult {
  // 闭-开区间 [低, 高), 上界归下一档
  // 高位
  if (deviationPct >= 100) return { rate: 0, label: '高位 100%以上', side: 'high' }
  if (deviationPct >= 50)  return { rate: 0.1, label: '高位 50-100%', side: 'high' }
  if (deviationPct >= 15)  return { rate: 0.4, label: '高位 15-50%', side: 'high' }
  if (deviationPct > 0)    return { rate: 0.7, label: '高位 0-15%', side: 'high' }
  // 基准
  if (deviationPct === 0)  return { rate: 1.0, label: '基准', side: 'flat' }
  // 低位
  if (deviationPct > -5)   return { rate: 1.3, label: '低位 0-5%', side: 'low' }
  if (deviationPct > -10)  return { rate: 1.6, label: '低位 5-10%', side: 'low' }
  if (deviationPct > -20)  return { rate: 1.9, label: '低位 10-20%', side: 'low' }
  if (deviationPct > -30)  return { rate: 2.2, label: '低位 20-30%', side: 'low' }
  if (deviationPct > -40)  return { rate: 2.5, label: '低位 30-40%', side: 'low' }
  return { rate: 2.8, label: '低位 40%以上', side: 'low' }
}
```

- [ ] **Step 5: 跑测试,确认通过**

```bash
npm test -- tests/unit/table.test.ts
```
Expected: 16 tests pass

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(dca): implement 10-tier bucket table lookup"
```

---

### Task 5: MA250 与偏离

**Files:**
- Create: `src/lib/ma.ts`, `src/lib/deviation.ts`, `tests/unit/ma.test.ts`, `tests/unit/deviation.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `computeMA250(closes: (number|null)[]): number | null`
  - `computeDeviation(close: number, ma: number): number`  // 返回百分点, e.g. 10 表示 +10%

- [ ] **Step 1: 写测试 tests/unit/ma.test.ts**

```ts
import { describe, it, expect } from 'vitest'
import { computeMA250 } from '@/lib/ma'

describe('computeMA250', () => {
  it('returns null when length < 250', () => {
    expect(computeMA250(new Array(249).fill(100))).toBeNull()
    expect(computeMA250([])).toBeNull()
  })
  it('returns average of last 250 closes when exactly 250', () => {
    const arr = new Array(250).fill(0).map((_, i) => i + 1)  // 1..250
    expect(computeMA250(arr)).toBe(125.5)
  })
  it('ignores nulls: returns null if any of last 250 is null', () => {
    const arr = new Array(250).fill(100)
    arr[100] = null
    expect(computeMA250(arr)).toBeNull()
  })
  it('uses only last 250 elements when more provided', () => {
    const arr = [...new Array(10).fill(0), ...new Array(250).fill(100)]
    expect(computeMA250(arr)).toBe(100)
  })
})
```

- [ ] **Step 2: 写测试 tests/unit/deviation.test.ts**

```ts
import { describe, it, expect } from 'vitest'
import { computeDeviation } from '@/lib/deviation'

describe('computeDeviation', () => {
  it('returns 0 when close == ma', () => { expect(computeDeviation(100, 100)).toBe(0) })
  it('returns positive when above', () => { expect(computeDeviation(110, 100)).toBe(10) })
  it('returns negative when below', () => { expect(computeDeviation(90, 100)).toBe(-10) })
  it('returns +100 when double', () => { expect(computeDeviation(200, 100)).toBe(100) })
  it('returns -50 when halved', () => { expect(computeDeviation(50, 100)).toBe(-50) })
  it('returns Infinity when ma=0 and close>0', () => { expect(computeDeviation(100, 0)).toBe(Infinity) })
  it('returns 0 when both 0', () => { expect(computeDeviation(0, 0)).toBe(0) })
})
```

- [ ] **Step 3: 跑测试,确认失败**

```bash
npm test -- tests/unit/ma.test.ts tests/unit/deviation.test.ts
```

- [ ] **Step 4: 实现 src/lib/ma.ts**

```ts
export function computeMA250(closes: (number | null)[]): number | null {
  const window = closes.slice(-250)
  if (window.length < 250) return null
  if (window.some(v => v === null || v === undefined || Number.isNaN(v as number))) return null
  const sum = window.reduce((a, b) => a + (b as number), 0)
  return sum / 250
}
```

- [ ] **Step 5: 实现 src/lib/deviation.ts**

```ts
export function computeDeviation(close: number, ma: number): number {
  if (ma === 0) return close === 0 ? 0 : Infinity
  return ((close - ma) / ma) * 100
}
```

- [ ] **Step 6: 跑测试,确认通过**

```bash
npm test -- tests/unit/ma.test.ts tests/unit/deviation.test.ts
```
Expected: 7 + 7 = 14 tests pass

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(dca): MA250 and deviation calculation"
```

---

### Task 6: 智能定投建议 (computeWeekSuggestion)

**Files:**
- Create: `src/lib/dca.ts`, `tests/unit/dca.test.ts`

**Interfaces:**
- Consumes: `lookupBucket`, `computeDeviation`
- Produces:
  - `computeWeekSuggestion(cfg, idx, weekIndex): { currentSplit, deviation, bucket, suggestedAmount, exceedsSplit, tableBase }`
  - `WeeklyDCAConfig { weeklySplits: [number,number,number,number] }`
  - `IndexSnapshot { close, ma250 }`

- [ ] **Step 1: 写测试 tests/unit/dca.test.ts**

```ts
import { describe, it, expect } from 'vitest'
import { computeWeekSuggestion } from '@/lib/dca'

const cfg = { weeklySplits: [200, 150, 150, 200] }

describe('computeWeekSuggestion', () => {
  it('基准: 偏离 0 → 当周分扣 × 100% = currentSplit', () => {
    const r = computeWeekSuggestion(cfg, { close: 100, ma250: 100 }, 1)
    expect(r.deviation).toBe(0)
    expect(r.suggestedAmount).toBe(200)
    expect(r.exceedsSplit).toBe(false)
    expect(r.bucket.label).toBe('基准')
  })

  it('高位: 偏离 +10% → 70%', () => {
    const r = computeWeekSuggestion(cfg, { close: 110, ma250: 100 }, 1)
    expect(r.suggestedAmount).toBe(140)
    expect(r.exceedsSplit).toBe(false)
  })

  it('低位: 偏离 -10% → 160% (第 2 周分扣 150)', () => {
    const r = computeWeekSuggestion(cfg, { close: 90, ma250: 100 }, 2)
    expect(r.suggestedAmount).toBe(240)  // 150 × 1.6
    expect(r.exceedsSplit).toBe(true)   // 240 > 150
  })

  it('低位: 偏离 -10% 但分扣高 → 不超限', () => {
    const r = computeWeekSuggestion(cfg, { close: 90, ma250: 100 }, 1)
    expect(r.suggestedAmount).toBe(320)  // 200 × 1.6
    expect(r.exceedsSplit).toBe(false)
  })

  it('极低位: 偏离 -50% → 280%', () => {
    const r = computeWeekSuggestion(cfg, { close: 50, ma250: 100 }, 1)
    expect(r.suggestedAmount).toBe(560)
    expect(r.exceedsSplit).toBe(true)
  })

  it('极高位: 偏离 +200% → 0%', () => {
    const r = computeWeekSuggestion(cfg, { close: 300, ma250: 100 }, 1)
    expect(r.suggestedAmount).toBe(0)
  })

  it('weekIndex 越界报错', () => {
    expect(() => computeWeekSuggestion(cfg, { close: 100, ma250: 100 }, 0)).toThrow()
    expect(() => computeWeekSuggestion(cfg, { close: 100, ma250: 100 }, 5)).toThrow()
  })
})
```

- [ ] **Step 2: 跑测试,确认失败**

```bash
npm test -- tests/unit/dca.test.ts
```

- [ ] **Step 3: 实现 src/lib/dca.ts**

```ts
import { lookupBucket } from '@/lib/table'
import { computeDeviation } from '@/lib/deviation'

export interface WeeklyDCAConfig { weeklySplits: [number, number, number, number] }
export interface IndexSnapshot { close: number; ma250: number }

export interface SuggestionResult {
  weekIndex: number
  currentSplit: number
  deviation: number
  bucket: { rate: number; label: string; side: 'high'|'low'|'flat' }
  suggestedAmount: number
  exceedsSplit: boolean
}

export function computeWeekSuggestion(
  cfg: WeeklyDCAConfig,
  idx: IndexSnapshot,
  weekIndex: 1 | 2 | 3 | 4
): SuggestionResult {
  if (weekIndex < 1 || weekIndex > 4) throw new Error('weekIndex must be 1-4')
  const currentSplit = cfg.weeklySplits[weekIndex - 1]
  const deviation = computeDeviation(idx.close, idx.ma250)
  const bucket = lookupBucket(deviation)
  const suggestedAmount = Math.round(currentSplit * bucket.rate)
  return {
    weekIndex,
    currentSplit,
    deviation,
    bucket,
    suggestedAmount,
    exceedsSplit: suggestedAmount > currentSplit
  }
}
```

- [ ] **Step 4: 跑测试,确认通过**

```bash
npm test -- tests/unit/dca.test.ts
```
Expected: 7 tests pass

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(dca): compute weekly suggestion with over-limit warning"
```

---

### Task 7: 持仓 PnL

**Files:**
- Create: `src/lib/pnl.ts`, `tests/unit/pnl.test.ts`

**Interfaces:**
- Produces: `computePnL(holding): { unrealized, unrealizedPct, totalCost, marketValue }`

- [ ] **Step 1: 写测试 tests/unit/pnl.test.ts**

```ts
import { describe, it, expect } from 'vitest'
import { computePnL } from '@/lib/pnl'

describe('computePnL', () => {
  it('盈利: currentPrice > avgCost', () => {
    const r = computePnL({ quantity: 100, avgCost: 5000, currentPrice: 6000 })
    expect(r.marketValue).toBe(600000)  // 分
    expect(r.totalCost).toBe(500000)
    expect(r.unrealized).toBe(100000)
    expect(r.unrealizedPct).toBe(20)
  })

  it('亏损', () => {
    const r = computePnL({ quantity: 100, avgCost: 5000, currentPrice: 4000 })
    expect(r.unrealized).toBe(-100000)
    expect(r.unrealizedPct).toBe(-20)
  })

  it('持平', () => {
    const r = computePnL({ quantity: 100, avgCost: 5000, currentPrice: 5000 })
    expect(r.unrealized).toBe(0)
    expect(r.unrealizedPct).toBe(0)
  })

  it('无 currentPrice: 返回 null pnl', () => {
    const r = computePnL({ quantity: 100, avgCost: 5000, currentPrice: null })
    expect(r.unrealized).toBeNull()
    expect(r.marketValue).toBeNull()
    expect(r.totalCost).toBe(500000)
  })

  it('avgCost=0 边界', () => {
    const r = computePnL({ quantity: 100, avgCost: 0, currentPrice: 5000 })
    expect(r.unrealizedPct).toBe(Infinity)
  })
})
```

- [ ] **Step 2: 跑测试,确认失败**

```bash
npm test -- tests/unit/pnl.test.ts
```

- [ ] **Step 3: 实现 src/lib/pnl.ts**

```ts
export interface PnLInput { quantity: number; avgCost: number; currentPrice: number | null }

export interface PnLResult {
  marketValue: number | null  // 分
  totalCost: number           // 分
  unrealized: number | null   // 分
  unrealizedPct: number | null  // 百分点
}

export function computePnL(input: PnLInput): PnLResult {
  const { quantity, avgCost, currentPrice } = input
  const totalCost = Math.round(avgCost * quantity)  // avgCost 已是分
  if (currentPrice === null || currentPrice === undefined) {
    return { marketValue: null, totalCost, unrealized: null, unrealizedPct: null }
  }
  const marketValue = Math.round(currentPrice * quantity)
  const unrealized = marketValue - totalCost
  const unrealizedPct = totalCost === 0 ? Infinity : (unrealized / totalCost) * 100
  return { marketValue, totalCost, unrealized, unrealizedPct }
}
```

- [ ] **Step 4: 跑测试,确认通过**

```bash
npm test -- tests/unit/pnl.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(portfolio): compute PnL with null-current-price handling"
```

---

### Task 8: 永久组合聚合与偏离

**Files:**
- Create: `src/lib/permanent.ts`, `tests/unit/permanent.test.ts`

**Interfaces:**
- Produces:
  - `aggregateByType(holdings, fxRate): Record<AssetType, number>` (各类型市值分,统一换算成 CNY)
  - `computePermanentDeviation(holdings, targets, fxRate): { actuals, deviations, total, alerts }`

- [ ] **Step 1: 写 src/types/permanent.ts**

```ts
export type AssetType = 'stock' | 'bond' | 'cash' | 'gold'
export interface HoldingForPerm { type: AssetType; marketValueCNY: number }
export interface PermTarget { assetType: AssetType; targetPercent: number }
```

- [ ] **Step 2: 写测试 tests/unit/permanent.test.ts**

```ts
import { describe, it, expect } from 'vitest'
import { aggregateByType, computePermanentDeviation } from '@/lib/permanent'

describe('permanent portfolio', () => {
  const holdings = [
    { type: 'stock', marketValueCNY: 300000 },
    { type: 'bond', marketValueCNY: 200000 },
    { type: 'cash', marketValueCNY: 250000 },
    { type: 'gold', marketValueCNY: 250000 }
  ] as any[]
  const targets = [
    { assetType: 'stock', targetPercent: 25 },
    { assetType: 'bond', targetPercent: 25 },
    { assetType: 'cash', targetPercent: 25 },
    { assetType: 'gold', targetPercent: 25 }
  ] as any[]

  it('aggregateByType sums by type', () => {
    const r = aggregateByType(holdings)
    expect(r.stock).toBe(300000); expect(r.bond).toBe(200000)
    expect(r.cash).toBe(250000); expect(r.gold).toBe(250000)
  })

  it('computePermanentDeviation: 完美匹配', () => {
    const r = computePermanentDeviation(holdings, targets, 5)
    expect(r.total).toBe(1000000)
    r.deviations.forEach(d => expect(d.deviation).toBe(0))
    expect(r.alerts).toEqual([])
  })

  it('computePermanentDeviation: 股票 30% 偏离 +5', () => {
    const h2 = [{ type: 'stock', marketValueCNY: 300000 },
                { type: 'bond', marketValueCNY: 233333 },
                { type: 'cash', marketValueCNY: 233333 },
                { type: 'gold', marketValueCNY: 233334 }] as any[]
    const r = computePermanentDeviation(h2, targets, 5)
    const stockDev = r.deviations.find(d => d.assetType === 'stock')!
    expect(stockDev.actualPercent).toBe(30)
    expect(stockDev.deviation).toBe(5)
    expect(r.alerts.some(a => a.assetType === 'stock')).toBe(true)
  })

  it('computePermanentDeviation: 空持仓 → 全 0 + 全 alert', () => {
    const r = computePermanentDeviation([], targets, 5)
    expect(r.total).toBe(0)
    r.deviations.forEach(d => expect(d.actualPercent).toBe(0))
    expect(r.alerts.length).toBe(4)
  })

  it('computePermanentDeviation: 阈值可配', () => {
    const h2 = [{ type: 'stock', marketValueCNY: 260000 },
                { type: 'bond', marketValueCNY: 246666 },
                { type: 'cash', marketValueCNY: 246666 },
                { type: 'gold', marketValueCNY: 246668 }] as any[]
    const r5 = computePermanentDeviation(h2, targets, 5)
    const r10 = computePermanentDeviation(h2, targets, 10)
    expect(r5.alerts.length).toBeGreaterThan(0)
    expect(r10.alerts.length).toBe(0)
  })
})
```

- [ ] **Step 3: 跑测试,确认失败**

```bash
npm test -- tests/unit/permanent.test.ts
```

- [ ] **Step 4: 实现 src/lib/permanent.ts**

```ts
import type { AssetType, HoldingForPerm, PermTarget } from '@/types/permanent'

export function aggregateByType(holdings: HoldingForPerm[]): Record<AssetType, number> {
  const init: Record<AssetType, number> = { stock: 0, bond: 0, cash: 0, gold: 0 }
  return holdings.reduce((acc, h) => {
    acc[h.type] = (acc[h.type] || 0) + h.marketValueCNY
    return acc
  }, init)
}

export interface PermDeviation {
  assetType: AssetType
  targetPercent: number
  actualPercent: number
  deviation: number  // 百分点
  marketValue: number  // 分
}

export interface PermResult {
  total: number
  deviations: PermDeviation[]
  alerts: PermDeviation[]
}

export function computePermanentDeviation(
  holdings: HoldingForPerm[],
  targets: PermTarget[],
  thresholdPct: number
): PermResult {
  const agg = aggregateByType(holdings)
  const total = Object.values(agg).reduce((a, b) => a + b, 0)
  const deviations: PermDeviation[] = targets.map(t => {
    const mv = agg[t.assetType] || 0
    const actualPercent = total === 0 ? 0 : (mv / total) * 100
    return {
      assetType: t.assetType,
      targetPercent: t.targetPercent,
      actualPercent,
      deviation: actualPercent - t.targetPercent,
      marketValue: mv
    }
  })
  const alerts = deviations.filter(d => Math.abs(d.deviation) > thresholdPct)
  return { total, deviations, alerts }
}
```

- [ ] **Step 5: 跑测试,确认通过**

```bash
npm test -- tests/unit/permanent.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(permanent): aggregate by type and compute deviation with threshold"
```

---

### Task 9: 货币换算

**Files:**
- Create: `src/lib/currency.ts`, `tests/unit/currency.test.ts`

**Interfaces:**
- Produces: `convertCurrency(amountFen, from, to, rate): number`;rate 表示 1 USD = X CNY

- [ ] **Step 1: 写测试 tests/unit/currency.test.ts**

```ts
import { describe, it, expect } from 'vitest'
import { convertCurrency } from '@/lib/currency'

describe('convertCurrency', () => {
  it('same currency: no conversion', () => {
    expect(convertCurrency(10000, 'CNY', 'CNY', 7.2)).toBe(10000)
  })
  it('USD to CNY: 100 USD = 720 CNY (rate 7.2)', () => {
    expect(convertCurrency(10000, 'USD', 'CNY', 7.2)).toBe(72000)  // 分→分
  })
  it('CNY to USD: 720 CNY = 100 USD', () => {
    expect(convertCurrency(72000, 'CNY', 'USD', 7.2)).toBe(10000)
  })
  it('rate=0 throws', () => {
    expect(() => convertCurrency(10000, 'USD', 'CNY', 0)).toThrow()
  })
  it('rate<0 throws', () => {
    expect(() => convertCurrency(10000, 'USD', 'CNY', -1)).toThrow()
  })
})
```

- [ ] **Step 2: 跑测试,确认失败**

```bash
npm test -- tests/unit/currency.test.ts
```

- [ ] **Step 3: 实现 src/lib/currency.ts**

```ts
export type Currency = 'CNY' | 'USD'

export function convertCurrency(
  amountFen: number,
  from: Currency,
  to: Currency,
  usdCnyRate: number
): number {
  if (usdCnyRate <= 0) throw new Error('usdCnyRate must be > 0')
  if (from === to) return amountFen
  if (from === 'USD' && to === 'CNY') return Math.round(amountFen * usdCnyRate)
  if (from === 'CNY' && to === 'USD') return Math.round(amountFen / usdCnyRate)
  throw new Error(`Unsupported currency: ${from} -> ${to}`)
}
```

- [ ] **Step 4: 跑测试,确认通过**

```bash
npm test -- tests/unit/currency.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(currency): CNY<->USD conversion with rate validation"
```

---

## Phase 3: 备份与外部数据

### Task 10: 备份/恢复 (serialize/deserialize/validate)

**Files:**
- Create: `src/lib/backup.ts`, `tests/unit/backup.test.ts`

**Interfaces:**
- Produces:
  - `serialize(state): BackupFile`
  - `validateBackup(obj): { ok: boolean, errors: string[] }`
  - `parseBackup(json: string): BackupFile | { error: string }`

- [ ] **Step 1: 写测试 tests/unit/backup.test.ts**

```ts
import { describe, it, expect } from 'vitest'
import { serialize, validateBackup, parseBackup } from '@/lib/backup'

const sample = {
  transactions: [{ id: 't1', date: '2026-01-01', type: 'expense', amount: 1000, categoryId: 'c1' }],
  categories: [{ id: 'c1', name: '餐饮', type: 'expense' }],
  budgets: [],
  holdings: [],
  holdingTxns: [],
  permanentTargets: [],
  dcaConfigs: [],
  indexData: [],
  dcaExecutions: [],
  settings: { id: 'app', baseCurrency: 'CNY' },
  meta: []
}

describe('backup', () => {
  it('serialize wraps with schemaVersion and exportedAt', () => {
    const b = serialize(sample)
    expect(b.schemaVersion).toBe(1)
    expect(b.exportedAt).toBeGreaterThan(0)
    expect(b.data).toEqual(sample)
  })

  it('validateBackup accepts valid data', () => {
    const r = validateBackup({ schemaVersion: 1, data: sample })
    expect(r.ok).toBe(true)
  })

  it('validateBackup rejects wrong schemaVersion', () => {
    const r = validateBackup({ schemaVersion: 99, data: sample })
    expect(r.ok).toBe(false)
    expect(r.errors.join('')).toContain('schemaVersion')
  })

  it('validateBackup rejects missing store', () => {
    const bad = { ...sample } as any; delete bad.transactions
    const r = validateBackup({ schemaVersion: 1, data: bad })
    expect(r.ok).toBe(false)
    expect(r.errors.join('')).toContain('transactions')
  })

  it('validateBackup rejects non-object', () => {
    const r = validateBackup('not json' as any)
    expect(r.ok).toBe(false)
  })

  it('parseBackup round-trips via JSON', () => {
    const json = JSON.stringify(serialize(sample))
    const p = parseBackup(json)
    expect('data' in p).toBe(true)
    if ('data' in p) expect(p.data.transactions).toEqual(sample.transactions)
  })

  it('parseBackup returns error on bad JSON', () => {
    const p = parseBackup('{ bad')
    expect('error' in p).toBe(true)
  })
})
```

- [ ] **Step 2: 跑测试,确认失败**

```bash
npm test -- tests/unit/backup.test.ts
```

- [ ] **Step 3: 实现 src/lib/backup.ts**

```ts
export const BACKUP_SCHEMA_VERSION = 1

export const ALL_STORES = [
  'transactions', 'categories', 'budgets', 'holdings', 'holdingTxns',
  'permanentTargets', 'dcaConfigs', 'indexData', 'dcaExecutions',
  'settings', 'meta'
] as const

export type StoreName = typeof ALL_STORES[number]

export interface BackupFile {
  schemaVersion: number
  exportedAt: number
  data: Record<StoreName, any[]>
}

export function serialize(data: Record<StoreName, any[]>): BackupFile {
  return { schemaVersion: BACKUP_SCHEMA_VERSION, exportedAt: Date.now(), data }
}

export interface ValidationResult { ok: boolean; errors: string[] }

export function validateBackup(input: unknown): ValidationResult {
  const errors: string[] = []
  if (typeof input !== 'object' || input === null) {
    return { ok: false, errors: ['root must be object'] }
  }
  const obj = input as any
  if (obj.schemaVersion !== BACKUP_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${BACKUP_SCHEMA_VERSION}, got ${obj.schemaVersion}`)
  }
  if (typeof obj.data !== 'object' || obj.data === null) {
    errors.push('data must be object')
    return { ok: false, errors }
  }
  for (const store of ALL_STORES) {
    if (!Array.isArray(obj.data[store])) errors.push(`data.${store} must be array`)
  }
  return { ok: errors.length === 0, errors }
}

export function parseBackup(json: string): BackupFile | { error: string } {
  let obj: unknown
  try { obj = JSON.parse(json) } catch (e) { return { error: 'JSON parse failed' } }
  const v = validateBackup(obj)
  if (!v.ok) return { error: v.errors.join('; ') }
  return obj as BackupFile
}
```

- [ ] **Step 4: 跑测试,确认通过**

```bash
npm test -- tests/unit/backup.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(backup): serialize/validate/parse backup files"
```

---

### Task 11: stooq CSV fetcher

**Files:**
- Create: `src/api/stooq.ts`, `src/lib/csv.ts`, `tests/unit/csv.test.ts`

**Interfaces:**
- Produces:
  - `parseStooqCsv(csv: string): { date, close }[]`
  - `fetchQQQHistory(): Promise<{ date, close }[]>` (使用 stooq URL)

- [ ] **Step 1: 写测试 tests/unit/csv.test.ts**

```ts
import { describe, it, expect } from 'vitest'
import { parseStooqCsv } from '@/lib/csv'

describe('parseStooqCsv', () => {
  it('parses standard stooq CSV', () => {
    const csv = `Date,Open,High,Low,Close,Volume
2026-01-02,100,105,99,104,1000000
2026-01-03,104,108,103,107,1200000`
    const r = parseStooqCsv(csv)
    expect(r).toEqual([
      { date: '2026-01-02', close: 104 },
      { date: '2026-01-03', close: 107 }
    ])
  })
  it('skips empty lines', () => {
    const csv = `Date,Close\n2026-01-02,100\n\n2026-01-03,101`
    const r = parseStooqCsv(csv)
    expect(r.length).toBe(2)
  })
  it('throws on missing Close column', () => {
    const csv = `Date,Open\n2026-01-02,100`
    expect(() => parseStooqCsv(csv)).toThrow()
  })
})
```

- [ ] **Step 2: 跑测试,确认失败**

```bash
npm test -- tests/unit/csv.test.ts
```

- [ ] **Step 3: 实现 src/lib/csv.ts**

```ts
export function parseStooqCsv(csv: string): { date: string; close: number }[] {
  const lines = csv.trim().split('\n').filter(l => l.trim())
  if (lines.length < 2) throw new Error('CSV too short')
  const header = lines[0].split(',').map(s => s.trim())
  const dateIdx = header.indexOf('Date')
  const closeIdx = header.indexOf('Close')
  if (dateIdx < 0 || closeIdx < 0) throw new Error('CSV missing Date or Close column')
  return lines.slice(1).map(line => {
    const cols = line.split(',')
    return { date: cols[dateIdx].trim(), close: parseFloat(cols[closeIdx]) }
  })
}
```

- [ ] **Step 4: 实现 src/api/stooq.ts**

```ts
import { parseStooqCsv } from '@/lib/csv'

const STOOQ_URL = 'https://stooq.com/q/d/l/?s=qqq.us&i=d'

export async function fetchQQQHistory(): Promise<{ date: string; close: number }[]> {
  const res = await fetch(STOOQ_URL)
  if (!res.ok) throw new Error(`stooq fetch failed: ${res.status}`)
  const csv = await res.text()
  return parseStooqCsv(csv)
}
```

- [ ] **Step 5: 跑测试,确认通过**

```bash
npm test -- tests/unit/csv.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(api): stooq CSV fetcher and parser"
```

---

## Phase 4: 仓储层

### Task 12: 流水 + 预算仓储

**Files:**
- Create: `src/types/ledger.ts`, `src/types/budget.ts`, `src/repos/transactionRepo.ts`, `src/repos/categoryRepo.ts`, `src/repos/budgetRepo.ts`, `tests/unit/transactionRepo.test.ts`

**Interfaces:**
- Produces (统一方法名 `list/get/put/softDelete`):
  - `transactionRepo.{listByMonth, get, put, softDelete}(...)`
  - `categoryRepo.{list, get, put, delete}`
  - `budgetRepo.{getByMonth, put, delete}`

- [ ] **Step 1: 写 src/types/ledger.ts**

```ts
import type { ID, ISODate, Timestamp } from './common'
export type TxType = 'income' | 'expense'
export interface Transaction {
  id: ID; date: ISODate; type: TxType; amount: number
  categoryId: ID; note?: string; createdAt: Timestamp; updatedAt: Timestamp
  deletedAt?: Timestamp
}
export interface Category {
  id: ID; name: string; type: 'income' | 'expense' | 'both'
  color: string; icon: string
}
```

- [ ] **Step 2: 写 src/types/budget.ts**

```ts
import type { ID, Timestamp } from './common'
export interface BudgetAllocation { categoryId: ID; amount: number; note?: string }
export interface BudgetPlan {
  id: ID; month: string; totalIncome: number
  allocations: BudgetAllocation[]; notes?: string
  createdAt: Timestamp; updatedAt: Timestamp
}
```

- [ ] **Step 3: 写仓储 src/repos/transactionRepo.ts**

```ts
import { openDb } from './db'
import type { Transaction } from '@/types/ledger'

export const transactionRepo = {
  async listByMonth(month: string): Promise<Transaction[]> {
    const db = await openDb()
    const all = await db.getAllFromIndex('transactions', 'by-date')
    return all.filter(t => t.date.startsWith(month) && !t.deletedAt) as Transaction[]
  },
  async get(id: string): Promise<Transaction | undefined> {
    return (await openDb()).get('transactions', id) as Promise<Transaction | undefined>
  },
  async put(tx: Transaction): Promise<void> {
    tx.updatedAt = Date.now()
    await (await openDb()).put('transactions', tx)
  },
  async softDelete(id: string): Promise<void> {
    const db = await openDb()
    const tx = await db.get('transactions', id) as Transaction | undefined
    if (!tx) return
    tx.deletedAt = Date.now()
    await db.put('transactions', tx)
  }
}
```

- [ ] **Step 4: 写仓储 src/repos/categoryRepo.ts**

```ts
import { openDb } from './db'
import type { Category } from '@/types/ledger'

export const categoryRepo = {
  async list(): Promise<Category[]> { return (await openDb()).getAll('categories') as Promise<Category[]> },
  async get(id: string) { return (await openDb()).get('categories', id) },
  async put(c: Category) { await (await openDb()).put('categories', c) },
  async delete(id: string) { await (await openDb()).delete('categories', id) }
}
```

- [ ] **Step 5: 写仓储 src/repos/budgetRepo.ts**

```ts
import { openDb } from './db'
import type { BudgetPlan } from '@/types/budget'

export const budgetRepo = {
  async getByMonth(month: string): Promise<BudgetPlan | undefined> {
    const db = await openDb()
    const all = await db.getAllFromIndex('budgets', 'by-month', month)
    return all[0] as BudgetPlan | undefined
  },
  async put(plan: BudgetPlan) {
    plan.updatedAt = Date.now()
    await (await openDb()).put('budgets', plan)
  },
  async delete(id: string) { await (await openDb()).delete('budgets', id) }
}
```

- [ ] **Step 6: 写测试 tests/unit/transactionRepo.test.ts**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { transactionRepo } from '@/repos/transactionRepo'
import 'fake-indexeddb/auto'

describe('transactionRepo', () => {
  beforeEach(async () => { indexedDB.deleteDatabase('func-db') })

  it('put + get round-trips', async () => {
    const tx = { id: 't1', date: '2026-01-15', type: 'expense', amount: 5000, categoryId: 'c1', createdAt: 0, updatedAt: 0 } as any
    await transactionRepo.put(tx)
    const got = await transactionRepo.get('t1')
    expect(got?.amount).toBe(5000)
    expect(got?.updatedAt).toBeGreaterThan(0)
  })

  it('listByMonth filters by month and excludes deleted', async () => {
    const tx1 = { id: 't1', date: '2026-01-15', type: 'expense', amount: 100, categoryId: 'c', createdAt: 0, updatedAt: 0 } as any
    const tx2 = { id: 't2', date: '2026-02-01', type: 'expense', amount: 200, categoryId: 'c', createdAt: 0, updatedAt: 0 } as any
    const tx3 = { id: 't3', date: '2026-01-20', type: 'expense', amount: 300, categoryId: 'c', createdAt: 0, updatedAt: 0, deletedAt: 1 } as any
    await transactionRepo.put(tx1)
    await transactionRepo.put(tx2)
    await transactionRepo.put(tx3)
    const list = await transactionRepo.listByMonth('2026-01')
    expect(list.length).toBe(1)
    expect(list[0].id).toBe('t1')
  })

  it('softDelete sets deletedAt', async () => {
    const tx = { id: 't1', date: '2026-01-15', type: 'expense', amount: 100, categoryId: 'c', createdAt: 0, updatedAt: 0 } as any
    await transactionRepo.put(tx)
    await transactionRepo.softDelete('t1')
    const got = await transactionRepo.get('t1')
    expect(got?.deletedAt).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 7: 跑测试,确认通过**

```bash
npm test -- tests/unit/transactionRepo.test.ts
```

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat(repos): transaction/category/budget repositories"
```

---

### Task 13: 持仓 + 永久组合仓储

**Files:**
- Create: `src/types/portfolio.ts`, `src/types/permanent.ts`, `src/repos/holdingRepo.ts`, `src/repos/holdingTxnRepo.ts`, `src/repos/permanentTargetRepo.ts`, `tests/unit/holdingRepo.test.ts`

- [ ] **Step 1: 写 src/types/portfolio.ts**

```ts
import type { ID, ISODate, Timestamp } from './common'
export type HoldingType = 'stock' | 'etf' | 'crypto' | 'bond' | 'cash' | 'gold'
export type Market = 'CN' | 'US' | 'HK'
export type Currency = 'CNY' | 'USD'
export interface Holding {
  id: ID; symbol: string; name: string; type: HoldingType
  market: Market; currency: Currency
  quantity: number; avgCost: number  // avgCost 是分
  currentPrice?: number; currentPriceAt?: Timestamp
  addedAt: Timestamp; notes?: string; deletedAt?: Timestamp
}
export type HoldingTxnType = 'buy' | 'sell' | 'dividend' | 'fee'
export interface HoldingTxn {
  id: ID; holdingId: ID; type: HoldingTxnType
  date: ISODate; quantity?: number; price?: number; amount?: number; fee?: number; note?: string
  createdAt: Timestamp
}
```

- [ ] **Step 2: 写 src/repos/holdingRepo.ts**

```ts
import { openDb } from './db'
import type { Holding } from '@/types/portfolio'

export const holdingRepo = {
  async list(): Promise<Holding[]> {
    const all = await (await openDb()).getAll('holdings')
    return all.filter(h => !h.deletedAt) as Holding[]
  },
  async get(id: string) { return (await openDb()).get('holdings', id) },
  async put(h: Holding) { await (await openDb()).put('holdings', h) },
  async softDelete(id: string) {
    const db = await openDb()
    const h = await db.get('holdings', id) as Holding | undefined
    if (!h) return
    h.deletedAt = Date.now()
    await db.put('holdings', h)
  },
  async updatePrice(id: string, price: number) {
    const db = await openDb()
    const h = await db.get('holdings', id) as Holding | undefined
    if (!h) return
    h.currentPrice = price
    h.currentPriceAt = Date.now()
    await db.put('holdings', h)
  }
}
```

- [ ] **Step 3: 写 src/repos/holdingTxnRepo.ts**

```ts
import { openDb } from './db'
import type { HoldingTxn } from '@/types/portfolio'

export const holdingTxnRepo = {
  async listByHolding(holdingId: string): Promise<HoldingTxn[]> {
    const all = await (await openDb()).getAllFromIndex('holdingTxns', 'by-holding', holdingId)
    return all.sort((a, b) => a.date.localeCompare(b.date)) as HoldingTxn[]
  },
  async put(t: HoldingTxn) { t.createdAt = t.createdAt || Date.now(); await (await openDb()).put('holdingTxns', t) },
  async delete(id: string) { await (await openDb()).delete('holdingTxns', id) }
}
```

- [ ] **Step 4: 写 src/repos/permanentTargetRepo.ts**

```ts
import { openDb } from './db'
import type { AssetType } from '@/types/permanent'

export interface PermTarget { id: string; assetType: AssetType; targetPercent: number }

export const permanentTargetRepo = {
  async list(): Promise<PermTarget[]> { return (await openDb()).getAll('permanentTargets') as Promise<PermTarget[]> },
  async put(t: PermTarget) { await (await openDb()).put('permanentTargets', t) },
  async ensureDefaults() {
    const list = await this.list()
    if (list.length === 0) {
      const defaults: PermTarget[] = [
        { id: 'p-stock', assetType: 'stock', targetPercent: 25 },
        { id: 'p-bond',  assetType: 'bond',  targetPercent: 25 },
        { id: 'p-cash',  assetType: 'cash',  targetPercent: 25 },
        { id: 'p-gold',  assetType: 'gold',  targetPercent: 25 }
      ]
      for (const d of defaults) await this.put(d)
    }
  }
}
```

- [ ] **Step 5: 写测试 tests/unit/holdingRepo.test.ts**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { holdingRepo } from '@/repos/holdingRepo'
import 'fake-indexeddb/auto'

describe('holdingRepo', () => {
  beforeEach(async () => { indexedDB.deleteDatabase('func-db') })

  it('put + list round-trips and excludes deleted', async () => {
    const h1 = { id: 'h1', symbol: 'QQQ', name: '纳指', type: 'etf', market: 'US', currency: 'USD', quantity: 10, avgCost: 30000, addedAt: 0 } as any
    const h2 = { id: 'h2', symbol: 'AAPL', name: '苹果', type: 'stock', market: 'US', currency: 'USD', quantity: 5, avgCost: 15000, addedAt: 0, deletedAt: 1 } as any
    await holdingRepo.put(h1)
    await holdingRepo.put(h2)
    const list = await holdingRepo.list()
    expect(list.length).toBe(1)
    expect(list[0].id).toBe('h1')
  })

  it('updatePrice sets price and timestamp', async () => {
    const h = { id: 'h1', symbol: 'QQQ', type: 'etf', market: 'US', currency: 'USD', quantity: 1, avgCost: 30000, addedAt: 0 } as any
    await holdingRepo.put(h)
    await holdingRepo.updatePrice('h1', 35000)
    const got = await holdingRepo.get('h1')
    expect(got?.currentPrice).toBe(35000)
    expect(got?.currentPriceAt).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 6: 跑测试,确认通过**

```bash
npm test -- tests/unit/holdingRepo.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(repos): holding/holdingTxn/permanentTarget repositories"
```

---

### Task 14: 智能定投 + 设置仓储

**Files:**
- Create: `src/types/dca.ts` (完整), `src/types/settings.ts`, `src/repos/dcaConfigRepo.ts`, `src/repos/indexDataRepo.ts`, `src/repos/dcaExecutionRepo.ts`, `src/repos/settingsRepo.ts`, `src/repos/metaRepo.ts`, `tests/unit/dcaConfigRepo.test.ts`

- [ ] **Step 1: 补全 src/types/dca.ts**

```ts
import type { ID, ISODate, Timestamp } from './common'
export interface BucketResult { rate: number; label: string; side: 'high'|'low'|'flat' }
export interface DCAConfig {
  id: ID; name: string; symbol: string
  monthlyBudget: number
  weeklySplits: [number, number, number, number]
  deviationAlertPercent: number
  createdAt: Timestamp; updatedAt: Timestamp
}
export interface IndexData {
  symbol: string; date: ISODate; close: number; ma250: number | null
  source: 'stooq' | 'manual' | 'cache'
  fetchedAt: Timestamp
}
export interface DCAExecution {
  id: ID; configId: ID; weekIndex: 1|2|3|4
  plannedAmount: number; suggestedByTable: number
  deviationPercent: number; tableBucket: string
  executedAt: Timestamp; note?: string
}
```

- [ ] **Step 2: 写 src/types/settings.ts**

```ts
import type { Currency } from './portfolio'
export interface AppSettings {
  id: 'app'
  baseCurrency: Currency
  usdCnyRate: number
  rateUpdatedAt: number
  lastIndexSync: { qqq?: number }
  schemaVersion: number
}
export interface MetaEntry { key: string; value: any }
```

- [ ] **Step 3: 写 src/repos/dcaConfigRepo.ts**

```ts
import { openDb } from './db'
import type { DCAConfig } from '@/types/dca'

export const dcaConfigRepo = {
  async list(): Promise<DCAConfig[]> { return (await openDb()).getAll('dcaConfigs') as Promise<DCAConfig[]> },
  async get(id: string) { return (await openDb()).get('dcaConfigs', id) },
  async put(c: DCAConfig) { c.updatedAt = Date.now(); await (await openDb()).put('dcaConfigs', c) },
  async delete(id: string) { await (await openDb()).delete('dcaConfigs', id) }
}
```

- [ ] **Step 4: 写 src/repos/indexDataRepo.ts**

```ts
import { openDb } from './db'
import type { IndexData } from '@/types/dca'

export const indexDataRepo = {
  async put(d: IndexData) { await (await openDb()).put('indexData', d) },
  async latest(symbol: string): Promise<IndexData | undefined> {
    const all = await (await openDb()).getAllFromIndex('indexData', 'by-symbol', symbol)
    if (all.length === 0) return undefined
    return all.sort((a, b) => b.date.localeCompare(a.date))[0] as IndexData
  },
  async listRecent(symbol: string, n: number): Promise<IndexData[]> {
    const all = await (await openDb()).getAllFromIndex('indexData', 'by-symbol', symbol)
    return all.sort((a, b) => b.date.localeCompare(a.date)).slice(0, n) as IndexData[]
  }
}
```

- [ ] **Step 5: 写 src/repos/dcaExecutionRepo.ts**

```ts
import { openDb } from './db'
import type { DCAExecution } from '@/types/dca'

export const dcaExecutionRepo = {
  async listByConfig(configId: string): Promise<DCAExecution[]> {
    const all = await (await openDb()).getAllFromIndex('dcaExecutions', 'by-config', configId)
    return all.sort((a, b) => a.executedAt - b.executedAt) as DCAExecution[]
  },
  async put(e: DCAExecution) { await (await openDb()).put('dcaExecutions', e) }
}
```

- [ ] **Step 6: 写 src/repos/settingsRepo.ts**

```ts
import { openDb } from './db'
import type { AppSettings } from '@/types/settings'

const DEFAULT_SETTINGS: AppSettings = {
  id: 'app', baseCurrency: 'CNY', usdCnyRate: 7.2,
  rateUpdatedAt: 0, lastIndexSync: {}, schemaVersion: 1
}

export const settingsRepo = {
  async get(): Promise<AppSettings> {
    const s = await (await openDb()).get('settings', 'app') as AppSettings | undefined
    return s || DEFAULT_SETTINGS
  },
  async put(s: AppSettings) { await (await openDb()).put('settings', s) }
}
```

- [ ] **Step 7: 写 src/repos/metaRepo.ts**

```ts
import { openDb } from './db'
export const metaRepo = {
  async get(key: string) {
    const r = await (await openDb()).get('meta', key)
    return r ? (r as any).value : undefined
  },
  async put(key: string, value: any) { await (await openDb()).put('meta', { key, value }) }
}
```

- [ ] **Step 8: 写测试 tests/unit/dcaConfigRepo.test.ts**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { dcaConfigRepo } from '@/repos/dcaConfigRepo'
import { settingsRepo } from '@/repos/settingsRepo'
import 'fake-indexeddb/auto'

describe('dcaConfigRepo + settingsRepo', () => {
  beforeEach(async () => { indexedDB.deleteDatabase('func-db') })

  it('dcaConfigRepo put + list', async () => {
    const c = { id: 'd1', name: 'QQQ', symbol: 'QQQ', monthlyBudget: 800, weeklySplits: [200,200,200,200], deviationAlertPercent: 5, createdAt: 0, updatedAt: 0 } as any
    await dcaConfigRepo.put(c)
    const list = await dcaConfigRepo.list()
    expect(list.length).toBe(1)
    expect(list[0].monthlyBudget).toBe(800)
  })

  it('settingsRepo defaults', async () => {
    const s = await settingsRepo.get()
    expect(s.baseCurrency).toBe('CNY')
    expect(s.usdCnyRate).toBe(7.2)
  })
})
```

- [ ] **Step 9: 跑测试,确认通过**

```bash
npm test -- tests/unit/dcaConfigRepo.test.ts
```

- [ ] **Step 10: Commit**

```bash
git add -A && git commit -m "feat(repos): dca/index/execution/settings/meta repositories"
```

---

## Phase 5: 状态管理 (Pinia)

### Task 15: settingsStore + ledgerStore

**Files:**
- Create: `src/stores/settings.ts`, `src/stores/ledger.ts`, `tests/unit/stores.test.ts`

- [ ] **Step 1: 写 src/stores/settings.ts**

```ts
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { settingsRepo } from '@/repos/settingsRepo'
import type { AppSettings } from '@/types/settings'

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<AppSettings | null>(null)
  async function load() { settings.value = await settingsRepo.get() }
  async function update(patch: Partial<AppSettings>) {
    const cur = settings.value || await settingsRepo.get()
    const next = { ...cur, ...patch }
    await settingsRepo.put(next)
    settings.value = next
  }
  return { settings, load, update }
})
```

- [ ] **Step 2: 写 src/stores/ledger.ts**

```ts
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { transactionRepo } from '@/repos/transactionRepo'
import { categoryRepo } from '@/repos/categoryRepo'
import type { Transaction, Category, TxType } from '@/types/ledger'

export const useLedgerStore = defineStore('ledger', () => {
  const transactions = ref<Transaction[]>([])
  const categories = ref<Category[]>([])

  async function loadMonth(month: string) {
    transactions.value = await transactionRepo.listByMonth(month)
    categories.value = await categoryRepo.list()
  }

  async function add(tx: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>) {
    const full: Transaction = { ...tx, id: crypto.randomUUID(), createdAt: Date.now(), updatedAt: Date.now() } as Transaction
    await transactionRepo.put(full)
    return full
  }

  async function remove(id: string) {
    await transactionRepo.softDelete(id)
    transactions.value = transactions.value.filter(t => t.id !== id)
  }

  const totals = computed(() => {
    const income = transactions.value.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0)
    const expense = transactions.value.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0)
    return { income, expense, net: income - expense }
  })

  return { transactions, categories, loadMonth, add, remove, totals }
})
```

- [ ] **Step 3: 写测试 tests/unit/stores.test.ts**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useSettingsStore } from '@/stores/settings'
import { useLedgerStore } from '@/stores/ledger'
import 'fake-indexeddb/auto'

describe('stores', () => {
  beforeEach(async () => { indexedDB.deleteDatabase('func-db'); setActivePinia(createPinia()) })

  it('settings store loads defaults', async () => {
    const s = useSettingsStore()
    await s.load()
    expect(s.settings?.baseCurrency).toBe('CNY')
  })

  it('ledger store add + totals', async () => {
    const l = useLedgerStore()
    await l.loadMonth('2026-01')
    await l.add({ date: '2026-01-05', type: 'income', amount: 100000, categoryId: 'c1' } as any)
    await l.add({ date: '2026-01-10', type: 'expense', amount: 30000, categoryId: 'c2' } as any)
    expect(l.transactions.length).toBe(2)
    expect(l.totals.income).toBe(100000)
    expect(l.totals.expense).toBe(30000)
    expect(l.totals.net).toBe(70000)
  })
})
```

- [ ] **Step 4: 跑测试,确认通过**

```bash
npm test -- tests/unit/stores.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(stores): settings + ledger pinia stores"
```

---

### Task 16: budgetStore + portfolioStore

**Files:**
- Create: `src/stores/budget.ts`, `src/stores/portfolio.ts`

- [ ] **Step 1: 写 src/stores/budget.ts**

```ts
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { budgetRepo } from '@/repos/budgetRepo'
import type { BudgetPlan } from '@/types/budget'

export const useBudgetStore = defineStore('budget', () => {
  const current = ref<BudgetPlan | null>(null)

  async function loadMonth(month: string) { current.value = await budgetRepo.getByMonth(month) || null }

  async function upsert(plan: Omit<BudgetPlan, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }) {
    const full: BudgetPlan = {
      ...plan, id: plan.id || `b-${plan.month}`,
      createdAt: current.value?.createdAt || Date.now(), updatedAt: Date.now()
    } as BudgetPlan
    await budgetRepo.put(full); current.value = full; return full
  }

  const totalAllocated = computed(() => current.value?.allocations.reduce((s, a) => s + a.amount, 0) || 0)
  const unallocated = computed(() => (current.value?.totalIncome || 0) - totalAllocated.value)

  return { current, loadMonth, upsert, totalAllocated, unallocated }
})
```

- [ ] **Step 2: 写 src/stores/portfolio.ts**

```ts
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { holdingRepo } from '@/repos/holdingRepo'
import { convertCurrency } from '@/lib/currency'
import { useSettingsStore } from './settings'
import { computePnL } from '@/lib/pnl'
import type { Holding } from '@/types/portfolio'

export const usePortfolioStore = defineStore('portfolio', () => {
  const holdings = ref<Holding[]>([])

  async function load() { holdings.value = await holdingRepo.list() }

  async function add(h: Omit<Holding, 'id' | 'addedAt'>) {
    const full: Holding = { ...h, id: crypto.randomUUID(), addedAt: Date.now() } as Holding
    await holdingRepo.put(full); await load(); return full
  }

  async function updatePrice(id: string, price: number) {
    await holdingRepo.updatePrice(id, price)
    const h = holdings.value.find(x => x.id === id)
    if (h) { h.currentPrice = price; h.currentPriceAt = Date.now() }
  }

  const enriched = computed(() => {
    const settings = useSettingsStore()
    const rate = settings.settings?.usdCnyRate || 7.2
    return holdings.value.map(h => {
      const pnl = computePnL(h)
      const mvCNY = pnl.marketValue === null ? null : convertCurrency(pnl.marketValue, h.currency, 'CNY', rate)
      return { ...h, pnl, marketValueCNY: mvCNY }
    })
  })

  const totalMarketValueCNY = computed(() => enriched.value.reduce((s, h) => s + (h.marketValueCNY || 0), 0))
  const totalUnrealizedCNY = computed(() => enriched.value.reduce((s, h) => {
    if (h.pnl.unrealized === null) return s
    return s + convertCurrency(h.pnl.unrealized, h.currency, 'CNY', rate(useSettingsStore()))
  }, 0))

  function rate(s: ReturnType<typeof useSettingsStore>) { return s.settings?.usdCnyRate || 7.2 }

  return { holdings, load, add, updatePrice, enriched, totalMarketValueCNY, totalUnrealizedCNY }
})
```

- [ ] **Step 3: 写测试 tests/unit/portfolioStore.test.ts**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { usePortfolioStore } from '@/stores/portfolio'
import { useSettingsStore } from '@/stores/settings'
import 'fake-indexeddb/auto'

describe('portfolioStore', () => {
  beforeEach(async () => { indexedDB.deleteDatabase('func-db'); setActivePinia(createPinia()) })

  it('add + updatePrice 通过 enriched 计算 PnL', async () => {
    const s = useSettingsStore(); await s.load()
    const p = usePortfolioStore(); await p.load()
    const added = await p.add({ symbol: 'QQQ', name: '纳指', type: 'etf', market: 'US', currency: 'USD', quantity: 10, avgCost: 30000 } as any)
    await p.updatePrice(added.id, 35000)  // 用真实 id
    expect(p.enriched.length).toBe(1)
    expect(p.enriched[0].pnl.unrealized).toBe(50000)  // (35000-30000)*10 = 50000 分
    expect(p.enriched[0].marketValueCNY).toBe(35000 * 10 * 7.2)  // 350000 USD分 → 2520000 CNY分
  })

  it('totalMarketValueCNY 累加多币种', async () => {
    const s = useSettingsStore(); await s.load()
    const p = usePortfolioStore(); await p.load()
    await p.add({ symbol: 'QQQ', name: '纳指', type: 'etf', market: 'US', currency: 'USD', quantity: 10, avgCost: 30000 } as any)
    await p.add({ symbol: '600519', name: '茅台', type: 'stock', market: 'CN', currency: 'CNY', quantity: 1, avgCost: 180000 } as any)
    const usd = p.enriched.find(h => h.symbol === 'QQQ')!
    await p.updatePrice(usd.id, 30000)
    expect(p.totalMarketValueCNY).toBe(30000 * 10 * 7.2 + 180000)
  })
})
```

- [ ] **Step 4: 跑测试,确认通过**

```bash
npm test -- tests/unit/portfolioStore.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(stores): budget + portfolio pinia stores"
```

---

### Task 17: permanentStore + dcaStore (含 eastmoney fetcher)

**Files:**
- Create: `src/api/eastmoney.ts`, `src/stores/permanent.ts`, `src/stores/dca.ts`, `tests/unit/dcaStore.test.ts`

- [ ] **Step 1: 写 src/api/eastmoney.ts (best-effort, 失败抛)**

```ts
export interface EMQuote { symbol: string; price: number }

export async function fetchEastmoneyQuote(symbol: string): Promise<EMQuote> {
  // secid: 1.600000=上证, 0.300760=创业板, 116.00700=港股; 简化处理只用通用接口
  const url = `https://push2.eastmoney.com/api/qt/stock/get?secid=1.${symbol}&fields=f43`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`eastmoney fetch failed: ${res.status}`)
  const json = await res.json()
  if (!json.data) throw new Error('eastmoney no data')
  return { symbol, price: json.data.f43 / 100 }  // 报价单位是厘
}
```

- [ ] **Step 2: 写 src/stores/permanent.ts**

```ts
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { permanentTargetRepo } from '@/repos/permanentTargetRepo'
import { usePortfolioStore } from './portfolio'
import { useSettingsStore } from './settings'
import { convertCurrency } from '@/lib/currency'
import { computePermanentDeviation, type HoldingForPerm } from '@/lib/permanent'
import type { AssetType } from '@/types/permanent'

export const usePermanentStore = defineStore('permanent', () => {
  const targets = ref<{ id: string; assetType: AssetType; targetPercent: number }[]>([])
  const threshold = ref(5)

  async function load() {
    await permanentTargetRepo.ensureDefaults()
    targets.value = await permanentTargetRepo.list()
  }

  async function setThreshold(t: number) { threshold.value = t }

  const result = computed(() => {
    const portfolio = usePortfolioStore()
    const settings = useSettingsStore()
    const rate = settings.settings?.usdCnyRate || 7.2
    const map: Record<AssetType, HoldingForPerm[]> = { stock: [], bond: [], cash: [], gold: [] }
    for (const h of portfolio.enriched) {
      if (h.type === 'stock' || h.type === 'etf') map.stock.push({ type: 'stock', marketValueCNY: h.marketValueCNY || 0 })
      else if (h.type === 'bond') map.bond.push({ type: 'bond', marketValueCNY: h.marketValueCNY || 0 })
      else if (h.type === 'cash') map.cash.push({ type: 'cash', marketValueCNY: h.marketValueCNY || 0 })
      else if (h.type === 'gold') map.gold.push({ type: 'gold', marketValueCNY: h.marketValueCNY || 0 })
    }
    const flat: HoldingForPerm[] = [...map.stock, ...map.bond, ...map.cash, ...map.gold]
    return computePermanentDeviation(flat, targets.value as any, threshold.value)
  })

  return { targets, threshold, load, setThreshold, result }
})
```

- [ ] **Step 3: 写 src/stores/dca.ts**

```ts
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { dcaConfigRepo } from '@/repos/dcaConfigRepo'
import { indexDataRepo } from '@/repos/indexDataRepo'
import { settingsRepo } from '@/repos/settingsRepo'
import { fetchQQQHistory } from '@/api/stooq'
import { computeMA250 } from '@/lib/ma'
import { computeWeekSuggestion, type IndexSnapshot } from '@/lib/dca'
import type { DCAConfig, IndexData } from '@/types/dca'

export const useDcaStore = defineStore('dca', () => {
  const config = ref<DCAConfig | null>(null)
  const indexData = ref<IndexData | null>(null)
  const syncing = ref(false)
  const lastSyncError = ref<string | null>(null)

  async function load() {
    const list = await dcaConfigRepo.list()
    config.value = list[0] || null
    if (config.value) {
      indexData.value = (await indexDataRepo.latest('QQQ')) || null
    }
  }

  async function upsertConfig(c: Omit<DCAConfig, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }) {
    const full: DCAConfig = { ...c, id: c.id || 'dca-qqq', createdAt: config.value?.createdAt || Date.now(), updatedAt: Date.now() } as DCAConfig
    await dcaConfigRepo.put(full); config.value = full
  }

  async function syncIndex(force = false) {
    if (syncing.value) return
    const settings = await settingsRepo.get()
    if (!force && settings.lastIndexSync.qqq && Date.now() - settings.lastIndexSync.qqq < 3600_000) return
    syncing.value = true; lastSyncError.value = null
    try {
      const rows = await fetchQQQHistory()
      const closes = rows.map(r => r.close)
      // 写入所有 (只保留最近 300 天)
      const keep = rows.slice(-300)
      const ma250 = computeMA250(closes)
      for (const r of keep) {
        await indexDataRepo.put({
          symbol: 'QQQ', date: r.date, close: r.close, ma250,
          source: 'stooq', fetchedAt: Date.now()
        })
      }
      indexData.value = (await indexDataRepo.latest('QQQ')) || null
      settings.lastIndexSync = { ...settings.lastIndexSync, qqq: Date.now() }
      await settingsRepo.put(settings)
    } catch (e: any) {
      lastSyncError.value = e.message || 'unknown'
    } finally { syncing.value = false }
  }

  async function setManualIndex(close: number, ma250: number | null) {
    const today = new Date().toISOString().slice(0, 10)
    await indexDataRepo.put({ symbol: 'QQQ', date: today, close, ma250, source: 'manual', fetchedAt: Date.now() })
    indexData.value = (await indexDataRepo.latest('QQQ')) || null
  }

  const suggestions = computed(() => {
    if (!config.value || !indexData.value) return []
    const snap: IndexSnapshot = { close: indexData.value.close, ma250: indexData.value.ma250 || indexData.value.close }
    return [1, 2, 3, 4].map(w => computeWeekSuggestion(config.value!, snap, w as 1|2|3|4))
  })

  return { config, indexData, syncing, lastSyncError, load, upsertConfig, syncIndex, setManualIndex, suggestions }
})
```

- [ ] **Step 4: 写测试 tests/unit/dcaStore.test.ts**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useDcaStore } from '@/stores/dca'
import 'fake-indexeddb/auto'

describe('dcaStore suggestions', () => {
  beforeEach(async () => { indexedDB.deleteDatabase('func-db'); setActivePinia(createPinia()) })

  it('no config → empty suggestions', async () => {
    const d = useDcaStore(); await d.load()
    expect(d.suggestions.length).toBe(0)
  })

  it('with config + index → 4 suggestions', async () => {
    const d = useDcaStore(); await d.load()
    await d.upsertConfig({ name: 'QQQ', symbol: 'QQQ', monthlyBudget: 800, weeklySplits: [200,200,200,200], deviationAlertPercent: 5 } as any)
    await d.setManualIndex(110, 100)  // +10% 偏离
    expect(d.suggestions.length).toBe(4)
    expect(d.suggestions[0].bucket.rate).toBe(0.7)  // 高位 0-15%
    expect(d.suggestions[0].suggestedAmount).toBe(140)
  })

  it('low deviation: -10% → 1.6x', async () => {
    const d = useDcaStore(); await d.load()
    await d.upsertConfig({ name: 'QQQ', symbol: 'QQQ', monthlyBudget: 800, weeklySplits: [200,200,200,200], deviationAlertPercent: 5 } as any)
    await d.setManualIndex(90, 100)
    expect(d.suggestions[0].bucket.rate).toBe(1.6)
    expect(d.suggestions[0].suggestedAmount).toBe(320)
  })
})
```

- [ ] **Step 5: 跑测试,确认通过**

```bash
npm test -- tests/unit/dcaStore.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(stores): permanent + dca (with stooq sync) pinia stores"
```

---

## Phase 6: 共享组件

### Task 18: AmountInput + ConfirmDialog + DatePicker

**Files:**
- Create: `src/components/AmountInput.vue`, `src/components/ConfirmDialog.vue`, `src/components/DatePicker.vue`, `tests/component/AmountInput.test.ts`

- [ ] **Step 1: 写 src/components/AmountInput.vue**

```vue
<script setup lang="ts">
import { computed } from 'vue'
import { yuanToFen, fenToYuan } from '@/lib/money'

const props = defineProps<{ modelValue: number; currency?: 'CNY' | 'USD' }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: number): void }>()

const display = computed({
  get: () => (props.modelValue / 100).toFixed(2),
  set: (v: string) => {
    const n = parseFloat(v)
    if (!isNaN(n)) emit('update:modelValue', yuanToFen(n))
  }
})
</script>

<template>
  <label class="amount-input">
    <span class="symbol">{{ currency === 'USD' ? '$' : '¥' }}</span>
    <input v-model="display" type="number" step="0.01" inputmode="decimal" />
  </label>
</template>

<style scoped>
.amount-input { display: inline-flex; align-items: center; border: 1px solid #ccc; border-radius: 6px; padding: 4px 8px; }
.symbol { margin-right: 4px; color: #666; }
input { border: 0; outline: 0; font-size: 16px; width: 100%; }
</style>
```

- [ ] **Step 2: 写 src/components/ConfirmDialog.vue**

```vue
<script setup lang="ts">
const props = defineProps<{ open: boolean; title: string; message: string; confirmText?: string; cancelText?: string }>()
const emit = defineEmits<{ (e: 'confirm'): void; (e: 'cancel'): void }>()
</script>

<template>
  <div v-if="open" class="backdrop" @click.self="emit('cancel')">
    <div class="dialog">
      <h3>{{ title }}</h3>
      <p>{{ message }}</p>
      <div class="actions">
        <button @click="emit('cancel')">{{ cancelText || '取消' }}</button>
        <button class="danger" @click="emit('confirm')">{{ confirmText || '确认' }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; z-index: 100; }
.dialog { background: #fff; border-radius: 12px; padding: 20px; max-width: 80vw; }
.actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }
.danger { background: #c0392b; color: #fff; border: 0; padding: 8px 16px; border-radius: 6px; }
.actions button { padding: 8px 16px; border-radius: 6px; border: 1px solid #ccc; background: #fff; }
</style>
```

- [ ] **Step 3: 写 src/components/DatePicker.vue**

```vue
<script setup lang="ts">
const props = defineProps<{ modelValue: string; label?: string }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>()
</script>

<template>
  <label class="date-picker">
    <span v-if="label">{{ label }}</span>
    <input type="date" :value="modelValue" @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)" />
  </label>
</template>

<style scoped>
.date-picker { display: flex; flex-direction: column; gap: 4px; }
input { padding: 8px; border: 1px solid #ccc; border-radius: 6px; font-size: 16px; }
</style>
```

- [ ] **Step 4: 写测试 tests/component/AmountInput.test.ts**

```ts
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import AmountInput from '@/components/AmountInput.vue'

describe('AmountInput', () => {
  it('displays value in yuan', () => {
    const w = mount(AmountInput, { props: { modelValue: 12345 } })
    const input = w.find('input').element as HTMLInputElement
    expect(input.value).toBe('123.45')
  })

  it('emits fen on input', async () => {
    const w = mount(AmountInput, { props: { modelValue: 0 } })
    await w.find('input').setValue('99.50')
    expect(w.emitted('update:modelValue')?.[0]).toEqual([9950])
  })

  it('shows $ for USD', () => {
    const w = mount(AmountInput, { props: { modelValue: 0, currency: 'USD' } })
    expect(w.find('.symbol').text()).toBe('$')
  })
})
```

- [ ] **Step 5: 跑测试,确认通过**

```bash
npm test -- tests/component/AmountInput.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(ui): AmountInput/ConfirmDialog/DatePicker components"
```

---

### Task 19: AppShell + Charts + DcaSuggestionCard

**Files:**
- Create: `src/components/AppShell.vue`, `src/components/BarChart.vue`, `src/components/PieChart.vue`, `src/components/DcaSuggestionCard.vue`, `src/components/CategoryChip.vue`

- [ ] **Step 1: 写 src/components/AppShell.vue**

```vue
<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router'
const route = useRoute(); const router = useRouter()
const tabs = [
  { path: '/ledger', icon: '📒', label: '流水' },
  { path: '/dca', icon: '📈', label: '定投' },
  { path: '/permanent', icon: '⚖️', label: '永久' },
  { path: '/portfolio', icon: '💼', label: '持仓' },
  { path: '/budget', icon: '🎯', label: '预算' }
]
</script>

<template>
  <div class="app-shell">
    <header>
      <h1>本地财务</h1>
      <button @click="router.push('/settings')" aria-label="设置">⚙️</button>
    </header>
    <main><slot /></main>
    <nav class="bottom-nav">
      <router-link v-for="t in tabs" :key="t.path" :to="t.path" :class="{ active: route.path.startsWith(t.path) }">
        <span class="icon">{{ t.icon }}</span>
        <span class="label">{{ t.label }}</span>
      </router-link>
    </nav>
  </div>
</template>

<style scoped>
.app-shell { display: flex; flex-direction: column; height: 100vh; }
header { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; border-bottom: 1px solid #eee; }
header h1 { font-size: 18px; margin: 0; }
main { flex: 1; overflow-y: auto; padding: 16px; padding-bottom: 80px; }
.bottom-nav { display: flex; position: fixed; bottom: 0; left: 0; right: 0; background: #fff; border-top: 1px solid #eee; }
.bottom-nav a { flex: 1; text-decoration: none; color: #666; text-align: center; padding: 8px 0; font-size: 12px; }
.bottom-nav a.active { color: #1f7a4d; }
.icon { display: block; font-size: 22px; }
</style>
```

- [ ] **Step 2: 写 src/components/BarChart.vue**

```vue
<script setup lang="ts">
import { Bar } from 'vue-chartjs'
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend } from 'chart.js'
ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend)
const props = defineProps<{ labels: string[]; values: number[]; label: string }>()
const data = { labels: props.labels, datasets: [{ label: props.label, data: props.values, backgroundColor: '#1f7a4d' }] }
</script>
<template><Bar :data="data" /></template>
```

- [ ] **Step 3: 写 src/components/PieChart.vue**

```vue
<script setup lang="ts">
import { Pie } from 'vue-chartjs'
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js'
ChartJS.register(ArcElement, Tooltip, Legend)
const props = defineProps<{ labels: string[]; values: number[] }>()
const colors = ['#1f7a4d', '#c0392b', '#2980b9', '#f39c12', '#8e44ad', '#16a085']
const data = { labels: props.labels, datasets: [{ data: props.values, backgroundColor: colors.slice(0, props.values.length) }] }
</script>
<template><Pie :data="data" /></template>
```

- [ ] **Step 4: 写 src/components/DcaSuggestionCard.vue**

```vue
<script setup lang="ts">
import { computed } from 'vue'
import { lookupBucket } from '@/lib/table'
import { formatYuan } from '@/lib/money'
const props = defineProps<{ weekIndex: 1|2|3|4; currentSplit: number; deviation: number; tableBase?: number }>()
const bucket = computed(() => lookupBucket(props.deviation))
const suggested = computed(() => Math.round(props.currentSplit * bucket.value.rate))
const exceeds = computed(() => suggested.value > props.currentSplit)
</script>
<template>
  <div class="dca-card" :class="bucket.side">
    <div class="week">第 {{ weekIndex }} 周</div>
    <div class="row">当周分扣: <b>{{ formatYuan(currentSplit) }}</b></div>
    <div class="row">偏离 MA250: <b :class="bucket.side">{{ deviation.toFixed(2) }}%</b></div>
    <div class="bucket">{{ bucket.label }} → {{ (bucket.rate * 100).toFixed(0) }}%</div>
    <div class="suggest">建议扣款: <b>{{ formatYuan(suggested) }}</b></div>
    <div v-if="exceeds" class="warn">⚠️ 超出当周分扣 {{ formatYuan(suggested - currentSplit) }},你决定</div>
  </div>
</template>
<style scoped>
.dca-card { border: 1px solid #eee; border-radius: 8px; padding: 12px; margin-bottom: 8px; }
.dca-card.high { border-color: #c0392b; background: #fdf3f3; }
.dca-card.low { border-color: #1f7a4d; background: #f3fdf6; }
.dca-card.flat { border-color: #ccc; }
.week { font-weight: bold; margin-bottom: 4px; }
.warn { color: #c0392b; margin-top: 8px; }
.suggest { font-size: 18px; margin-top: 8px; }
</style>
```

- [ ] **Step 5: 写 src/components/CategoryChip.vue**

```vue
<script setup lang="ts">
defineProps<{ name: string; color?: string; active?: boolean }>()
</script>
<template>
  <span class="chip" :class="{ active }" :style="{ background: color || '#eee' }">{{ name }}</span>
</template>
<style scoped>
.chip { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 12px; margin: 2px; }
.chip.active { outline: 2px solid #1f7a4d; }
</style>
```

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(ui): AppShell, charts, DcaSuggestionCard, CategoryChip"
```

---

## Phase 7: 页面

### Task 20: Dashboard + Ledger 页

**Files:**
- Create: `src/pages/Dashboard.vue`, `src/pages/Ledger.vue`

- [ ] **Step 1: 写 src/pages/Dashboard.vue**

```vue
<script setup lang="ts">
import { onMounted, computed } from 'vue'
import { useLedgerStore } from '@/stores/ledger'
import { useDcaStore } from '@/stores/dca'
import { formatYuan } from '@/lib/money'

const ledger = useLedgerStore(); const dca = useDcaStore()
const today = new Date().toISOString().slice(0, 7)
onMounted(async () => { await ledger.loadMonth(today); await dca.load() })

const todayStr = new Date().toISOString().slice(0, 10)
const todayTotals = computed(() => {
  const t = ledger.transactions.filter(x => x.date === todayStr)
  const income = t.filter(x => x.type === 'income').reduce((s, x) => s + x.amount, 0)
  const expense = t.filter(x => x.type === 'expense').reduce((s, x) => s + x.amount, 0)
  return { income, expense }
})
</script>
<template>
  <h2>今日</h2>
  <p>收入: {{ formatYuan(todayTotals.income) }} | 支出: {{ formatYuan(todayTotals.expense) }}</p>
  <h2>本月</h2>
  <p>收入: {{ formatYuan(ledger.totals.income) }}</p>
  <p>支出: {{ formatYuan(ledger.totals.expense) }}</p>
  <p>结余: {{ formatYuan(ledger.totals.net) }}</p>
  <h2>本周定投</h2>
  <p v-if="dca.suggestions[0]">建议: {{ formatYuan(dca.suggestions[0].suggestedAmount) }} ({{ dca.suggestions[0].bucket.label }})</p>
  <p v-else>未配置</p>
</template>
```

- [ ] **Step 2: 写 src/pages/Ledger.vue**

```vue
<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'
import { useLedgerStore } from '@/stores/ledger'
import AmountInput from '@/components/AmountInput.vue'
import DatePicker from '@/components/DatePicker.vue'
import CategoryChip from '@/components/CategoryChip.vue'
import { formatYuan } from '@/lib/money'

const ledger = useLedgerStore()
const month = ref(new Date().toISOString().slice(0, 7))
onMounted(() => ledger.loadMonth(month.value))

const showForm = ref(false)
const form = ref({ date: new Date().toISOString().slice(0, 10), type: 'expense' as 'income'|'expense', amount: 0, categoryId: '', note: '' })

async function save() {
  if (form.value.amount <= 0) return
  await ledger.add({ ...form.value } as any)
  showForm.value = false
  form.value.amount = 0; form.value.note = ''
}

const grouped = computed(() => {
  const m: Record<string, typeof ledger.transactions> = {}
  for (const t of ledger.transactions) (m[t.date] ||= []).push(t)
  return Object.entries(m).sort(([a],[b]) => b.localeCompare(a))
})
</script>
<template>
  <div class="ledger">
    <header><DatePicker v-model="month" label="月份" /><button @click="showForm = !showForm">+ 记一笔</button></header>
    <div v-if="showForm" class="form">
      <DatePicker v-model="form.date" />
      <select v-model="form.type"><option value="expense">支出</option><option value="income">收入</option></select>
      <AmountInput v-model="form.amount" />
      <select v-model="form.categoryId">
        <option v-for="c in ledger.categories" :key="c.id" :value="c.id">{{ c.name }}</option>
      </select>
      <input v-model="form.note" placeholder="备注" />
      <button @click="save">保存</button>
    </div>
    <div v-for="[date, items] in grouped" :key="date" class="day">
      <h3>{{ date }}</h3>
      <ul>
        <li v-for="t in items" :key="t.id">
          <CategoryChip :name="ledger.categories.find(c => c.id === t.categoryId)?.name || '?'" />
          <span>{{ t.note }}</span>
          <span :class="t.type">{{ formatYuan(t.amount) }}</span>
          <button @click="ledger.remove(t.id)">×</button>
        </li>
      </ul>
    </div>
  </div>
</template>
<style scoped>
header { display: flex; gap: 8px; align-items: end; margin-bottom: 12px; }
.form { display: grid; gap: 8px; padding: 12px; background: #f9f9f9; border-radius: 8px; margin-bottom: 12px; }
.day { margin-bottom: 16px; }
.day h3 { margin: 8px 0; }
li { display: flex; gap: 8px; align-items: center; padding: 6px 0; border-bottom: 1px solid #f0f0f0; }
li .income { color: #1f7a4d; }
li .expense { color: #c0392b; }
li button { margin-left: auto; background: none; border: 0; color: #999; }
</style>
```

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(pages): Dashboard + Ledger"
```

---

### Task 21: Budget + Portfolio 页

**Files:**
- Create: `src/pages/Budget.vue`, `src/pages/Portfolio.vue`

- [ ] **Step 1: 写 src/pages/Budget.vue**

```vue
<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'
import { useBudgetStore } from '@/stores/budget'
import { useLedgerStore } from '@/stores/ledger'
import AmountInput from '@/components/AmountInput.vue'
import { formatYuan } from '@/lib/money'

const budget = useBudgetStore(); const ledger = useLedgerStore()
const month = ref(new Date().toISOString().slice(0, 7))
onMounted(async () => { await budget.loadMonth(month.value); await ledger.loadMonth(month.value) })

const totalIncome = computed({
  get: () => budget.current?.totalIncome || 0,
  set: v => { budget.current && (budget.current.totalIncome = v) }
})

async function save() {
  if (!budget.current) return
  await budget.upsert({ ...budget.current })
}

const actualByCat = computed(() => {
  const m: Record<string, number> = {}
  for (const t of ledger.transactions) if (t.type === 'expense') m[t.categoryId] = (m[t.categoryId] || 0) + t.amount
  return m
})
</script>
<template>
  <div>
    <h2>本月预算</h2>
    <label>总收入(分)<AmountInput v-model="totalIncome" /></label>
    <div v-for="a in budget.current?.allocations || []" :key="a.categoryId" class="alloc">
      <span>{{ ledger.categories.find(c => c.id === a.categoryId)?.name }}</span>
      <AmountInput v-model="a.amount" />
      <span class="actual">实花: {{ formatYuan(actualByCat[a.categoryId] || 0) }}</span>
    </div>
    <p>未分配: {{ formatYuan(budget.unallocated) }}</p>
    <button @click="save">保存</button>
  </div>
</template>
<style scoped>
.alloc { display: flex; gap: 8px; align-items: center; padding: 8px 0; border-bottom: 1px solid #eee; }
.alloc .actual { margin-left: auto; color: #666; font-size: 12px; }
</style>
```

- [ ] **Step 2: 写 src/pages/Portfolio.vue**

```vue
<script setup lang="ts">
import { onMounted } from 'vue'
import { usePortfolioStore } from '@/stores/portfolio'
import { useSettingsStore } from '@/stores/settings'
import { formatYuan } from '@/lib/money'

const portfolio = usePortfolioStore(); const settings = useSettingsStore()
onMounted(async () => { await settings.load(); await portfolio.load() })

async function refresh() {
  for (const h of portfolio.holdings) {
    try {
      if (h.symbol === 'QQQ') {
        const { fetchQQQHistory } = await import('@/api/stooq')
        const r = await fetchQQQHistory()
        await portfolio.updatePrice(h.id, r[r.length - 1].close)
      } else if (h.market === 'CN') {
        const { fetchEastmoneyQuote } = await import('@/api/eastmoney')
        const q = await fetchEastmoneyQuote(h.symbol)
        await portfolio.updatePrice(h.id, Math.round(q.price * 100))  // 元 → 分
      }
      // HK/其他: 留手填
    } catch (e) {
      // 静默失败,UI 不报错,只在卡片上标"价格未更新"(Task 22 已实现)
      console.warn('refresh price failed for', h.symbol, e)
    }
  }
}
</script>
<template>
  <div>
    <h2>总市值: {{ formatYuan(portfolio.totalMarketValueCNY) }}</h2>
    <button @click="refresh">刷新价格</button>
    <ul>
      <li v-for="h in portfolio.enriched" :key="h.id">
        <div>
          <b>{{ h.name }}</b> ({{ h.symbol }}) {{ h.quantity }} @ {{ formatYuan(h.avgCost) }}
          <div v-if="h.pnl.marketValue !== null">现价 {{ formatYuan(h.currentPrice || 0) }} · 盈亏
            <span :class="h.pnl.unrealized! >= 0 ? 'pos' : 'neg'">
              {{ formatYuan(h.pnl.unrealized!) }} ({{ h.pnl.unrealizedPct!.toFixed(2) }}%)
            </span>
          </div>
          <div v-else>未设现价</div>
        </div>
      </li>
    </ul>
  </div>
</template>
<style scoped>
li { padding: 8px 0; border-bottom: 1px solid #eee; }
.pos { color: #c0392b; }  /* A 股习惯红涨 */
.neg { color: #1f7a4d; }
</style>
```

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(pages): Budget + Portfolio"
```

---

### Task 22: Permanent + DCA 页

**Files:**
- Create: `src/pages/Permanent.vue`, `src/pages/Dca.vue`

- [ ] **Step 1: 写 src/pages/Permanent.vue**

```vue
<script setup lang="ts">
import { onMounted, computed } from 'vue'
import { usePermanentStore } from '@/stores/permanent'
import { usePortfolioStore } from '@/stores/portfolio'
import { useSettingsStore } from '@/stores/settings'
import PieChart from '@/components/PieChart.vue'
import { formatYuan } from '@/lib/money'

const perm = usePermanentStore(); const portfolio = usePortfolioStore(); const settings = useSettingsStore()
onMounted(async () => { await settings.load(); await portfolio.load(); await perm.load() })

const pieData = computed(() => ({
  labels: perm.result.deviations.map(d => ({ stock: '股票', bond: '债券', cash: '现金', gold: '黄金' }[d.assetType])),
  values: perm.result.deviations.map(d => Math.round(d.marketValue / 100))
}))
</script>
<template>
  <div>
    <h2>永久组合</h2>
    <p>总市值: {{ formatYuan(perm.result.total) }}</p>
    <PieChart v-if="perm.result.total > 0" :labels="pieData.labels" :values="pieData.values" />
    <div v-for="d in perm.result.deviations" :key="d.assetType" class="row" :class="{ alert: Math.abs(d.deviation) > perm.threshold }">
      <span>{{ {stock:'股票',bond:'债券',cash:'现金',gold:'黄金'}[d.assetType] }}</span>
      <span>目标 {{ d.targetPercent }}% · 实际 {{ d.actualPercent.toFixed(1) }}%</span>
      <span :class="d.deviation > 0 ? 'pos' : 'neg'">{{ d.deviation > 0 ? '+' : '' }}{{ d.deviation.toFixed(1) }}%</span>
    </div>
    <p v-if="perm.result.alerts.length" class="rebalance">
      ⚠️ 偏离超阈值,建议再平衡: {{ perm.result.alerts.map(a => ({stock:'股票',bond:'债券',cash:'现金',gold:'黄金'}[a.assetType])).join('、') }}
    </p>
  </div>
</template>
<style scoped>
.row { display: flex; gap: 12px; padding: 8px 0; border-bottom: 1px solid #eee; }
.row.alert { background: #fdf3f3; }
.pos { color: #c0392b; } .neg { color: #1f7a4d; }
.rebalance { color: #c0392b; margin-top: 16px; }
</style>
```

- [ ] **Step 2: 写 src/pages/Dca.vue**

```vue
<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'
import { useDcaStore } from '@/stores/dca'
import DcaSuggestionCard from '@/components/DcaSuggestionCard.vue'
import AmountInput from '@/components/AmountInput.vue'
import { formatYuan } from '@/lib/money'

const dca = useDcaStore()
onMounted(() => dca.load())

const editing = ref(false)
const form = ref({ monthlyBudget: 0, weeklySplits: [0, 0, 0, 0] as [number, number, number, number], deviationAlertPercent: 5 })

function openEditor() {
  if (dca.config) {
    form.value = {
      monthlyBudget: dca.config.monthlyBudget,
      weeklySplits: [...dca.config.weeklySplits],
      deviationAlertPercent: dca.config.deviationAlertPercent
    }
  }
  editing.value = true
}

async function save() {
  await dca.upsertConfig({ name: 'QQQ', symbol: 'QQQ', ...form.value } as any)
  editing.value = false
}
async function sync() { await dca.syncIndex(true) }
</script>
<template>
  <div>
    <header>
      <h2>智能定投 (QQQ)</h2>
      <button @click="openEditor">⚙️ 配置</button>
    </header>

    <div v-if="editing" class="config">
      <label>月预算 <AmountInput v-model="form.monthlyBudget" /></label>
      <div v-for="(w, i) in form.weeklySplits" :key="i" class="week-cfg">
        第 {{ i+1 }} 周 <AmountInput v-model="form.weeklySplits[i]" />
      </div>
      <button @click="save">保存</button>
    </div>

    <section v-if="dca.indexData">
      <p>QQQ 收盘: {{ dca.indexData.close }} | MA250: {{ dca.indexData.ma250?.toFixed(2) || 'N/A' }}
        <button @click="sync">{{ dca.syncing ? '同步中…' : '同步' }}</button>
      </p>
      <p v-if="dca.lastSyncError" class="err">同步失败: {{ dca.lastSyncError }} (使用缓存)</p>
    </section>
    <section v-else>
      <p>无指数数据,<button @click="sync">立即拉取</button></p>
    </section>

    <section v-if="dca.config">
      <p>月预算: {{ formatYuan(dca.config.monthlyBudget) }}</p>
      <DcaSuggestionCard v-for="s in dca.suggestions" :key="s.weekIndex" :week-index="s.weekIndex" :current-split="s.currentSplit" :deviation="s.deviation" />
    </section>
    <p v-else>请先配置月预算和 4 周分摊</p>
  </div>
</template>
<style scoped>
header { display: flex; justify-content: space-between; align-items: center; }
.config { background: #f9f9f9; padding: 12px; border-radius: 8px; margin: 12px 0; }
.week-cfg { display: flex; gap: 8px; align-items: center; margin: 4px 0; }
.err { color: #c0392b; font-size: 12px; }
</style>
```

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(pages): Permanent + DCA"
```

---

### Task 23: Settings 页 (含备份/恢复 UI)

**Files:**
- Create: `src/pages/Settings.vue`

- [ ] **Step 1: 写 src/pages/Settings.vue**

```vue
<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import { useLedgerStore } from '@/stores/ledger'
import { serialize, parseBackup, type StoreName, ALL_STORES } from '@/lib/backup'
import * as reposMod from '@/repos'
import AmountInput from '@/components/AmountInput.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import { openDb } from '@/repos/db'

const settings = useSettingsStore()
const ledger = useLedgerStore()
onMounted(() => settings.load())

const fileInput = ref<HTMLInputElement | null>(null)
const confirmImport = ref(false)
const importData = ref<any>(null)
const message = ref('')

async function exportBackup() {
  const db = await openDb()
  const data: any = {}
  for (const s of ALL_STORES) data[s] = await db.getAll(s)
  const json = JSON.stringify(serialize(data), null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `func-backup-${new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16)}.json`
  a.click()
  URL.revokeObjectURL(url)
  message.value = '已导出'
}

function onFile(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (!f) return
  const reader = new FileReader()
  reader.onload = () => {
    const r = parseBackup(reader.result as string)
    if ('error' in r) { message.value = '导入失败: ' + r.error; return }
    importData.value = r
    confirmImport.value = true
  }
  reader.readAsText(f)
}

async function doImport() {
  if (!importData.value) return
  const db = await openDb()
  const tx = db.transaction(ALL_STORES as any, 'readwrite')
  for (const s of ALL_STORES) {
    const store = tx.objectStore(s)
    await store.clear()
    for (const row of importData.value.data[s] || []) await store.put(row)
  }
  await tx.done
  confirmImport.value = false
  message.value = '已导入,请刷新页面'
}

async function clearAll() {
  const db = await openDb()
  const tx = db.transaction(ALL_STORES as any, 'readwrite')
  for (const s of ALL_STORES) await tx.objectStore(s).clear()
  await tx.done
  message.value = '已清空,刷新页面'
}
</script>
<template>
  <div>
    <h2>设置</h2>
    <section>
      <h3>币种</h3>
      <label>USD/CNY 汇率 <AmountInput v-model="settings.settings!.usdCnyRate" currency="USD" /></label>
      <button @click="settings.update({ usdCnyRate: settings.settings!.usdCnyRate })">保存</button>
    </section>
    <section>
      <h3>数据</h3>
      <button @click="exportBackup">导出备份 (JSON)</button>
      <input ref="fileInput" type="file" accept=".json" @change="onFile" style="display:none" />
      <button @click="fileInput?.click()">导入备份</button>
      <button class="danger" @click="clearAll">清空所有数据</button>
    </section>
    <p v-if="message">{{ message }}</p>
    <ConfirmDialog :open="confirmImport" title="确认导入" message="将覆盖当前所有数据,确定?" @confirm="doImport" @cancel="confirmImport = false" />
  </div>
</template>
<style scoped>
section { margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid #eee; }
.danger { background: #c0392b; color: #fff; border: 0; padding: 8px 16px; border-radius: 6px; margin-left: 8px; }
button { padding: 8px 16px; border-radius: 6px; border: 1px solid #ccc; background: #fff; }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add -A && git commit -m "feat(pages): Settings with backup/restore UI"
```

---

## Phase 8: 最终装配与部署

### Task 24: Router + main.ts 装配

**Files:**
- Modify: `src/main.ts`, `src/App.vue`
- Create: `src/router/index.ts`

- [ ] **Step 1: 写 src/router/index.ts**

```ts
import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import Dashboard from '@/pages/Dashboard.vue'
import Ledger from '@/pages/Ledger.vue'
import Budget from '@/pages/Budget.vue'
import Portfolio from '@/pages/Portfolio.vue'
import Permanent from '@/pages/Permanent.vue'
import Dca from '@/pages/Dca.vue'
import Settings from '@/pages/Settings.vue'

const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/dashboard' },
  { path: '/dashboard', component: Dashboard },
  { path: '/ledger', component: Ledger },
  { path: '/budget', component: Budget },
  { path: '/portfolio', component: Portfolio },
  { path: '/permanent', component: Permanent },
  { path: '/dca', component: Dca },
  { path: '/settings', component: Settings }
]

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes
})
```

- [ ] **Step 2: 改写 src/main.ts**

```ts
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from './router'

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')
```

- [ ] **Step 3: 改写 src/App.vue (使用 AppShell)**

```vue
<script setup lang="ts">
import AppShell from '@/components/AppShell.vue'
</script>
<template>
  <AppShell>
    <router-view />
  </AppShell>
</template>
```

- [ ] **Step 4: 跑 build,确认无 TS 错误**

```bash
npm run build
```
Expected: dist/ created, no errors

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(app): wire router and AppShell"
```

---

### Task 25: PWA 配置 (manifest, icons, service worker)

**Files:**
- Modify: `vite.config.ts`, `public/manifest.webmanifest`
- Create: `public/icon-192.png`, `public/icon-512.png` (用任意现有 PNG 代替,v1 简化为占位)
- Create: `scripts/gen-icons.mjs` (可选:生成纯色占位 PNG)

- [ ] **Step 1: 改 vite.config.ts,加 manifest 完整配置**

```ts
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  base: '/func/',
  plugins: [vue(), VitePWA({
    registerType: 'autoUpdate',
    includeAssets: ['icon-192.png', 'icon-512.png', 'apple-touch-icon.png'],
    manifest: {
      name: '本地个人财务',
      short_name: '本地财务',
      description: '本地优先的个人财务 PWA',
      theme_color: '#1f7a4d',
      background_color: '#ffffff',
      display: 'standalone',
      start_url: '/func/',
      scope: '/func/',
      icons: [
        { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
      ]
    },
    workbox: { globPatterns: ['**/*.{js,css,html,ico,png,svg,json}'] }
  })],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: { environment: 'happy-dom', globals: true, setupFiles: ['./tests/setup.ts'] }
})
```

- [ ] **Step 2: 生成纯色占位图标 (1x1 PNG,实际用任意工具替换)**

```bash
mkdir -p public
# 用 Node 生成 1x1 绿色 PNG 作为占位 (实际发布前替换)
node -e "
const fs=require('fs');
// 最小 1x1 绿色 PNG (base64)
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4//8/AwAI/AL+0jpQ8AAAAABJRU5ErkJggg==','base64');
fs.writeFileSync('public/icon-192.png',png);
fs.writeFileSync('public/icon-512.png',png);
fs.writeFileSync('public/apple-touch-icon.png',png);
console.log('placeholders created');
"
```

- [ ] **Step 3: 跑 build,确认 PWA 生成**

```bash
npm run build
ls dist/ | grep -E "manifest|sw|workbox"
```
Expected: `manifest.webmanifest`, `sw.js` 或 `registerSW.js`,`workbox-*.js` 等

- [ ] **Step 4: 跑 dev,在浏览器打开,确认 console 无 SW 注册错误**

```bash
npm run dev &
sleep 3 && curl -s http://localhost:5173/ | head -20
kill %1
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(pwa): manifest, service worker, placeholder icons"
```

---

### Task 26: GitHub Actions 部署 + README

**Files:**
- Create: `.github/workflows/deploy.yml`, `README.md`

- [ ] **Step 1: 写 .github/workflows/deploy.yml**

```yaml
name: Deploy to GitHub Pages
on:
  push:
    branches: [main]
permissions:
  contents: read
  pages: write
  id-token: write
jobs:
  build-deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'npm' }
      - run: npm ci
      - run: npm test
      - run: npm run build
      - uses: actions/configure-pages@v4
      - uses: actions/upload-pages-artifact@v3
        with: { path: dist }
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 2: 写 README.md**

````markdown
# 本地个人财务 PWA

本地优先的个人财务工具,数据永远在手机 IndexedDB。

## 功能

1. 流水 (花销/收入)
2. 月预算分配
3. 持仓与股票收益
4. 永久组合建议 (Harry Browne 25/25/25/25)
5. 智能定投 (纳指 100,基于 250 日均线 + 档位表)

## 本地开发

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # 跑测试
npm run build      # 产出 dist/
```

## 部署

1. 推到 GitHub
2. Settings → Pages → Source: GitHub Actions
3. 等待 workflow 跑完,访问 `https://<user>.github.io/<repo>/`

## 手机使用

1. 浏览器打开部署 URL
2. 菜单 → 添加到主屏
3. 像 App 一样启动,数据存手机本地

## 文档

- 设计: `docs/superpowers/specs/2026-08-12-local-personal-finance-pwa-design.md`
- 计划: `docs/superpowers/plans/2026-08-12-local-personal-finance-pwa.md`
````

- [ ] **Step 3: 验证 build + test 全过**

```bash
npm test && npm run build
```
Expected: all tests pass, dist/ created

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "ci: GitHub Pages deploy workflow + README"
```

---

## 验收清单

跑完所有 26 个 task 后,跑下面确认:

```bash
npm test            # 全套测试通过
npm run build       # 构建无错
```

部署到 GitHub Pages 后,按 spec §9.4 跑手机手测清单:
- [ ] iOS Safari PWA 安装
- [ ] Android Chrome PWA 安装
- [ ] 飞行模式可看缓存
- [ ] 流水 增/改/删
- [ ] 智能定投: 4 周分摊 + QQQ 同步 + 建议合理
- [ ] 永久组合: 加 A 股+美股 + 偏离计算
- [ ] 备份导出 → JSON 正确
- [ ] 备份导入恢复
- [ ] 横竖屏切换不丢数据
- [ ] 杀后台重开数据还在
