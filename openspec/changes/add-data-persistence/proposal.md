## Why

应用所有数据仅存在浏览器 IndexedDB 中,不上云。日常使用数据持久,但存在两类丢失风险:浏览器(尤其 iOS Safari)在存储紧张或长期不用时可能自动回收清理本地数据;用户也可能因清理缓存、换机、丢手机而永久丢失。需要降低被自动清理的概率,并在用户长期未备份时温和提醒,把"本地优先"的数据可靠性提升到可接受水平。

## What Changes

- **申请持久化存储**:应用启动时调用 `navigator.storage.persist()`,请求浏览器承诺不自动回收本地数据;记录授权结果(已授权/被拒绝/不支持),并在设置页展示当前持久化状态。
- **备份提醒**:记录最近一次"导出备份"的时间;当超过阈值(默认 30 天,可在设置调整)未备份时,在应用启动/总览页温和提示"该备份了",并提供一键跳转导出;用户可"稍后提醒"(推迟阈值周期)或导出后自动消除提醒。
- 导出备份后自动刷新"最近备份时间";提醒阈值纳入设置项。

## Capabilities

### New Capabilities
- `data-persistence`: 降低本地数据被浏览器自动清理的概率(持久化存储申请)与防止用户因遗忘备份而丢失数据的提醒机制。

### Modified Capabilities

(无既有 spec 需要改动。)

## Impact

- **设置存储**:`AppSettings` 增加字段 `lastBackupAt?: number`(最近备份时间戳)、`backupReminderDays?: number`(提醒阈值,默认 30)、`backupReminderSnoozedAt?: number`(稍后提醒时间戳)、`storagePersisted?: boolean | null`(持久化授权结果)。
- **新增**:`src/lib/persist.ts`(封装 `navigator.storage.persist()` 与状态查询);备份提醒逻辑(可放 `src/stores/settings.ts` 或新 `src/composables/useBackupReminder.ts`)。
- **改动**:`src/App.vue`(启动时申请持久化 + 触发提醒判断);`src/pages/Settings.vue`(展示持久化状态、提醒阈值设置);`src/lib/backup.ts` 的导出在成功后写回 `lastBackupAt`。
- **类型/Repo**:`src/types/settings.ts` 与 `src/repos/settingsRepo.ts` 的 DEFAULTS 同步新字段。
- **测试**:持久化封装的降级逻辑(不支持 API 时安全跳过);提醒触发/消除逻辑(基于时间戳);导出后 `lastBackupAt` 写回。
