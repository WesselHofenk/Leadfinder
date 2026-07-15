import "server-only";

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const secretPath = join(process.cwd(), ".data", "auth-secret");

export function authSecret() {
  const configured = process.env.AUTH_SECRET?.trim();
  if (configured) {
    if (configured.length < 32) throw new Error("AUTH_SECRET moet minimaal 32 tekens bevatten");
    return configured;
  }
  if (process.env.VERCEL || process.env.NODE_ENV === "production") {
    throw new Error("AUTH_SECRET ontbreekt in de productieomgeving");
  }
  if (existsSync(secretPath)) return readFileSync(secretPath, "utf8").trim();
  mkdirSync(dirname(secretPath), { recursive: true });
  const generated = randomBytes(48).toString("base64url");
  writeFileSync(secretPath, generated, { encoding: "utf8", mode: 0o600, flag: "wx" });
  return generated;
}
