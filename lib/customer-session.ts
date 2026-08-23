import { createHmac, timingSafeEqual } from "node:crypto";

const COOKIE_VERSION = "v1";

function sessionSecret() {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") throw new Error("CRON_SECRET is required for customer session signing");
    return "pursuit-dev-session-secret";
  }
  return secret;
}

function signature(value: string) {
  return createHmac("sha256", sessionSecret()).update(`${COOKIE_VERSION}.${value}`).digest("base64url");
}

export function encodeCustomerSession(organizationId: string) {
  return `${COOKIE_VERSION}.${organizationId}.${signature(organizationId)}`;
}

export function decodeCustomerSession(cookieValue: string | undefined) {
  if (!cookieValue) return null;
  const [version, organizationId, suppliedSignature, ...extra] = cookieValue.split(".");
  if (version !== COOKIE_VERSION || !organizationId || !suppliedSignature || extra.length > 0) return null;

  const expected = Buffer.from(signature(organizationId));
  const supplied = Buffer.from(suppliedSignature);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
  return organizationId;
}
