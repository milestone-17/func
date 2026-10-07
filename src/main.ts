import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { registerSW } from 'virtual:pwa-register'
import './assets/main.css'
import App from './App.vue'
import { router } from './router'
import { installGlobalErrorHooks } from './lib/logger'

const app = createApp(App)
app.use(createPinia())
app.use(router)
// 全局错误采集 (error + unhandledrejection) → 前端日志缓冲
installGlobalErrorHooks()

app.mount('#app')

registerSW({ immediate: true })
