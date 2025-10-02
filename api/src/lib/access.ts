import { HTTPException } from 'hono/http-exception';
import type { AuthenticatedUser, MarbleBindings } from '../types';

interface JwtParts {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  signature: Uint8Array;
  signingInput: Uint8Array;
  kid: string;
  alg: string;
}

interface AccessJwk {
  kid: string;
  kty: string;
  alg: string;
  n: string;
  e: string;
}

const jwkCache: Map<string, { keys: Map<string, CryptoKey>; fetchedAt: number }> = new Map();

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function base64UrlDecode(segment: string): Uint8Array {
  const normalized = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function parseJwt(token: string): JwtParts {
  const [headerSegment, payloadSegment, signatureSegment] = token.split('.');
  if (!headerSegment || !payloadSegment || !signatureSegment) {
    throw new HTTPException(401, { message: 'Malformed Access token' });
  }

  const headerJson = textDecoder.decode(base64UrlDecode(headerSegment));
  const payloadJson = textDecoder.decode(base64UrlDecode(payloadSegment));
  const header = JSON.parse(headerJson) as Record<string, unknown>;
  const payload = JSON.parse(payloadJson) as Record<string, unknown>;

  const alg = typeof header.alg === 'string' ? header.alg : undefined;
  const kid = typeof header.kid === 'string' ? header.kid : undefined;
  if (!alg || !kid) {
    throw new HTTPException(401, { message: 'Missing Access token header metadata' });
  }

  const signingInput = textEncoder.encode(`${headerSegment}.${payloadSegment}`);
  const signature = base64UrlDecode(signatureSegment);

  return {
    header,
    payload,
    signature,
    signingInput,
    kid,
    alg,
  };
}

async function importKey(jwk: AccessJwk): Promise<CryptoKey> {
  const jwkKey: JsonWebKey = {
    kty: jwk.kty,
    n: jwk.n,
    e: jwk.e,
    alg: jwk.alg,
    ext: true,
  };

  return crypto.subtle.importKey(
    'jwk',
    jwkKey,
    {
      name: 'RSASSA-PKCS1-v1_5',
      hash: { name: 'SHA-256' },
    },
    false,
    ['verify'],
  );
}

async function getSigningKey(env: MarbleBindings, kid: string): Promise<CryptoKey> {
  const domain = env.CF_ACCESS_TEAM_DOMAIN;
  if (!domain) {
    throw new HTTPException(401, { message: 'Server missing Access team domain configuration' });
  }
  const now = Date.now();
  const cached = jwkCache.get(domain);
  if (cached && now - cached.fetchedAt < 10 * 60 * 1000) {
    const key = cached.keys.get(kid);
    if (key) {
      return key;
    }
  }

  const response = await fetch(`https://${domain}/cdn-cgi/access/certs`);
  if (!response.ok) {
    throw new HTTPException(401, { message: 'Unable to fetch Access signing keys' });
  }

  const { keys } = (await response.json()) as { keys: AccessJwk[] };
  const keyMap = new Map<string, CryptoKey>();
  await Promise.all(
    keys.map(async (key) => {
      const cryptoKey = await importKey(key);
      keyMap.set(key.kid, cryptoKey);
    }),
  );
  jwkCache.set(domain, { keys: keyMap, fetchedAt: now });

  const signingKey = keyMap.get(kid);
  if (!signingKey) {
    throw new HTTPException(401, { message: 'Access signing key not found' });
  }

  return signingKey;
}

function ensureAudience(payload: Record<string, unknown>, aud: string) {
  const value = payload.aud;
  if (typeof value === 'string') {
    if (value !== aud) {
      throw new HTTPException(401, { message: 'Access token audience mismatch' });
    }
    return;
  }
  if (Array.isArray(value) && value.includes(aud)) {
    return;
  }
  throw new HTTPException(401, { message: 'Access token audience mismatch' });
}

function resolveTenant(payload: Record<string, unknown>, env: MarbleBindings): string {
  const explicit = typeof payload.tenant === 'string' ? payload.tenant : undefined;
  if (explicit) {
    return explicit;
  }

  const orgClaim = typeof payload.org === 'string' ? payload.org : undefined;
  if (orgClaim) {
    return orgClaim;
  }

  return env.DEFAULT_TENANT ?? 'default';
}

function toAuthenticatedUser(payload: Record<string, unknown>, env: MarbleBindings): AuthenticatedUser {
  const id = typeof payload.sub === 'string' ? payload.sub : undefined;
  const email = typeof payload.email === 'string' ? payload.email : undefined;
  const displayName = typeof payload.name === 'string' ? payload.name : null;
  const avatarUrl = typeof payload.picture === 'string' ? payload.picture : null;

  if (!id || !email) {
    throw new HTTPException(401, { message: 'Access token missing user claims' });
  }

  return {
    id,
    email,
    displayName,
    avatarUrl,
    tenant: resolveTenant(payload, env),
  };
}

/**
 * authenticateRequest
 *
 * - If the worker secret SKIP_ACCESS_CHECK is set to "true", this function
 *   returns a deterministic DEV user (useful for local development).
 * - Otherwise it runs the original Access JWT verification flow unchanged.
 *
 * Note: this file preserves all original helper functions above.
 */
export async function authenticateRequest(request: Request, env: MarbleBindings): Promise<AuthenticatedUser> {
  // Toggle bypass: set SKIP_ACCESS_CHECK secret to "true" to skip Access validation.
  // Example:
  //   npx -y wrangler@4 secret put SKIP_ACCESS_CHECK
  //   # paste: true
  if (env.SKIP_ACCESS_CHECK === 'true') {
    // Return a stable dev user used by the rest of the application.
    return {
      id: 'dev-user',
      email: 'dev@local',
      displayName: 'Dev User',
      avatarUrl: null,
      tenant: env.DEFAULT_TENANT ?? 'default',
    };
  }

  // --- Original verification logic (unchanged) ---
  const token = request.headers.get('cf-access-jwt-assertion');
  if (!token) {
    throw new HTTPException(401, { message: 'Missing Access token' });
  }

  const { payload, signature, signingInput, kid } = parseJwt(token);
  if (!env.CF_ACCESS_AUD) {
    throw new HTTPException(401, { message: 'Server missing Access audience configuration' });
  }
  ensureAudience(payload, env.CF_ACCESS_AUD);

  const key = await getSigningKey(env, kid);
  const signatureView = new Uint8Array(signature);
  const signingView = new Uint8Array(signingInput);
  const verified = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signatureView, signingView);
  if (!verified) {
    throw new HTTPException(401, { message: 'Invalid Access token signature' });
  }

  return toAuthenticatedUser(payload, env);
}
