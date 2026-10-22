import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { createInitialAdmin, hasAdmin, logAudit, readSettings, writeSettings } from './database.mjs'
import { hashPassword } from './passwords.mjs'

const port = Number(process.env.MANAGER_API_PORT || 4174)
const mcpUrl = process.env.AI_MEMORY_MCP_URL?.replace(/\/+$/, '')
const token = process.env.AI_MEMORY_AUTH_TOKEN
const adminToken = process.env.AI_MEMORY_ADMIN_TOKEN
const preferredWorkspace = process.env.AI_MEMORY_WORKSPACE || ''
const preferredProject = process.env.AI_MEMORY_PROJECT || ''

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
  })
  response.end(JSON.stringify(payload))
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

function missingConfiguration() {
  return mcpUrl ? [] : ['AI_MEMORY_MCP_URL']
}

function getAiMemoryBaseUrl() {
  const url = new URL(mcpUrl)
  url.pathname = url.pathname.replace(/\/mcp\/?$/, '').replace(/\/$/, '')
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/$/, '')
}

async function getAiMemory(path) {
  const headers = { accept: 'application/json' }
  if (token) headers.authorization = `Bearer ${token}`
  let response
  try {
    response = await fetch(`${getAiMemoryBaseUrl()}${path}`, {
      headers,
      signal: AbortSignal.timeout(20000),
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
  if (!adminToken) throw new UpstreamError('Configure AI_MEMORY_ADMIN_TOKEN com o bearer root do ai-memory para habilitar ações administrativas.', 503)
  let response
  try {
    response = await fetch(`${getAiMemoryBaseUrl()}${path}`, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json', authorization: `Bearer ${adminToken}` },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20000),
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
  if (!adminToken) throw new UpstreamError('Configure AI_MEMORY_ADMIN_TOKEN com o bearer root do ai-memory para acessar a lixeira.', 503)
  let response
  try {
    response = await fetch(`${getAiMemoryBaseUrl()}${path}`, {
      headers: { accept: 'application/json', authorization: `Bearer ${adminToken}` },
      signal: AbortSignal.timeout(20000),
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
    if (url.pathname === '/api/manager/setup/status' && request.method === 'GET') {
      return send(response, 200, { configured: hasAdmin() })
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
      const created = createInitialAdmin({ id: randomUUID(), name, email, passwordHash, theme })
      if (!created) return send(response, 409, { error: 'A configuração inicial já foi concluída.' })
      logAudit({ action: 'create-initial-admin', outcome: 'success' })
      return send(response, 201, { configured: true, account: { name, email, role: 'admin' }, preferences: { theme } })
    }

    if (url.pathname === '/api/manager/settings' && request.method === 'GET') {
      return send(response, 200, readSettings())
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
      return send(response, 200, writeSettings(updates))
    }

    const missing = missingConfiguration()
    if (missing.length) return send(response, 503, { error: 'Configure a URL do ai-memory no .env.', missing })

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
        preferred: { workspace: preferredWorkspace, project: preferredProject },
        canAdmin: Boolean(adminToken),
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
