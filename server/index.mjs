import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { createInitialAdmin, createSession, deleteSession, findAdminByEmail, findAdminPasswordById, hasAdmin, logAudit, readSession, readSettings, updateAdminPassword, updateUserTheme, writeSettings } from './database.mjs'
import { deleteConnectionConfig, readConnectionConfig, readConnectionStatus, validateEncryptionKey, writeConnectionConfig } from './connection-config.mjs'
import { hashPassword, verifyPassword } from './passwords.mjs'

const port = Number(process.env.MANAGER_API_PORT || 4174)
const sessionCookieName = 'memora_session'
const sessionLifetimeMs = 7 * 24 * 60 * 60 * 1000
const invalidLoginHash = `scrypt$131072$8$1$${Buffer.alloc(16).toString('base64url')}$${Buffer.alloc(64).toString('base64url')}`

class UpstreamError extends Error {
  constructor(message, status = 502) {
    super(message)
    this.status = status
  }
}

function send(response, status, payload) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'same-origin',
  })
  response.end(JSON.stringify(payload))
}

function cookieValue(request, name) {
  const cookies = request.headers.cookie?.split(';') || []
  for (const cookie of cookies) {
    const separator = cookie.indexOf('=')
    if (separator < 0 || cookie.slice(0, separator).trim() !== name) continue
    return cookie.slice(separator + 1).trim()
  }
  return ''
}

function tokenHash(token) {
  return createHash('sha256').update(token).digest('hex')
}

function cookieHeader(request, value, maxAge) {
  const secure = process.env.MANAGER_COOKIE_SECURE === 'true' || Boolean(request.socket.encrypted)
  return `${sessionCookieName}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`
}

function setSessionCookie(request, response, token) {
  response.setHeader('set-cookie', cookieHeader(request, token, Math.floor(sessionLifetimeMs / 1000)))
}

function clearSessionCookie(request, response) {
  response.setHeader('set-cookie', cookieHeader(request, '', 0))
}

function sameOriginRequest(request) {
  const origin = request.headers.origin
  const forwardedHost = request.headers['x-forwarded-host']
  const host = typeof forwardedHost === 'string' ? forwardedHost.split(',')[0].trim() : request.headers.host
  const forwardedProto = request.headers['x-forwarded-proto']
  const protocol = typeof forwardedProto === 'string'
    ? forwardedProto.split(',')[0].trim()
    : request.socket.encrypted ? 'https' : 'http'
  if (!origin || !host) return false
  try {
    const parsedOrigin = new URL(origin)
    if (parsedOrigin.protocol !== `${protocol}:` || parsedOrigin.host !== host) return false
    return request.headers['sec-fetch-site'] !== 'cross-site'
  } catch {
    return false
  }
}

function userFromRequest(request) {
  const token = cookieValue(request, sessionCookieName)
  if (!/^[A-Za-z0-9_-]{40,50}$/.test(token)) return null
  const session = readSession(tokenHash(token))
  if (!session) return null
  return { id: session.id, name: session.name, email: session.email, role: session.role, theme: session.theme || 'system' }
}

async function readJson(request, maxBytes = 8192) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > maxBytes) throw new UpstreamError('A solicitação excede o tamanho permitido.', 413)
    chunks.push(chunk)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new UpstreamError('JSON inválido.', 400) }
}

function getAiMemoryBaseUrl(endpoint) {
  const url = new URL(endpoint)
  url.pathname = url.pathname.replace(/\/mcp\/?$/, '').replace(/\/$/, '')
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/$/, '')
}

function savedConnectionConfig() {
  try { return readConnectionConfig() } catch (error) {
    throw new UpstreamError(error instanceof Error ? error.message : 'Não foi possível ler as credenciais do node.', 503)
  }
}

function requireEncryptionKey() {
  try { validateEncryptionKey() } catch (error) {
    throw new UpstreamError(error instanceof Error ? error.message : 'A chave de criptografia não está configurada.', 503)
  }
}

