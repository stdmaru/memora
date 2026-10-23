import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scryptAsync = promisify(scrypt)
const N = 1 << 17
const r = 8
const p = 1
const keyLength = 64

export async function hashPassword(password) {
  const salt = randomBytes(16)
  const key = await scryptAsync(password, salt, keyLength, { N, r, p, maxmem: 256 * 1024 * 1024 })
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64url')}$${key.toString('base64url')}`
}

export async function verifyPassword(password, encoded) {
  const match = /^scrypt\$(\d+)\$(\d+)\$(\d+)\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/.exec(encoded || '')
  if (!match) return false
  const [, cost, blockSize, parallelism, saltEncoded, keyEncoded] = match
  if (Number(cost) !== N || Number(blockSize) !== r || Number(parallelism) !== p) return false

  const salt = Buffer.from(saltEncoded, 'base64url')
  const expected = Buffer.from(keyEncoded, 'base64url')
  if (salt.length !== 16 || expected.length !== keyLength) return false

  const actual = await scryptAsync(password, salt, keyLength, { N, r, p, maxmem: 256 * 1024 * 1024 })
  return timingSafeEqual(actual, expected)
}
