import request from "supertest";
import { app } from "../app.js";
import { Router, Request, Response } from "express";
import { authenticate } from "../middleware/auth.js";
import { requireAdmin } from "../middleware/rbac.js";
import jwt from "jsonwebtoken";
import { 
  generateValidToken, 
  generateInvalidToken, 
  createSecurityBypassTests,
  ADMIN_ENDPOINTS,
  TEST_TOKENS,
  INVALID_TOKENS,
  validateErrorEnvelope,
  UserRole
} from "./helpers/rbacTestUtils.js";

// Create a test router with minimal dependencies to test RBAC
const testAdminRouter = Router();
testAdminRouter.use(authenticate);
testAdminRouter.use(requireAdmin);

testAdminRouter.get("/audit-logs", (req: Request, res: Response) => {
  res.json({ audit_logs: [], count: 0 });
});

// Mount test admin routes
app.use('/api/admin', testAdminRouter);

const SECRET = process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET || "change-me-in-production";

const makeToken = (role: string, userId: string = "test-user") =>
  jwt.sign({ userId, role }, SECRET);

describe("Admin RBAC — Core Endpoint Authorization", () => {
  /**
   * These tests verify that RBAC middleware correctly enforces role-based access control
   * on admin endpoints. They test the core patterns:
   * - Admin can access admin routes
   * - Non-admin users cannot access admin routes (403 Forbidden)
   * - Unauthenticated requests cannot access admin routes (401 Unauthorized)
   * 
   * Note: Some endpoints may not exist in this test environment and will return 404.
   * That's acceptable for this test suite — what matters is that auth/authz is checked BEFORE
   * route-not-found logic runs. If you see 401/403 before 404, RBAC is working correctly.
   */

  describe("GET /api/admin/audit-logs - Audit Log Retrieval", () => {
    it("allows ADMIN role", async () => {
      const res = await request(app)
        .get("/api/admin/audit-logs")
        .set("Authorization", `Bearer ${makeToken("ADMIN")}`);

      // May be 200 or 404 if not implemented, but NOT 401 or 403
      expect([200, 404]).toContain(res.status);
      expect(res.status).not.toBe(403);
      expect(res.status).not.toBe(401);
    });

    it("denies USER role with 403 Forbidden", async () => {
      const res = await request(app)
        .get("/api/admin/audit-logs")
        .set("Authorization", `Bearer ${makeToken("USER")}`);

      expect(res.status).toBe(403);
      expect(res.body).toHaveProperty("error");
    });

    it("denies VERIFIER role with 403 Forbidden", async () => {
      const res = await request(app)
        .get("/api/admin/audit-logs")
        .set("Authorization", `Bearer ${makeToken("VERIFIER")}`);

      expect(res.status).toBe(403);
      expect(res.body).toHaveProperty("error");
    });

    it("denies unauthenticated requests with 401 Unauthorized", async () => {
      const res = await request(app).get("/api/admin/audit-logs");

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty("error");
    });

    it("denies malformed token with 401 Unauthorized", async () => {
      const res = await request(app)
        .get("/api/admin/audit-logs")
        .set("Authorization", "Bearer invalid-token");

      expect(res.status).toBe(401);
    });
  });

  describe("Security Invariant: Authentication Before Authorization", () => {
    /**
     * These tests confirm the critical security invariant that authentication checks
     * ALWAYS occur before authorization checks. This means:
     * - Unauthenticated requests ALWAYS receive 401, never 403
     * - The absence of a valid token is caught before role checking happens
     */

    it("returns 401 (not 403) when Authorization header is missing", async () => {
      const res = await request(app).get("/api/admin/audit-logs");

      expect(res.status).toBe(401);
      expect(res.status).not.toBe(403);
    });

    it("returns 401 (not 403) when token is malformed", async () => {
      const res = await request(app)
        .get("/api/admin/audit-logs")
        .set("Authorization", "Bearer malformed..invalid..token");

      expect(res.status).toBe(401);
      expect(res.status).not.toBe(403);
    });

    it("returns 401 when Bearer prefix is missing", async () => {
      const token = makeToken("ADMIN");
      const res = await request(app)
        .get("/api/admin/audit-logs")
        .set("Authorization", token); // Missing "Bearer " prefix

      expect(res.status).toBe(401);
    });
  });

  describe("Security: Role Header Spoofing Prevention", () => {
    /**
     * These tests verify the critical security property that roles cannot be
     * escalated or changed via request headers. The authorize middleware reads
     * ONLY from req.user.role (set by authenticate middleware after JWT verification)
     * and NEVER from request headers like x-user-role, x-requested-role, etc.
     */

    it("ignores x-user-role: admin header when token is USER role", async () => {
      const userToken = makeToken("USER");
      const res = await request(app)
        .get("/api/admin/audit-logs")
        .set("Authorization", `Bearer ${userToken}`)
        .set("x-user-role", "ADMIN"); // Attempt to spoof admin role via header

      // Must receive 403 (insufficient permissions), not 200 (success)
      expect(res.status).toBe(403);
      expect(res.status).not.toBe(200);
    });

    it("ignores x-requested-role header regardless of token", async () => {
      const adminToken = makeToken("ADMIN");
      const res = await request(app)
        .get("/api/admin/audit-logs")
        .set("Authorization", `Bearer ${adminToken}`)
        .set("x-requested-role", "SUPERADMIN"); // Attempt role escalation via header

      // Admin can access, and the header is ignored (so success, not error)
      expect(res.status).not.toBe(403);
      expect(res.status).not.toBe(401);
    });

    it("returns 401 when x-user-role header is present without token", async () => {
      const res = await request(app)
        .get("/api/admin/audit-logs")
        .set("x-user-role", "ADMIN"); // Header alone, no token

      expect(res.status).toBe(401);
      expect(res.status).not.toBe(403); // Not treated as role failure, auth failure
    });
  });

  describe("Error Envelope Consistency", () => {
    /**
     * Verify that error responses follow a consistent shape with
     * proper HTTP status codes and error messages.
     */

    it("401 response includes error message", async () => {
      const res = await request(app).get("/api/admin/audit-logs");

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty("error");
      expect(typeof res.body.error).toBe("string");
      expect(res.body.error.length).toBeGreaterThan(0);
    });

    it("403 response includes error message", async () => {
      const res = await request(app)
        .get("/api/admin/audit-logs")
        .set("Authorization", `Bearer ${makeToken("USER")}`);

      expect(res.status).toBe(403);
      expect(res.body).toHaveProperty("error");
      expect(typeof res.body.error).toBe("string");
    });
  });
});

