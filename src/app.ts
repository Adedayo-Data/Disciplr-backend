import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { vaultsRouter } from './routes/vaults.js';
import { healthRouter } from './routes/health.js';

export const app = express();

app.use(helmet());

// 2. CORS: Origin validation
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'];

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
};

app.use(cors(corsOptions));
app.use(express.json());

// Routes
app.use('/api/health', healthRouter);
app.use('/api/vaults', vaultsRouter);