import { Knex } from 'knex'
import { createHash } from 'node:crypto'
import { ParsedEvent } from '../types/horizonSync.js'
import crypto from 'node:crypto'
import { getPgPool } from '../db/pool.js'

export class IdempotencyConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IdempotencyConflictError'
  }
}

interface StoredIdempotentResponse<T = unknown> {
  requestHash: string
  resourceId: string
  response: T
}

const apiIdempotencyStore = new Map<string, StoredIdempotentResponse>()

// Accepts alphanumeric, hyphens, underscores; 1–255 characters.
export const IDEMPOTENCY_KEY_REGEX = /^[A-Za-z0-9_\-]{1,255}$/

export class IdempotencyConflictError extends Error {
  readonly code = 'IDEMPOTENCY_CONFLICT'
  constructor(message = 'Idempotency key has already been used with a different payload.') {
    super(message)
    this.name = 'IdempotencyConflictError'
  }
}

export class IdempotencyKeyValidationError extends Error {
  readonly code = 'INVALID_IDEMPOTENCY_KEY'
  constructor(
    message = 'Idempotency key must be 1–255 characters and contain only letters, digits, hyphens, and underscores.',
  ) {
    super(message)
    this.name = 'IdempotencyKeyValidationError'
  }
}

export const validateIdempotencyKey = (key: string): void => {
  if (!IDEMPOTENCY_KEY_REGEX.test(key)) {
    throw new IdempotencyKeyValidationError()
  }
}

// Recursively sort object keys so identical payloads with different property
// ordering produce the same hash.
const sortKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {}
    for (const k of Object.keys(value as object).sort()) {
      sorted[k] = sortKeys((value as Record<string, unknown>)[k])
    }
    return sorted
  }
  return value
}

export const hashRequestPayload = (payload: unknown): string => {
  return createHash('sha256').update(JSON.stringify(sortKeys(payload ?? null))).digest('hex')
}

export const getIdempotentResponse = async <T>(
  key: string,
  requestHash: string,
): Promise<T | null> => {
  const record = apiIdempotencyStore.get(key)
  if (!record) {
    return null
  }

  if (record.requestHash !== requestHash) {
    throw new IdempotencyConflictError()
  }

  return record.response as T
}

export const saveIdempotentResponse = async <T>(
  key: string,
  requestHash: string,
  resourceId: string,
  response: T,
): Promise<void> => {
  apiIdempotencyStore.set(key, {
    requestHash,
    resourceId,
    response,
  })
}

export const resetIdempotencyStore = (): void => {
  apiIdempotencyStore.clear()
}

/**
 * Idempotency Service
 * Handles checking and recording of processed operations to ensure exactly-once execution.
 */
export class IdempotencyService {
  private db: Knex

  constructor(db: Knex) {
    this.db = db
  }

  /**
   * Check if an event has already been processed.
   * 
   * @param eventId - Unique ID of the event
   * @param trx - Optional transaction to use for the check
   * @returns Promise<boolean> - True if already processed
   */
  async isEventProcessed(eventId: string, trx?: Knex.Transaction): Promise<boolean> {
    const query = (trx || this.db)('processed_events')
      .where({ event_id: eventId })
      .first()
    
    const result = await query
    return !!result
  }

  /**
   * Mark an event as processed in the database.
   * MUST be called within a transaction that includes the business logic operations.
   * 
   * @param event - The parsed event being processed
   * @param trx - Transaction to use for recording
   */
  async markEventProcessed(event: ParsedEvent, trx: Knex.Transaction): Promise<void> {
    await trx('processed_events').insert({
      event_id: event.eventId,
      transaction_hash: event.transactionHash,
      event_index: event.eventIndex,
      ledger_number: event.ledgerNumber,
      processed_at: new Date(),
      created_at: new Date()
    })
  }

  /**
   * General-purpose idempotency check for API requests.
   * Checks the idempotency_keys table.
   * 
   * @param key - The idempotency key provided by the client
   * @returns Promise<any | null> - The stored response if found, null otherwise
   */
  async getStoredResponse(key: string): Promise<any | null> {
    const record = await this.db('idempotency_keys')
      .where({ key })
      .first()
    
    return record ? record.response : null
  }

  /**
   * Store a response for a given idempotency key.
   * 
   * @param key - The idempotency key
   * @param response - The response payload to store
   * @param trx - Optional transaction
   */
  async storeResponse(key: string, response: any, trx?: Knex.Transaction): Promise<void> {
    await (trx || this.db)('idempotency_keys').insert({
      key,
      response: typeof response === 'string' ? response : JSON.stringify(response),
      created_at: new Date()
    })
  }
}

export async function getIdempotentResponse<T>(key: string, requestHash: string): Promise<T | null> {
  const pool = getPgPool()
  if (!pool) return null

  const result = await pool.query(
    'SELECT response, request_hash FROM idempotency_keys WHERE key = $1',
    [key]
  )

  if (result.rows.length === 0) return null

  const record = result.rows[0]
  if (record.request_hash !== requestHash) {
    throw new IdempotencyConflictError('Idempotency key already used with a different payload')
  }

  return record.response as T
}

export async function saveIdempotentResponse(key: string, requestHash: string, vaultId: string, response: any): Promise<void> {
  const pool = getPgPool()
  if (!pool) return

  await pool.query(
    'INSERT INTO idempotency_keys (key, request_hash, vault_id, response, created_at) VALUES ($1, $2, $3, $4, NOW())',
    [key, requestHash, vaultId, JSON.stringify(response)]
  )
}

export function hashRequestPayload(payload: any): string {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}
