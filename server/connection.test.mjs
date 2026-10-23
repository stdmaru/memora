import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { createServer as createTcpServer } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'

const masterKey = 'test-only-master-key-with-at-least-32-characters'
const readToken = 'test-read-token-that-must-not-leak'
const adminToken = 'test-admin-token-that-must-not-leak'
let child
let managerUrl
let upstreamUrl
let databasePath
let tempDirectory
let origin
let upstream
let sessionCookie
let primaryNodeId
let secondaryNodeId
const receivedPaths = []
const receivedRequests = []
const upstreamResponses = new Map()

async function availablePort() {
  const server = createTcpServer()
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject))
  const { port } = server.address()
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  return port
}

async function request(path, { method = 'GET', body, cookie } = {}) {
  const headers = { origin }
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (cookie) headers.cookie = cookie
  const response = await fetch(`${managerUrl}/api/manager/${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { response, payload: await response.json() }
}

function cookieFrom(response) {
  const value = response.headers.get('set-cookie')
  assert.ok(value?.startsWith('memora_session='))
  return value.split(';', 1)[0]
}

before(async () => {
  tempDirectory = await mkdtemp(join(tmpdir(), 'memora-connection-test-'))
  databasePath = join(tempDirectory, 'test.sqlite')
  const upstreamPort = await availablePort()
  upstreamUrl = `http://127.0.0.1:${upstreamPort}/mcp`
  upstream = createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const path = request.url
    receivedPaths.push(path)
    receivedRequests.push({
      path,
      method: request.method,
      authorization: request.headers.authorization,
      body: Buffer.concat(chunks).toString('utf8'),
    })
    const expectedToken = request.url.startsWith('/admin/') ? adminToken : readToken
    if (request.headers.authorization !== `Bearer ${expectedToken}`) {
      response.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'Unauthorized' }))
      return
    }
    const override = upstreamResponses.get(path)
    if (override?.redirect) {
      response.writeHead(302, { location: override.redirect }).end()
      return
    }
    if (override?.oversized) {
      response.writeHead(200, { 'content-type': 'application/json', 'content-length': String(5 * 1024 * 1024 + 1) }).end()
      return
    }
    const payload = override?.payload ?? (
      path === '/identity'
        ? { level: 'ok', version: 'test' }
        : path === '/api/v1/workspaces'
          ? [{ name: 'workspace-one' }]
          : path === '/api/v1/projects'
            ? [{ name: 'project-one' }]
            : []
    )
    response.writeHead(override?.status || 200, { 'content-type': 'application/json' }).end(JSON.stringify(payload))
  })
  await new Promise((resolve, reject) => upstream.listen(upstreamPort, '127.0.0.1', resolve).once('error', reject))

  const managerPort = await availablePort()
  managerUrl = `http://127.0.0.1:${managerPort}`
  origin = managerUrl
  child = spawn(process.execPath, ['server/index.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      MANAGER_API_PORT: String(managerPort),
      MANAGER_DB_PATH: databasePath,
      MEMORA_CONFIG_ENCRYPTION_KEY: masterKey,
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  })

  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Connection test server exited with code ${child.exitCode}`)
    try {
      const response = await fetch(`${managerUrl}/api/manager/setup/status`)
      if (response.ok) return
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('Connection test server did not start in time')
})

after(async () => {
  if (child && child.exitCode === null) {
    child.kill('SIGTERM')
    await new Promise(resolve => child.once('exit', resolve))
  }
  if (upstream) await new Promise(resolve => upstream.close(resolve))
  if (tempDirectory) await rm(tempDirectory, { recursive: true, force: true })
})

test('node connection starts disconnected, encrypts credentials and scopes preferences by node', async () => {
  const setup = await request('setup', {
    method: 'POST',
    body: {
      name: 'Admin Teste',
      email: 'connection@example.com',
      password: 'senha de teste segura',
      passwordConfirmation: 'senha de teste segura',
    },
  })
  assert.equal(setup.response.status, 201)
  const cookie = cookieFrom(setup.response)
  sessionCookie = cookie

  const disconnected = await request('connection', { cookie })
  assert.deepEqual(disconnected.payload, { nodes: [], activeNodeId: '' })

  const scopesWhileDisconnected = await request('scopes', { cookie })
  assert.equal(scopesWhileDisconnected.response.status, 503)
  assert.match(scopesWhileDisconnected.payload.error, /Configurações/)

  const invalidEndpoint = await request('connection', {
    method: 'POST',
    cookie,
    body: { name: 'Node inválido', endpoint: 'ftp://invalid.example/mcp', readToken },
  })
  assert.equal(invalidEndpoint.response.status, 400)

  const connected = await request('connection', {
    method: 'POST',
    cookie,
    body: { name: 'Node principal', endpoint: upstreamUrl, readToken, adminToken },
  })
  assert.equal(connected.response.status, 201)
  assert.deepEqual(connected.payload, {
    nodes: [{
      id: connected.payload.nodes[0].id,
      name: 'Node principal',
      endpoint: upstreamUrl,
      hasReadToken: true,
      hasAdminToken: true,
    }],
    activeNodeId: connected.payload.nodes[0].id,
  })
  assert.deepEqual(receivedPaths, ['/identity', '/api/v1/workspaces', '/api/v1/projects', '/admin/checkpoints?limit=1'])

  const settings = await request('settings', { cookie })
  assert.equal(JSON.stringify(settings.payload).includes(readToken), false)
  assert.equal(JSON.stringify(settings.payload).includes(adminToken), false)
  assert.equal(settings.payload.ai_memory_connection, undefined)

  const database = new DatabaseSync(databasePath, { readOnly: true })
  const saved = database.prepare('SELECT encrypted_read_token, encrypted_admin_token FROM ai_memory_nodes').get()
  database.close()
  assert.ok(saved)
  assert.equal(saved.encrypted_read_token.includes(readToken), false)
  assert.equal(saved.encrypted_admin_token.includes(adminToken), false)

  const nodeId = connected.payload.activeNodeId
  primaryNodeId = nodeId
  const rejectedUpdate = await request(`connection/${nodeId}`, {
    method: 'PUT',
    cookie,
    body: { name: 'Node principal alterado', endpoint: upstreamUrl, readToken: 'incorrect-token' },
  })
  assert.equal(rejectedUpdate.response.status, 401)
  const stillConnected = await request('connection', { cookie })
  assert.equal(stillConnected.payload.nodes[0].name, 'Node principal')

  const secondNode = await request('connection', {
    method: 'POST',
    cookie,
    body: { name: 'Node secundário', endpoint: upstreamUrl, readToken },
  })
  secondaryNodeId = secondNode.payload.activeNodeId
  assert.equal(secondNode.response.status, 201)
  assert.equal(secondNode.payload.nodes.length, 2)
  assert.equal(secondNode.payload.activeNodeId, secondNode.payload.nodes.find(node => node.name === 'Node secundário').id)

  const selectFirst = await request('connection/active', { method: 'PUT', cookie, body: { nodeId } })
  assert.equal(selectFirst.payload.activeNodeId, nodeId)
  const firstScope = await request('settings', {
    method: 'PUT',
    cookie,
    body: { scope: { workspace: 'workspace-one', project: 'project-one' } },
  })
  assert.deepEqual(firstScope.payload.scope, { workspace: 'workspace-one', project: 'project-one' })
  const selectSecond = await request('connection/active', { method: 'PUT', cookie, body: { nodeId: secondNode.payload.activeNodeId } })
  assert.equal(selectSecond.payload.activeNodeId, secondNode.payload.activeNodeId)
  const secondScope = await request('settings', { cookie })
  assert.equal(secondScope.payload.scope, null)
  const selectFirstAgain = await request('connection/active', { method: 'PUT', cookie, body: { nodeId } })
  assert.equal(selectFirstAgain.payload.activeNodeId, nodeId)
  const firstScopeAgain = await request('settings', { cookie })
  assert.deepEqual(firstScopeAgain.payload.scope, { workspace: 'workspace-one', project: 'project-one' })
  const scopesWithAdmin = await request('scopes', { cookie })
  assert.equal(scopesWithAdmin.payload.canAdmin, true, JSON.stringify(scopesWithAdmin.payload))

})

test('protected API routes reject missing and invalid sessions', async () => {
  const unauthenticated = await request('identity')
  assert.equal(unauthenticated.response.status, 401)
  assert.equal(unauthenticated.payload.error, 'Autenticação necessária.')

  const invalidCookie = await fetch(`${managerUrl}/api/manager/identity`, {
    headers: { cookie: 'memora_session=not-a-session' },
  })
  assert.equal(invalidCookie.status, 401)
})

test('API proxy forwards scoped requests and maps upstream failures', async () => {
  const identity = await request('identity', { cookie: sessionCookie })
  assert.equal(identity.response.status, 200)
  assert.deepEqual(identity.payload, { level: 'ok', version: 'test' })

  const scopes = await request('scopes', { cookie: sessionCookie })
  assert.equal(scopes.response.status, 200)
  assert.deepEqual(scopes.payload.workspaces, [{ name: 'workspace-one' }])
  assert.deepEqual(scopes.payload.projects, [{ name: 'project-one' }])
  assert.equal(scopes.payload.canAdmin, true)

  const encodedPagePath = '/api/v1/workspaces/workspace%20one/projects/project%2Fone/pages'
  const pages = await request('pages?workspace=workspace%20one&project=project%2Fone', { cookie: sessionCookie })
  assert.equal(pages.response.status, 200)
  assert.ok(receivedRequests.some(({ path, authorization }) => path === encodedPagePath && authorization === ['Bearer', readToken].join(' ')))

  const invalidPagePath = await request('page?workspace=workspace-one&project=project-one&path=..%2Fsecret.md', { cookie: sessionCookie })
  assert.equal(invalidPagePath.response.status, 400)

  upstreamResponses.set(encodedPagePath, { status: 404, payload: { error: 'not found' } })
  const missingReadApi = await request('pages?workspace=workspace%20one&project=project%2Fone', { cookie: sessionCookie })
  upstreamResponses.delete(encodedPagePath)
  assert.equal(missingReadApi.response.status, 424)
  assert.match(missingReadApi.payload.error, /AI_MEMORY_ENABLE_WEB/)
})

test('administrative proxy requires the root token and forwards allowed actions', async () => {
  const adminPath = '/admin/rename-project'
  const callsBefore = receivedRequests.filter(({ path }) => path === adminPath).length
  const renamed = await request('admin', {
    method: 'POST',
    cookie: sessionCookie,
    body: { action: 'rename-project', workspace: 'workspace-one', project: 'project-one', name: 'renamed' },
  })
  assert.equal(renamed.response.status, 200)
  const adminRequest = receivedRequests.filter(({ path }) => path === adminPath).at(-1)
  assert.equal(adminRequest.authorization, ['Bearer', adminToken].join(' '))
  assert.equal(adminRequest.method, 'POST')
  assert.deepEqual(JSON.parse(adminRequest.body), { workspace: 'workspace-one', project: 'project-one', name: 'renamed' })
  assert.equal(receivedRequests.filter(({ path }) => path === adminPath).length, callsBefore + 1)

  const selectNodeWithoutAdmin = await request('connection/active', {
    method: 'PUT',
    cookie: sessionCookie,
    body: { nodeId: secondaryNodeId },
  })
  assert.equal(selectNodeWithoutAdmin.response.status, 200)
  const callsWithoutRoot = receivedRequests.filter(({ path }) => path === adminPath).length
  const denied = await request('admin', {
    method: 'POST',
    cookie: sessionCookie,
    body: { action: 'rename-project', workspace: 'workspace-one', project: 'project-one', name: 'should-not-run' },
  })
  assert.equal(denied.response.status, 503)
  assert.match(denied.payload.error, /token root/)
  assert.equal(receivedRequests.filter(({ path }) => path === adminPath).length, callsWithoutRoot)

  const restorePrimary = await request('connection/active', {
    method: 'PUT',
    cookie: sessionCookie,
    body: { nodeId: primaryNodeId },
  })
  assert.equal(restorePrimary.response.status, 200)
  assert.equal(restorePrimary.payload.activeNodeId, primaryNodeId)
})

test('node connection refuses redirects and oversized upstream responses', async () => {
  const redirectTargetCalls = receivedRequests.filter(({ path }) => path === '/redirect-target').length
  upstreamResponses.set('/identity', { redirect: '/redirect-target' })
  const redirectedConnection = await request('connection', {
    method: 'POST',
    cookie: sessionCookie,
    body: { name: 'Node com redirect', endpoint: upstreamUrl, readToken },
  })
  upstreamResponses.delete('/identity')
  assert.equal(redirectedConnection.response.status, 502)
  assert.equal(receivedRequests.filter(({ path }) => path === '/redirect-target').length, redirectTargetCalls)

  upstreamResponses.set('/identity', { oversized: true })
  const oversizedIdentity = await request('identity', { cookie: sessionCookie })
  upstreamResponses.delete('/identity')
  assert.equal(oversizedIdentity.response.status, 502)
  assert.match(oversizedIdentity.payload.error, /excede o tamanho permitido/)
})

test('deleting nodes clears the active selection and stored nodes', async () => {
  const selectPrimary = await request('connection/active', {
    method: 'PUT',
    cookie: sessionCookie,
    body: { nodeId: primaryNodeId },
  })
  assert.equal(selectPrimary.payload.activeNodeId, primaryNodeId)
  const removeFirst = await request(`connection/${primaryNodeId}`, { method: 'DELETE', cookie: sessionCookie })
  assert.equal(removeFirst.response.status, 200)
  assert.equal(removeFirst.payload.nodes.length, 1)
  assert.equal(removeFirst.payload.activeNodeId, '')

  const removeActive = await request(`connection/${secondaryNodeId}`, { method: 'DELETE', cookie: sessionCookie })
  assert.deepEqual(removeActive.payload, { nodes: [], activeNodeId: '' })
})
