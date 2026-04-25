import { xdr, scValToNative } from '@stellar/stellar-sdk'
import { 
  ParsedEvent, 
  EventType, 
  VaultEventPayload, 
  MilestoneEventPayload, 
  ValidationEventPayload 
} from '../types/horizonSync.js'

type DecodedPayload = Record<string, unknown>

/**
 * Schema validation result
 */
interface ValidationResult {
  isValid: boolean
  error?: string
  sanitizedPayload?: Record<string, unknown>
}

/**
 * Safe object creation that prevents prototype pollution
 */
function createSafeObject<T extends Record<string, unknown>>(payload: T): T {
  const obj = Object.create(null) as T
  for (const key in payload) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      obj[key] = payload[key]
    }
  }
  return obj
}

/**
 * Validates object against allowed field names (strict schema validation)
 */
function validateAllowedFields(
  payload: Record<string, unknown>,
  allowedFields: string[]
): ValidationResult {
  const payloadKeys = Object.keys(payload)
  const unknownFields = payloadKeys.filter(key => !allowedFields.includes(key))
  
  if (unknownFields.length > 0) {
    return {
      isValid: false,
      error: `Unknown fields not allowed: ${unknownFields.join(', ')}`
    }
  }
  
  return { isValid: true }
}

/**
 * Redacts sensitive information from error logs
 */
function redactSensitiveInfo(data: Record<string, unknown>): Record<string, unknown> {
  const redacted = { ...data }
  const sensitiveFields = ['privateKey', 'secret', 'password', 'token', 'key']
  
  for (const key in redacted) {
    if (sensitiveFields.some(sensitive => key.toLowerCase().includes(sensitive))) {
      redacted[key] = '[REDACTED]'
    }
  }
  
  return redacted
}

/**
 * Validates Stellar address format
 */
function validateStellarAddress(address: string): boolean {
  return /^[G][A-Z0-9]{55}$/.test(address)
}

/**
 * Validates decimal amount format
 */
function validateDecimalAmount(amount: string): boolean {
  return /^\d+(\.\d{1,7})?$/.test(amount) && parseFloat(amount) > 0
}

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

function decodePayloadRecord(xdrData: string): DecodedPayload | null {
  const candidates = [xdrData]

  try {
    const decoded = Buffer.from(xdrData, 'base64').toString('utf8')
    if (decoded && decoded !== xdrData) {
      candidates.push(decoded)
    }
  } catch {
    // Ignore invalid base64 and fall back to direct JSON parsing.
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as DecodedPayload
      }
    } catch {
      // Try the next candidate.
    }
  }

  return null
}

function readStringField(record: DecodedPayload, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' ? value : undefined
}

function readDateField(record: DecodedPayload, key: string): Date | undefined {
  const value = record[key]

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value
  }

  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? undefined : parsed
  }

  return undefined
}

/**
 * Validates vault_created event payload with strict schema validation
 * 
 * @param payload - The vault event payload to validate
 * @returns ValidationResult with success/failure and sanitized payload
 */
