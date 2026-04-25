import { Router, Request, Response, NextFunction } from 'express'
import { authenticate } from '../middleware/auth.js'
import {
  listUserNotifications,
  markAsRead,
  markAllAsRead,
} from '../services/notification.js'
import { AppError } from '../middleware/errorHandler.js'

export const notificationsRouter = Router()

// All notifications routes require authentication
notificationsRouter.use(authenticate)

// GET /api/notifications - List current user's notifications
notificationsRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  if (!req.user) {
    return next(AppError.unauthorized('Unauthenticated'))
  }
  const notifications = await listUserNotifications(req.user.userId)
  res.json(notifications)
})

// PATCH /api/notifications/:id/read - Mark a notification as read
notificationsRouter.patch('/:id/read', async (req: Request, res: Response, next: NextFunction) => {
  if (!req.user) {
    return next(AppError.unauthorized('Unauthenticated'))
  }
  const { id } = req.params
  const notification = await markAsRead(id, req.user.userId)
  
  if (!notification) {
    return next(AppError.notFound('Notification not found'))
  }
  
  res.json(notification)
})

// POST /api/notifications/read-all - Mark all as read
notificationsRouter.post('/read-all', async (req: Request, res: Response, next: NextFunction) => {
  if (!req.user) {
    return next(AppError.unauthorized('Unauthenticated'))
  }
  const count = await markAllAsRead(req.user.userId)
  res.json({ message: `Marked ${count} notifications as read` })
})
