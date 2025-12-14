import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Bindings } from './types';
import { mintTicket, claimTicket } from './routes/api';

const app = new Hono<{ Bindings: Bindings }>();

// Enable CORS for development (allowing Vite frontend to connect)
app.use('/api/*', cors({
  origin: '*', // In production, restrict this to your domain
  allowMethods: ['POST', 'GET', 'OPTIONS'],
  allowHeaders: ['Content-Type'],
}));

// API Routes
app.post('/api/mint', mintTicket);
app.post('/api/claim', claimTicket);

export default app;
