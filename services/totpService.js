import crypto from "crypto";

// Minimal RFC 4226/6238 TOTP (SHA-1, 6 digits, 30s step) — enough for
// authenticator-app 2FA without adding a dependency.

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function generateTotpSecret() {
  const bytes = crypto.randomBytes(20);
  let secret = "";
  let bits = 0;
  let value = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      secret += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) secret += BASE32[(value << (5 - bits)) & 31];
  return secret;
}

function base32Decode(secret) {
  const clean = String(secret || "").replace(/[\s-]/g, "").toUpperCase();
  const bytes = [];
  let bits = 0;
  let value = 0;
  for (const char of clean) {
    const idx = BASE32.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function totpCode(secret, forTime = Date.now(), stepSeconds = 30) {
  const counter = Math.floor(forTime / 1000 / stepSeconds);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigInt64BE(BigInt(counter));
  const digest = crypto
    .createHmac("sha1", base32Decode(secret))
    .update(counterBuffer)
    .digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(binary % 1000000).padStart(6, "0");
}

// Accept the current step plus one either side for clock drift.
export function verifyTotp(secret, code) {
  const candidate = String(code || "").replace(/\D/g, "");
  if (candidate.length !== 6 || !secret) return false;
  const now = Date.now();
  for (const drift of [-30000, 0, 30000]) {
    if (totpCode(secret, now + drift) === candidate) return true;
  }
  return false;
}

export function otpauthUrl(secret, accountEmail) {
  const issuer = "TronMarket";
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(accountEmail)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&digits=6&period=30`;
}