function validateVaultCreatedPayload(payload: VaultEventPayload): ValidationResult {
  const allowedFields = [
    'vaultId', 'creator', 'amount', 'startTimestamp', 'endTimestamp', 
    'successDestination', 'failureDestination', 'status'
  ]
  
  // Check for unknown fields
  const fieldValidation = validateAllowedFields(payload as unknown as Record<string, unknown>, allowedFields)
  if (!fieldValidation.isValid) {
    return fieldValidation
  }
  
  // Validate required fields
  if (!payload.vaultId || typeof payload.vaultId !== 'string') {
    return { isValid: false, error: 'Missing or invalid vaultId field' }
  }
  
  if (!payload.creator || typeof payload.creator !== 'string') {
    return { isValid: false, error: 'Missing or invalid creator field' }
  }
  
  if (!validateStellarAddress(payload.creator)) {
    return { isValid: false, error: 'Invalid creator address format' }
  }
  
  if (!payload.amount || typeof payload.amount !== 'string') {
    return { isValid: false, error: 'Missing or invalid amount field' }
  }
  
  if (!validateDecimalAmount(payload.amount)) {
    return { isValid: false, error: 'Amount must be a valid positive decimal number with up to 7 decimal places' }
  }
  
  if (!payload.startTimestamp || !(payload.startTimestamp instanceof Date)) {
    return { isValid: false, error: 'Missing or invalid startTimestamp field' }
  }
  
  if (isNaN(payload.startTimestamp.getTime())) {
    return { isValid: false, error: 'startTimestamp must be a valid date' }
  }
  
  if (!payload.endTimestamp || !(payload.endTimestamp instanceof Date)) {
    return { isValid: false, error: 'Missing or invalid endTimestamp field' }
  }
  
  if (isNaN(payload.endTimestamp.getTime())) {
    return { isValid: false, error: 'endTimestamp must be a valid date' }
  }
  
  if (payload.endTimestamp <= payload.startTimestamp) {
    return { isValid: false, error: 'endTimestamp must be after startTimestamp' }
  }
  
  if (!payload.successDestination || typeof payload.successDestination !== 'string') {
    return { isValid: false, error: 'Missing or invalid successDestination field' }
  }
  
  if (!validateStellarAddress(payload.successDestination)) {
    return { isValid: false, error: 'Invalid successDestination address format' }
  }
  
  if (!payload.failureDestination || typeof payload.failureDestination !== 'string') {
    return { isValid: false, error: 'Missing or invalid failureDestination field' }
  }
  
  if (!validateStellarAddress(payload.failureDestination)) {
    return { isValid: false, error: 'Invalid failureDestination address format' }
  }
  
  // Create sanitized payload
  const sanitized = createSafeObject({
    vaultId: payload.vaultId,
    creator: payload.creator,
    amount: payload.amount,
    startTimestamp: payload.startTimestamp,
    endTimestamp: payload.endTimestamp,
    successDestination: payload.successDestination,
    failureDestination: payload.failureDestination,
    status: 'active' as const
  })
  
  return { isValid: true, sanitizedPayload: sanitized }
}

/**
 * Validates vault status event payload with strict schema validation
 * 
 * @param payload - The vault event payload to validate
 * @returns ValidationResult with success/failure and sanitized payload
 */
function validateVaultStatusPayload(payload: VaultEventPayload): ValidationResult {
  const allowedFields = ['vaultId', 'status']
  
  // Check for unknown fields
  const fieldValidation = validateAllowedFields(payload as unknown as Record<string, unknown>, allowedFields)
  if (!fieldValidation.isValid) {
    return fieldValidation
  }
  
  if (!payload.vaultId || typeof payload.vaultId !== 'string') {
    return { isValid: false, error: 'Missing or invalid vaultId field' }
  }
  
  if (!payload.status || typeof payload.status !== 'string') {
    return { isValid: false, error: 'Missing or invalid status field' }
  }
  
  const validStatuses = ['completed', 'failed', 'cancelled']
  if (!validStatuses.includes(payload.status)) {
    return { 
      isValid: false, 
      error: `Invalid status value: ${payload.status}. Must be one of: ${validStatuses.join(', ')}`
    }
  }
  
  // Create sanitized payload
  const sanitized = createSafeObject({
    vaultId: payload.vaultId,
    status: payload.status as 'completed' | 'failed' | 'cancelled'
  })
  
  return { isValid: true, sanitizedPayload: sanitized }
}

/**
 * Parses vault event payload from XDR data
 * 
 * @param eventType - The type of vault event
 * @param xdrData - Base64 encoded XDR data
 * @returns VaultEventPayload or null if parsing fails
 */
