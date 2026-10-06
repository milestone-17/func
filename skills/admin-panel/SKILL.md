---
name: admin-panel
description: 管理后台前端（soybean-admin + element-plus）：elegant-router 自动路由、菜单 i18n、panel API 接线
globs:
  - admin-web/src/**
alwaysApply: false
---

# 管理后台前端（L2 核心知识）

## 技术栈与生成机制

- soybean-admin 模板 + element-plus + uno.css，pnpm workspace（`admin-web/packages/`）
- **路由自动生成**：elegant-router vite 插件（`admin-web/build/plugins/router.ts`）扫描 `src/views/<name>/index.vue` 自动生成路由/imports/类型；新增页面 = 建目录，构建时自动注册
- 菜单标题来自 i18n：`src/locales/langs/zh-cn.ts` 的 `route.<name>` 键
- 请求封装：`src/service/request/`，API 函数放 `src/service/api/*.ts`，返回 `{ data, error }`

## 页面清单

home / users / fund-pool / market / audit / releases / pitfalls / incidents / user-center

## 新增页面接线清单（checklist）

1. `src/views/<name>/index.vue`（defineOptions name 与路由名一致）
2. i18n：`zh-cn.ts` / `en-us.ts` 的 route 段补 `<name>` 标题
3. `src/typings/elegant-router.d.ts` 补 RouteKey/LastLevelRouteKey 联合类型（构建时插件也会生成 .js 镜像）
4. 需要 API 则在 `src/service/api/` 加函数
5. 构建产物 `admin-web/dist` 由 server 静态托管在 `/_admin/`

## 代码地图

- 参考模板：`src/views/releases/index.vue`（列表+同步+增删+dialog）
- API 模板：`src/service/api/panel.ts` / `records.ts`

## 反向校验锚点

- `admin-web/src/router/elegant/imports.ts`（views 映射）
- `admin-web/src/locales/langs/zh-cn.ts`（route 标题）
