## Context

应用为本地优先 PWA,数据全部存于浏览器 IndexedDB(`func-db`)。已有备份导入/导出能力(`src/lib/backup.ts` → `downloadBackup()` / `importAll()`),以及 `AppSettings`(单例 `id:'app'`,经 `settingsRepo` 持久化)。本变更在此基础上增加"持久化存储申请"与"备份到期提醒",不引入新数据存储介质,仍完全本地。

参见 `proposal.md - Why`(动机)与 `specs/data-persistence/spec.md`(行为契约)。

## Goals / Non-Goals

**Goals**
- 启动时尽力申请 `navigator.storage.persist()`,全程容错(不阻塞、不抛错)。
- 记录最近备份时间,据此与用户可配阈值计算是否到期,到期时温和提醒。
- 提醒可"稍后提醒"推迟,推迟与阈值状态持久化。

**Non-Goals**
- 不做云端备份/同步(本地优先原则不变)。
- 不做自动定时导出到磁盘(浏览器无此能力;仍由用户主动导出)。
- 不改变现有备份文件格式或导入/导出契约。

## Decisions

### D1: 持久化封装为 `src/lib/persist.ts`
封装 `requestPersist(): Promise<'granted'|'denied'|'unsupported'>` 与 `isPersisted(): Promise<boolean|null>`。所有 `navigator.storage` 访问集中于此,内部对 `undefined`/异常做降级返回 `'unsupported'` / `null`。
- **备选**:直接在 `App.vue` 内联调用。否决:集中封装便于测试(可 mock)与复用,且隔离浏览器兼容判断。

### D2: 备份时间与提醒状态全部挂在 `AppSettings`(扩展现有字段)
新增字段:`lastBackupAt?: number`、`backupReminderDays?: number`(默认 30)、`backupReminderSnoozedAt?: number`、`storagePersisted?: boolean|null`。
- **备选 A**:新建独立 `meta` 记录。否决:这些是应用级偏好/状态,与现有 `AppSettings` 同类,单例更简单,读取一次即可。
- **备选 B**:用 `localStorage` 存提醒状态。否决:与 IndexedDB 数据源不一致,清缓存时状态与数据可能不同步丢失;统一进 IndexedDB。

### D3: 提醒判断为纯函数 `src/lib/backupReminder.ts`
导出 `shouldRemindBackup(opts: { lastBackupAt, firstDataAt, snoozedAt, reminderDays, now }): boolean` 与 `recordSnooze`/到期计算。纯函数便于单元测试(注入 `now`,无需真实延时)。
- "首次产生数据时间":用现有 ledger/持仓等最早记录的 `createdAt` 近似;若全空则不提醒(无数据无须备份)。

### D4: 导出成功后写回 `lastBackupAt`
在 `src/lib/backup.ts` 的 `downloadBackup()` 成功生成并触发下载后,调用 `settingsRepo.save({ lastBackupAt: Date.now() })`。失败(序列化等)不写回。
- **备选**:在 UI 层(Settings.vue)点击导出后写回。否决:放数据层更可靠,保证任何调用路径都更新。

### D5: 提醒 UI 为总览页卡片 + 可关闭
`Dashboard.vue` 顶部条件渲染一张提醒卡片(警告色调),含"立即备份"(跳 `/settings`)与"稍后提醒"(写 `backupReminderSnoozedAt`)。非模态、不阻断。
- **备选**:全局 toast。否决:备份提醒需要持续可见且可操作,卡片更合适。

## Risks / Trade-offs

- **[iOS Safari 持久化承诺弱]** → `persist()` 即便返回 `true`,iOS 仍可能在极端情况清理。→ 缓解:提醒机制作为第二道防线;设置页文案如实说明"降低概率,非绝对保证"。
- **[首次数据时间近似不准]** → 用最早记录 `createdAt` 近似"开始有数据",可能略偏。→ 可接受:仅影响首次提醒时机,不涉及数据正确性。
- **[提醒打扰]** → 默认 30 天较长、可关闭/推迟/调阈值,确保不打扰。
- **[`persist()` 权限提示]** → 部分浏览器可能弹权限提示。→ 仅在启动后异步静默申请一次,不主动打断。

## Migration Plan

1. 类型与 DEFAULTS 加字段(向后兼容,旧数据缺字段走默认)。
2. 实现 `persist.ts` / `backupReminder.ts` / 改 `backup.ts` / `App.vue` / `Dashboard.vue` / `Settings.vue`。
3. 加单元测试 + E2E 用例(导出后提醒消除、超阈值提醒)。
4. 部署:纯前端,无数据迁移脚本;旧 `AppSettings` 缺新字段自动补默认值。

**回滚**:还原代码即可;新增字段对旧版本无害(旧版忽略未知字段)。

## Open Questions

无。
