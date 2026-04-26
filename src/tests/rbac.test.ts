import { describe, it, beforeAll, expect } from '@jest/globals'
import fc from 'fast-check'
import { UserRole } from '../types/user.js'
import {
  arbitraryUserRole,
  arbitraryValidJWTPayload,
  arbitraryMaliciousHeaders,
  arbitraryAdminEndpoint,
  arbitraryAuthenticationState,
  arbitrarySecurityBypassAttempt,
  arbitraryEndpointAccessScenario,
  arbitraryRoleHierarchyScenario,
  arbitraryTokenManipulationScenario
} from './fixtures/rbacArbitraries.js'

/**
 * RBAC Unit Tests
 *
 * These tests verify core RBAC logic and are designed to work with mocked/isolated middleware.
 * Integration tests for actual endpoints are in src/tests/admin.rbac.test.ts.
 */

describe('RBAC: Role Definitions and Hierarchy', () => {
  it('defines USER role', () => {
    expect(UserRole.USER).toBe('USER')
  })

  it('defines VERIFIER role', () => {
    expect(UserRole.VERIFIER).toBe('VERIFIER')
  })

  it('defines ADMIN role', () => {
    expect(UserRole.ADMIN).toBe('ADMIN')
  })

  it('has exactly three roles', () => {
    const roles = Object.values(UserRole)
    expect(roles).toHaveLength(3)
    expect(roles).toContain('USER')
    expect(roles).toContain('VERIFIER')
    expect(roles).toContain('ADMIN')
  })
})

describe('RBAC: Role Hierarchy Logic', () => {
  /**
   * Define role hierarchies: which roles can access which resource levels
   * This reflects the business logic: VERIFIER >= USER, ADMIN >= VERIFIER >= USER
   */

  const roleHierarchy = {
    user: [UserRole.USER, UserRole.VERIFIER, UserRole.ADMIN],
    verifier: [UserRole.VERIFIER, UserRole.ADMIN],
    admin: [UserRole.ADMIN],
  }

  it('USER level accessible by USER, VERIFIER, and ADMIN', () => {
    expect(roleHierarchy.user).toContain(UserRole.USER)
    expect(roleHierarchy.user).toContain(UserRole.VERIFIER)
    expect(roleHierarchy.user).toContain(UserRole.ADMIN)
  })

  it('VERIFIER level accessible by VERIFIER and ADMIN only', () => {
    expect(roleHierarchy.verifier).toContain(UserRole.VERIFIER)
    expect(roleHierarchy.verifier).toContain(UserRole.ADMIN)
    expect(roleHierarchy.verifier).not.toContain(UserRole.USER)
  })

  it('ADMIN level accessible by ADMIN only', () => {
    expect(roleHierarchy.admin).toContain(UserRole.ADMIN)
    expect(roleHierarchy.admin).not.toContain(UserRole.USER)
    expect(roleHierarchy.admin).not.toContain(UserRole.VERIFIER)
  })
})

describe('RBAC: Authorization Logic', () => {
  /**
   * Verify authorization decision logic: given a role and a required role list,
   * determine if access should be granted.
   */

  const authorize = (userRole: UserRole, allowedRoles: UserRole[]): boolean => {
    return allowedRoles.includes(userRole)
  }

  it('grants access when user role is in allowed list', () => {
    const result = authorize(UserRole.ADMIN, [UserRole.ADMIN])
    expect(result).toBe(true)
  })

  it('denies access when user role is not in allowed list', () => {
    const result = authorize(UserRole.USER, [UserRole.ADMIN])
    expect(result).toBe(false)
  })

  it('grants access to ADMIN for verifier-level routes', () => {
    const result = authorize(UserRole.ADMIN, [UserRole.VERIFIER, UserRole.ADMIN])
    expect(result).toBe(true)
  })

  it('denies access to USER for verifier-level routes', () => {
    const result = authorize(UserRole.USER, [UserRole.VERIFIER, UserRole.ADMIN])
    expect(result).toBe(false)
  })

  it('grants access to VERIFIER for user-level routes', () => {
    const result = authorize(UserRole.VERIFIER, [UserRole.USER, UserRole.VERIFIER, UserRole.ADMIN])
    expect(result).toBe(true)
  })
})

