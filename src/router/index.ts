import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  { path: '/', name: 'dashboard', component: () => import('@/pages/Dashboard.vue') },
  { path: '/ledger', name: 'ledger', component: () => import('@/pages/Ledger.vue') },
  { path: '/budget', name: 'budget', component: () => import('@/pages/Budget.vue') },
  { path: '/portfolio', name: 'portfolio', component: () => import('@/pages/Portfolio.vue') },
  { path: '/holding/:id', name: 'holding-detail', component: () => import('@/pages/HoldingDetail.vue') },
  { path: '/permanent', name: 'permanent', component: () => import('@/pages/Permanent.vue') },
  { path: '/dca', name: 'dca', component: () => import('@/pages/Dca.vue') },
  { path: '/suggest', name: 'suggest', component: () => import('@/pages/Suggest.vue') },
  { path: '/settings', name: 'settings', component: () => import('@/pages/Settings.vue') }
]

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes
})
