import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'

// 需要运行期可变的键。
// 新增键时必须同步更新 deploy/config.<env>.js，否则该键仍会在构建期固化。
const runtimeKeys = [
  'VITE_ENV_NAME',
  'VITE_BASE_URL',
  'VITE_API_URL',
  'VITE_APP_TITLE',
  'VITE_APP_TENANT_ENABLE',
  'VITE_APP_CAPTCHA_ENABLE'
] as const

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  // 把 import.meta.env.VITE_X 静态替换成“window.__APP_CONFIG__ 优先、构建期值兜底”的表达式。
  // 业务代码仍然写 import.meta.env.VITE_X，不需要改动。
  const runtimeDefine = Object.fromEntries(
    runtimeKeys.map((key) => [
      `import.meta.env.${key}`,
      `((typeof window !== 'undefined' ? window.__APP_CONFIG__ : null)?.${key} ?? ${JSON.stringify(env[key] ?? '')})`
    ])
  )

  return {
    plugins: [vue()],
    define: runtimeDefine,
    server: {
      port: Number(env.VITE_PORT || 5180),
      strictPort: true,
      proxy: {
        // 本地开发：VITE_BASE_URL=''，由 Vite 代理到 local 后端
        '/api': {
          target: 'http://localhost:4000',
          changeOrigin: true
        }
      }
    },
    build: {
      outDir: env.VITE_OUT_DIR || 'dist',
      emptyOutDir: true
    }
  }
})