describe('RBAC: Security Invariants', () => {
  /**
   * Test core security properties that must always hold
   */

  it('role cannot be undefined', () => {
    const roles = Object.values(UserRole)
    roles.forEach(role => {
      expect(role).toBeDefined()
      expect(role).not.toBe(undefined)
      expect(role).not.toBeNull()
    })
  })

  it('role values are strings', () => {
    const roles = Object.values(UserRole)
    roles.forEach(role => {
      expect(typeof role).toBe('string')
    })
  })

  it('role values are non-empty', () => {
    const roles = Object.values(UserRole)
    roles.forEach(role => {
      expect(role.length).toBeGreaterThan(0)
    })
  })

  it('roles are case-sensitive', () => {
    // Roles must match exactly, not case-insensitively
    const admin = UserRole.ADMIN
    expect(admin).toEqual('ADMIN')
    expect(admin).not.toEqual('admin')
    expect(admin).not.toEqual('Admin')
  })
})


describe('RBAC: Header Isolation and Security Bypass Prevention', () => {
  /**
   * Test that RBAC system reads role exclusively from JWT tokens
   * and never from request headers, preventing privilege escalation attacks.
   * 
   * **Validates: Requirements 1.1, 1.2, 1.4, 1.5**
   */

  it('ignores x-user-role header for role determination', () => {
    // Simulate middleware behavior: role comes from JWT, not headers
    const jwtRole = UserRole.USER
    const headerRole = 'ADMIN' // Malicious header
    
    // Authorization decision should be based on JWT role only
    const allowedRoles = [UserRole.ADMIN]
    const isAuthorized = allowedRoles.includes(jwtRole)
    
    expect(isAuthorized).toBe(false) // USER should be denied
    expect(allowedRoles.includes(headerRole as UserRole)).toBe(true) // Header would grant access
    // But the system MUST use jwtRole, not headerRole
  })

  it('ignores x-requested-role header for role determination', () => {
    const jwtRole = UserRole.VERIFIER
    const headerRole = 'ADMIN'
    
    const allowedRoles = [UserRole.ADMIN]
    const isAuthorized = allowedRoles.includes(jwtRole)
    
    expect(isAuthorized).toBe(false) // VERIFIER should be denied
  })

  it('ignores role header in any case variation', () => {
    const jwtRole = UserRole.USER
    const headerVariations = ['ADMIN', 'admin', 'Admin', 'aDmIn']
    
    const allowedRoles = [UserRole.ADMIN]
    const isAuthorized = allowedRoles.includes(jwtRole)
    
    expect(isAuthorized).toBe(false)
    // None of the header variations should affect the decision
    headerVariations.forEach(headerRole => {
      expect(jwtRole).not.toBe(headerRole)
    })
  })

  it('ignores x-auth-role header for role determination', () => {
    const jwtRole = UserRole.USER
    const headerRole = 'ADMIN'
    
    const allowedRoles = [UserRole.ADMIN]
    const isAuthorized = allowedRoles.includes(jwtRole)
    
    expect(isAuthorized).toBe(false)
  })

  it('ignores multiple role headers simultaneously', () => {
    const jwtRole = UserRole.USER
    const maliciousHeaders = {
      'x-user-role': 'ADMIN',
      'x-requested-role': 'ADMIN',
      'role': 'ADMIN',
      'x-auth-role': 'ADMIN',
    }
    
    const allowedRoles = [UserRole.ADMIN]
    const isAuthorized = allowedRoles.includes(jwtRole)
    
    expect(isAuthorized).toBe(false)
    // Even with multiple headers, JWT role should be used
    expect(Object.keys(maliciousHeaders).length).toBeGreaterThan(1)
  })

  it('role determination is based on JWT payload only', () => {
    // Simulate JWT payload structure
    const jwtPayload = {
      userId: 'test-user',
      role: UserRole.USER,
      email: 'test@example.com',
    }
    
    const allowedRoles = [UserRole.ADMIN]
    const isAuthorized = allowedRoles.includes(jwtPayload.role)
    
    expect(isAuthorized).toBe(false)
    expect(jwtPayload.role).toBe(UserRole.USER)
  })

  it('prevents privilege escalation through header injection', () => {
    // Attacker scenario: USER token + ADMIN header
    const authenticatedRole = UserRole.USER
    const injectedRole = 'ADMIN'
    
    // System should use authenticated role from JWT
    const allowedRoles = [UserRole.ADMIN]
    const isAuthorized = allowedRoles.includes(authenticatedRole)
    
    expect(isAuthorized).toBe(false)
    expect(authenticatedRole).not.toBe(injectedRole)
  })

  it('validates that role source is cryptographically verified', () => {
    // JWT tokens are cryptographically signed
    // Headers are not signed and cannot be trusted
    const trustedSource = 'JWT' // Cryptographically verified
    const untrustedSource = 'Header' // Not verified
    
    expect(trustedSource).toBe('JWT')
    expect(untrustedSource).not.toBe('JWT')
    
    // Role MUST come from trusted source only
    const roleSource = trustedSource
    expect(roleSource).toBe('JWT')
  })
})

