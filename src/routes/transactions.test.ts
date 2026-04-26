import request from 'supertest'
import { app } from '../app.js'
import { db } from '../db/index.js'

describe('Transactions API', () => {
  let testUserId: string
  let testVaultId: string
  let testTransactionId: string

  beforeAll(async () => {
    // Create test user
    const user = await db('users').insert({
      email: 'test@example.com',
      password_hash: 'hashed_password'
    }).returning('*')
    testUserId = user[0].id

    // Create test vault
    const vault = await db('vaults').insert({
      id: 'test-vault-1234567890123456789012345678901234567890123456789012345678901234',
      creator: 'GTEST1234567890123456789012345678901234567890123456789012345678901',
      amount: '100.0000000',
      start_timestamp: new Date(),
      end_timestamp: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      success_destination: 'GDEST1234567890123456789012345678901234567890123456789012345678901',
      failure_destination: 'GFAIL1234567890123456789012345678901234567890123456789012345678901',
      status: 'active',
      user_id: testUserId
    }).returning('*')
    testVaultId = vault[0].id

    // Create test transaction
    const transaction = await db('transactions').insert({
      user_id: testUserId,
      vault_id: testVaultId,
      tx_hash: 'test_tx_hash_1234567890123456789012345678901234567890123456789012345678901234',
      type: 'creation',
      amount: '100.0000000',
      asset_code: null,
      from_account: 'GTEST1234567890123456789012345678901234567890123456789012345678901',
      to_account: 'GDEST1234567890123456789012345678901234567890123456789012345678901',
      memo: 'Test transaction',
      stellar_ledger: 12345,
      stellar_timestamp: new Date(),
      explorer_url: 'https://stellar.expert/explorer/public/tx/test_tx_hash'
    }).returning('*')
    testTransactionId = transaction[0].id
  })

  afterAll(async () => {
    // Clean up test data
    await db('transactions').where('user_id', testUserId).del()
    await db('vaults').where('user_id', testUserId).del()
    await db('users').where('id', testUserId).del()
    await db.destroy()
  })

  describe('GET /api/transactions', () => {
    it('should return user transactions with authentication', async () => {
      const response = await request(app)
        .get('/api/transactions')
        .set('x-user-id', testUserId)
        .expect(200)

      expect(response.body).toHaveProperty('data')
      expect(response.body).toHaveProperty('pagination')
      expect(Array.isArray(response.body.data)).toBe(true)
      expect(response.body.data.length).toBeGreaterThan(0)
      
      const transaction = response.body.data[0]
      expect(transaction).toHaveProperty('id')
      expect(transaction).toHaveProperty('vault_id')
      expect(transaction).toHaveProperty('type')
      expect(transaction).toHaveProperty('amount')
      expect(transaction).toHaveProperty('tx_hash')
      expect(transaction).toHaveProperty('explorer_url')
    })

    it('should filter transactions by type', async () => {
      const response = await request(app)
        .get('/api/transactions?type=creation')
        .set('x-user-id', testUserId)
        .expect(200)

      expect(response.body.data.every((tx: any) => tx.type === 'creation')).toBe(true)
    })

    it('should filter transactions by vault_id', async () => {
      const response = await request(app)
        .get(`/api/transactions?vault_id=${testVaultId}`)
        .set('x-user-id', testUserId)
        .expect(200)

      expect(response.body.data.every((tx: any) => tx.vault_id === testVaultId)).toBe(true)
    })

    it('should paginate results using page parameter', async () => {
      const response = await request(app)
        .get('/api/transactions?page=1&limit=1')
        .set('x-user-id', testUserId)
        .expect(200)

      expect(response.body.pagination.limit).toBe(1)
      expect(response.body.pagination.page).toBe(1)
      expect(response.body.data.length).toBeLessThanOrEqual(1)
    })

    it('should maintain stable ordering for identical timestamps', async () => {
      const now = new Date()
      // Insert two transactions with the same timestamp
      await db('transactions').insert([
        {
          user_id: testUserId,
          vault_id: testVaultId,
          tx_hash: 'same_ts_1',
          type: 'creation',
          amount: '10.00',
          from_account: 'GFROM',
          to_account: 'GTO',
          stellar_ledger: 100,
          stellar_timestamp: now,
          explorer_url: 'http://example.com/1'
        },
        {
          user_id: testUserId,
          vault_id: testVaultId,
          tx_hash: 'same_ts_2',
          type: 'creation',
          amount: '20.00',
          from_account: 'GFROM',
          to_account: 'GTO',
          stellar_ledger: 100,
          stellar_timestamp: now,
          explorer_url: 'http://example.com/2'
        }
      ])

      const res = await request(app)
        .get('/api/transactions?limit=10')
        .set('x-user-id', testUserId)
        .expect(200)

      const sameTsItems = res.body.data.filter((tx: any) => tx.tx_hash.startsWith('same_ts_'))
      expect(sameTsItems.length).toBe(2)
      
      // Should be ordered by ID (UUID) descending since timestamps are identical
      // We can't easily predict UUID order without knowing them, but we can verify consistency
      const order = sameTsItems.map((tx: any) => tx.id)
      const sortedOrder = [...order].sort().reverse()
      expect(order).toEqual(sortedOrder)
    })

    it('should require authentication', async () => {
      await request(app)
        .get('/api/transactions')
        .expect(401)
    })
  })

  describe('GET /api/transactions/:id', () => {
    it('should return specific transaction', async () => {
      const response = await request(app)
        .get(`/api/transactions/${testTransactionId}`)
        .set('x-user-id', testUserId)
        .expect(200)

      expect(response.body).toHaveProperty('id', testTransactionId)
      expect(response.body).toHaveProperty('vault_id', testVaultId)
      expect(response.body).toHaveProperty('type')
      expect(response.body).toHaveProperty('amount')
    })

    it('should return 404 for non-existent transaction', async () => {
      await request(app)
        .get('/api/transactions/non-existent-id')
        .set('x-user-id', testUserId)
        .expect(404)
    })

    it('should require authentication', async () => {
      await request(app)
        .get(`/api/transactions/${testTransactionId}`)
        .expect(401)
    })
  })

  describe('GET /api/transactions/vault/:vaultId', () => {
    it('should return transactions for specific vault', async () => {
      const response = await request(app)
        .get(`/api/transactions/vault/${testVaultId}`)
        .set('x-user-id', testUserId)
        .expect(200)

      expect(response.body).toHaveProperty('data')
      expect(Array.isArray(response.body.data)).toBe(true)
      expect(response.body.data.every((tx: any) => tx.vault_id === testVaultId)).toBe(true)
    })

    it('should return 404 for non-existent vault', async () => {
      await request(app)
        .get('/api/transactions/vault/non-existent-vault')
        .set('x-user-id', testUserId)
        .expect(404)
    })

    it('should require authentication', async () => {
      await request(app)
        .get(`/api/transactions/vault/${testVaultId}`)
        .expect(401)
    })
  })
})
