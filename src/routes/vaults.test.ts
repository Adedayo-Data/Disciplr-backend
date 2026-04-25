import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, test } from 'node:test'
import request from 'supertest'
import { app } from '../app.js'
import { resetIdempotencyStore } from '../services/idempotency.js'
import { resetVaultStore, createVaultWithMilestones } from '../services/vaultStore.js'
import { runListContractTests } from '../tests/helpers/listContract.js'

let baseUrl = ''
let server: ReturnType<typeof app.listen> | null = null

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

  server = app.listen(0)
  await new Promise<void>((resolve) => {
    server!.once('listening', () => resolve())
  })
  const address = server.address() as AddressInfo
  baseUrl = `http://127.0.0.1:${address.port}`
})

afterEach(async () => {
  if (!server) {
    return
  }

  await new Promise<void>((resolve, reject) => {
    server!.close((error?: Error) => {
      if (error) {
        reject(error)
        return
      }
      resolve()
    })
  })

  server = null
})

test('rejects invalid vault payload', async () => {
  const response = await fetch(`${baseUrl}/api/vaults`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      ...validPayload(),
      amount: '-1',
    }),
  })

  assert.equal(response.status, 400)
  const body = (await response.json()) as { details: string[] }
  assert.equal(body.details.some((detail) => detail.includes('amount must be a positive number')), true)
})

test('creates vault and returns client-sign payload', async () => {
  const response = await fetch(`${baseUrl}/api/vaults`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
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

  const firstResponse = await fetch(`${baseUrl}/api/vaults`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': idempotencyKey,
    },
    body: JSON.stringify(validPayload()),
  })

  assert.equal(firstResponse.status, 201)

  const secondResponse = await fetch(`${baseUrl}/api/vaults`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': idempotencyKey,
    },
    body: JSON.stringify(validPayload()),
  })

  assert.equal(secondResponse.status, 200)
  const secondBody = (await secondResponse.json()) as { idempotency: { replayed: boolean } }
  assert.equal(secondBody.idempotency.replayed, true)

  const conflictResponse = await fetch(`${baseUrl}/api/vaults`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': idempotencyKey,
    },
    body: JSON.stringify({
      ...validPayload(),
      amount: '999',
    }),
  })

  assert.equal(conflictResponse.status, 409)
})

// ─── List Contract Tests for GET /api/vaults ────────────────────────────────

