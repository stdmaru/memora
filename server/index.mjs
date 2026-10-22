import { createServer } from 'node:http'

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

  const missing = missingConfiguration()
  if (missing.length) return send(response, 503, { error: 'Configure a URL do ai-memory no .env.', missing })

  try {
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
        return send(response, 200, await postAdmin(routes[action], writePayload))
      }
      return send(response, 200, await postAdmin(routes[action], payload))
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
