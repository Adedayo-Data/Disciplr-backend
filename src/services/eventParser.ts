import { xdr, scValToNative } from '@stellar/stellar-sdk'
import { 
  ParsedEvent, 
  EventType, 
  VaultEventPayload, 
  MilestoneEventPayload, 
  ValidationEventPayload 
} from '../types/horizonSync.js'

/**
 * Result of parsing a Horizon event
 */
export type ParseResult =
  | {
      success: true
      event: ParsedEvent
    }
  | {
      success: false
      error: string
      details?: Record<string, unknown>
    }

/**
 * Raw Horizon event structure from Stellar SDK
 */
export interface HorizonEvent {
  type: string
  ledger: number
  ledgerClosedAt: string
  contractId: string
  id: string
  pagingToken: string
  topic: string[]
  value: {
    xdr: string
  }
  inSuccessfulContractCall: boolean
  txHash: string
}

/**
 * Validates vault_created event payload
 */
function validateVaultCreatedPayload(payload: VaultEventPayload): string | null {
  if (!payload.vaultId || typeof payload.vaultId !== 'string') {
    return 'Missing or invalid vaultId field'
  }
  if (!payload.creator || typeof payload.creator !== 'string') {
    return 'Missing or invalid creator field'
  }
  if (!payload.amount || typeof payload.amount !== 'string') {
    return 'Missing or invalid amount field'
  }
  if (isNaN(parseFloat(payload.amount))) {
    return 'Amount must be a valid decimal number'
  }
  if (!payload.startTimestamp || !(payload.startTimestamp instanceof Date) || isNaN(payload.startTimestamp.getTime())) {
    return 'Missing or invalid startTimestamp field'
  }
  if (!payload.endTimestamp || !(payload.endTimestamp instanceof Date) || isNaN(payload.endTimestamp.getTime())) {
    return 'Missing or invalid endTimestamp field'
  }
  if (!payload.successDestination || typeof payload.successDestination !== 'string') {
    return 'Missing or invalid successDestination field'
  }
  if (!payload.failureDestination || typeof payload.failureDestination !== 'string') {
    return 'Missing or invalid failureDestination field'
  }
  return null
}

/**
 * Validates vault status event payload
 */
function validateVaultStatusPayload(payload: VaultEventPayload): string | null {
  if (!payload.vaultId || typeof payload.vaultId !== 'string') {
    return 'Missing or invalid vaultId field'
  }
  const validStatuses = ['active', 'completed', 'failed', 'cancelled']
  if (!payload.status || !validStatuses.includes(payload.status)) {
    return `Invalid status value: ${payload.status}. Must be one of: ${validStatuses.join(', ')}`
  }
  return null
}

/**
 * Parses vault event payload from XDR data
 */
function parseVaultPayload(
  eventType: EventType,
  xdrData: string
): VaultEventPayload | null {
  try {
    const scVal = xdr.ScVal.fromXDR(xdrData, 'base64')
    const nativeVal = scValToNative(scVal)
    
    // For vault events, we expect either an object or a direct vault ID
    const vaultId = typeof nativeVal === 'string' ? nativeVal : (nativeVal.vault_id || nativeVal.id || `vault_${Date.now()}`)
    
    if (eventType === 'vault_created') {
      const payload: VaultEventPayload = {
        vaultId,
        creator: nativeVal.creator || 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
        amount: nativeVal.amount?.toString() || '0',
        startTimestamp: nativeVal.start_date ? new Date(nativeVal.start_date * 1000) : new Date(),
        endTimestamp: nativeVal.end_date ? new Date(nativeVal.end_date * 1000) : new Date(),
        successDestination: nativeVal.success_destination || 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
        failureDestination: nativeVal.failure_destination || 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
        status: 'active'
      }
      const error = validateVaultCreatedPayload(payload)
      if (error) {
        console.error(`Vault created validation error: ${error}`)
        return null
      }
      return payload
    } else {
      const payload: VaultEventPayload = {
        vaultId,
        status: (nativeVal.status || eventType.replace('vault_', '')) as VaultEventPayload['status']
      }
      const error = validateVaultStatusPayload(payload)
      if (error) {
        console.error(`Vault status validation error: ${error}`)
        return null
      }
      return payload
    }
  } catch (error) {
    console.error('Error parsing vault payload XDR:', error)
    return null
  }
}

/**
 * Validates milestone_created event payload
 */
function validateMilestonePayload(payload: MilestoneEventPayload): string | null {
  if (!payload.milestoneId || typeof payload.milestoneId !== 'string') {
    return 'Missing or invalid milestoneId field'
  }
  if (!payload.vaultId || typeof payload.vaultId !== 'string') {
    return 'Missing or invalid vaultId field'
  }
  if (!payload.title || typeof payload.title !== 'string') {
    return 'Missing or invalid title field'
  }
  if (!payload.targetAmount || typeof payload.targetAmount !== 'string') {
    return 'Missing or invalid targetAmount field'
  }
  if (isNaN(parseFloat(payload.targetAmount))) {
    return 'targetAmount must be a valid decimal number'
  }
  if (!payload.deadline || !(payload.deadline instanceof Date) || isNaN(payload.deadline.getTime())) {
    return 'Missing or invalid deadline field'
  }
  return null
}