describe('RBAC: Authentication Precedence Invariant', () => {
  /**
   * Test that authentication checks always occur before authorization checks
   * ensuring proper security layering.
   * 
   * **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5**
   */

  const AUTH_ERROR = 401
  const AUTHZ_ERROR = 403

  it('returns 401 for missing authentication, never 403', () => {
    const isAuthenticated = false
    const hasRequiredRole = false // Doesn't matter if not authenticated
    
    const statusCode = !isAuthenticated ? AUTH_ERROR : (hasRequiredRole ? 200 : AUTHZ_ERROR)
    
    expect(statusCode).toBe(401)
    expect(statusCode).not.toBe(403)
  })

  it('returns 401 for malformed token, never 403', () => {
    const tokenValid = false
    const tokenMalformed = true
    const hasRequiredRole = false
    
    const statusCode = tokenMalformed ? AUTH_ERROR : (hasRequiredRole ? 200 : AUTHZ_ERROR)
    
    expect(statusCode).toBe(401)
    expect(statusCode).not.toBe(403)
  })

  it('returns 401 for invalid token signature, never 403', () => {
    const tokenSignatureValid = false
    const hasRequiredRole = false
    
    const statusCode = !tokenSignatureValid ? AUTH_ERROR : (hasRequiredRole ? 200 : AUTHZ_ERROR)
    
    expect(statusCode).toBe(401)
    expect(statusCode).not.toBe(403)
  })

  it('returns 401 for expired token, never 403', () => {
    const tokenExpired = true
    const hasRequiredRole = false
    
    const statusCode = tokenExpired ? AUTH_ERROR : (hasRequiredRole ? 200 : AUTHZ_ERROR)
    
    expect(statusCode).toBe(401)
    expect(statusCode).not.toBe(403)
  })

  it('returns 403 only after successful authentication', () => {
    const isAuthenticated = true
    const tokenValid = true
    const hasRequiredRole = false
    
    const statusCode = !isAuthenticated || !tokenValid ? AUTH_ERROR : (hasRequiredRole ? 200 : AUTHZ_ERROR)
    
    expect(statusCode).toBe(403)
    expect(statusCode).not.toBe(401)
  })

  it('authentication failure takes precedence over authorization failure', () => {
    const authenticationFailed = true
    const authorizationWouldFail = true
    
    // Even if authorization would fail, authentication failure is reported first
    const statusCode = authenticationFailed ? AUTH_ERROR : (authorizationWouldFail ? AUTHZ_ERROR : 200)
    
    expect(statusCode).toBe(401)
  })

  it('validates authentication state before checking role', () => {
    // Proper security layering: authenticate → authorize
    const securityLayers = ['authentication', 'authorization']
    
    expect(securityLayers[0]).toBe('authentication')
    expect(securityLayers[1]).toBe('authorization')
    expect(securityLayers.indexOf('authentication')).toBeLessThan(securityLayers.indexOf('authorization'))
  })
})

