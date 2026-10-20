import type { Trip } from '@/domain/models';
import type { TripInput } from '@/domain/trips';

export class HttpTripManagement {
  async list(): Promise<Trip[]> { const response = await fetch('/api/trips'); if (!response.ok) throw new Error(); return response.json(); }
  async create(input: TripInput): Promise<Trip> { const response = await fetch('/api/trips', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) }); if (!response.ok) throw await response.json(); return response.json(); }
  async rename(id: string, name: string): Promise<Trip> { const response = await fetch(`/api/trips/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) }); if (!response.ok) throw new Error(); return response.json(); }
  async update(id: string, update: Partial<TripInput>): Promise<Trip> { const response = await fetch(`/api/trips/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(update) }); if (!response.ok) throw new Error(); return response.json(); }
  async delete(id: string): Promise<void> { const response = await fetch(`/api/trips/${id}`, { method: 'DELETE' }); if (!response.ok) throw new Error(); }
}