async function getAiMemory(path) {
  const config = savedConnectionConfig()
  if (!config) throw new UpstreamError('Conecte um node ai-memory em Configurações para continuar.', 503)
  const token = config.readToken
  const headers = { accept: 'application/json' }
  if (token) headers.authorization = `Bearer ${token}`
  let response
  try {
    response = await fetch(`${getAiMemoryBaseUrl(config.endpoint)}${path}`, {
      headers,
      signal: AbortSignal.timeout(20000),
      redirect: 'error',
    })
  } catch (error) {
    const detail = error instanceof Error && error.name === 'TimeoutError' ? 'Tempo limite excedido ao conectar ao ai-memory.' : 'Não foi possível conectar à API do ai-memory.'
    throw new UpstreamError(detail)
  }
  const body = await response.text()
  let payload
  try { payload = body ? JSON.parse(body) : null } catch { payload = null }
  if (!response.ok) {
    if (response.status === 404 && path.startsWith('/api/v1/')) {
      throw new UpstreamError('A API de leitura não está habilitada no servidor. Ative AI_MEMORY_ENABLE_WEB=true (ou --enable-web) no ai-memory e reinicie o serviço.', 424)
    }
    throw new UpstreamError(payload?.error || `ai-memory respondeu HTTP ${response.status}.`, response.status)
  }
  return payload
}

async function postAdmin(path, payload) {
  const config = savedConnectionConfig()
  if (!config) throw new UpstreamError('Conecte um node ai-memory em Configurações para continuar.', 503)
  const adminToken = config.adminToken
  if (!adminToken) throw new UpstreamError('Configure o token root nas Configurações para habilitar ações administrativas.', 503)
  let response
  try {
    response = await fetch(`${getAiMemoryBaseUrl(config.endpoint)}${path}`, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json', authorization: `Bearer ${adminToken}` },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20000),
      redirect: 'error',
    })
  } catch {
    throw new UpstreamError('Não foi possível conectar à API administrativa do ai-memory.')
  }
  const body = await response.text()
  let result
  try { result = body ? JSON.parse(body) : null } catch { result = { message: body } }
  if (!response.ok) throw new UpstreamError(result?.error || result?.message || `ai-memory respondeu HTTP ${response.status}.`, response.status)
  return result
}

async function getAdmin(path) {
  const config = savedConnectionConfig()
  if (!config) throw new UpstreamError('Conecte um node ai-memory em Configurações para continuar.', 503)
  const adminToken = config.adminToken
  if (!adminToken) throw new UpstreamError('Configure o token root nas Configurações para acessar a lixeira.', 503)
  let response
  try {
    response = await fetch(`${getAiMemoryBaseUrl(config.endpoint)}${path}`, {
      headers: { accept: 'application/json', authorization: `Bearer ${adminToken}` },
      signal: AbortSignal.timeout(20000),
      redirect: 'error',
    })
  } catch {
    throw new UpstreamError('Não foi possível conectar à API administrativa do ai-memory.')
  }
  const body = await response.text()
  let result
  try { result = body ? JSON.parse(body) : null } catch { result = null }
  if (!response.ok) throw new UpstreamError(result?.error || `ai-memory respondeu HTTP ${response.status}.`, response.status)
  return result
}

function validateConnectionEndpoint(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 2048) {
    throw new UpstreamError('Informe o endereço do endpoint MCP.', 400)
  }
  let endpoint
  try { endpoint = new URL(value.trim()) } catch { throw new UpstreamError('O endereço do endpoint MCP não é válido.', 400) }
  if (!['http:', 'https:'].includes(endpoint.protocol) || !endpoint.hostname || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new UpstreamError('Use um endereço HTTP ou HTTPS válido, sem credenciais, parâmetros ou fragmentos.', 400)
  }
  endpoint.pathname = endpoint.pathname.replace(/\/+$/, '')
  return endpoint.toString().replace(/\/$/, '')
}

