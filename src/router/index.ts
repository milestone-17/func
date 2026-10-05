import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const routes: RouteRecordRaw[] = [
  { path: '/login', name: 'login', component: () => import('@/pages/Login.vue'), meta: { public: true } },
  { path: '/', name: 'dashboard', component: () => import('@/pages/Dashboard.vue') },
  { path: '/ledger', name: 'ledger', component: () => import('@/pages/Ledger.vue') },
  { path: '/budget', name: 'budget', component: () => import('@/pages/Budget.vue') },
  { path: '/portfolio', name: 'portfolio', component: () => import('@/pages/Portfolio.vue') },
  { path: '/holding/:id', name: 'holding-detail', component: () => import('@/pages/HoldingDetail.vue') },
  { path: '/permanent', name: 'permanent', component: () => import('@/pages/Permanent.vue') },
  { path: '/dca', name: 'dca', component: () => import('@/pages/Dca.vue') },
  { path: '/suggest', name: 'suggest', component: () => import('@/pages/Suggest.vue') },
  { path: '/channel', name: 'channel', component: () => import('@/pages/Channel.vue') },
  { path: '/settings', name: 'settings', component: () => import('@/pages/Settings.vue') },
  { path: '/admin', name: 'admin', component: () => import('@/pages/Admin.vue'), meta: { admin: true } }
]

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes
})

router.beforeEach(async (to) => {
  const auth = useAuthStore()
  await auth.init()
  if (to.meta.public) {
    if (auth.isLoggedIn && to.name === 'login') return { path: '/' }
    return true
  }
  if (!auth.isLoggedIn) {
    return { name: 'login', query: to.fullPath === '/' ? {} : { redirect: to.fullPath } }
  }
  if (to.meta.admin && auth.user?.role !== 'admin') {
    return { path: '/' }
  }
  return true
})
