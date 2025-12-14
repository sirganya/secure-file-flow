import { TicketAsset } from './types';

// In-memory storage for demonstration
// Note: In a real Cloudflare Worker, this Map clears on worker restart/eviction.
// For persistence, use Cloudflare KV or Durable Objects.
export const TICKET_STORE = new Map<string, TicketAsset>();
