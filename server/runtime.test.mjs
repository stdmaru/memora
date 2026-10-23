import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
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

async function post(path, body) {
  return fetch(`${baseUrl}/api/manager/${path}`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

before(async () => {
  tempDirectory = await mkdtemp(join(tmpdir(), 'memora-runtime-test-'))
  const staticRoot = join(tempDirectory, 'dist')
  await mkdir(join(staticRoot, 'assets'), { recursive: true })
  await writeFile(join(staticRoot, 'index.html'), '<!doctype html><title>Memora test</title>')
  await writeFile(join(staticRoot, 'assets', 'app-test.js'), 'globalThis.memoraTest = true')
  await writeFile(join(staticRoot, 'theme-init.js'), 'globalThis.memoraTheme = true')

  const port = await availablePort()
  baseUrl = `http://127.0.0.1:${port}`
  origin = baseUrl
  child = spawn(process.execPath, ['server/index.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'production',
      MANAGER_API_PORT: String(port),
      MANAGER_DB_PATH: join(tempDirectory, 'test.sqlite'),
      MANAGER_STATIC_DIR: staticRoot,
      MEMORA_CONFIG_ENCRYPTION_KEY: 'test-only-runtime-key-with-at-least-32-characters',
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  })

  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Runtime test server exited with code ${child.exitCode}`)
    try {
      const response = await fetch(`${baseUrl}/healthz`)
      if (response.ok) return
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('Runtime test server did not start in time')
})

after(async () => {
  if (child && child.exitCode === null) {
    child.kill('SIGTERM')
    await new Promise(resolve => child.once('exit', resolve))
  }
  if (tempDirectory) await rm(tempDirectory, { recursive: true, force: true })
})

test('single server serves SPA, static assets, health and security headers', async () => {
  const page = await fetch(`${baseUrl}/`)
  assert.equal(page.status, 200)
  assert.match(page.headers.get('content-type'), /text\/html/)
  assert.equal(await page.text(), '<!doctype html><title>Memora test</title>')
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(page.headers.get('x-frame-options'), 'DENY')
  assert.match(page.headers.get('content-security-policy'), /default-src 'self'/)
  assert.equal(page.headers.get('cache-control'), 'no-cache')

  const spaRoute = await fetch(`${baseUrl}/settings/account`)
  assert.equal(spaRoute.status, 200)
  assert.equal(await spaRoute.text(), '<!doctype html><title>Memora test</title>')

  const asset = await fetch(`${baseUrl}/assets/app-test.js`)
  assert.equal(asset.status, 200)
  assert.match(asset.headers.get('content-type'), /text\/javascript/)
  assert.match(asset.headers.get('cache-control'), /immutable/)
  assert.equal(await asset.text(), 'globalThis.memoraTest = true')

  const missingAsset = await fetch(`${baseUrl}/assets/missing.js`)
  assert.equal(missingAsset.status, 404)

  const health = await fetch(`${baseUrl}/healthz`)
  assert.equal(health.status, 200)
  assert.equal(await health.text(), 'ok\n')
})

test('login and setup attempts are rate limited', async () => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const response = await post('setup', {})
    assert.equal(response.status, 400)
  }
  const limited = await post('setup', {})
  assert.equal(limited.status, 429)
  assert.equal(limited.headers.get('retry-after'), '60')
  assert.match((await limited.json()).error, /Muitas tentativas/)
})