describe('GET /api/vaults - List Contract', () => {
  const testVaults: string[] = []

  beforeEach(async () => {
    // Create test vaults for list operations
    for (let i = 0; i < 5; i++) {
      const { vault } = await createVaultWithMilestones({
        amount: String(1000 + i * 100),
        startDate: '2030-01-01T00:00:00.000Z',
        endDate: '2030-06-01T00:00:00.000Z',
        verifier: stellar(),
        destinations: {
          success: stellar(),
          failure: stellar(),
        },
        milestones: [
          {
            title: `Milestone ${i}`,
            dueDate: '2030-02-01T00:00:00.000Z',
            amount: '300',
          },
        ],
      })
      testVaults.push(vault.id)
    }
  })

  afterEach(() => {
    testVaults.length = 0
  })

  // Pagination Contract
  describe('Pagination', () => {
    test('validates offset pagination structure', async () => {
      const res = await request(app)
        .get('/api/vaults')
        .set('Authorization', 'Bearer test-token')

      assert.equal(res.status, 200)
      assert.ok(res.body.data)
      assert.ok(res.body.pagination)
      assert.equal(typeof res.body.pagination.page, 'number')
      assert.equal(typeof res.body.pagination.pageSize, 'number')
      assert.equal(typeof res.body.pagination.total, 'number')
      assert.equal(typeof res.body.pagination.totalPages, 'number')
      assert.equal(typeof res.body.pagination.hasNext, 'boolean')
      assert.equal(typeof res.body.pagination.hasPrev, 'boolean')
    })

    test('respects page and pageSize parameters', async () => {
      const res = await request(app)
        .get('/api/vaults?page=1&pageSize=2')
        .set('Authorization', 'Bearer test-token')

      assert.equal(res.status, 200)
      assert.equal(res.body.pagination.page, 1)
      assert.equal(res.body.pagination.pageSize, 2)
      assert.equal(res.body.data.length, 2)
    })

    test('enforces maximum pageSize', async () => {
      const res = await request(app)
        .get('/api/vaults?pageSize=200')
        .set('Authorization', 'Bearer test-token')

      assert.equal(res.status, 200)
      assert.ok(res.body.pagination.pageSize <= 100)
    })

    test('defaults to page 1 when page < 1', async () => {
      const res = await request(app)
        .get('/api/vaults?page=0')
        .set('Authorization', 'Bearer test-token')

      assert.equal(res.status, 200)
      assert.equal(res.body.pagination.page, 1)
    })
  })

  // Sorting Contract
  describe('Sorting', () => {
    test('rejects invalid sort field with 400', async () => {
      const res = await request(app)
        .get('/api/vaults?sortBy=invalid_field')
        .set('Authorization', 'Bearer test-token')

      assert.equal(res.status, 400)
      assert.ok(res.body.error)
    })

    test('accepts valid sort fields', async () => {
      const validFields = ['createdAt', 'amount', 'endTimestamp', 'status']
      for (const field of validFields) {
        const res = await request(app)
          .get(`/api/vaults?sortBy=${field}`)
          .set('Authorization', 'Bearer test-token')

        assert.equal(res.status, 200)
        assert.ok(res.body.data)
      }
    })

    test('supports ascending and descending order', async () => {
      const ascRes = await request(app)
        .get('/api/vaults?sortBy=amount&sortOrder=asc')
        .set('Authorization', 'Bearer test-token')

      const descRes = await request(app)
        .get('/api/vaults?sortBy=amount&sortOrder=desc')
        .set('Authorization', 'Bearer test-token')

      assert.equal(ascRes.status, 200)
      assert.equal(descRes.status, 200)
    })
  })

  // Filtering Contract
  describe('Filtering', () => {
    test('ignores non-allowed filter parameters', async () => {
      const res = await request(app)
        .get('/api/vaults?nonexistentFilter=value')
        .set('Authorization', 'Bearer test-token')

      assert.equal(res.status, 200)
      assert.ok(res.body.data)
    })

    test('accepts valid filter fields', async () => {
      const res = await request(app)
        .get('/api/vaults?status=active')
        .set('Authorization', 'Bearer test-token')

      assert.equal(res.status, 200)
      assert.ok(res.body.data)
    })

    test('filters by creator', async () => {
      const res = await request(app)
        .get('/api/vaults?creator=GTEST1234567890123456789012345678901234567890123456789012345678901')
        .set('Authorization', 'Bearer test-token')

      assert.equal(res.status, 200)
      assert.ok(res.body.data)
    })
  })

  // Security Contract
  describe('Security', () => {
    test('requires authentication', async () => {
      const res = await request(app).get('/api/vaults')
      assert.equal(res.status, 401)
    })

    test('cannot sort by sensitive fields', async () => {
      const res = await request(app)
        .get('/api/vaults?sortBy=password')
        .set('Authorization', 'Bearer test-token')

      assert.equal(res.status, 400)
    })
  })

  // Response Structure Contract
  describe('Response Structure', () => {
    test('returns array of items in data field', async () => {
      const res = await request(app)
        .get('/api/vaults')
        .set('Authorization', 'Bearer test-token')

      assert.equal(res.status, 200)
      assert.equal(Array.isArray(res.body.data), true)
    })

    test('includes required fields in each item', async () => {
      const res = await request(app)
        .get('/api/vaults')
        .set('Authorization', 'Bearer test-token')

      assert.equal(res.status, 200)
      if (res.body.data.length > 0) {
        const item = res.body.data[0]
        assert.ok(item.id)
        assert.ok(item.creator)
        assert.ok(item.amount)
        assert.ok(item.status)
      }
    })
  })
})
