import { Vault, CreateVaultDTO, VaultStatus } from '../types/vault.js';

// Assuming you have a configured pg pool exported from your db setup
import pool from '../db/index.js';

// Mock Prisma for when DATABASE_URL is not available
const mockPrisma: any = null;

// Lazy-initialized Prisma client
let prismaInstance: any = null;

async function getPrisma(): Promise<any> {
  if (prismaInstance === null) {
    try {
      if (process.env.DATABASE_URL) {
        const { prisma: realPrisma } = await import('../lib/prisma.js');
        prismaInstance = realPrisma;
      } else {
        prismaInstance = mockPrisma;
      }
    } catch {
      prismaInstance = mockPrisma;
    }
  }
  return prismaInstance;
}

export class VaultService {
  /**
   * Creates a new vault record in the database.
   */
  static async createVault(data: CreateVaultDTO): Promise<Vault> {
    const query = `
      INSERT INTO vaults (
        contract_id, creator_address, amount, milestone_hash,
        verifier_address, success_destination, failure_destination, deadline
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *;
    `;

    const values = [
      data.contractId, data.creatorAddress, data.amount, data.milestoneHash,
      data.verifierAddress, data.successDestination, data.failureDestination, data.deadline
    ];

    try {
      const result = await pool.query(query, values);
      return result.rows[0];
    } catch (error) {
      console.error('Error creating vault:', error);
      throw new Error('Database error during vault creation');
    }
  }

  /**
   * Get vault by ID
   */
  static async getVaultById(vaultId: string): Promise<Vault | null> {
    try {
      const result = await pool.query('SELECT * FROM vaults WHERE id = $1', [vaultId]);
      return result.rows[0] || null;
    } catch (error) {
      console.error('Error fetching vault:', error);
      return null;
    }
  }

  /**
   * Get vaults by user address
   */
  static async getVaultsByUser(address: string): Promise<Vault[]> {
    try {
      const result = await pool.query('SELECT * FROM vaults WHERE creator_address = $1', [address]);
      return result.rows;
    } catch (error) {
      console.error('Error fetching user vaults:', error);
      return [];
    }
  }

  /**
   * Update vault status
   */
  static async updateVaultStatus(vaultId: string, status: VaultStatus): Promise<void> {
    try {
      await pool.query('UPDATE vaults SET status = $1 WHERE id = $2', [status, vaultId]);
    } catch (error) {
      console.error('Error updating vault status:', error);
      throw new Error('Failed to update vault status');
    }
  }
}

// Export lazy prisma getter for use in other modules
export { getPrisma as prisma };
