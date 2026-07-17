// @vitest-environment node
//
// F7: the verify route interpolated `phone` into an `exec()` shell string with
// only a truthiness check (unlike the sibling register route, which validates
// E.164 and uses execFile). A phone carrying shell metacharacters must be
// rejected at the boundary — before any docker subprocess is reached.
import { describe, it, expect } from 'vitest'
import { POST } from '../route'

function post(body: unknown): Request {
  return new Request('http://localhost/api/surfaces/signal/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('signal verify route — phone validation (F7)', () => {
  it('rejects a phone containing shell metacharacters with 400', async () => {
    const res = await POST(post({ phone: '+1; touch /tmp/pwned #', code: '123456' }))
    expect(res.status).toBe(400)
  })

  it('rejects a non-E.164 phone with 400', async () => {
    const res = await POST(post({ phone: 'not-a-number', code: '123456' }))
    expect(res.status).toBe(400)
  })
})
