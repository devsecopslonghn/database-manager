const issuer = process.env.NEXT_PUBLIC_OIDC_ISSUER ?? 'https://database-manager-auth.apps.drgdevlab.com/realms/database-manager';
const clientId = process.env.NEXT_PUBLIC_OIDC_CLIENT_ID ?? 'database-manager-web';
const tokenStorageKey = 'schemaops.oidc.token';
const verifierStorageKey = 'schemaops.oidc.verifier';
const stateStorageKey = 'schemaops.oidc.state';
const returnToStorageKey = 'schemaops.oidc.returnTo';

type OidcDiscovery = { authorization_endpoint: string; token_endpoint: string; end_session_endpoint?: string };
type OidcToken = { access_token: string; id_token?: string; expires_in?: number; token_type?: string };

function base64Url(value: ArrayBuffer | Uint8Array): string {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function randomValue(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

function callbackUrl(): string { return `${window.location.origin}/auth/callback`; }

async function discover(): Promise<OidcDiscovery> {
  const response = await fetch(`${issuer}/.well-known/openid-configuration`, { cache: 'no-store' });
  if (!response.ok) throw new Error('OIDC_DISCOVERY_FAILED');
  return response.json() as Promise<OidcDiscovery>;
}

export async function login(returnTo = window.location.pathname): Promise<void> {
  const discovery = await discover();
  const verifier = randomValue();
  const state = randomValue();
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const safeReturnTo = returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/';
  sessionStorage.setItem(verifierStorageKey, verifier);
  sessionStorage.setItem(stateStorageKey, state);
  sessionStorage.setItem(returnToStorageKey, safeReturnTo);
  const authorization = new URL(discovery.authorization_endpoint);
  authorization.searchParams.set('client_id', clientId);
  authorization.searchParams.set('redirect_uri', callbackUrl());
  authorization.searchParams.set('response_type', 'code');
  authorization.searchParams.set('scope', 'openid profile email');
  authorization.searchParams.set('state', state);
  authorization.searchParams.set('code_challenge', base64Url(digest));
  authorization.searchParams.set('code_challenge_method', 'S256');
  window.location.assign(authorization.toString());
}

export async function completeLogin(search: string): Promise<string> {
  const params = new URLSearchParams(search);
  const code = params.get('code');
  const state = params.get('state');
  const expectedState = sessionStorage.getItem(stateStorageKey);
  const verifier = sessionStorage.getItem(verifierStorageKey);
  if (!code || !state || !expectedState || state !== expectedState || !verifier) throw new Error('OIDC_CALLBACK_STATE_INVALID');
  const discovery = await discover();
  const response = await fetch(discovery.token_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, code, redirect_uri: callbackUrl(), code_verifier: verifier }),
  });
  if (!response.ok) throw new Error('OIDC_TOKEN_EXCHANGE_FAILED');
  const token = await response.json() as OidcToken;
  const expiresAt = Date.now() + Math.max((token.expires_in ?? 300) - 30, 30) * 1000;
  sessionStorage.setItem(tokenStorageKey, JSON.stringify({ ...token, expiresAt }));
  sessionStorage.removeItem(verifierStorageKey);
  sessionStorage.removeItem(stateStorageKey);
  const returnTo = sessionStorage.getItem(returnToStorageKey) ?? '/';
  sessionStorage.removeItem(returnToStorageKey);
  return returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/';
}

export function getAccessToken(): string | undefined {
  const raw = sessionStorage.getItem(tokenStorageKey);
  if (!raw) return undefined;
  try {
    const token = JSON.parse(raw) as OidcToken & { expiresAt?: number };
    if (!token.access_token || (token.expiresAt !== undefined && token.expiresAt <= Date.now())) {
      sessionStorage.removeItem(tokenStorageKey);
      return undefined;
    }
    return token.access_token;
  } catch {
    sessionStorage.removeItem(tokenStorageKey);
    return undefined;
  }
}

export function isLoggedIn(): boolean { return getAccessToken() !== undefined; }

export async function logout(): Promise<void> {
  const raw = sessionStorage.getItem(tokenStorageKey);
  let idToken: string | undefined;
  try { idToken = raw ? (JSON.parse(raw) as OidcToken).id_token : undefined; } catch { /* ignore malformed local state */ }
  sessionStorage.removeItem(tokenStorageKey);
  const discovery = await discover();
  if (!discovery.end_session_endpoint) { window.location.assign('/'); return; }
  const endSession = new URL(discovery.end_session_endpoint);
  endSession.searchParams.set('client_id', clientId);
  endSession.searchParams.set('post_logout_redirect_uri', `${window.location.origin}/`);
  if (idToken) endSession.searchParams.set('id_token_hint', idToken);
  window.location.assign(endSession.toString());
}
