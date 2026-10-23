import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { deleteSetting, readSetting, writeSettings } from './database.mjs'

const settingKey = 'ai_memory_connection'
const encryptionKeyEnvironment = 'MEMORA_CONFIG_ENCRYPTION_KEY'
const additionalData = Buffer.from('memora-ai-memory-connection-v1')

function encryptionKey() {
  const value = process.env[encryptionKeyEnvironment]
  if (!value || Buffer.byteLength(value, 'utf8') < 32) {
    throw new Error(`${encryptionKeyEnvironment} deve conter pelo menos 32 caracteres para proteger as credenciais.`)
  }
  return createHash('sha256').update(value).digest()
}

export function validateEncryptionKey() {
  encryptionKey()
}

function encrypt(value) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv)
  cipher.setAAD(additionalData)
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return `v1:${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${ciphertext.toString('base64url')}`
}

function decrypt(value) {
  const [version, encodedIv, encodedTag, encodedCiphertext] = value.split(':')
  if (version !== 'v1' || !encodedIv || !encodedTag || !encodedCiphertext) {
    throw new Error('As credenciais salvas do ai-memory têm um formato inválido.')
  }
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(encodedIv, 'base64url'))
  decipher.setAAD(additionalData)
  decipher.setAuthTag(Buffer.from(encodedTag, 'base64url'))
  return Buffer.concat([
    decipher.update(Buffer.from(encodedCiphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8')
}

export function readConnectionConfig() {
  const saved = readSetting(settingKey)
  if (!saved) return null
  return {
    endpoint: saved.endpoint,
    readToken: saved.encryptedReadToken ? decrypt(saved.encryptedReadToken) : '',
    adminToken: saved.encryptedAdminToken ? decrypt(saved.encryptedAdminToken) : '',
  }
}

export function readConnectionStatus() {
  const saved = readSetting(settingKey)
  return {
    configured: Boolean(saved?.endpoint),
    endpoint: saved?.endpoint || '',
    hasReadToken: Boolean(saved?.encryptedReadToken),
    hasAdminToken: Boolean(saved?.encryptedAdminToken),
  }
}

export function writeConnectionConfig({ endpoint, readToken, adminToken }) {
  validateEncryptionKey()
  writeSettings({
    [settingKey]: {
      endpoint,
      encryptedReadToken: readToken ? encrypt(readToken) : '',
      encryptedAdminToken: adminToken ? encrypt(adminToken) : '',
    },
  })
}

export function deleteConnectionConfig() {
  deleteSetting(settingKey)
}
