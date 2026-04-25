import { initEnv } from './config/index.js'

// Validate environment variables before any other initialisation.
// This ensures the process exits immediately on misconfiguration.
initEnv()

import { app } from './app.js'
import { errorHandler } from './middleware/errorHandler.js'
import { notFound } from './middleware/notFound.js'
import { vaultsRouter } from './routes/vaults.js'
import { createHealthRouter } from './routes/health.js'
import { createJobsRouter } from './routes/jobs.js'
import { BackgroundJobSystem } from './jobs/system.js'
import { authRouter } from './routes/auth.js'
import { analyticsRouter } from './routes/analytics.js'
import { healthRateLimiter, vaultsRateLimiter } from './middleware/rateLimiter.js'
import { createExportRouter } from './routes/exports.js'
import { transactionsRouter } from './routes/transactions.js'
import { privacyRouter } from './routes/privacy.js'
import { milestonesRouter } from './routes/milestones.js'
import { startExpirationChecker } from './services/expirationScheduler.js'
import { orgVaultsRouter } from './routes/orgVaults.js'
import { orgAnalyticsRouter } from './routes/orgAnalytics.js'
import { orgMembersRouter } from './routes/orgMembers.js'
import { adminRouter } from './routes/admin.js'
import { adminVerifiersRouter } from './routes/adminVerifiers.js'
import { verificationsRouter } from './routes/verifications.js'
import { apiKeysRouter } from './routes/apiKeys.js'
import { notificationsRouter } from './routes/notifications.js'
import {
  securityMetricsMiddleware,
  securityRateLimitMiddleware,
} from './security/abuse-monitor.js'
import { initializeDatabase } from './db/database.js'
import { etlWorker } from './services/etlWorker.js'
import { mountVersionedRoute } from './middleware/versioning.js'

const PORT = process.env.PORT ?? 3000
const jobSystem = new BackgroundJobSystem()

jobSystem.start()

// Initialize SQLite database for analytics
initializeDatabase()

app.use(securityMetricsMiddleware)
app.use(securityRateLimitMiddleware)

mountVersionedRoute(app, '/api/health', '/api/v1/health', healthRateLimiter, createHealthRouter(jobSystem))
mountVersionedRoute(app, '/api/jobs', '/api/v1/jobs', createJobsRouter(jobSystem))
mountVersionedRoute(app, '/api/vaults', '/api/v1/vaults', vaultsRateLimiter, vaultsRouter)
mountVersionedRoute(app, '/api/vaults/:vaultId/milestones', '/api/v1/vaults/:vaultId/milestones', milestonesRouter)
mountVersionedRoute(app, '/api/auth', '/api/v1/auth', authRouter)
mountVersionedRoute(app, '/api/exports', '/api/v1/exports', createExportRouter([]))
mountVersionedRoute(app, '/api/transactions', '/api/v1/transactions', transactionsRouter)
mountVersionedRoute(app, '/api/analytics', '/api/v1/analytics', analyticsRouter)
mountVersionedRoute(app, '/api/privacy', '/api/v1/privacy', privacyRouter)
mountVersionedRoute(app, '/api/organizations', '/api/v1/organizations', orgVaultsRouter)
mountVersionedRoute(app, '/api/organizations', '/api/v1/organizations', orgAnalyticsRouter)
mountVersionedRoute(app, '/api/organizations', '/api/v1/organizations', orgMembersRouter)
mountVersionedRoute(app, '/api/admin', '/api/v1/admin', adminRouter)
mountVersionedRoute(app, '/api/admin/verifiers', '/api/v1/admin/verifiers', adminVerifiersRouter)
mountVersionedRoute(app, '/api/verifications', '/api/v1/verifications', verificationsRouter)
mountVersionedRoute(app, '/api/api-keys', '/api/v1/api-keys', apiKeysRouter)
mountVersionedRoute(app, '/api/notifications', '/api/v1/notifications', notificationsRouter)

// Catch-all 404 and uniform error shape – must be registered after all routes.
app.use(notFound)
app.use(errorHandler)

const ETL_INTERVAL_MINUTES = parseInt(process.env.ETL_INTERVAL_MINUTES ?? '5', 10)

const server = app.listen(PORT, () => {
  console.log(`Disciplr API listening on http://localhost:${PORT}`)
  startExpirationChecker()
  if (process.env.ENABLE_ETL_WORKER !== 'false') {
    etlWorker.start(ETL_INTERVAL_MINUTES)
  }
})

let shuttingDown = false

const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
  if (shuttingDown) {
    return
  }

  shuttingDown = true
  console.log(`Received ${signal}. Shutting down gracefully...`)

  try {
    await etlWorker.stop()
    await jobSystem.stop()
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }
        resolve()
      })
    })
    process.exit(0)
  } catch (error) {
    console.error('Failed during shutdown:', error)
    process.exit(1)
  }
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void shutdown(signal)
  })
}
