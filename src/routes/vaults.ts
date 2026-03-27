import { Router, Request, Response } from 'express'
import { authenticate } from '../middleware/auth.js'
import { VaultService } from '../services/vault.service.js'
import { UserRole } from '../types/user.js'
import { applyFilters, applySort, paginateArray } from '../utils/pagination.js'
import { updateAnalyticsSummary } from '../db/database.js'
import { createAuditLog } from '../lib/audit-logs.js'
import { buildVaultCreationPayload } from '../services/soroban.js'
import { listVaults, cancelVaultById } from '../services/vaultStore.js'
import { queryParser } from '../middleware/queryParser.js'
import { utcNow } from '../utils/timestamps.js'

export const vaultsRouter = Router()

// In-memory fallback (for development/legacy support)
export let vaults: any[] = []
export const setVaults = (newVaults: any[]) => { vaults = newVaults }

export interface Vault {
  id: string
  creator: string
  amount: string
  status: 'active' | 'completed' | 'failed' | 'cancelled'
  startTimestamp: string
  endTimestamp: string
  successDestination: string
  failureDestination: string
  createdAt: string
}

/**
 * GET /api/vaults
 */
vaultsRouter.get(
  '/',
  authenticate,
  queryParser({
    allowedSortFields: ['createdAt', 'amount', 'endTimestamp', 'status'],
    allowedFilterFields: ['status', 'creator'],
  }),
  async (req: Request, res: Response) => {
    try {
      // Fetch all vaults
      let vaults = await listVaults()
      
      // Apply filters, sort, and pagination if available
      if (req.filters) {
          vaults = applyFilters(vaults as any, req.filters)
      }
      if (req.sort) {
          vaults = applySort(vaults as any, req.sort)
      }
      if (req.pagination) {
          const paginatedResult = paginateArray(vaults as any, req.pagination)
          return res.json(paginatedResult)
      }

      res.json({ data: vaults, pagination: null })
    } catch (error: any) {
      res.status(500).json({ error: error.message })
    }
  }
)

/**
 * POST /api/vaults
 */
vaultsRouter.post('/', authenticate, async (req: Request, res: Response) => {
  const { creator, amount, endTimestamp, successDestination, failureDestination, milestoneHash, verifierAddress, contractId } = req.body

  if (!creator || !amount || !endTimestamp || !successDestination || !failureDestination) {
    res.status(400).json({ error: 'Missing required vault fields' })
    return
  }

  // 1. Persist to PostgreSQL via VaultService (Issue #46/Issue #80 logic)
  let dbVaultId: string | undefined;
  try {
    const newDbVault = await VaultService.createVault({
      contractId: contractId || 'mock-contract-id',
      creatorAddress: creator,
      amount,
      milestoneHash,
      verifierAddress,
      successDestination,
      failureDestination,
      deadline: endTimestamp
    });
    dbVaultId = newDbVault.id;
  } catch (error) {
    console.error('Warning: Failed to save to PostgreSQL, falling back to in-memory only.', error);
  }

  // 2. Persist to In-Memory Array
  const id = dbVaultId || `vault-${Date.now()}`
  const startTimestamp = utcNow()
  const vault: Vault = {
    id,
    creator,
    amount,
    startTimestamp,
    endTimestamp,
    successDestination,
    failureDestination,
    status: 'active',
    createdAt: startTimestamp,
  }

  vaults.push(vault)
  updateAnalyticsSummary()

  res.status(201).json(vault)
})

/**
 * GET /api/vaults/:id
 */
vaultsRouter.get('/:id', authenticate, async (req: Request, res: Response) => {
  try {
    // 1. Try DB first
    const dbVault = await VaultService.getVaultById(req.params.id)
    if (dbVault) {
      res.json(dbVault)
      return
    }

    // 2. Try In-memory
    const vault = vaults.find(v => v.id === req.params.id)
    if (!vault) {
      res.status(404).json({ error: 'Vault not found' })
      return
    }

    res.json(vault)
  } catch (error) {
    console.error('Error fetching vault:', error)
    res.status(500).json({ error: 'Failed to fetch vault' })
  }
})

/**
 * POST /api/vaults/:id/cancel
 */
vaultsRouter.post('/:id/cancel', authenticate, async (req, res) => {
  const actorUserId = req.user!.userId
  const actorRole = req.user!.role

  let existingVault = await VaultService.getVaultById(req.params.id)
  if (!existingVault) existingVault = vaults.find(v => v.id === req.params.id)

  if (!existingVault) return res.status(404).json({ error: 'Vault not found' })

  // Access control
  if (actorUserId !== existingVault.creatorAddress && actorRole !== UserRole.ADMIN) {
    return res.status(403).json({ error: 'Forbidden' })
  }
  
  // 1. Update Database
  try {
    await VaultService.updateVaultStatus(req.params.id, 'cancelled' as any)
  } catch (error) {}

  // 2. Update In-memory
  const arrayIndex = vaults.findIndex(v => v.id === req.params.id);
  if (arrayIndex !== -1) vaults[arrayIndex].status = 'cancelled';
  
  updateAnalyticsSummary()
  res.status(200).json({ message: 'Vault cancelled', id: req.params.id })
})

// Additional user-specific routes (Standardized)
vaultsRouter.get('/user/:address', authenticate, async (req: Request, res: Response) => {
  try {
    const userVaults = await VaultService.getVaultsByUser(req.params.address);
    res.json(userVaults);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch user vaults' });
  }
});

// Export the cancelVaultById function for admin use
export { cancelVaultById }
