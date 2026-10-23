import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'

let child
let baseUrl
let tempDirectory
let origin

async function availablePort() {
  const server = createServer()
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject))
  const { port } = server.address()
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  return port
}

async function request(path, { method = 'GET', body, cookie } = {}) {
  const headers = { origin }
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (cookie) headers.cookie = cookie
  const response = await fetch(`${baseUrl}/api/manager/${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { response, payload: await response.json() }
}

function cookieFrom(response) {
  const value = response.headers.get('set-cookie')
  assert.ok(value?.startsWith('memora_session='))
  assert.match(value, /HttpOnly/)
  assert.match(value, /SameSite=Strict/)
  return value.split(';', 1)[0]
}

before(async () => {
  tempDirectory = await mkdtemp(join(tmpdir(), 'memora-auth-test-'))
  const port = await availablePort()
  baseUrl = `http://127.0.0.1:${port}`
  origin = baseUrl
  child = spawn(process.execPath, ['server/index.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, MANAGER_API_PORT: String(port), MANAGER_DB_PATH: join(tempDirectory, 'test.sqlite') },
    stdio: ['ignore', 'ignore', 'inherit'],
  })

  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Authentication server exited with code ${child.exitCode}`)
    try {
      const response = await fetch(`${baseUrl}/api/manager/setup/status`)
      if (response.ok) return
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('Authentication server did not start in time')
})

after(async () => {
  if (child && child.exitCode === null) {
    child.kill('SIGTERM')
    await new Promise(resolve => child.once('exit', resolve))
  }
  if (tempDirectory) await rm(tempDirectory, { recursive: true, force: true })
})

test('setup creates the first administrator and an authenticated session', async () => {
  const status = await request('setup/status')
  assert.equal(status.payload.configured, false)
  const protectedBeforeSetup = await request('settings')
  assert.equal(protectedBeforeSetup.response.status, 401)

  const setup = await request('setup', {
    method: 'POST',
    body: {
      name: 'Admin Teste',
      email: 'admin@example.com',
      password: 'uma senha longa e segura',
      passwordConfirmation: 'uma senha longa e segura',
      theme: 'dark',
    },
  })
  assert.equal(setup.response.status, 201)
  assert.equal(setup.payload.account.email, 'admin@example.com')
  const cookie = cookieFrom(setup.response)
  assert.match(setup.response.headers.get('set-cookie'), /Max-Age=604800/)

  const session = await request('auth/session', { cookie })
  assert.equal(session.payload.user.email, 'admin@example.com')
  assert.equal(session.payload.user.theme, 'dark')
  const protectedSettings = await request('settings', { cookie })
  assert.equal(protectedSettings.response.status, 200)
  const repeatedSetup = await request('setup', { method: 'POST', body: {} })
  assert.equal(repeatedSetup.response.status, 409)
})

test('login rejects invalid credentials and logout revokes the session', async () => {
  const wrongPassword = await request('auth/login', {
    method: 'POST',
    body: { email: 'admin@example.com', password: 'incorrecta' },
  })
  assert.equal(wrongPassword.response.status, 401)
  assert.equal(wrongPassword.payload.error, 'E-mail ou senha incorretos.')

  const login = await request('auth/login', {
    method: 'POST',
    body: { email: 'ADMIN@example.com', password: 'uma senha longa e segura' },
  })
  assert.equal(login.response.status, 200)
  const cookie = cookieFrom(login.response)

  const preference = await request('auth/preferences', {
    method: 'PUT',
    body: { theme: 'light' },
    cookie,
  })
  assert.equal(preference.payload.theme, 'light')

  const logout = await request('auth/logout', { method: 'POST', cookie })
  assert.equal(logout.response.status, 200)
  assert.equal(logout.payload.loggedOut, true)
  assert.match(logout.response.headers.get('set-cookie'), /Max-Age=0/)

  const expiredSession = await request('auth/session', { cookie })
  assert.equal(expiredSession.payload.user, null)
  const denied = await request('settings', { cookie })
  assert.equal(denied.response.status, 401)

  const relogin = await request('auth/login', {
    method: 'POST',
    body: { email: 'admin@example.com', password: 'uma senha longa e segura' },
  })
  assert.equal(relogin.response.status, 200)
  const newSession = await request('auth/session', { cookie: cookieFrom(relogin.response) })
  assert.equal(newSession.payload.user.theme, 'light')
})

test('state-changing requests reject a foreign origin', async () => {
  const response = await fetch(`${baseUrl}/api/manager/auth/login`, {
    method: 'POST',
    headers: { origin: 'https://attacker.example', 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.com', password: 'uma senha longa e segura' }),
  })
  assert.equal(response.status, 403)
})