async function probeConnection({ endpoint, readToken, adminToken }) {
  const baseUrl = getAiMemoryBaseUrl(endpoint)
  const headers = new Headers({ accept: 'application/json' })
  if (readToken) headers.set('authorization', ['Bearer', readToken].join(' '))

  for (const path of ['/identity', '/api/v1/workspaces', '/api/v1/projects']) {
    let response
    try {
      response = await fetch(`${baseUrl}${path}`, {
        headers,
        signal: AbortSignal.timeout(10000),
        redirect: 'error',
      })
    } catch (error) {
      const message = error instanceof Error && error.name === 'TimeoutError'
        ? 'Tempo limite excedido ao testar o node ai-memory.'
        : 'Não foi possível conectar ao node ai-memory. Confira o endereço e a disponibilidade do serviço.'
      throw new UpstreamError(message, 502)
    }
    if (!response.ok) {
      if (response.status === 404 && path.startsWith('/api/v1/')) {
        throw new UpstreamError('A API de leitura não está habilitada no servidor. Ative AI_MEMORY_ENABLE_WEB=true (ou --enable-web) no ai-memory.', 424)
      }
      if (response.status === 401 || response.status === 403) {
        throw new UpstreamError('Autenticação recusada pelo node. Confira o bearer de leitura.', response.status)
      }
      throw new UpstreamError(`O node respondeu HTTP ${response.status} em ${path}.`, 502)
    }
    let payload
    try { payload = await response.json() } catch { throw new UpstreamError(`O node retornou uma resposta inválida em ${path}.`, 502) }
    if (!payload || typeof payload !== 'object') throw new UpstreamError(`O node retornou uma resposta inválida em ${path}.`, 502)
    if (path !== '/identity' && !Array.isArray(payload)) {
      throw new UpstreamError(`O node retornou uma lista inválida em ${path}.`, 502)
    }
  }

  if (adminToken) {
    const adminHeaders = new Headers({ accept: 'application/json', authorization: ['Bearer', adminToken].join(' ') })
    let response
    try {
      response = await fetch(`${baseUrl}/admin/checkpoints?limit=1`, {
        headers: adminHeaders,
        signal: AbortSignal.timeout(10000),
        redirect: 'error',
      })
    } catch {
      throw new UpstreamError('Não foi possível validar o bearer root administrativo.', 502)
    }
    if (response.status === 401 || response.status === 403) {
      throw new UpstreamError('Autenticação administrativa recusada pelo node. Confira o bearer root.', response.status)
    }
    if (!response.ok) throw new UpstreamError(`O node respondeu HTTP ${response.status} ao validar o bearer root.`, 502)
    let checkpoints
    try { checkpoints = await response.json() } catch {
      throw new UpstreamError('O node retornou uma resposta inválida ao validar o bearer root.', 502)
    }
    if (!Array.isArray(checkpoints)) throw new UpstreamError('O node não retornou checkpoints válidos para o bearer root.', 502)
  }
}

function scopeFrom(url) {
  const workspace = url.searchParams.get('workspace')?.trim()
  const project = url.searchParams.get('project')?.trim()
  if (!workspace || !project || workspace.length > 200 || project.length > 200) {
    throw new UpstreamError('Selecione um workspace e um projeto válidos.', 400)
  }
  return { workspace, project }
}

