import { Knex } from 'knex'
import { createHash } from 'node:crypto'
import { ParsedEvent } from '../types/horizonSync.js'

interface StoredIdempotentResponse<T = unknown> {
  requestHash: string
  resourceId: string
  response: T
}

const apiIdempotencyStore = new Map<string, StoredIdempotentResponse>()

export class IdempotencyConflictError extends Error {
  constructor(message = 'Idempotency key has already been used with a different payload.') {
    super(message)
    this.name = 'IdempotencyConflictError'
  }
}

export const hashRequestPayload = (payload: unknown): string => {
  return createHash('sha256').update(JSON.stringify(payload ?? null)).digest('hex')
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
