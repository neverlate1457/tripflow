import { describe, expect, it } from 'vitest';
import { POST } from './index';
describe('routing API validation', () => {
  it('rejects malformed input without exposing internals', async () => { const response=await POST({request:new Request('http://localhost/api/routes',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({mode:'teleport'})})} as never); expect(response.status).toBe(400); expect(await response.json()).toEqual({error:'Invalid routing request'}); });
});
