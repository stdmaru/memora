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
const receivedPaths = []

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
  upstream = createServer((request, response) => {
    receivedPaths.push(request.url)
    const expectedToken = request.url.startsWith('/admin/') ? adminToken : readToken
    if (request.headers.authorization !== `Bearer ${expectedToken}`) {
      response.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'Unauthorized' }))
      return
    }
    const payload = request.url === '/identity'
      ? { level: 'ok', version: 'test' }
      : []
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(payload))
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

test('node connection starts disconnected, stores encrypted credentials and can be removed', async () => {
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

  const removeFirst = await request(`connection/${nodeId}`, { method: 'DELETE', cookie })
  assert.equal(removeFirst.payload.nodes.length, 1)
  assert.equal(removeFirst.payload.activeNodeId, '')
  const removeActive = await request(`connection/${secondNode.payload.activeNodeId}`, { method: 'DELETE', cookie })
  assert.deepEqual(removeActive.payload, { nodes: [], activeNodeId: '' })
})