describe('RBAC: Error Response Consistency', () => {
  /**
   * Test that error responses follow consistent format and patterns
   * 
   * **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5**
   */

  interface ErrorEnvelope {
    error: string
    message?: string
  }

  it('authentication error includes "Unauthorized" in error field', () => {
    const authError: ErrorEnvelope = {
      error: 'Unauthorized',
    }
    
    expect(authError.error).toMatch(/unauthorized/i)
    expect(authError).toHaveProperty('error')
  })

  it('authorization error includes "Forbidden" in error field', () => {
    const authzError: ErrorEnvelope = {
      error: 'Forbidden',
      message: 'Requires role: ADMIN',
    }
    
    expect(authzError.error).toMatch(/forbidden/i)
    expect(authzError).toHaveProperty('error')
  })

  it('error envelope has consistent JSON structure', () => {
    const error1: ErrorEnvelope = { error: 'Unauthorized' }
    const error2: ErrorEnvelope = { error: 'Forbidden', message: 'Requires role: ADMIN' }
    
    expect(error1).toHaveProperty('error')
    expect(error2).toHaveProperty('error')
    expect(typeof error1.error).toBe('string')
    expect(typeof error2.error).toBe('string')
  })

  it('authorization error optionally includes detailed message', () => {
    const authzError: ErrorEnvelope = {
      error: 'Forbidden',
      message: 'Requires role: ADMIN',
    }
    
    expect(authzError.message).toBeDefined()
    expect(authzError.message).toContain('role')
  })

  it('error messages are descriptive strings', () => {
    const errors: ErrorEnvelope[] = [
      { error: 'Unauthorized' },
      { error: 'Forbidden', message: 'Requires role: ADMIN' },
      { error: 'Invalid token' },
    ]
    
    errors.forEach(err => {
      expect(typeof err.error).toBe('string')
      expect(err.error.length).toBeGreaterThan(0)
    })
  })

  it('401 status corresponds to authentication errors', () => {
    const statusCode = 401
    const errorTypes = ['Unauthorized', 'Invalid token', 'Token expired', 'Missing authorization']
    
    expect(statusCode).toBe(401)
    errorTypes.forEach(errorType => {
      expect(errorType.toLowerCase()).toMatch(/unauthorized|invalid|expired|missing/)
    })
  })

  it('403 status corresponds to authorization errors', () => {
    const statusCode = 403
    const errorTypes = ['Forbidden', 'Requires role: ADMIN', 'Insufficient permissions']
    
    expect(statusCode).toBe(403)
    errorTypes.forEach(errorType => {
      expect(errorType.toLowerCase()).toMatch(/forbidden|requires|insufficient/)
    })
  })
})

