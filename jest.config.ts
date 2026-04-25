import type { Config } from 'jest'

const config: Config = {
     testEnvironment: 'node',
     extensionsToTreatAsEsm: ['.ts'],
     moduleNameMapper: {
          '^(\\.{1,2}/.*)\\.js$': '$1',
     },
     transform: {
        '^.+\\.ts$': ['<rootDir>/node_modules/ts-jest', { 
            useESM: true, 
            tsconfig: {
                module: 'NodeNext',
                moduleResolution: 'NodeNext',
                target: 'ES2022'
            },
            diagnostics: { ignoreCodes: [151002] } 
        }],
     },
     testMatch: ['**/tests/**/*.test.ts'],
     clearMocks: true,
     collectCoverageFrom: [
          'src/middleware/errorHandler.ts',
          'src/middleware/notFound.ts',
     ],
     coverageThreshold: {
          global: {
               branches: 95,
               functions: 95,
               lines: 95,
               statements: 95,
          },
     },
}

export default config