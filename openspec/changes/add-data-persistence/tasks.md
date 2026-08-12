## 1. 数据模型与持久化封装

- [x] 1.1 `src/types/settings.ts`: `AppSettings` 增加 `lastBackupAt?: number|null`、`backupReminderDays?: number`(默认 30)、`backupReminderSnoozedAt?: number|null`、`storagePersisted?: boolean|null`
- [x] 1.2 `src/repos/settingsRepo.ts`: DEFAULTS 补充新字段默认值(`lastBackupAt:null, backupReminderDays:30, backupReminderSnoozedAt:null, storagePersisted:null`)
- [x] 1.3 新建 `src/lib/persist.ts`: `requestPersist()` → `'granted'|'denied'|'unsupported'`(对 `navigator.storage` 缺失/异常降级),`isPersisted()` → `boolean|null`
- [x] 1.4 新建 `src/lib/backupReminder.ts`: 纯函数 `shouldRemindBackup({lastBackupAt, firstDataAt, snoozedAt, reminderDays, now})` 与 `daysSince(ts, now)`

## 2. 备份时间写回

- [x] 2.1 `src/lib/backup.ts`: `downloadBackup()` 成功触发下载后调用 `settingsRepo.save({ lastBackupAt: Date.now() })`;失败不写回

## 3. 启动时持久化申请

- [x] 3.1 `src/App.vue`: `onMounted` 中(设置加载后)异步调用 `requestPersist()`,把结果 `settings.save({ storagePersisted })`;全程 try/catch 不阻塞

## 4. 备份提醒 UI

- [x] 4.1 `src/pages/Dashboard.vue`: 计算是否到期提醒(读 settings 字段 + 最早数据 createdAt 作 firstDataAt),到期时顶部渲染提醒卡片(警告色,含"立即备份"跳 `/settings`、"稍后提醒"写 `backupReminderSnoozedAt`)
- [x] 4.2 提醒卡片"稍后提醒"→ `settings.save({ backupReminderSnoozedAt: Date.now() })` 并即时消失

## 5. 设置页

- [x] 5.1 `src/pages/Settings.vue`: 数据管理区显示"持久化存储"状态(已开启/未开启/不支持)与"最近备份时间"
- [x] 5.2 `src/pages/Settings.vue`: 增加"备份提醒阈值"输入(7–180,默认 30),`@change` 写 `settings.save({ backupReminderDays })`

## 6. 测试

- [x] 6.1 单元: `persist.ts` 降级逻辑(navigator.storage 缺失 → 'unsupported',persist true → 'granted')
- [x] 6.2 单元: `backupReminder.ts` `shouldRemindBackup` 各场景(超阈值/未超/推迟期内/无数据/导出后消除)
- [x] 6.3 单元: `backup.ts` 导出成功后 `lastBackupAt` 被写回(用 fake-indexeddb + settingsRepo 回读校验)
- [x] 6.4 E2E (`tests/e2e/app.py`): 设置页导出备份后,总览页备份提醒(若曾显示)消失;持久化状态在设置页可见

## 7. 验证与部署

- [x] 7.1 `npx vue-tsc -b` 类型检查通过(清 .tsbuildinfo 复现 CI)
- [x] 7.2 `npm run test` + `npm run test:e2e` 全绿
- [x] 7.3 提交推送,确认 CI(含 E2E)通过、线上版本生效
