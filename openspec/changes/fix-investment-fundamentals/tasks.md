## 1. 基金净值数据源（JSONP）

- [x] 1.1 新增 `src/lib/fundQuote.ts`：`fetchFundQuote(code, timeout=8000)` 用天天基金 `fundgz.1234567.com.cn` JSONP（固定回调 `jsonpgz`）拉净值，优先 `dwjz` 回退 `gsz`，超时/无数据返回 null 不抛；导出解析纯函数 `parseFundGz(data)` 便于测试
- [x] 1.2 `src/lib/yahoo.ts`：`fetchHoldingPrice(market, symbol)` 改为按代码形态路由——6 位数字先试 `fetchFundQuote`（失败再试东方财富股票 `push2`），字母走 Yahoo 代理链；任一正值返回，全失败 null
- [x] 1.3 `Portfolio.vue`：现价拉取结果若为估值（`gsz`）在卡片标注「估值」；失败提示文案区分「基金净值」
- [x] 1.4 单元测试：`parseFundGz` 各字段优先级与空值降级；`fetchFundQuote` 超时/mock script 返回 null 不抛；路由：6 位代码走基金、字母走 Yahoo

## 2. 持仓自动分类

- [x] 2.1 新增 `src/lib/category.ts`：`inferCategory(name, symbol)` 关键词规则（红利/标普/纳指/债/其他）；导出规则常量便于测试
- [x] 2.2 `Portfolio.vue` 新建表单：watch 名称/代码 → 自动预填 `form.category`（用户可改）；编辑时不覆盖用户已选
- [x] 2.3 `stores/portfolio.ts`：新增 `reclassifyAll(scope: 'unclassified'|'all')`——遍历持仓按规则重算 category 并 `holdingRepo.put` + refresh
- [x] 2.4 `Portfolio.vue`：顶部增「一键重新自动分类」按钮（含范围选择：默认仅「其他」），调用 `reclassifyAll`
- [x] 2.5 单元测试：`inferCategory` 各关键词分支（含中英文、代码）；边界（空名、全匹配优先级）

## 3. 永久组合按 category 聚合

- [x] 3.1 `src/lib/permanent.ts`：新增 `categoryToAssetType(category, type?)` 映射；`aggregateByType` 改用该映射归类（`HoldingForPerm` 增 `category` 与 `type`）
- [x] 3.2 `stores/permanent.ts`：`analysis` computed 传入 `h.category` 与 `h.type`；`HoldingView` 已含 category，直接用
- [x] 3.3 `types/permanent.ts`：`HoldingForPerm` 增 `category?: HoldingCategory` 与 `type?: string`
- [x] 3.4 单元测试：`categoryToAssetType` 各分支（红利/纳指/标普→股票、债券→债券、other+etf→股票、other+bond→债券、cash/gold）；`computePermanentDeviation` 含基金持仓时正确计入

## 4. 集成验证

- [x] 4.1 `npm run test` 全绿（新增上述单测 + 不破坏既有）
- [x] 4.2 `npm run build`（vue-tsc + vite）通过
- [x] 4.3 `npm run test:e2e` 通过；新增/调整用例：基金净值 JSONP mock、自动分类预填、一键重分类、永久组合含基金持仓显示比例
- [ ] 4.4 提交推送上线，线上强刷验证：现价能拉到（基金净值）、分类正确、永久组合显示持仓比例
