import { readFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'

const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
])

const securityHeaders = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'same-origin',
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
}

function send(response, status, body, contentType = 'text/plain; charset=utf-8') {
  response.writeHead(status, {
    ...securityHeaders,
    'content-type': contentType,
    'cache-control': 'no-store',
  })
  response.end(body)
}

export async function serveStatic(request, response, staticRoot) {
  if (!staticRoot || !['GET', 'HEAD'].includes(request.method || '')) return false

  let pathname
  try {
    pathname = decodeURIComponent(new URL(request.url || '/', 'http://localhost').pathname)
  } catch {
    send(response, 400, 'Bad Request')
    return true
  }
  if (pathname.includes('\0')) {
    send(response, 400, 'Bad Request')
    return true
  }

  if (pathname.startsWith('/api/')) return false
  const root = resolve(staticRoot)
  const requestedPath = resolve(root, `.${pathname}`)
  if (requestedPath !== root && !requestedPath.startsWith(`${root}${sep}`)) {
    send(response, 400, 'Bad Request')
    return true
  }

  let filePath = requestedPath
  let body
  try {
    body = await readFile(filePath)
  } catch (error) {
    if (error?.code !== 'ENOENT' && error?.code !== 'EISDIR') throw error
    if (extname(pathname) || pathname.startsWith('/assets/')) {
      send(response, 404, 'Not Found')
      return true
    }
    filePath = resolve(root, 'index.html')
    try {
      body = await readFile(filePath)
    } catch (indexError) {
      if (indexError?.code !== 'ENOENT') throw indexError
      return false
    }
  }

  const isHashedAsset = pathname.startsWith('/assets/')
  response.writeHead(200, {
    ...securityHeaders,
    'content-type': contentTypes.get(extname(filePath)) || 'application/octet-stream',
    'cache-control': isHashedAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
  })
  response.end(request.method === 'HEAD' ? undefined : body)
  return true
}
