import crypto from "crypto";

export function generateRsvpToken(bytes: number = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}
