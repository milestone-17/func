<template>
  <div class="app-shell min-h-screen flex flex-col bg-gray-50">
    <header class="bg-white border-b sticky top-0 z-10">
      <div class="max-w-screen-md mx-auto px-4 py-3 flex items-center justify-between">
        <h1 class="text-lg font-semibold">个人财务</h1>
        <button @click="installable ? install() : null" v-if="installable" class="text-sm text-blue-600">安装</button>
      </div>
    </header>
    <main class="flex-1 max-w-screen-md mx-auto w-full px-4 py-4 pb-20">
      <slot />
    </main>
    <nav class="bg-white border-t fixed bottom-0 inset-x-0 z-10">
      <div class="max-w-screen-md mx-auto grid grid-cols-5 text-xs">
        <RouterLink to="/" class="py-2 text-center" active-class="text-blue-600">总览</RouterLink>
        <RouterLink to="/ledger" class="py-2 text-center" active-class="text-blue-600">账本</RouterLink>
        <RouterLink to="/budget" class="py-2 text-center" active-class="text-blue-600">预算</RouterLink>
        <RouterLink to="/portfolio" class="py-2 text-center" active-class="text-blue-600">投资</RouterLink>
        <RouterLink to="/dca" class="py-2 text-center" active-class="text-blue-600">定投</RouterLink>
        <RouterLink to="/permanent" class="py-2 text-center" active-class="text-blue-600">永久</RouterLink>
        <RouterLink to="/settings" class="py-2 text-center col-span-1" active-class="text-blue-600">设置</RouterLink>
      </div>
    </nav>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'

const installable = ref(false)
let deferred: any = null

onMounted(() => {
  window.addEventListener('beforeinstallprompt', (e: any) => {
    e.preventDefault()
    deferred = e
    installable.value = true
  })
})

function install() {
  if (deferred) {
    deferred.prompt()
    deferred = null
    installable.value = false
  }
}
</script>