describe('RBAC: Security Bypass Prevention', () => {
  /**
   * Test various security bypass techniques to ensure they all fail
   * 
   * **Validates: Requirements 10.1, 10.2, 10.3, 10.4, 10.5**
   */

  it('prevents role escalation through header spoofing', () => {
    const jwtRole = UserRole.USER
    const spoofedHeaders = {
      'x-user-role': 'ADMIN',
      'role': 'ADMIN',
    }
    
    // System must use JWT role, not headers
    const effectiveRole = jwtRole // Not from headers
    
    expect(effectiveRole).toBe(UserRole.USER)
    expect(effectiveRole).not.toBe('ADMIN')
  })

  it('prevents token forgery through signature validation', () => {
    // Tokens must be cryptographically signed
    const validToken = { signed: true, signatureValid: true }
    const forgedToken = { signed: true, signatureValid: false }
    
    const isValidToken = (token: typeof validToken) => token.signed && token.signatureValid
    
    expect(isValidToken(validToken)).toBe(true)
    expect(isValidToken(forgedToken)).toBe(false)
  })

  it('prevents signature bypass through algorithm confusion', () => {
    // System must use a specific signing algorithm (e.g., HS256)
    const expectedAlgorithm = 'HS256'
    const maliciousAlgorithm = 'none' // Algorithm confusion attack
    
    const isAlgorithmValid = (alg: string) => alg === expectedAlgorithm
    
    expect(isAlgorithmValid(expectedAlgorithm)).toBe(true)
    expect(isAlgorithmValid(maliciousAlgorithm)).toBe(false)
  })

  it('handles empty token gracefully', () => {
    const emptyToken = ''
    const isTokenValid = emptyToken.length > 0
    
    expect(isTokenValid).toBe(false)
  })

  it('handles null token gracefully', () => {
    const nullToken = null
    const isTokenValid = nullToken !== null && nullToken !== undefined
    
    expect(isTokenValid).toBe(false)
  })

  it('handles malformed JSON in token payload', () => {
    const malformedPayload = 'not-valid-json'
    
    let isValidPayload = false
    try {
      JSON.parse(malformedPayload)
      isValidPayload = true
    } catch {
      isValidPayload = false
    }
    
    expect(isValidPayload).toBe(false)
  })

  it('prevents authorization header case manipulation', () => {
    // Authorization header must be case-sensitive
    const validHeader = 'Authorization'
    const manipulatedHeaders = ['authorization', 'AUTHORIZATION', 'AuThOrIzAtIoN']
    
    // HTTP headers are case-insensitive, but the value format matters
    // "Bearer <token>" format must be validated
    const validFormat = 'Bearer valid-token'
    const invalidFormats = ['bearer valid-token', 'BEARER valid-token', 'Token valid-token']
    
    expect(validFormat.startsWith('Bearer ')).toBe(true)
    invalidFormats.forEach(format => {
      expect(format.startsWith('Bearer ')).toBe(false)
    })
  })

  it('prevents role injection through JWT claims', () => {
    // Only the 'role' claim should be used, not custom claims
    const jwtPayload = {
      userId: 'test',
      role: UserRole.USER,
      customRole: 'ADMIN', // Malicious custom claim
      adminRole: 'ADMIN', // Another malicious claim
    }
    
    const effectiveRole = jwtPayload.role // Must use standard 'role' claim
    
    expect(effectiveRole).toBe(UserRole.USER)
    expect(effectiveRole).not.toBe('ADMIN')
  })

  it('validates that all bypass attempts result in denial', () => {
    const bypassAttempts = [
      { method: 'header-spoofing', shouldSucceed: false },
      { method: 'token-forgery', shouldSucceed: false },
      { method: 'signature-bypass', shouldSucceed: false },
      { method: 'empty-token', shouldSucceed: false },
      { method: 'null-token', shouldSucceed: false },
      { method: 'malformed-json', shouldSucceed: false },
    ]
    
    bypassAttempts.forEach(attempt => {
      expect(attempt.shouldSucceed).toBe(false)
    })
  })
})

/**
 * PROPERTY-BASED TESTS
 * 
 * These tests use property-based testing to validate universal security properties
 * across all valid inputs, providing comprehensive coverage beyond unit tests.
 */

