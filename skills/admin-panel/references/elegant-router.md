# elegant-router 机制说明（L3）

## 工作方式

- vite 插件在 dev/build 时扫描 `src/views`，生成：
  - `src/router/elegant/routes.ts`（generatedRoutes，含 meta.order/icon）
  - `src/router/elegant/imports.ts`（组件懒加载映射）
  - `src/typings/elegant-router.d.ts`（RouteKey 等类型）
- 自定义 meta（icon/order/title）直接编辑 generatedRoutes——插件保留人工修改
- 构建机上若无交互式 dev 过程，务必确认三个生成文件与新页面一致（本仓库同时提交 .ts 与 .js 镜像）

## 菜单顺序

meta.order 决定菜单排序：home(1) audit(2) ... 未设置则按字母序追加在后
