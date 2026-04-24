import request from "supertest";
import { app } from "../app.js";
import { Router, Request, Response } from "express";
import { authenticate } from "../middleware/auth.js";
import { requireAdmin } from "../middleware/rbac.js";
import jwt from "jsonwebtoken";

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
