import { initEnv } from './config/index.js'

// Validate environment variables before any other initialisation.
// This ensures the process exits immediately on misconfiguration.
initEnv()

import { app } from './app.js'
import { bootstrapApp } from './app-bootstrap.js'
import { startExpirationChecker } from './services/expirationScheduler.js'
import { initializeDatabase } from './db/database.js'
import { etlWorker } from './services/etlWorker.js'

const PORT = process.env.PORT ?? 3000

// Initialize SQLite database for analytics
initializeDatabase()

const { jobSystem } = bootstrapApp()

jobSystem.start()

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
