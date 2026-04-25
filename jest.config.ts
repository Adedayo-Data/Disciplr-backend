// jest.config.ts
import { createDefaultEsmPreset, type JestConfigWithTsJest } from 'ts-jest'

const defaultEsmPreset = createDefaultEsmPreset({
  tsconfig: 'tsconfig.jest.json',
})

const config: JestConfigWithTsJest = {
  ...defaultEsmPreset,
  testEnvironment: 'node',
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  // Ensure we are testing the right files
  testMatch: ['**/tests/**/*.test.ts'],
  clearMocks: true,
}

export default config