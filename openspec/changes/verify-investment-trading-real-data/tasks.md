# tasks.md

## 1. 准备

- [x] 1.1 确认 `investment-position-trading` 已完成且上线（tasks 7.4 已部署）；若未完成则阻塞本变更 （已归档 + commit 5b5da67 + push main 部署）
- [x] 1.2 校验输入：`/home/wf/func-backup-20260813-0907.json` 文件存在、sha256 记录（用于验证后比对） `27c5735d3b289462dcb075156979482c0f3814099000ef92a22f8a7cd4f37b8f`
- [x] 1.3 提取备份中 16 只持仓的（symbol → 净值）映射，作为沙箱内东财基金接口的 mock fixture `tests/fixtures/backup-holdings-20260813.json`（16 只含 navYuan）

## 2. 自动化 e2e（长期护栏）

- [x] 2.1 `tests/e2e/app.py` 新增 `s_verify_sync()` 段：用脱敏 fixture（`tests/fixtures/backup-holdings-20260813.json`）模拟导入，mock 基金批量 JSONP 返回真实净值
- [x] 2.2 加仓：按金额加仓某基金 → 断言 buy 交易生成、份额/均价/投资总额/永久组合该分类同步增加
- [x] 2.3 减仓（部分）：按份额减仓 → 断言 sell、剩余数量/均价、两页同步减少
- [x] 2.4 全部卖出 → 断言数量归零、持仓「已清仓」标签、永久组合同步扣减
- [x] 2.5 超级转换：转出 A → 转入未添加基金 B（自动建仓）→ 断言 sell+buy 双交易、B 持仓建立、A 清仓、两页同步
- [x] 2.6 周度定投自动执行：绑定目标基金 → 触发 → 断言 buy 交易、执行记录、份额增加；同日重复触发不重复（幂等）
- [x] 2.7 T+1/T+2 结算：当日买入显示「确认中」、不计入收益；注入次日日期后确认计入
- [x] 2.8 投资↔永久同步断言：每步操作前后投资页总额、永久组合总额、分类占比对照（金额以「分」整数比较）
  （e2e 100/100 通过；另修复产品 bug：`computePosition` 有交易时以交易为准、不再叠加持仓种子导致的数量翻倍）

## 3. 真实数据沙箱验证

- [x] 3.1 编写一次性验证脚本：启动 headless 浏览器 → 拦截东财接口返回备份净值 fixture → `importAll(bundle, 'merge')` 导入真实备份 （`tests/e2e/verify_real_data.py`）
- [x] 3.2 在沙箱内完整跑 e2e 2.2–2.7 全套操作，截屏 + 抓取投资页/永久页关键数值 （8 张截屏）
- [x] 3.3 生成验证报告：每步操作 { 前投资总额 / 后投资总额 / 前永久总额 / 后永久总额 / 分类占比变化 } （`verification-report.md`）
- [x] 3.4 关闭沙箱浏览器，校验 `/home/wf/func-backup-20260813-0907.json` sha256 与 1.2 一致（数据未被改动） （执行前/后均 `27c5735d…7f8`）
- [x] 3.5 报告归档到本变更目录下（`verification-report.md`），与 e2e 通过截图共置
  （基线 458982=Σ份额×净值 分，证明数量翻倍 bug 修复后真实数据渲染正确；加仓+10000/减仓-3560/全部卖出-19174/转换±0/T+2加仓±0/定投+5250，两页全程同步，结论通过）

## 4. 收尾

- [x] 4.1 `npm run test` 全绿（含 e2e 扩展用例） （219/219 unit 通过）
- [x] 4.2 `npm run build` 通过 （vue-tsc + vite build ✓）
- [x] 4.3 `npm run test:e2e` 通过 （100/100 通过, 非预期错误 0）
- [x] 4.4 提交 e2e 扩展与验证脚本（非产品代码）；确认真实备份文件、本地用户数据、线上均未被改动
  - 产品 bug 修复 `src/lib/position.ts` + `tests/unit/position.test.ts` 单独提交 `93bbd21`
  - 验证代码 `tests/e2e/app.py` + `verify_real_data.py` + 变更工件归档: `7ed665b` + `903cdee`
  - CI 部署修复 `f905c05` (e2e mock 东财 push2 单票接口, 消除 CORS 误报)
  - 部署: Actions run `31689726163` **success**; 线上 `https://milestone-17.github.io/func/` 资产与本地 dist 字节一致 (Portfolio-*.js sha256 相同), 修复已上线
  - 真实备份 sha256 前后一致 (`27c5735d…7f8`)、测试仅触 throwaway 浏览器 IndexedDB、线上用户数据(浏览器本地)不受部署影响
