import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import {
  createAiMemoryNode,
  deleteAiMemoryNode,
  findAiMemoryNode,
  listAiMemoryNodes,
  readActiveNodeId,
  writeActiveNodeId,
  updateAiMemoryNode,
} from './database.mjs'

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

export function readConnectionConfig(userId) {
  const activeNodeId = readActiveNodeId(userId)
  return activeNodeId ? readConnectionNode(userId, activeNodeId) : null
}

export function readConnectionNode(userId, nodeId) {
  const saved = findAiMemoryNode(userId, nodeId)
  if (!saved) return null
  return {
    id: saved.id,
    name: saved.name,
    endpoint: saved.endpoint,
    readToken: saved.encrypted_read_token ? decrypt(saved.encrypted_read_token) : '',
    adminToken: saved.encrypted_admin_token ? decrypt(saved.encrypted_admin_token) : '',
  }
}

export function readConnectionStatus(userId) {
  const nodes = listAiMemoryNodes(userId).map(node => ({
    id: node.id,
    name: node.name,
    endpoint: node.endpoint,
    hasReadToken: Boolean(node.encrypted_read_token),
    hasAdminToken: Boolean(node.encrypted_admin_token),
  }))
  return {
    nodes,
    activeNodeId: readActiveNodeId(userId),
  }
}

export function writeConnectionConfig({ id, userId, name, endpoint, readToken, adminToken }) {
  validateEncryptionKey()
  const encryptedReadToken = readToken ? encrypt(readToken) : ''
  const encryptedAdminToken = adminToken ? encrypt(adminToken) : ''
  const existing = findAiMemoryNode(userId, id)
  if (existing) {
    return updateAiMemoryNode({ id, userId, name, endpoint, encryptedReadToken, encryptedAdminToken })
  }
  createAiMemoryNode({ id, userId, name, endpoint, encryptedReadToken, encryptedAdminToken })
  return true
}

export function setActiveConnection(userId, nodeId) {
  if (nodeId && !findAiMemoryNode(userId, nodeId)) return false
  writeActiveNodeId(userId, nodeId)
  return true
}

export function deleteConnectionConfig(userId, nodeId) {
  return deleteAiMemoryNode(userId, nodeId)
}