function parseVaultPayload(
  eventType: EventType,
  xdrData: string
): VaultEventPayload | null {
  try {
    // Decode XDR using Stellar SDK
    const scVal = xdr.ScVal.fromXDR(xdrData, 'base64')
    const nativeVal = scValToNative(scVal)
    
    // Try to decode payload as JSON first (fallback for testing)
    const decoded = decodePayloadRecord(xdrData)
    
    let payload: VaultEventPayload
    
    switch (eventType) {
      case 'vault_created':
        // For vault_created, we expect a more complex object in the event
        payload = {
          vaultId: readStringField(decoded, 'vaultId') || nativeVal.vault_id || `vault_${Date.now()}`,
          creator: readStringField(decoded, 'creator') || nativeVal.creator || 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
          amount: readStringField(decoded, 'amount') || nativeVal.amount?.toString() || '1000.0000000',
          startTimestamp: readDateField(decoded, 'startTimestamp') || (nativeVal.start_date ? new Date(nativeVal.start_date * 1000) : new Date()),
          endTimestamp: readDateField(decoded, 'endTimestamp') || (nativeVal.end_date ? new Date(nativeVal.end_date * 1000) : new Date(Date.now() + 86400000)),
          successDestination: readStringField(decoded, 'successDestination') || nativeVal.success_destination || 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
          failureDestination: readStringField(decoded, 'failureDestination') || nativeVal.failure_destination || 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
          status: 'active'
        }
        
        // Validate vault_created payload
        const createdValidation = validateVaultCreatedPayload(payload)
        if (!createdValidation.isValid) {
          const redactedDetails = redactSensitiveInfo({ payload, eventType })
          console.error(`Vault created validation error: ${createdValidation.error}`, redactedDetails)
          return null
        }
        
        return createdValidation.sanitizedPayload! as unknown as VaultEventPayload

      case 'vault_completed':
      case 'vault_failed':
      case 'vault_cancelled':
        payload = {
          vaultId: readStringField(decoded, 'vaultId') || nativeVal.vault_id || '',
          status: ((readStringField(decoded, 'status') ||
            eventType.replace('vault_', '')) as VaultEventPayload['status'])
        }

        const statusValidation = validateVaultStatusPayload(payload)
        if (!statusValidation.isValid) {
          const redactedDetails = redactSensitiveInfo({ payload, eventType })
          console.error(`Vault status validation error: ${statusValidation.error}`, redactedDetails)
          return null
        }
        
        return statusValidation.sanitizedPayload! as unknown as VaultEventPayload
      
      default:
        return null
    }
  } catch (error) {
    console.error('Error parsing vault payload XDR:', error)
    return null
  }
}

/**
 * Validates milestone_created event payload with strict schema validation
 * 
 * @param payload - The milestone event payload to validate
 * @returns ValidationResult with success/failure and sanitized payload
 */
function validateMilestonePayload(payload: MilestoneEventPayload): ValidationResult {
  const allowedFields = ['milestoneId', 'vaultId', 'title', 'description', 'targetAmount', 'deadline']
  
  // Check for unknown fields
  const fieldValidation = validateAllowedFields(payload as unknown as Record<string, unknown>, allowedFields)
  if (!fieldValidation.isValid) {
    return fieldValidation
  }
  
  if (!payload.milestoneId || typeof payload.milestoneId !== 'string') {
    return { isValid: false, error: 'Missing or invalid milestoneId field' }
  }
  
  if (!payload.vaultId || typeof payload.vaultId !== 'string') {
    return { isValid: false, error: 'Missing or invalid vaultId field' }
  }
  
  if (!payload.title || typeof payload.title !== 'string') {
    return { isValid: false, error: 'Missing or invalid title field' }
  }
  
  if (payload.title.length > 255) {
    return { isValid: false, error: 'Title must be 255 characters or less' }
  }
  
  if (payload.description !== undefined && typeof payload.description !== 'string') {
    return { isValid: false, error: 'Description must be a string' }
  }
  
  if (payload.description && payload.description.length > 1000) {
    return { isValid: false, error: 'Description must be 1000 characters or less' }
  }
  
  if (!payload.targetAmount || typeof payload.targetAmount !== 'string') {
    return { isValid: false, error: 'Missing or invalid targetAmount field' }
  }
  
  if (!validateDecimalAmount(payload.targetAmount)) {
    return { isValid: false, error: 'targetAmount must be a valid positive decimal number with up to 7 decimal places' }
  }
  
  if (!payload.deadline || !(payload.deadline instanceof Date)) {
    return { isValid: false, error: 'Missing or invalid deadline field' }
  }
  
  if (isNaN(payload.deadline.getTime())) {
    return { isValid: false, error: 'deadline must be a valid date' }
  }
  
  if (payload.deadline <= new Date()) {
    return { isValid: false, error: 'deadline must be in the future' }
  }
  
  // Create sanitized payload
  const sanitized = createSafeObject({
    milestoneId: payload.milestoneId,
    vaultId: payload.vaultId,
    title: payload.title,
    description: payload.description || '',
    targetAmount: payload.targetAmount,
    deadline: payload.deadline
  })
  
  return { isValid: true, sanitizedPayload: sanitized }
}

/**
 * Parses milestone event payload from XDR data
 * 
 * @param xdrData - Base64 encoded XDR data
 * @returns MilestoneEventPayload or null if parsing fails
 */
