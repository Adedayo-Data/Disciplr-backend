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

export interface ValidationErrorField {
  path: string
  message: string
  code: string
}

export const formatIssuePath = (path: ReadonlyArray<PropertyKey>): string =>
  path
    .filter((seg): seg is string | number => typeof seg === 'string' || typeof seg === 'number')
    .reduce<string>((acc, seg, i) => {
      if (typeof seg === 'number') return `${acc}[${seg}]`
      return i === 0 ? seg : `${acc}.${seg}`
    }, '')

export const flattenZodErrors = (error: z.ZodError): ValidationErrorField[] =>
  error.issues.map((issue) => ({
    path: formatIssuePath(issue.path) || 'root',
    message: issue.message,
    code: issue.code,
  }))

export const buildValidationError = (fields: ValidationErrorField[]) => ({
  error: {
    code: 'VALIDATION_ERROR',
    message: 'Invalid request payload',
    fields,
  },
})

export const formatValidationError = (error: z.ZodError) => buildValidationError(flattenZodErrors(error))
