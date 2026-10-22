import { randomBytes, scrypt } from 'node:crypto'
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