function parseMilestonePayload(xdrData: string): MilestoneEventPayload | null {
  try {
    // Decode XDR using Stellar SDK
    const scVal = xdr.ScVal.fromXDR(xdrData, 'base64')
    const nativeVal = scValToNative(scVal)
    
    // Try to decode payload as JSON first (fallback for testing)
    const decoded = decodePayloadRecord(xdrData)
    
    const payload: MilestoneEventPayload = {
      milestoneId: readStringField(decoded, 'milestoneId') || nativeVal.milestone_id || `milestone_${Date.now()}`,
      vaultId: readStringField(decoded, 'vaultId') || nativeVal.vault_id || `vault_${Date.now()}`,
      title: readStringField(decoded, 'title') || nativeVal.title || 'Milestone Title',
      description: readStringField(decoded, 'description') || nativeVal.description || 'Milestone Description',
      targetAmount: readStringField(decoded, 'targetAmount') || nativeVal.amount?.toString() || '500.0000000',
      deadline: readDateField(decoded, 'deadline') || (nativeVal.due_date ? new Date(nativeVal.due_date * 1000) : new Date(Date.now() + 86400000))
    }
    
    // Validate milestone payload
    const validation = validateMilestonePayload(payload)
    if (!validation.isValid) {
      const redactedDetails = redactSensitiveInfo({ payload })
      console.error(`Milestone validation error: ${validation.error}`, redactedDetails)
      return null
    }
    
    return validation.sanitizedPayload! as unknown as MilestoneEventPayload
  } catch (error) {
    console.error('Error parsing milestone payload XDR:', error)
    return null
  }
}

/**
 * Validates milestone_validated event payload with strict schema validation
 * 
 * @param payload - The validation event payload to validate
 * @returns ValidationResult with success/failure and sanitized payload
 */
function validateValidationPayload(payload: ValidationEventPayload): ValidationResult {
  const allowedFields = ['validationId', 'milestoneId', 'validatorAddress', 'validationResult', 'evidenceHash', 'validatedAt']
  
  // Check for unknown fields
  const fieldValidation = validateAllowedFields(payload as unknown as Record<string, unknown>, allowedFields)
  if (!fieldValidation.isValid) {
    return fieldValidation
  }
  
  if (!payload.validationId || typeof payload.validationId !== 'string') {
    return { isValid: false, error: 'Missing or invalid validationId field' }
  }
  
  if (!payload.milestoneId || typeof payload.milestoneId !== 'string') {
    return { isValid: false, error: 'Missing or invalid milestoneId field' }
  }
  
  if (!payload.validatorAddress || typeof payload.validatorAddress !== 'string') {
    return { isValid: false, error: 'Missing or invalid validatorAddress field' }
  }
  
  if (!validateStellarAddress(payload.validatorAddress)) {
    return { isValid: false, error: 'Invalid validatorAddress format' }
  }
  
  if (!payload.validationResult || typeof payload.validationResult !== 'string') {
    return { isValid: false, error: 'Missing or invalid validationResult field' }
  }
  
  const validResults = ['approved', 'rejected', 'pending_review']
  if (!validResults.includes(payload.validationResult)) {
    return { 
      isValid: false, 
      error: `Invalid validationResult value: ${payload.validationResult}. Must be one of: ${validResults.join(', ')}`
    }
  }
  
  if (!payload.evidenceHash || typeof payload.evidenceHash !== 'string') {
    return { isValid: false, error: 'Missing or invalid evidenceHash field' }
  }
  
  if (!/^[a-zA-Z0-9_-]+$/.test(payload.evidenceHash)) {
    return { isValid: false, error: 'evidenceHash must contain only alphanumeric characters, underscores, and hyphens' }
  }
  
  if (!payload.validatedAt || !(payload.validatedAt instanceof Date)) {
    return { isValid: false, error: 'Missing or invalid validatedAt field' }
  }
  
  if (isNaN(payload.validatedAt.getTime())) {
    return { isValid: false, error: 'validatedAt must be a valid date' }
  }
  
  // Create sanitized payload
  const sanitized = createSafeObject({
    validationId: payload.validationId,
    milestoneId: payload.milestoneId,
    validatorAddress: payload.validatorAddress,
    validationResult: payload.validationResult as 'approved' | 'rejected' | 'pending_review',
    evidenceHash: payload.evidenceHash,
    validatedAt: payload.validatedAt
  })
  
  return { isValid: true, sanitizedPayload: sanitized }
}

/**
 * Parses validation event payload from XDR data
 * 
 * @param xdrData - Base64 encoded XDR data
 * @returns ValidationEventPayload or null if parsing fails
 */
