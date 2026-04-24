import { z } from 'zod'
import { UserRole } from '../types/user.js'

export const registerSchema = z.object({
    email: z.string().email(),
    password: z.string().min(8),
    role: z.nativeEnum(UserRole).optional(),
})

export const loginSchema = z.object({
    email: z.string().email(),
    password: z.string(),
})

export const refreshSchema = z.object({
    refreshToken: z.string(),
})

export type RegisterInput = z.infer<typeof registerSchema>
export type LoginInput = z.infer<typeof loginSchema>
export type RefreshInput = z.infer<typeof refreshSchema>

/**
 * Security utility to prevent prototype pollution and other malicious query patterns
 */

const DANGEROUS_KEYS = ['__proto__', 'constructor', 'prototype']

/**
 * Recursively removes dangerous keys from an object to prevent prototype pollution.
 * 
 * @param obj - The object to sanitize
 * @returns A deep copy of the object with dangerous keys removed
 */
export function sanitizeObject<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj
  }

  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeObject(item)) as unknown as T
  }

  const result: any = {}
  
  for (const [key, value] of Object.entries(obj)) {
    if (DANGEROUS_KEYS.includes(key)) {
      continue
    }

    result[key] = sanitizeObject(value)
  }

  return result as T
}

/**
 * Validates that a field is in the allowlist and doesn't contain nested object paths
 * if they are not explicitly allowed.
 */
export function isValidField(field: string, allowlist: string[]): boolean {
  if (!field || typeof field !== 'string') return false
  
  // Prevent any attempt at nested property access via dot notation if not explicitly in allowlist
  if (field.includes('.') || field.includes('[') || field.includes(']')) {
    return allowlist.includes(field)
  }
  
  return allowlist.includes(field)
}