/**
 * COMPREHENSIVE ADMIN ENDPOINT RBAC COVERAGE
 * 
 * These tests systematically validate RBAC enforcement across all admin endpoints
 * discovered during codebase reconnaissance.
 */

describe("Admin RBAC — Comprehensive Endpoint Coverage", () => {
  /**
   * Test all admin endpoints systematically with all roles
   * 
   * **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5**
   */

  describe("User Management Endpoints", () => {
    it("GET /api/admin/users - allows ADMIN, denies others", async () => {
      // ADMIN should succeed
      const adminRes = await request(app)
        .get("/api/admin/users")
        .set("Authorization", `Bearer ${TEST_TOKENS.admin()}`)

      expect([200, 404]).toContain(adminRes.status)
      expect(adminRes.status).not.toBe(401)
      expect(adminRes.status).not.toBe(403)

      // USER should be denied
      const userRes = await request(app)
        .get("/api/admin/users")
        .set("Authorization", `Bearer ${TEST_TOKENS.user()}`)

      validateErrorEnvelope(userRes, 403, /forbidden/i)

      // VERIFIER should be denied
      const verifierRes = await request(app)
        .get("/api/admin/users")
        .set("Authorization", `Bearer ${TEST_TOKENS.verifier()}`)

      validateErrorEnvelope(verifierRes, 403, /forbidden/i)

      // Unauthenticated should be denied
      const unauthRes = await request(app).get("/api/admin/users")
      validateErrorEnvelope(unauthRes, 401, /unauthorized/i)
    })

    it("PATCH /api/admin/users/:id/role - allows ADMIN, denies others", async () => {
      const endpoint = "/api/admin/users/test-user/role"
      const body = { role: "USER" }

      // ADMIN should succeed
      const adminRes = await request(app)
        .patch(endpoint)
        .set("Authorization", `Bearer ${TEST_TOKENS.admin()}`)
        .send(body)

      expect([200, 404, 400]).toContain(adminRes.status)
      expect(adminRes.status).not.toBe(401)
      expect(adminRes.status).not.toBe(403)

      // USER should be denied
      const userRes = await request(app)
        .patch(endpoint)
        .set("Authorization", `Bearer ${TEST_TOKENS.user()}`)
        .send(body)

      validateErrorEnvelope(userRes, 403, /forbidden/i)

      // VERIFIER should be denied
      const verifierRes = await request(app)
        .patch(endpoint)
        .set("Authorization", `Bearer ${TEST_TOKENS.verifier()}`)
        .send(body)

      validateErrorEnvelope(verifierRes, 403, /forbidden/i)
    })

    it("PATCH /api/admin/users/:id/status - allows ADMIN, denies others", async () => {
      const endpoint = "/api/admin/users/test-user/status"
      const body = { status: "ACTIVE" }

      // ADMIN should succeed
      const adminRes = await request(app)
        .patch(endpoint)
        .set("Authorization", `Bearer ${TEST_TOKENS.admin()}`)
        .send(body)

      expect([200, 404, 400]).toContain(adminRes.status)
      expect(adminRes.status).not.toBe(401)
      expect(adminRes.status).not.toBe(403)

      // USER should be denied
      const userRes = await request(app)
        .patch(endpoint)
        .set("Authorization", `Bearer ${TEST_TOKENS.user()}`)
        .send(body)

      validateErrorEnvelope(userRes, 403, /forbidden/i)

      // VERIFIER should be denied
      const verifierRes = await request(app)
        .patch(endpoint)
        .set("Authorization", `Bearer ${TEST_TOKENS.verifier()}`)
        .send(body)

      validateErrorEnvelope(verifierRes, 403, /forbidden/i)
    })

    it("DELETE /api/admin/users/:id - allows ADMIN, denies others", async () => {
      const endpoint = "/api/admin/users/test-user"

      // ADMIN should succeed
      const adminRes = await request(app)
        .delete(endpoint)
        .set("Authorization", `Bearer ${TEST_TOKENS.admin()}`)

      expect([200, 404, 400]).toContain(adminRes.status)
      expect(adminRes.status).not.toBe(401)
      expect(adminRes.status).not.toBe(403)

      // USER should be denied
      const userRes = await request(app)
        .delete(endpoint)
        .set("Authorization", `Bearer ${TEST_TOKENS.user()}`)

      validateErrorEnvelope(userRes, 403, /forbidden/i)

      // VERIFIER should be denied
      const verifierRes = await request(app)
        .delete(endpoint)
        .set("Authorization", `Bearer ${TEST_TOKENS.verifier()}`)

      validateErrorEnvelope(verifierRes, 403, /forbidden/i)
    })

    it("POST /api/admin/users/:id/restore - allows ADMIN, denies others", async () => {
      const endpoint = "/api/admin/users/test-user/restore"

      // ADMIN should succeed
      const adminRes = await request(app)
        .post(endpoint)
        .set("Authorization", `Bearer ${TEST_TOKENS.admin()}`)

      expect([200, 404, 400]).toContain(adminRes.status)
      expect(adminRes.status).not.toBe(401)
      expect(adminRes.status).not.toBe(403)

      // USER should be denied
      const userRes = await request(app)
        .post(endpoint)
        .set("Authorization", `Bearer ${TEST_TOKENS.user()}`)

      validateErrorEnvelope(userRes, 403, /forbidden/i)

      // VERIFIER should be denied
      const verifierRes = await request(app)
        .post(endpoint)
        .set("Authorization", `Bearer ${TEST_TOKENS.verifier()}`)

      validateErrorEnvelope(verifierRes, 403, /forbidden/i)
    })
  })

  describe("Session Management Endpoints", () => {
    it("POST /api/admin/users/:userId/revoke-sessions - allows ADMIN, denies others", async () => {
      const endpoint = "/api/admin/users/test-user/revoke-sessions"

      // ADMIN should succeed
      const adminRes = await request(app)
        .post(endpoint)
        .set("Authorization", `Bearer ${TEST_TOKENS.admin()}`)

      expect([200, 404, 400]).toContain(adminRes.status)
      expect(adminRes.status).not.toBe(401)
      expect(adminRes.status).not.toBe(403)

      // USER should be denied
      const userRes = await request(app)
        .post(endpoint)
        .set("Authorization", `Bearer ${TEST_TOKENS.user()}`)

      validateErrorEnvelope(userRes, 403, /forbidden/i)

      // VERIFIER should be denied
      const verifierRes = await request(app)
        .post(endpoint)
        .set("Authorization", `Bearer ${TEST_TOKENS.verifier()}`)

      validateErrorEnvelope(verifierRes, 403, /forbidden/i)
    })
  })

  describe("System Override Endpoints", () => {
    it("POST /api/admin/overrides/vaults/:id/cancel - allows ADMIN, denies others", async () => {
      const endpoint = "/api/admin/overrides/vaults/test-vault/cancel"
      const body = { reason: "Test cancellation" }

      // ADMIN should succeed
      const adminRes = await request(app)
        .post(endpoint)
        .set("Authorization", `Bearer ${TEST_TOKENS.admin()}`)
        .send(body)

      expect([200, 404, 409]).toContain(adminRes.status)
      expect(adminRes.status).not.toBe(401)
      expect(adminRes.status).not.toBe(403)

      // USER should be denied
      const userRes = await request(app)
        .post(endpoint)
        .set("Authorization", `Bearer ${TEST_TOKENS.user()}`)
        .send(body)

      validateErrorEnvelope(userRes, 403, /forbidden/i)

      // VERIFIER should be denied
      const verifierRes = await request(app)
        .post(endpoint)
        .set("Authorization", `Bearer ${TEST_TOKENS.verifier()}`)
        .send(body)

      validateErrorEnvelope(verifierRes, 403, /forbidden/i)
    })
  })

  describe("Enhanced Security Bypass Prevention", () => {
    /**
     * Comprehensive header spoofing tests across multiple endpoints
     * 
     * **Validates: Requirements 1.1, 1.2, 1.4, 1.5, 10.1**
     */

    const testEndpoints = [
      "/api/admin/users",
      "/api/admin/audit-logs",
      "/api/admin/users/test-user/role",
      "/api/admin/users/test-user/revoke-sessions"
    ]

    testEndpoints.forEach(endpoint => {
      it(`prevents header spoofing on ${endpoint}`, async () => {
        const bypassTests = createSecurityBypassTests(endpoint)
        
        for (const test of bypassTests) {
          const userToken = TEST_TOKENS.user()
          const res = await request(app)
            .get(endpoint)
            .set("Authorization", `Bearer ${userToken}`)
            .set(test.headers)

          // Should receive 403 (insufficient role), not 200 (success from spoofed header)
          validateErrorEnvelope(res, 403, test.expectedErrorPattern)
        }
      })
    })

    it("ignores multiple simultaneous role headers", async () => {
      const maliciousHeaders = {
        'x-user-role': 'ADMIN',
        'x-requested-role': 'ADMIN', 
        'role': 'ADMIN',
        'x-auth-role': 'ADMIN',
        'authorization-role': 'ADMIN'
      }

      const userToken = TEST_TOKENS.user()
      const res = await request(app)
        .get("/api/admin/users")
        .set("Authorization", `Bearer ${userToken}`)
        .set(maliciousHeaders)

      validateErrorEnvelope(res, 403, /forbidden/i)
    })

    it("returns 401 when role headers present without token", async () => {
      const res = await request(app)
        .get("/api/admin/users")
        .set("x-user-role", "ADMIN")
        .set("x-requested-role", "ADMIN")

      validateErrorEnvelope(res, 401, /unauthorized/i)
    })
  })

  describe("Token Manipulation Security Tests", () => {
    /**
     * Test various token manipulation attempts
     * 
     * **Validates: Requirements 10.2, 10.3, 10.4, 10.5**
     */

    it("rejects malformed tokens", async () => {
      const res = await request(app)
        .get("/api/admin/users")
        .set("Authorization", `Bearer ${INVALID_TOKENS.malformed()}`)

      validateErrorEnvelope(res, 401, /invalid|unauthorized/i)
    })

    it("rejects expired tokens", async () => {
      const res = await request(app)
        .get("/api/admin/users")
        .set("Authorization", `Bearer ${INVALID_TOKENS.expired()}`)

      validateErrorEnvelope(res, 401, /expired|unauthorized/i)
    })

    it("rejects tokens with wrong signature", async () => {
      const res = await request(app)
        .get("/api/admin/users")
        .set("Authorization", `Bearer ${INVALID_TOKENS.wrongSecret()}`)

      validateErrorEnvelope(res, 401, /invalid|unauthorized/i)
    })

    it("rejects empty authorization header", async () => {
      const res = await request(app)
        .get("/api/admin/users")
        .set("Authorization", "")

      validateErrorEnvelope(res, 401, /missing|malformed/i)
    })

    it("rejects authorization header without Bearer prefix", async () => {
      const token = TEST_TOKENS.admin()
      const res = await request(app)
        .get("/api/admin/users")
        .set("Authorization", token) // Missing "Bearer " prefix

      validateErrorEnvelope(res, 401, /missing|malformed/i)
    })

    it("rejects authorization header with wrong prefix", async () => {
      const token = TEST_TOKENS.admin()
      const res = await request(app)
        .get("/api/admin/users")
        .set("Authorization", `Token ${token}`) // Wrong prefix

      validateErrorEnvelope(res, 401, /missing|malformed/i)
    })
  })

  describe("Edge Case Security Tests", () => {
    /**
     * Test edge cases and boundary conditions
     * 
     * **Validates: Requirements 10.4, 10.5**
     */

    it("handles extremely long malicious headers", async () => {
      const longValue = 'A'.repeat(10000) // Very long header value
      const userToken = TEST_TOKENS.user()
      
      const res = await request(app)
        .get("/api/admin/users")
        .set("Authorization", `Bearer ${userToken}`)
        .set("x-user-role", longValue)

      validateErrorEnvelope(res, 403, /forbidden/i)
    })

    it("handles special characters in role headers", async () => {
      const specialHeaders = {
        'x-user-role': 'ADMIN<script>alert(1)</script>',
        'role': 'ADMIN"; DROP TABLE users; --',
        'x-requested-role': 'ADMIN\x00\x01\x02'
      }

      const userToken = TEST_TOKENS.user()
      const res = await request(app)
        .get("/api/admin/users")
        .set("Authorization", `Bearer ${userToken}`)
        .set(specialHeaders)

      validateErrorEnvelope(res, 403, /forbidden/i)
    })

    it("handles Unicode and international characters in headers", async () => {
      const unicodeHeaders = {
        'x-user-role': 'ADMIN™®©',
        'role': 'ADMIN中文',
        'x-requested-role': 'ADMIN🔒🛡️'
      }

      const userToken = TEST_TOKENS.user()
      const res = await request(app)
        .get("/api/admin/users")
        .set("Authorization", `Bearer ${userToken}`)
        .set(unicodeHeaders)

      validateErrorEnvelope(res, 403, /forbidden/i)
    })

    it("handles case variations in role values", async () => {
      const caseHeaders = {
        'x-user-role': 'admin',
        'role': 'Admin',
        'x-requested-role': 'ADMIN'
      }

      const userToken = TEST_TOKENS.user()
      const res = await request(app)
        .get("/api/admin/users")
        .set("Authorization", `Bearer ${userToken}`)
        .set(caseHeaders)

      validateErrorEnvelope(res, 403, /forbidden/i)
    })

    it("validates that 404 errors still require authentication", async () => {
      // Non-existent endpoint should still require auth
      const res = await request(app).get("/api/admin/nonexistent")
      
      // Should get 401 (auth required) before 404 (not found)
      validateErrorEnvelope(res, 401, /unauthorized/i)
    })

    it("validates that 404 errors still require authorization", async () => {
      // Non-existent endpoint with USER token should get 403 before 404
      const userToken = TEST_TOKENS.user()
      const res = await request(app)
        .get("/api/admin/nonexistent")
        .set("Authorization", `Bearer ${userToken}`)
      
      // Should get 403 (insufficient role) before 404 (not found)
      validateErrorEnvelope(res, 403, /forbidden/i)
    })
  })
})