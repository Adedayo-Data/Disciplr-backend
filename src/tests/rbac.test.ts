import { describe, it, beforeAll, beforeEach } from '@jest/globals'
import request from 'supertest'
import express from 'express'
import { UserRole } from '../types/user.js'
import { jest } from '@jest/globals'

const mockGetVerifierProfile = jest.fn<any>()

// Mock database connection
const mockDb = {
  insert: jest.fn<any>().mockReturnThis(),
  returning: jest.fn<any>().mockReturnThis(),
  where: jest.fn<any>().mockReturnThis(),
  whereNull: jest.fn<any>().mockReturnThis(),
  andWhere: jest.fn<any>().mockReturnThis(),
  update: jest.fn<any>().mockReturnThis(),
  first: jest.fn<any>().mockResolvedValue({ id: 'mock-session-id' }),
}

jest.unstable_mockModule('../db/index.js', () => ({
  db: jest.fn<any>(() => mockDb),
  default: jest.fn<any>(() => mockDb),
}))

jest.unstable_mockModule('../services/verifiers.js', () => ({
  getVerifierProfile: mockGetVerifierProfile,
}))

let app: express.Express
let tokenHelpers: Record<string, () => Promise<string>>

beforeAll(async () => {
    // Dynamic import to allow mocks to be applied before module evaluation
    const authModule = await import('../middleware/auth.js')
    const rbacModule = await import('../middleware/rbac.js')

    app = express()
    app.use(express.json())

    app.get('/user-route', authModule.authenticate, rbacModule.requireUser, (_req, res) => res.json({ ok: true }))
    app.post('/verify-route', authModule.authenticate, rbacModule.requireVerifier, (_req, res) => res.json({ ok: true }))
    app.post('/active-verify-route', authModule.authenticate, rbacModule.requireVerifier, rbacModule.requireActiveVerifier, (req, res) => res.json({ verifier: req.verifier }))
    app.delete('/admin-route', authModule.authenticate, rbacModule.requireAdmin, (_req, res) => res.json({ ok: true }))

    tokenHelpers = {
        user: async () => `Bearer ${await authModule.signToken({ userId: '1', role: UserRole.USER })}`,
        verifier: async () => `Bearer ${await authModule.signToken({ userId: '1', role: UserRole.VERIFIER })}`,
        admin: async () => `Bearer ${await authModule.signToken({ userId: '1', role: UserRole.ADMIN })}`,
    }
})

beforeEach(() => {
     mockGetVerifierProfile.mockReset()
})

describe('authenticate', () => {
     it('rejects request with no token', async () => {
          const res = await request(app).get('/user-route')
          expect(res.status).toBe(401)
     })

     it('rejects an invalid token', async () => {
          const res = await request(app).get('/user-route').set('Authorization', 'Bearer invalid-token')
          expect(res.status).toBe(401)
     })

     it('accepts a valid token', async () => {
          const res = await request(app).get('/user-route').set('Authorization', await tokenHelpers.user())
          expect(res.status).toBe(200)
     })
})

describe('requireUser', () => {
     it('allows user', async () => {
          const res = await request(app).get('/user-route').set('Authorization', await tokenHelpers.user())
          expect(res.status).toBe(200)
     })

     it('allows verifier', async () => {
          const res = await request(app).get('/user-route').set('Authorization', await tokenHelpers.verifier())
          expect(res.status).toBe(200)
     })

     it('allows admin', async () => {
          const res = await request(app).get('/user-route').set('Authorization', await tokenHelpers.admin())
          expect(res.status).toBe(200)
     })
})

describe('requireVerifier', () => {
     it('forbids user', async () => {
          const res = await request(app).post('/verify-route').set('Authorization', await tokenHelpers.user())
          expect(res.status).toBe(403)
     })

     it('allows verifier', async () => {
          const res = await request(app).post('/verify-route').set('Authorization', await tokenHelpers.verifier())
          expect(res.status).toBe(200)
     })

     it('allows admin', async () => {
          const res = await request(app).post('/verify-route').set('Authorization', await tokenHelpers.admin())
          expect(res.status).toBe(200)
     })
})

describe('requireActiveVerifier', () => {
     it('denies verifier token without registry row', async () => {
          mockGetVerifierProfile.mockResolvedValue(undefined)
          const res = await request(app).post('/active-verify-route').set('Authorization', await tokenHelpers.verifier())
          expect(res.status).toBe(403)
     })

     it.each(['pending', 'suspended', 'deactivated'])('denies %s registry status', async (status) => {
          mockGetVerifierProfile.mockResolvedValue({ userId: '1', status })
          const res = await request(app).post('/active-verify-route').set('Authorization', await tokenHelpers.verifier())
          expect(res.status).toBe(403)
     })

     it('allows approved registry status and attaches verifier profile', async () => {
          mockGetVerifierProfile.mockResolvedValue({ userId: '1', status: 'approved', metadata: { specialty: 'docs' } })
          const res = await request(app).post('/active-verify-route').set('Authorization', await tokenHelpers.verifier())
          expect(res.status).toBe(200)
          expect(res.body.verifier.status).toBe('approved')
     })

     it('returns 500 when verifier registry lookup fails', async () => {
          mockGetVerifierProfile.mockRejectedValue(new Error('db down'))
          const res = await request(app).post('/active-verify-route').set('Authorization', await tokenHelpers.verifier())
          expect(res.status).toBe(500)
     })
})

describe('requireAdmin', () => {
     it('forbids user', async () => {
          const res = await request(app).delete('/admin-route').set('Authorization', await tokenHelpers.user())
          expect(res.status).toBe(403)
     })

     it('forbids verifier', async () => {
          const res = await request(app).delete('/admin-route').set('Authorization', await tokenHelpers.verifier())
          expect(res.status).toBe(403)
     })

     it('allows admin', async () => {
          const res = await request(app).delete('/admin-route').set('Authorization', await tokenHelpers.admin())
          expect(res.status).toBe(200)
     })
})
