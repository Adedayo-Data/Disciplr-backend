import request from "supertest";
import { app } from "../app.js";
import jwt from "jsonwebtoken";
import { clearProcessedOverrides } from "../routes/admin.js";
import { clearAuditLogs } from "../lib/audit-logs.js";

const SECRET = process.env.JWT_SECRET || "change-me-in-production";

const makeToken = (role: string, userId: string = "test-user") =>
  jwt.sign({ userId, role }, SECRET);

describe("Admin RBAC", () => {
  beforeEach(() => {
    clearProcessedOverrides();
    clearAuditLogs();
  });

  it("allows ADMIN", async () => {
    const res = await request(app)
      .get("/api/admin/audit-logs")
      .set("Authorization", `Bearer ${makeToken("ADMIN")}`);

    expect(res.status).not.toBe(403);
  });

  it("denies USER", async () => {
    const res = await request(app)
      .get("/api/admin/audit-logs")
      .set("Authorization", `Bearer ${makeToken("USER")}`);

    expect(res.status).toBe(403);
  });

  it("denies unauthenticated", async () => {
    const res = await request(app).get("/api/admin/audit-logs");

    expect(res.status).toBe(401);
  });
});

describe("Admin Override RBAC Security", () => {
  beforeEach(() => {
    clearProcessedOverrides();
    clearAuditLogs();
  });

  describe("POST /api/admin/overrides/vaults/:id/cancel", () => {
    it("denies USER role from performing admin overrides", async () => {
      const res = await request(app)
        .post("/api/admin/overrides/vaults/test-vault-id/cancel")
        .set("Authorization", `Bearer ${makeToken("USER", "user-123")}`)
        .send({
          reasonCode: "USER_REQUEST",
          reason: "Test reason",
        });

      expect(res.status).toBe(403);
      expect(res.body).toHaveProperty("error");
    });

    it("denies VERIFIER role from performing admin overrides", async () => {
      const res = await request(app)
        .post("/api/admin/overrides/vaults/test-vault-id/cancel")
        .set("Authorization", `Bearer ${makeToken("VERIFIER", "verifier-123")}`)
        .send({
          reasonCode: "FRAUD_DETECTED",
          reason: "Suspicious activity",
        });

      expect(res.status).toBe(403);
      expect(res.body).toHaveProperty("error");
    });

    it("denies unauthenticated access to admin overrides", async () => {
      const res = await request(app)
        .post("/api/admin/overrides/vaults/test-vault-id/cancel")
        .send({
          reasonCode: "SYSTEM_ERROR",
          reason: "System error",
        });

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty("error");
    });

    it("allows ADMIN to access override endpoint", async () => {
      // Note: This test may return 404 or 409 depending on vault state,
      // but should NOT return 403 (Forbidden)
      const res = await request(app)
        .post("/api/admin/overrides/vaults/non-existent-vault/cancel")
        .set("Authorization", `Bearer ${makeToken("ADMIN", "admin-123")}`)
        .send({
          reasonCode: "TESTING_CLEANUP",
          reason: "Test admin access",
        });

      // Should not be forbidden - actual error depends on vault state
      expect(res.status).not.toBe(403);
      expect(res.status).not.toBe(401);
    });

    it("denies expired token access", async () => {
      const expiredToken = jwt.sign(
        { userId: "test-admin", role: "ADMIN", exp: Math.floor(Date.now() / 1000) - 3600 },
        SECRET
      );

      const res = await request(app)
        .post("/api/admin/overrides/vaults/test-vault-id/cancel")
        .set("Authorization", `Bearer ${expiredToken}`)
        .send({
          reasonCode: "EMERGENCY_ADMIN_ACTION",
        });

      expect(res.status).toBe(401);
    });

    it("denies malformed token access", async () => {
      const res = await request(app)
        .post("/api/admin/overrides/vaults/test-vault-id/cancel")
        .set("Authorization", "Bearer invalid-token-here")
        .send({
          reasonCode: "POLICY_VIOLATION",
        });

      expect(res.status).toBe(401);
    });
  });

  describe("GET /api/admin/audit-logs/:id (audit log access)", () => {
    it("denies USER from accessing specific audit logs", async () => {
      const res = await request(app)
        .get("/api/admin/audit-logs/audit-12345")
        .set("Authorization", `Bearer ${makeToken("USER")}`);

      expect(res.status).toBe(403);
    });

    it("denies VERIFIER from accessing specific audit logs", async () => {
      const res = await request(app)
        .get("/api/admin/audit-logs/audit-12345")
        .set("Authorization", `Bearer ${makeToken("VERIFIER")}`);

      expect(res.status).toBe(403);
    });

    it("allows ADMIN to access specific audit logs", async () => {
      // Will return 404 since audit log doesn't exist, but not 403
      const res = await request(app)
        .get("/api/admin/audit-logs/non-existent-audit-id")
        .set("Authorization", `Bearer ${makeToken("ADMIN")}`);

      expect(res.status).not.toBe(403);
      expect(res.status).not.toBe(401);
    });
  });
});
