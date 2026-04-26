import { Router, Request, Response } from 'express'
import { authenticate } from '../middleware/auth.js'
import { requireVerifier, requireAdmin } from '../middleware/rbac.js'
import {
  recordVerification,
  listVerifications,
} from '../services/verifiers.js'
import { createAuditLog } from '../lib/audit-logs.js'

export const verificationsRouter = Router()

verificationsRouter.post('/', authenticate, requireVerifier, requireActiveVerifier, async (req: Request, res: Response) => {
  const payload = req.user!
  const verifierUserId = payload.userId
  const { targetId, result, disputed } = req.body as {
    targetId?: string
    result?: 'approved' | 'rejected'
    disputed?: boolean
  }

  if (!targetId || !targetId.trim()) {
    res.status(400).json({ error: 'targetId is required' })
    return
  }

  if (result !== 'approved' && result !== 'rejected') {
    res.status(400).json({ error: "result must be 'approved' or 'rejected'" })
    return
  }

  try {
    const cleanTargetId = targetId.trim()

    const rec = await recordVerification(
      verifierUserId,
      cleanTargetId,
      result,
      !!disputed
    )

    createAuditLog({
      actor_user_id: verifierUserId,
      action: 'verification.decision.recorded',
      target_type: 'verification',
      target_id: cleanTargetId,
      metadata: {
        result,
        disputed: !!disputed,
      },
    })

    res.status(201).json({ verification: rec })
  } catch (error: any) {
    // ✅ FIX: use name check instead of instanceof
    if (error?.name === 'VerificationConflictError') {
      res.status(409).json({
        error: 'conflicting verification decision already exists',
      })
      return
    }

    res.status(500).json({
      error: 'failed to record verification decision',
    })
  }
})

verificationsRouter.get('/', authenticate, requireAdmin, async (_req: Request, res: Response) => {
  const all = await listVerifications()
  res.json({ verifications: all })
})