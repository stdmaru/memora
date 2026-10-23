import { TLSSocket } from 'node:tls'
import vue from '@vitejs/plugin-vue'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiPort = env.MANAGER_API_PORT || '4174'

  return {
    plugins: [vue()],
    server: {
      proxy: {
        '/api/manager': {
          target: `http://127.0.0.1:${apiPort}`,
          configure(proxy) {
            proxy.on('proxyReq', (proxyRequest, request) => {
              if (request.headers.host) proxyRequest.setHeader('x-forwarded-host', request.headers.host)
              const protocol = request.headers['x-forwarded-proto'] || (request.socket instanceof TLSSocket ? 'https' : 'http')
              proxyRequest.setHeader('x-forwarded-proto', protocol)
            })
          },
        },
      },
    },
  }
})