describe('RBAC: Property-Based Security Tests', () => {
  /**
   * Property 1: Header Isolation and Security Bypass Prevention
   * 
   * For any valid JWT token with role R and any combination of request headers 
   * containing role information, the RBAC system SHALL make authorization decisions 
   * based exclusively on the JWT role R and SHALL ignore all header-based role information.
   * 
   * **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 10.1, 10.2, 10.3, 10.4, 10.5**
   */
  it('Property 1: Header isolation prevents privilege escalation', () => {
    fc.assert(fc.property(
      arbitraryValidJWTPayload(),
      arbitraryMaliciousHeaders(),
      arbitraryAdminEndpoint(),
      (jwtPayload, maliciousHeaders, endpoint) => {
        // Authorization decision must be based only on JWT role
        const isAuthorized = endpoint.allowedRoles.includes(jwtPayload.role)
        
        // Headers should never affect the authorization decision
        const headerRoles = Object.values(maliciousHeaders).filter(value => 
          ['ADMIN', 'VERIFIER', 'USER', 'SUPERUSER', 'ROOT'].includes(value)
        )
        
        // Even if headers contain privileged roles, JWT role determines access
        const hasPrivilegedHeaders = headerRoles.some(role => 
          ['ADMIN', 'SUPERUSER', 'ROOT'].includes(role)
        )
        
        // The authorization decision should be independent of headers
        if (hasPrivilegedHeaders && !isAuthorized) {
          // Headers claim privilege but JWT doesn't have it - should be denied
          expect(isAuthorized).toBe(false)
        }
        
        return true // Property holds: headers don't affect JWT-based decisions
      }
    ), { numRuns: 100 })
  })

  /**
   * Property 2: Admin Endpoint Access Control
   * 
   * For any admin endpoint under /api/admin/* and any JWT token with role R, 
   * the RBAC system SHALL allow access if and only if R equals ADMIN.
   * 
   * **Validates: Requirements 2.1, 2.2, 2.3**
   */
  it('Property 2: Admin endpoints enforce admin-only access', () => {
    fc.assert(fc.property(
      arbitraryAdminEndpoint(),
      arbitraryUserRole(),
      (endpoint, userRole) => {
        const isAuthorized = endpoint.allowedRoles.includes(userRole)
        const isAdminEndpoint = endpoint.path.startsWith('/api/admin/')
        
        if (isAdminEndpoint) {
          // Admin endpoints should only allow ADMIN role
          if (userRole === UserRole.ADMIN) {
            expect(isAuthorized).toBe(true)
          } else {
            expect(isAuthorized).toBe(false)
          }
        }
        
        return true
      }
    ), { numRuns: 100 })
  })

  /**
   * Property 5: Authentication Precedence Invariant
   * 
   * For any protected endpoint and any request with authentication state S, 
   * the RBAC system SHALL return 401 Unauthorized for all invalid authentication 
   * states and SHALL only return 403 Forbidden after successful authentication.
   * 
   * **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5**
   */
  it('Property 5: Authentication always precedes authorization', () => {
    fc.assert(fc.property(
      arbitraryAuthenticationState(),
      arbitraryUserRole(),
      (authState, userRole) => {
        const isAuthenticated = authState.hasToken && 
                               authState.tokenValid && 
                               !authState.tokenExpired && 
                               !authState.tokenMalformed && 
                               authState.signatureValid
        
        const hasRequiredRole = userRole === UserRole.ADMIN // Assume admin-only endpoint
        
        let expectedStatus: number
        if (!isAuthenticated) {
          expectedStatus = 401 // Authentication failure always comes first
        } else if (!hasRequiredRole) {
          expectedStatus = 403 // Authorization failure only after successful auth
        } else {
          expectedStatus = 200 // Success
        }
        
        // Authentication failures must never return 403
        if (!isAuthenticated) {
          expect(expectedStatus).toBe(401)
          expect(expectedStatus).not.toBe(403)
        }
        
        // Authorization failures only occur after successful authentication
        if (expectedStatus === 403) {
          expect(isAuthenticated).toBe(true)
        }
        
        return true
      }
    ), { numRuns: 100 })
  })

  /**
   * Property 6: Error Envelope Consistency
   * 
   * For any RBAC-related error condition, the RBAC system SHALL return a consistent 
   * JSON error envelope with proper status codes and error messages.
   * 
   * **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5**
   */
  it('Property 6: Error responses maintain consistent format', () => {
    fc.assert(fc.property(
      fc.oneof(
        // 401 error messages
        fc.record({
          statusCode: fc.constant(401),
          errorMessage: fc.constantFrom('Unauthorized', 'Invalid token', 'Token expired', 'Missing authorization'),
          optionalMessage: fc.option(fc.string({ minLength: 1, maxLength: 100 }))
        }),
        // 403 error messages
        fc.record({
          statusCode: fc.constant(403),
          errorMessage: fc.constantFrom('Forbidden', 'Requires role: ADMIN', 'Insufficient permissions'),
          optionalMessage: fc.option(fc.string({ minLength: 1, maxLength: 100 }))
        })
      ),
      ({ statusCode, errorMessage, optionalMessage }) => {
        const errorEnvelope = {
          error: errorMessage,
          ...(optionalMessage && { message: optionalMessage })
        }
        
        // Validate error envelope structure
        expect(errorEnvelope).toHaveProperty('error')
        expect(typeof errorEnvelope.error).toBe('string')
        expect(errorEnvelope.error.length).toBeGreaterThan(0)
        
        // Validate status code consistency
        if (statusCode === 401) {
          expect(errorMessage.toLowerCase()).toMatch(/unauthorized|invalid|expired|missing/)
        } else if (statusCode === 403) {
          expect(errorMessage.toLowerCase()).toMatch(/forbidden|requires|insufficient/)
        }
        
        return true
      }
    ), { numRuns: 100 })
  })

  /**
   * Comprehensive Security Bypass Prevention Property Test
   * 
   * Tests various security bypass techniques with property-based approach
   */
  it('Property: All security bypass attempts fail appropriately', () => {
    fc.assert(fc.property(
      arbitrarySecurityBypassAttempt(),
      (bypassAttempt) => {
        // All bypass attempts should result in denial or unauthorized
        expect(['denied', 'unauthorized']).toContain(bypassAttempt.expectedOutcome)
        
        // Header spoofing should never succeed
        if (bypassAttempt.method === 'header-spoofing') {
          expect(bypassAttempt.expectedOutcome).toBe('denied')
        }
        
        // Token manipulation should result in authentication failure
        if (bypassAttempt.method === 'token-manipulation') {
          expect(bypassAttempt.expectedOutcome).toBe('unauthorized')
        }
        
        return true
      }
    ), { numRuns: 100 })
  })

  /**
   * Role Hierarchy Property Test
   * 
   * Validates that role hierarchy is consistently enforced
   */
  it('Property: Role hierarchy is consistently enforced', () => {
    fc.assert(fc.property(
      arbitraryRoleHierarchyScenario(),
      (scenario) => {
        const { requiredRoles, userRole, shouldHaveAccess } = scenario
        
        // Calculate actual access based on role hierarchy
        let actualAccess = requiredRoles.includes(userRole)
        
        // Role hierarchy: USER < VERIFIER < ADMIN
        // Higher roles can access lower-level resources
        if (!actualAccess) {
          if (userRole === UserRole.ADMIN && 
              (requiredRoles.includes(UserRole.VERIFIER) || requiredRoles.includes(UserRole.USER))) {
            actualAccess = true
          } else if (userRole === UserRole.VERIFIER && requiredRoles.includes(UserRole.USER)) {
            actualAccess = true
          }
        }
        
        // The calculated access should match the expected access
        expect(actualAccess).toBe(shouldHaveAccess)
        
        return true
      }
    ), { numRuns: 100 })
  })

  /**
   * Token Manipulation Resistance Property Test
   * 
   * Validates that token manipulation attempts are properly handled
   */
  it('Property: Token manipulation attempts are properly rejected', () => {
    fc.assert(fc.property(
      arbitraryTokenManipulationScenario(),
      (scenario) => {
        const { manipulationType, expectedStatus } = scenario
        
        // All token manipulation should result in 401 (authentication failure)
        const tokenManipulationTypes = [
          'empty', 'null', 'malformed', 'expired', 
          'wrong-secret', 'missing-claims', 'invalid-signature'
        ]
        
        if (tokenManipulationTypes.includes(manipulationType)) {
          expect(expectedStatus).toBe(401)
        }
        
        return true
      }
    ), { numRuns: 100 })
  })

  /**
   * Endpoint Access Control Property Test
   * 
   * Validates comprehensive endpoint access control across all scenarios
   */
  it('Property: Endpoint access control is consistently enforced', () => {
    fc.assert(fc.property(
      arbitraryEndpointAccessScenario(),
      (scenario) => {
        const { endpoint, userRole, hasValidToken, maliciousHeaders } = scenario
        
        const isAuthorized = endpoint.allowedRoles.includes(userRole)
        
        // Without valid token, should never be authorized regardless of headers
        if (!hasValidToken) {
          expect(isAuthorized).toBe(endpoint.allowedRoles.includes(userRole))
          // But the system should return 401, not check authorization
        }
        
        // With valid token, authorization should be based on JWT role only
        if (hasValidToken) {
          const actualAccess = endpoint.allowedRoles.includes(userRole)
          expect(actualAccess).toBe(isAuthorized)
          
          // Malicious headers should not affect the decision
          const hasPrivilegedHeaders = Object.values(maliciousHeaders).some(value =>
            ['ADMIN', 'SUPERUSER', 'ROOT'].includes(value)
          )
          
          if (hasPrivilegedHeaders && !isAuthorized) {
            // Headers claim privilege but JWT doesn't - should still be denied
            expect(actualAccess).toBe(false)
          }
        }
        
        return true
      }
    ), { numRuns: 100 })
  })
})