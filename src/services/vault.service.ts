import { UserRole } from '../types/user.js'

// Mock Prisma client for testing when DATABASE_URL is not available
const mockPrisma = {
    vault: {
        create: async (data: any) => ({ id: 'mock-id', ...data.data }),
        findUnique: async () => null,
        findMany: async () => [],
        update: async (data: any) => ({ id: data.where.id, ...data.data }),
        count: async () => 0
    }
}

// Use Prisma only when DATABASE_URL is available
let prisma: any
try {
    if (process.env.DATABASE_URL) {
        const { prisma: realPrisma } = await import('../lib/prisma.js')
        prisma = realPrisma
    } else {
        prisma = mockPrisma
    }
} catch {
    prisma = mockPrisma
}

export interface VaultFilters {
    status?: string
    minAmount?: string
    maxAmount?: string
    startDate?: string
    endDate?: string
}

export interface PaginationParams {
    page?: number
    limit?: number
}

export interface CreateVaultDTO {
    contractId: string
    creatorAddress: string
    amount: string
    milestoneHash?: string
    verifierAddress: string
    successDestination: string
    failureDestination: string
    deadline: string
}

export interface Vault {
    id: string
    contractId: string
    creatorAddress: string
    amount: string
    status: string
    createdAt: string
    updatedAt: string
}

export class VaultService {
    /**
     * Creates a new vault record in the database.
     */
    static async createVault(data: CreateVaultDTO): Promise<Vault> {
        try {
            const vault = await prisma.vault.create({
                data: {
                    contractId: data.contractId,
                    creatorAddress: data.creatorAddress,
                    amount: data.amount,
                    milestoneHash: data.milestoneHash,
                    verifierAddress: data.verifierAddress,
                    successDestination: data.successDestination,
                    failureDestination: data.failureDestination,
                    deadline: new Date(data.deadline),
                    status: 'active'
                }
            })
            return vault as Vault
        } catch (error) {
            console.error('Error creating vault:', error);
            throw new Error('Database error during vault creation');
        }
    }

    /**
     * Retrieves a vault by its internal UUID.
     */
    static async getVaultById(id: string): Promise<Vault | null> {
        try {
            const vault = await prisma.vault.findUnique({
                where: { id }
            })
            return vault as Vault | null
        } catch (error) {
            console.error(`Error fetching vault with id ${id}:`, error);
            throw new Error('Database error during fetch');
        }
    }

    /**
     * Retrieves all vaults created by a specific Stellar address.
     */
    static async getVaultsByUser(creatorAddress: string): Promise<Vault[]> {
        try {
            const vaults = await prisma.vault.findMany({
                where: { creatorAddress },
                orderBy: { createdAt: 'desc' }
            })
            return vaults as Vault[]
        } catch (error) {
            console.error(`Error fetching vaults for user ${creatorAddress}:`, error);
            throw new Error('Database error during fetch');
        }
    }

    /**
     * Updates the status of an existing vault.
     */
    static async updateVaultStatus(id: string, status: string): Promise<Vault | null> {
        try {
            const vault = await prisma.vault.update({
                where: { id },
                data: { 
                    status,
                    updatedAt: new Date()
                }
            })
            return vault as Vault | null
        } catch (error) {
            console.error(`Error updating vault status for id ${id}:`, error);
            throw new Error('Database error during status update');
        }
    }

    static async listVaults(filters: VaultFilters, pagination: PaginationParams, userId: string, role: UserRole) {
        const page = pagination.page || 1
        const limit = pagination.limit || 10
        const skip = (page - 1) * limit

        const where: any = {}

        // Access control: Users see only their own, Admins see all
        if (role !== UserRole.ADMIN) {
            where.creatorAddress = userId
        }

        if (filters.status) {
            where.status = filters.status
        }

        if (filters.minAmount || filters.maxAmount) {
            where.amount = {}
            if (filters.minAmount) where.amount.gte = filters.minAmount
            if (filters.maxAmount) where.amount.lte = filters.maxAmount
        }

        if (filters.startDate || filters.endDate) {
            where.createdAt = {}
            if (filters.startDate) where.createdAt.gte = new Date(filters.startDate)
            if (filters.endDate) where.createdAt.lte = new Date(filters.endDate)
        }

        const [vaults, total] = await Promise.all([
            prisma.vault.findMany({
                where,
                skip,
                take: limit,
                orderBy: { createdAt: 'desc' },
            }),
            prisma.vault.count({ where }),
        ])

        return {
            vaults: vaults as Vault[],
            pagination: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit),
            },
        }
    }

    static async getVaultDetails(id: string, userId: string, role: UserRole) {
        const vault = await prisma.vault.findUnique({
            where: { id },
            include: {
                creator: {
                    select: { id: true, email: true },
                },
            },
        })

        if (!vault) {
            throw new Error('Vault not found')
        }

        // Access control
        if (role !== UserRole.ADMIN && vault.creatorAddress !== userId) {
            throw new Error('Forbidden: You do not have access to this vault')
        }

        return vault
    }
}
