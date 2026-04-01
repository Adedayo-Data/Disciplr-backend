import { parseHorizonEvent, HorizonEvent } from '../services/eventParser.js'

jest.mock('@stellar/stellar-sdk', () => ({
  xdr: {
    ScVal: {
      fromXDR: jest.fn().mockReturnValue({})
    }
  },
  scValToNative: jest.fn().mockImplementation((val) => {
    // Return a sensible default based on common testing needs or just a dynamic object
    return {
      vault_id: 'vault-test-001',
      creator: 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
      amount: '1000.0000000',
      start_date: Math.floor(Date.now() / 1000),
      end_date: Math.floor(Date.now() / 1000) + 86400,
      success_destination: 'GSUCCESSXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
      failure_destination: 'GFAILUREXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
      status: 'active',
      milestone_id: 'milestone-test-001',
      title: 'Test Milestone',
      due_date: Math.floor(Date.now() / 1000) + 86400,
      validation_id: 'validation-test-001',
      validator: 'GVALIDATORXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
      result: 'approved',
      timestamp: Math.floor(Date.now() / 1000)
    }
  })
}))

describe('eventParser', () => {
  describe('parseHorizonEvent', () => {
    it('should parse vault_created event and route to vault payload parser', () => {
      const mockEvent: HorizonEvent = {
        type: 'contract',
        ledger: 12345,
        ledgerClosedAt: '2024-01-15T10:30:00Z',
        contractId: 'CDISCIPLR123',
        id: 'abc123-0',
        pagingToken: 'abc123-0',
        topic: ['vault_created'],
        value: {
          xdr: 'AAAAAgAAAA...'
        },
        inSuccessfulContractCall: true,
        txHash: 'abc123'
      }

      const result = parseHorizonEvent(mockEvent)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.event.eventType).toBe('vault_created')
        expect(result.event.eventId).toBe('abc123:0')
        expect(result.event.transactionHash).toBe('abc123')
        expect(result.event.eventIndex).toBe(0)
        expect(result.event.ledgerNumber).toBe(12345)
        expect(result.event.payload).toBeDefined()
        expect((result.event.payload as any).vaultId).toBeDefined()
      }
    })

    it('should parse vault_completed event and route to vault payload parser', () => {
      const mockEvent: HorizonEvent = {
        type: 'contract',
        ledger: 12346,
        ledgerClosedAt: '2024-01-15T10:31:00Z',
        contractId: 'CDISCIPLR123',
        id: 'def456-1',
        pagingToken: 'def456-1',
        topic: ['vault_completed'],
        value: {
          xdr: 'AAAAAgAAAA...'
        },
        inSuccessfulContractCall: true,
        txHash: 'def456'
      }

      const result = parseHorizonEvent(mockEvent)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.event.eventType).toBe('vault_completed')
        expect(result.event.payload).toBeDefined()
        expect((result.event.payload as any).status).toBe('completed')
      }
    })

    it('should parse milestone_created event and route to milestone payload parser', () => {
      const mockEvent: HorizonEvent = {
        type: 'contract',
        ledger: 12347,
        ledgerClosedAt: '2024-01-15T10:32:00Z',
        contractId: 'CDISCIPLR123',
        id: 'ghi789-2',
        pagingToken: 'ghi789-2',
        topic: ['milestone_created'],
        value: {
          xdr: 'AAAAAgAAAA...'
        },
        inSuccessfulContractCall: true,
        txHash: 'ghi789'
      }

      const result = parseHorizonEvent(mockEvent)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.event.eventType).toBe('milestone_created')
        expect(result.event.payload).toBeDefined()
        expect((result.event.payload as any).milestoneId).toBeDefined()
        expect((result.event.payload as any).vaultId).toBeDefined()
      }
    })

    it('should parse milestone_validated event and route to validation payload parser', () => {
      const mockEvent: HorizonEvent = {
        type: 'contract',
        ledger: 12348,
        ledgerClosedAt: '2024-01-15T10:33:00Z',
        contractId: 'CDISCIPLR123',
        id: 'jkl012-3',
        pagingToken: 'jkl012-3',
        topic: ['milestone_validated'],
        value: {
          xdr: 'AAAAAgAAAA...'
        },
        inSuccessfulContractCall: true,
        txHash: 'jkl012'
      }

      const result = parseHorizonEvent(mockEvent)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.event.eventType).toBe('milestone_validated')
        expect(result.event.payload).toBeDefined()
        expect((result.event.payload as any).validationId).toBeDefined()
        expect((result.event.payload as any).milestoneId).toBeDefined()
      }
    })

    it('should return error for unknown event type', () => {
      const mockEvent: HorizonEvent = {
        type: 'contract',
        ledger: 12349,
        ledgerClosedAt: '2024-01-15T10:34:00Z',
        contractId: 'CDISCIPLR123',
        id: 'mno345-4',
        pagingToken: 'mno345-4',
        topic: ['unknown_event'],
        value: {
          xdr: 'AAAAAgAAAA...'
        },
        inSuccessfulContractCall: true,
        txHash: 'mno345'
      }

      const result = parseHorizonEvent(mockEvent)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toContain('Unknown event type')
      }
    })

    it('should return error for missing transaction hash', () => {
      const mockEvent: HorizonEvent = {
        type: 'contract',
        ledger: 12350,
        ledgerClosedAt: '2024-01-15T10:35:00Z',
        contractId: 'CDISCIPLR123',
        id: 'pqr678-5',
        pagingToken: 'pqr678-5',
        topic: ['vault_created'],
        value: {
          xdr: 'AAAAAgAAAA...'
        },
        inSuccessfulContractCall: true,
        txHash: ''
      }

      const result = parseHorizonEvent(mockEvent)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toContain('Missing transaction hash')
      }
    })

    it('should return error for missing event topic', () => {
      const mockEvent: HorizonEvent = {
        type: 'contract',
        ledger: 12351,
        ledgerClosedAt: '2024-01-15T10:36:00Z',
        contractId: 'CDISCIPLR123',
        id: 'stu901-6',
        pagingToken: 'stu901-6',
        topic: [],
        value: {
          xdr: 'AAAAAgAAAA...'
        },
        inSuccessfulContractCall: true,
        txHash: 'stu901'
      }

      const result = parseHorizonEvent(mockEvent)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toContain('Missing event topic')
      }
    })
  })
})
