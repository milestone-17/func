/// <reference types="vitest" />
import { installMemApi } from './mem-api'

// 全局安装内存 API mock: repo 层的 /api/* fetch 在测试中走内存实现
installMemApi()

import { afterEach } from 'vitest'

afterEach(() => {
  // 跨测试污染防护
})
