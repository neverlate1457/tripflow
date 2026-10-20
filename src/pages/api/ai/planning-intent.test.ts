import { describe,expect,it } from 'vitest';
import { POST } from './planning-intent';
describe('planning intent API',()=>{it('rejects oversized and malformed requests without mutation',async()=>{const response=await POST({request:new Request('http://localhost/api/ai/planning-intent',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({tripId:'x',selectedDate:'2026-01-01',message:'x'.repeat(501)})})} as never);expect(response.status).toBe(400);expect(await response.json()).toEqual({error:'Invalid AI planning request'})})});
