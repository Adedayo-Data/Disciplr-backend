import { Router } from 'express'
import { BackgroundJobSystem } from '../jobs/system.js'
import { healthService } from '../services/healthService.js'
import { getSecurityMetricsSnapshot } from '../security/abuse-monitor.js'

export const createHealthRouter = (jobSystem: BackgroundJobSystem) => {
  const router = Router()

  router.get('/', async (req, res) => {
    const isDeep = req.query.deep === '1'

    const healthData: any = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      jobs: jobSystem.getMetrics(),
    }

    if (!isDeep) {
      res.status(200).json(healthData)
      return
    }

    const [database, horizon] = await Promise.all([
      healthService.checkDatabase(),
      healthService.checkHorizon(),
    ])

    healthData.details = { database, horizon }

    if (database.status === 'down' || horizon.status === 'down') {
      healthData.status = 'error'
      res.status(503).json(healthData)
      return
    }

    res.status(200).json(healthData)
  })

  router.get('/security', (_req, res) => {
    res.status(200).json(getSecurityMetricsSnapshot())
  })

  return router
}