function encodedScopePath({ workspace, project }) {
  return `/api/v1/workspaces/${encodeURIComponent(workspace)}/projects/${encodeURIComponent(project)}`
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://127.0.0.1:${port}`)
  if (!url.pathname.startsWith('/api/manager/')) return send(response, 404, { error: 'Rota não encontrada.' })

  try {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method || '') && !sameOriginRequest(request)) {
      return send(response, 403, { error: 'Origem da solicitação inválida.' })
    }

    if (url.pathname === '/api/manager/setup/status' && request.method === 'GET') {
      return send(response, 200, { configured: hasAdmin() })
    }

    if (url.pathname === '/api/manager/auth/session' && request.method === 'GET') {
      return send(response, 200, { user: userFromRequest(request) })
    }

    if (url.pathname === '/api/manager/auth/login' && request.method === 'POST') {
      if (!hasAdmin()) return send(response, 409, { error: 'Conclua a configuração inicial antes de entrar.' })
      const body = await readJson(request)
      if (!body || typeof body !== 'object' || Array.isArray(body)) return send(response, 400, { error: 'Dados de acesso inválidos.' })
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
      const password = typeof body.password === 'string' ? body.password : ''
      if (!email || email.length > 254 || !password || Buffer.byteLength(password, 'utf8') > 1024) {
        return send(response, 401, { error: 'E-mail ou senha incorretos.' })
      }
      const user = findAdminByEmail(email)
      const passwordMatches = await verifyPassword(password, user?.password_hash || invalidLoginHash)
      if (!user || !passwordMatches) {
        logAudit({ action: 'login', outcome: 'failure' })
        return send(response, 401, { error: 'E-mail ou senha incorretos.' })
      }
      const token = randomBytes(32).toString('base64url')
      createSession({
        id: randomUUID(),
        userId: user.id,
        tokenHash: tokenHash(token),
        expiresAt: new Date(Date.now() + sessionLifetimeMs).toISOString(),
      })
      setSessionCookie(request, response, token)
      logAudit({ action: 'login', outcome: 'success' })
      return send(response, 200, { user: { id: user.id, name: user.name, email: user.email, role: user.role } })
    }

    if (url.pathname === '/api/manager/auth/logout' && request.method === 'POST') {
      const token = cookieValue(request, sessionCookieName)
      if (/^[A-Za-z0-9_-]{40,50}$/.test(token)) deleteSession(tokenHash(token))
      clearSessionCookie(request, response)
      return send(response, 200, { loggedOut: true })
    }

    if (url.pathname === '/api/manager/setup' && request.method === 'POST') {
      if (hasAdmin()) return send(response, 409, { error: 'A configuração inicial já foi concluída.' })
      const body = await readJson(request)
      if (!body || typeof body !== 'object' || Array.isArray(body)) return send(response, 400, { error: 'Dados da conta inválidos.' })
      const name = typeof body.name === 'string' ? body.name.trim() : ''
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
      const password = typeof body.password === 'string' ? body.password : ''
      const passwordConfirmation = typeof body.passwordConfirmation === 'string' ? body.passwordConfirmation : ''
      const theme = body.theme || 'system'
      if (!name || name.length > 80) return send(response, 400, { error: 'Informe um nome de até 80 caracteres.' })
      if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return send(response, 400, { error: 'Informe um endereço de e-mail válido.' })
      if (Array.from(password).length < 12 || Buffer.byteLength(password, 'utf8') > 1024) return send(response, 400, { error: 'A senha deve ter pelo menos 12 caracteres e no máximo 1024 bytes.' })
      if (password !== passwordConfirmation) return send(response, 400, { error: 'As senhas não coincidem.' })
      if (!['light', 'dark', 'system'].includes(theme)) return send(response, 400, { error: 'Preferência de tema inválida.' })
      const passwordHash = await hashPassword(password)
      const id = randomUUID()
      const created = createInitialAdmin({ id, name, email, passwordHash, theme })
      if (!created) return send(response, 409, { error: 'A configuração inicial já foi concluída.' })
      const sessionToken = randomBytes(32).toString('base64url')
      createSession({
        id: randomUUID(),
        userId: id,
        tokenHash: tokenHash(sessionToken),
        expiresAt: new Date(Date.now() + sessionLifetimeMs).toISOString(),
      })
      setSessionCookie(request, response, sessionToken)
      logAudit({ action: 'create-initial-admin', outcome: 'success' })
      return send(response, 201, { configured: true, account: { name, email, role: 'admin' }, preferences: { theme } })
    }

    const user = userFromRequest(request)
    if (!user) return send(response, 401, { error: 'Autenticação necessária.' })

    if (url.pathname === '/api/manager/auth/preferences' && request.method === 'PUT') {
      const body = await readJson(request)
      if (!body || !['light', 'dark', 'system'].includes(body.theme)) return send(response, 400, { error: 'Preferência de tema inválida.' })
      const updatedUser = updateUserTheme(user.id, body.theme)
      return send(response, 200, { theme: updatedUser?.theme || body.theme })
    }

    if (url.pathname === '/api/manager/auth/password' && request.method === 'PUT') {
      const body = await readJson(request)
      const currentPassword = typeof body?.currentPassword === 'string' ? body.currentPassword : ''
      const newPassword = typeof body?.newPassword === 'string' ? body.newPassword : ''
      const passwordConfirmation = typeof body?.passwordConfirmation === 'string' ? body.passwordConfirmation : ''
      if (!currentPassword || Buffer.byteLength(currentPassword, 'utf8') > 1024) return send(response, 400, { error: 'Informe sua senha atual.' })
      if (Array.from(newPassword).length < 12 || Buffer.byteLength(newPassword, 'utf8') > 1024) return send(response, 400, { error: 'A nova senha deve ter pelo menos 12 caracteres e no máximo 1024 bytes.' })
      if (newPassword !== passwordConfirmation) return send(response, 400, { error: 'As novas senhas não coincidem.' })
      const passwordHash = findAdminPasswordById(user.id)
      if (!passwordHash || !(await verifyPassword(currentPassword, passwordHash))) return send(response, 400, { error: 'A senha atual está incorreta.' })
      const updated = updateAdminPassword(user.id, await hashPassword(newPassword), tokenHash(cookieValue(request, sessionCookieName)))
      if (!updated) return send(response, 404, { error: 'A conta não foi encontrada.' })
      logAudit({ action: 'change-password', outcome: 'success' })
      return send(response, 200, { changed: true })
    }

    if (url.pathname === '/api/manager/connection' && request.method === 'GET') {
      return send(response, 200, readConnectionStatus())
    }

    if (url.pathname === '/api/manager/connection' && request.method === 'PUT') {
      const body = await readJson(request, 16384)
      if (!body || typeof body !== 'object' || Array.isArray(body)) return send(response, 400, { error: 'Dados da conexão inválidos.' })
      for (const key of ['readToken', 'adminToken']) {
        if (key in body && typeof body[key] !== 'string') return send(response, 400, { error: 'Os tokens devem ser informados como texto.' })
      }
      for (const key of ['clearReadToken', 'clearAdminToken']) {
        if (key in body && typeof body[key] !== 'boolean') return send(response, 400, { error: 'Opção de remoção de token inválida.' })
      }
      const endpoint = validateConnectionEndpoint(body?.endpoint)
      const existing = savedConnectionConfig()
      const readToken = typeof body?.readToken === 'string' && body.readToken.trim()
        ? body.readToken.trim()
        : body?.clearReadToken ? '' : existing?.readToken || ''
      const adminToken = typeof body?.adminToken === 'string' && body.adminToken.trim()
        ? body.adminToken.trim()
        : body?.clearAdminToken ? '' : existing?.adminToken || ''
      if (Buffer.byteLength(readToken, 'utf8') > 4096 || Buffer.byteLength(adminToken, 'utf8') > 4096) {
        return send(response, 400, { error: 'Os tokens não podem exceder 4096 caracteres.' })
      }
      requireEncryptionKey()
      await probeConnection({ endpoint, readToken, adminToken })
      writeConnectionConfig({ endpoint, readToken, adminToken })
      logAudit({ action: 'configure-ai-memory', outcome: 'success', detail: endpoint })
      return send(response, 200, readConnectionStatus())
    }

    if (url.pathname === '/api/manager/connection' && request.method === 'DELETE') {
      deleteConnectionConfig()
      logAudit({ action: 'disconnect-ai-memory', outcome: 'success' })
      return send(response, 200, readConnectionStatus())
    }

    if (url.pathname === '/api/manager/settings' && request.method === 'GET') {
      const settings = readSettings()
      delete settings.ai_memory_connection
      return send(response, 200, settings)
    }

    if (url.pathname === '/api/manager/settings' && request.method === 'PUT') {
      const chunks = []
      for await (const chunk of request) chunks.push(chunk)
      let body
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { return send(response, 400, { error: 'JSON inválido.' }) }
      const updates = {}
      if ('scope' in (body || {})) {
        const scope = body.scope
        if (!scope || typeof scope.workspace !== 'string' || typeof scope.project !== 'string' || scope.workspace.length > 200 || scope.project.length > 200) return send(response, 400, { error: 'Escopo inválido.' })
        updates.scope = { workspace: scope.workspace, project: scope.project }
      }
      if (!Object.keys(updates).length) return send(response, 400, { error: 'Nenhuma configuração válida foi enviada.' })
      const settings = writeSettings(updates)
      delete settings.ai_memory_connection
      return send(response, 200, settings)
    }

    if (url.pathname === '/api/manager/identity') {
      const identity = await getAiMemory('/identity')
      return send(response, 200, { ...identity, version: identity?.version || 'conectado' })
    }

    if (url.pathname === '/api/manager/scopes') {
      const [workspaces, projects] = await Promise.all([
        getAiMemory('/api/v1/workspaces'),
        getAiMemory('/api/v1/projects'),
      ])
      return send(response, 200, {
        workspaces: Array.isArray(workspaces) ? workspaces : [],
        projects: Array.isArray(projects) ? projects : [],
        preferred: { workspace: '', project: '' },
        canAdmin: Boolean(readConnectionConfig()?.adminToken),
      })
    }

    if (url.pathname === '/api/manager/admin' && request.method === 'POST') {
      const chunks = []
      for await (const chunk of request) chunks.push(chunk)
      let body
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { return send(response, 400, { error: 'JSON inválido.' }) }
      const { action, ...payload } = body || {}
      const routes = {
        'rename-project': '/admin/rename-project',
        'rename-workspace': '/admin/rename-workspace',
        'purge-project': '/admin/purge-project',
        'delete-workspace': '/admin/delete-workspace',
        'delete-page': '/admin/delete-page',
        'restore-page': '/admin/restore-page',
        'write-page': '/admin/write-page',
      }
      if (!routes[action]) return send(response, 400, { error: 'Ação administrativa inválida.' })
      if (action === 'write-page') {
        const { workspace, project } = payload
        const pagePath = payload.path
        if (typeof workspace !== 'string' || !workspace.trim() || typeof project !== 'string' || !project.trim()) return send(response, 400, { error: 'Workspace e projeto são obrigatórios.' })
        if (typeof pagePath !== 'string' || !pagePath || pagePath.startsWith('/') || pagePath.split('/').some(segment => !segment || segment === '.' || segment === '..')) return send(response, 400, { error: 'Caminho de página inválido.' })
        if (typeof payload.body !== 'string' || payload.body.length > 1_000_000) return send(response, 400, { error: 'Conteúdo Markdown inválido ou maior que 1 MB.' })
        const writePayload = Object.fromEntries(['workspace', 'project', 'path', 'body', 'title', 'kind', 'tier', 'tags', 'pinned', 'entities', 'abstract', 'relations'].filter(key => key in payload).map(key => [key, payload[key]]))
        try {
          const result = await postAdmin(routes[action], writePayload)
          logAudit({ action, workspace, project, path: pagePath, outcome: 'success' })
          return send(response, 200, result)
        } catch (error) {
          logAudit({ action, workspace, project, path: pagePath, outcome: 'failure', detail: error instanceof Error ? error.message.slice(0, 500) : 'Falha desconhecida.' })
          throw error
        }
      }
      try {
        const result = await postAdmin(routes[action], payload)
        logAudit({ action, workspace: payload.workspace || null, project: payload.project || null, outcome: 'success' })
        return send(response, 200, result)
      } catch (error) {
        logAudit({ action, workspace: payload.workspace || null, project: payload.project || null, outcome: 'failure', detail: error instanceof Error ? error.message.slice(0, 500) : 'Falha desconhecida.' })
        throw error
      }
    }

    if (url.pathname === '/api/manager/trash' && request.method === 'GET') {
      const checkpoints = await getAdmin('/admin/checkpoints?limit=100')
      const ordered = (Array.isArray(checkpoints) ? checkpoints : []).filter(item => item?.oid && item?.summary).sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')))
      const deleted = new Map()
      for (let index = 0; index < ordered.length; index += 1) {
        const checkpoint = ordered[index]
        const match = String(checkpoint.summary).match(/^delete-page ([^/]+)\/([^:]+): (.+)$/)
        if (!match) continue
        const [, workspace, project, pagePath] = match
        const previous = ordered[index - 1]
        const preSummary = `pre-delete-page ${workspace}/${project}: ${pagePath}`
        const preCheckpoint = [...ordered.slice(0, index)].reverse().find(item => item.summary === preSummary) || previous
        const key = `${workspace}\0${project}\0${pagePath}`
        const current = deleted.get(key)
        if (!current || String(checkpoint.time || '') > current.deleted_at) {
          deleted.set(key, { workspace, project, path: pagePath, deleted_at: checkpoint.time || null, restore_rev: preCheckpoint?.oid || null })
        }
      }
      return send(response, 200, { items: [...deleted.values()].sort((a, b) => String(b.deleted_at || '').localeCompare(String(a.deleted_at || ''))), checkpoint_limit: 100 })
    }

    if (url.pathname === '/api/manager/pages') {
      const scope = scopeFrom(url)
      const query = url.searchParams.get('q')?.trim()
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || 50)))
      const endpoint = query
        ? `/api/v1/search?q=${encodeURIComponent(query)}&workspace=${encodeURIComponent(scope.workspace)}&project=${encodeURIComponent(scope.project)}&limit=${limit}`
        : `${encodedScopePath(scope)}/pages`
      const pages = await getAiMemory(endpoint)
      return send(response, 200, Array.isArray(pages) ? pages : [])
    }

    if (url.pathname === '/api/manager/overview') {
      const scope = scopeFrom(url)
      const endpoint = `${encodedScopePath(scope)}/overview?limit=10`
      return send(response, 200, await getAiMemory(endpoint))
    }

    if (url.pathname === '/api/manager/page') {
      const scope = scopeFrom(url)
      const pagePath = url.searchParams.get('path')
      if (!pagePath || pagePath.startsWith('/') || pagePath.split('/').some(segment => !segment || segment === '.' || segment === '..')) {
        return send(response, 400, { error: 'Caminho de página inválido.' })
      }
      const encodedPagePath = pagePath.split('/').map(encodeURIComponent).join('/')
      const page = await getAiMemory(`${encodedScopePath(scope)}/pages/${encodedPagePath}`)
      return send(response, 200, { ...page, body_markdown: page?.body_markdown || '' })
    }

    if (url.pathname === '/api/manager/sessions') {
      const scope = scopeFrom(url)
      const endpoint = `${encodedScopePath(scope)}/sessions?limit=100&offset=0&include_open=true`
      const result = await getAiMemory(endpoint)
      return send(response, 200, Array.isArray(result?.sessions) ? result.sessions : [])
    }

    if (url.pathname === '/api/manager/session-observations') {
      const scope = scopeFrom(url)
      const sessionId = url.searchParams.get('session_id') || ''
      if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return send(response, 400, { error: 'Identificador de sessão inválido.' })
      const offset = Math.max(0, Number(url.searchParams.get('offset') || 0))
      const endpoint = `${encodedScopePath(scope)}/sessions/${encodeURIComponent(sessionId)}/observations?limit=100&offset=${offset}&order=asc&body_max_chars=4000`
      return send(response, 200, await getAiMemory(endpoint))
    }

    return send(response, 404, { error: 'Rota não encontrada.' })
  } catch (error) {
    const status = error instanceof UpstreamError ? error.status : 502
    const message = error instanceof Error ? error.message : 'Falha ao consultar o ai-memory.'
    return send(response, status, { error: message })
  }
})

server.listen(port, '127.0.0.1', () => console.log(`API local do painel: http://127.0.0.1:${port}`))