/**
 * Parses milestone event payload from XDR data
 */
function parseMilestonePayload(xdrData: string): MilestoneEventPayload | null {
  try {
    const scVal = xdr.ScVal.fromXDR(xdrData, 'base64')
    const nativeVal = scValToNative(scVal)
    
    const payload: MilestoneEventPayload = {
      milestoneId: nativeVal.milestone_id || nativeVal.id || `milestone_${Date.now()}`,
      vaultId: nativeVal.vault_id || `vault_${Date.now()}`,
      title: nativeVal.title || 'Untitled',
      description: nativeVal.description || '',
      targetAmount: nativeVal.amount?.toString() || nativeVal.target_amount?.toString() || '0',
      deadline: nativeVal.due_date ? new Date(nativeVal.due_date * 1000) : (nativeVal.deadline ? new Date(nativeVal.deadline) : new Date())
    }
    
    const error = validateMilestonePayload(payload)
    if (error) {
      console.error(`Milestone validation error: ${error}`)
      return null
    }
    return payload
  } catch (error) {
    console.error('Error parsing milestone payload XDR:', error)
    return null
  }
}

/**
 * Validates milestone_validated event payload
 */
function validateValidationPayload(payload: ValidationEventPayload): string | null {
  if (!payload.validationId || typeof payload.validationId !== 'string') {
    return 'Missing or invalid validationId field'
  }
  if (!payload.milestoneId || typeof payload.milestoneId !== 'string') {
    return 'Missing or invalid milestoneId field'
  }
  if (!payload.validatorAddress || typeof payload.validatorAddress !== 'string') {
    return 'Missing or invalid validatorAddress field'
  }
  if (!payload.validationResult || typeof payload.validationResult !== 'string') {
    return 'Missing or invalid validationResult field'
  }
  const validResults = ['approved', 'rejected', 'pending_review']
  if (!validResults.includes(payload.validationResult)) {
    return `Invalid validationResult value: ${payload.validationResult}`
  }
  if (!payload.validatedAt || !(payload.validatedAt instanceof Date) || isNaN(payload.validatedAt.getTime())) {
    return 'Missing or invalid validatedAt field'
  }
  return null
}

/**
 * Parses validation event payload from XDR data
 */
function parseValidationPayload(xdrData: string): ValidationEventPayload | null {
  try {
    const scVal = xdr.ScVal.fromXDR(xdrData, 'base64')
    const nativeVal = scValToNative(scVal)
    
    const payload: ValidationEventPayload = {
      validationId: nativeVal.validation_id || nativeVal.id || `val_${Date.now()}`,
      milestoneId: nativeVal.milestone_id || `milestone_${Date.now()}`,
      validatorAddress: nativeVal.validator || nativeVal.validator_address || 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
      validationResult: nativeVal.result || nativeVal.validation_result || 'approved',
      evidenceHash: nativeVal.evidence_hash || '',
      validatedAt: nativeVal.timestamp ? new Date(nativeVal.timestamp * 1000) : (nativeVal.validated_at ? new Date(nativeVal.validated_at) : new Date())
    }
    
    const error = validateValidationPayload(payload)
    if (error) {
      console.error(`Validation event validation error: ${error}`)
      return null
    }
    return payload
  } catch (error) {
    console.error('Error parsing validation payload XDR:', error)
    return null
  }
}

/**
 * Routes event to appropriate payload parser based on event type
 */
function routeToPayloadParser(
  eventType: EventType,
  xdrData: string
): VaultEventPayload | MilestoneEventPayload | ValidationEventPayload | null {
  switch (eventType) {
    case 'vault_created':
    case 'vault_completed':
    case 'vault_failed':
    case 'vault_cancelled':
      return parseVaultPayload(eventType, xdrData)
    case 'milestone_created':
      return parseMilestonePayload(xdrData)
    case 'milestone_validated':
      return parseValidationPayload(xdrData)
    default:
      return null
  }
}

/**
 * Parses a Horizon event and extracts metadata and payload
 */
export function parseHorizonEvent(rawEvent: HorizonEvent): ParseResult {
  try {
    if (!rawEvent.txHash || !rawEvent.id || typeof rawEvent.ledger !== 'number') {
      return { success: false, error: 'Missing required Horizon event fields' }
    }

    const eventIndexMatch = rawEvent.id.match(/-(\d+)$/)
    const eventIndex = eventIndexMatch ? parseInt(eventIndexMatch[1], 10) : 0
    const eventId = `${rawEvent.txHash}:${eventIndex}`

    if (!rawEvent.topic || rawEvent.topic.length === 0) {
      return { success: false, error: 'Missing event topic' }
    }

    const eventType = rawEvent.topic[0] as EventType
    const payload = routeToPayloadParser(eventType, rawEvent.value.xdr)
    
    if (!payload) {
      return { success: false, error: `Failed to parse payload for event type: ${eventType}` }
    }

    return {
      success: true,
      event: {
        eventId,
        transactionHash: rawEvent.txHash,
        eventIndex,
        ledgerNumber: rawEvent.ledger,
        eventType,
        payload
      }
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown parsing error'
    }
  }
}
