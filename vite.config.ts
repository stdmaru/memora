import vue from '@vitejs/plugin-vue'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiPort = env.MANAGER_API_PORT || '4174'

  return {
    plugins: [vue()],
    server: {
      proxy: {
        '/api/manager': `http://127.0.0.1:${apiPort}`,
      },
    },
  }
})
