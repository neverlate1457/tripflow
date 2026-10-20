import { describe,expect,it } from 'vitest';
import { POST } from './estimate';
describe('hypothetical routing API validation',()=>{it('rejects arbitrary coordinates and malformed endpoint references',async()=>{const response=await POST({request:new Request('http://localhost/api/routes/estimate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({tripId:'x',from:{latitude:1,longitude:2},to:{type:'candidate',id:'c'},mode:'driving'})})} as never);expect(response.status).toBe(400);expect(await response.json()).toEqual({error:'Invalid route estimate request'})})});