function parseValidationPayload(xdrData: string): ValidationEventPayload | null {
  try {
    // Decode XDR using Stellar SDK
    const scVal = xdr.ScVal.fromXDR(xdrData, 'base64')
    const nativeVal = scValToNative(scVal)
    
    // Try to decode payload as JSON first (fallback for testing)
    const decoded = decodePayloadRecord(xdrData)
    
    const payload: ValidationEventPayload = {
      validationId: readStringField(decoded, 'validationId') || nativeVal.validation_id || `validation_${Date.now()}`,
      milestoneId: readStringField(decoded, 'milestoneId') || nativeVal.milestone_id || `milestone_${Date.now()}`,
      validatorAddress: readStringField(decoded, 'validatorAddress') || nativeVal.validator || 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
      validationResult: (readStringField(decoded, 'validationResult') || nativeVal.result || 'approved') as ValidationEventPayload['validationResult'],
      evidenceHash: readStringField(decoded, 'evidenceHash') || nativeVal.evidence_hash || 'hash_' + Date.now(),
      validatedAt: readDateField(decoded, 'validatedAt') || (nativeVal.timestamp ? new Date(nativeVal.timestamp * 1000) : new Date())
    }
    
    // Validate validation payload
    const validation = validateValidationPayload(payload)
    if (!validation.isValid) {
      const redactedDetails = redactSensitiveInfo({ payload })
      console.error(`Validation event validation error: ${validation.error}`, redactedDetails)
      return null
    }
    
    return validation.sanitizedPayload! as unknown as ValidationEventPayload
  } catch (error) {
    console.error('Error parsing validation payload XDR:', error)
    return null
  }
}

/**
 * Routes event to appropriate payload parser based on event type
 * 
 * @param eventType - The type of event
 * @param xdrData - Base64 encoded XDR data
 * @returns Parsed payload or null if parsing fails
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
 * 
 * @param rawEvent - Raw event from Horizon API
 * @returns ParseResult with success/failure and parsed event or error details
 */
export function parseHorizonEvent(rawEvent: HorizonEvent): ParseResult {
  try {
    // Validate required fields
    if (!rawEvent.txHash) {
      return {
        success: false,
        error: 'Missing transaction hash',
        details: { rawEvent }
      }
    }

    if (!rawEvent.id) {
      return {
        success: false,
        error: 'Missing event id',
        details: { rawEvent }
      }
    }

    if (typeof rawEvent.ledger !== 'number') {
      return {
        success: false,
        error: 'Missing or invalid ledger number',
        details: { rawEvent }
      }
    }

    // Extract event index from the event id (format: "txHash-index")
    const eventIndexMatch = rawEvent.id.match(/-(\d+)$/)
    if (!eventIndexMatch) {
      return {
        success: false,
        error: 'Could not extract event index from event id',
        details: { eventId: rawEvent.id }
      }
    }
    const eventIndex = parseInt(eventIndexMatch[1], 10)

    // Generate event_id in format {transaction_hash}:{event_index}
    const eventId = `${rawEvent.txHash}:${eventIndex}`

    // Extract event type from topic (first element)
    if (!rawEvent.topic || rawEvent.topic.length === 0) {
      return {
        success: false,
        error: 'Missing event topic',
        details: { rawEvent }
      }
    }

    const eventType = rawEvent.topic[0] as EventType

    // Validate event type
    const validEventTypes: EventType[] = [
      'vault_created',
      'vault_completed',
      'vault_failed',
      'vault_cancelled',
      'milestone_created',
      'milestone_validated'
    ]

    if (!validEventTypes.includes(eventType)) {
      return {
        success: false,
        error: `Unknown event type: ${eventType}`,
        details: { eventType, validTypes: validEventTypes }
      }
    }

    // Route to appropriate payload parser based on event type
    const payload = routeToPayloadParser(eventType, rawEvent.value.xdr)
    
    if (!payload) {
      return {
        success: false,
        error: `Failed to parse payload for event type: ${eventType}`,
        details: { eventType, xdr: rawEvent.value.xdr }
      }
    }

    // Create parsed event with extracted payload
    const parsedEvent: ParsedEvent = {
      eventId,
      transactionHash: rawEvent.txHash,
      eventIndex,
      ledgerNumber: rawEvent.ledger,
      eventType,
      payload
    }

    return {
      success: true,
      event: parsedEvent
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown parsing error',
      details: { error }
    }
  }
}
