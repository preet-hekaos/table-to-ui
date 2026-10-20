import { createHmac } from 'node:crypto'

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

function base32Decode(input: string): Buffer {
  let bits = ''
  for (const ch of input.replace(/=+$/, '').toUpperCase()) {
    const v = ALPHABET.indexOf(ch)
    if (v < 0) throw new Error('bad base32')
    bits += v.toString(2).padStart(5, '0')
  }
  const bytes: number[] = []
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2))
  return Buffer.from(bytes)
}

/** RFC 6238 TOTP (SHA-1, 30 s, 6 digits), enough to act as the user's authenticator app in tests. */
export function totp(secret: string, at = Date.now()): string {
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)))
  const h = createHmac('sha1', base32Decode(secret)).update(counter).digest()
  const o = h[h.length - 1]! & 0xf
  const code = ((h[o]! & 0x7f) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!
  return String(code % 1_000_000).padStart(6, '0')
}
