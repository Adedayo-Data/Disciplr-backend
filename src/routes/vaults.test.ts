import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, test } from 'node:test'
import express from 'express'
import { vaultsRouter } from './vaults.js'
import { resetIdempotencyStore } from '../services/idempotency.js'
import { resetVaultStore } from '../services/vaultStore.js'
import { generateAccessToken } from '../lib/auth-utils.js'
import { UserRole } from '../types/user.js'

const testApp = express()
testApp.use(express.json())
testApp.use('/api/vaults', vaultsRouter)

const userToken = generateAccessToken({ userId: 'route-test-user', role: UserRole.USER })
const otherToken = generateAccessToken({ userId: 'route-test-other', role: UserRole.USER })

let baseUrl = ''
let server: ReturnType<typeof testApp.listen> | null = null

const stellar = (): string => `G${'A'.repeat(55)}`

const validPayload = () => ({
  amount: '1000',
  startDate: '2030-01-01T00:00:00.000Z',
  endDate: '2030-06-01T00:00:00.000Z',
  verifier: stellar(),
  destinations: {
    success: stellar(),
    failure: stellar(),
  },
  milestones: [
    {
      title: 'Kickoff',
      dueDate: '2030-02-01T00:00:00.000Z',
      amount: '300',
    },
    {
      title: 'Final review',
      dueDate: '2030-05-01T00:00:00.000Z',
      amount: '700',
    },
  ],
})

beforeEach(async () => {
  resetVaultStore()
  resetIdempotencyStore()

  server = testApp.listen(0)
  await new Promise<void>((resolve) => {
    server!.once('listening', () => resolve())
  })
  const address = server.address() as AddressInfo
  baseUrl = `http://127.0.0.1:${address.port}`
})

afterEach(async () => {
  if (!server) return

  await new Promise<void>((resolve, reject) => {
    server!.close((error?: Error) => {
      if (error) { reject(error); return }
      resolve()
    })
  })

  server = null
})

test('returns 401 without an auth token', async () => {
  const response = await fetch(`${baseUrl}/api/vaults`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(validPayload()),
  })
  assert.equal(response.status, 401)
})

test('rejects invalid vault payload', async () => {
  const response = await fetch(`${baseUrl}/api/vaults`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${userToken}`,
    },
    body: JSON.stringify({ ...validPayload(), amount: '-1' }),
  })

  assert.equal(response.status, 400)
  const body = (await response.json()) as { error: { code: string; fields: { path: string; message: string }[] } }
  assert.equal(body.error.code, 'VALIDATION_ERROR')
  assert.equal(body.error.fields.some((f) => f.path === 'amount' && f.message.includes('positive')), true)
})

test('creates vault and returns client-sign payload', async () => {
  const response = await fetch(`${baseUrl}/api/vaults`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${userToken}`,
    },
    body: JSON.stringify(validPayload()),
  })

  assert.equal(response.status, 201)
  const body = (await response.json()) as {
    vault: { id: string; milestones: Array<{ id: string }> }
    onChain: { payload: { method: string } }
  }
  assert.ok(body.vault.id)
  assert.equal(body.vault.milestones.length, 2)
  assert.equal(body.onChain.payload.method, 'create_vault')
})

test('replays idempotent request and blocks hash mismatch reuse', async () => {
  const idempotencyKey = 'idem-vault-create-1'
  const authHeader = `Bearer ${userToken}`

  const firstResponse = await fetch(`${baseUrl}/api/vaults`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'authorization': authHeader, 'idempotency-key': idempotencyKey },
    body: JSON.stringify(validPayload()),
  })
  assert.equal(firstResponse.status, 201)

  const secondResponse = await fetch(`${baseUrl}/api/vaults`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'authorization': authHeader, 'idempotency-key': idempotencyKey },
    body: JSON.stringify(validPayload()),
  })
  assert.equal(secondResponse.status, 200)
  const secondBody = (await secondResponse.json()) as { idempotency: { replayed: boolean } }
  assert.equal(secondBody.idempotency.replayed, true)

  const conflictResponse = await fetch(`${baseUrl}/api/vaults`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'authorization': authHeader, 'idempotency-key': idempotencyKey },
    body: JSON.stringify({ ...validPayload(), amount: '999' }),
  })
  assert.equal(conflictResponse.status, 409)
  const conflictBody = (await conflictResponse.json()) as { error: { code: string } }
  assert.equal(conflictBody.error.code, 'IDEMPOTENCY_CONFLICT')
})

test('returns 400 for empty idempotency key', async () => {
  const response = await fetch(`${baseUrl}/api/vaults`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${userToken}`,
      'idempotency-key': '',
    },
    body: JSON.stringify(validPayload()),
  })
  assert.equal(response.status, 400)
  const body = (await response.json()) as { error: { code: string } }
  assert.equal(body.error.code, 'INVALID_IDEMPOTENCY_KEY')
})

test('returns 400 for idempotency key with spaces', async () => {
  const response = await fetch(`${baseUrl}/api/vaults`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${userToken}`,
      'idempotency-key': 'invalid key here',
    },
    body: JSON.stringify(validPayload()),
  })
  assert.equal(response.status, 400)
  const body = (await response.json()) as { error: { code: string } }
  assert.equal(body.error.code, 'INVALID_IDEMPOTENCY_KEY')
})

test('returns 400 for idempotency key exceeding 255 characters', async () => {
  const response = await fetch(`${baseUrl}/api/vaults`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${userToken}`,
      'idempotency-key': 'a'.repeat(256),
    },
    body: JSON.stringify(validPayload()),
  })
  assert.equal(response.status, 400)
  const body = (await response.json()) as { error: { code: string } }
  assert.equal(body.error.code, 'INVALID_IDEMPOTENCY_KEY')
})

test('isolates idempotency keys between different users', async () => {
  const key = 'shared-cross-user-key'

  // User 1 creates a vault with the key
  const res1 = await fetch(`${baseUrl}/api/vaults`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${userToken}`,
      'idempotency-key': key,
    },
    body: JSON.stringify(validPayload()),
  })
  assert.equal(res1.status, 201)
  const body1 = (await res1.json()) as { vault: { id: string } }

  // User 2 uses the same key with a different payload – must NOT get 409
  const res2 = await fetch(`${baseUrl}/api/vaults`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${otherToken}`,
      'idempotency-key': key,
    },
    body: JSON.stringify({ ...validPayload(), amount: '500' }),
  })
  assert.equal(res2.status, 201)
  const body2 = (await res2.json()) as { vault: { id: string } }

  assert.notEqual(body2.vault.id, body1.vault.id)
})
