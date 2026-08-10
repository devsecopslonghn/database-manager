'use client';

import { useEffect, useState } from 'react';
import { isLoggedIn, login, logout } from '../../lib/oidc';

export default function AuthButton() {
  const [authenticated, setAuthenticated] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setAuthenticated(isLoggedIn()); }, []);
  async function handleLogin() { setBusy(true); try { await login(window.location.pathname); } catch { setBusy(false); } }
  async function handleLogout() { setBusy(true); try { await logout(); } catch { setBusy(false); } }
  return authenticated
    ? <button className="button" disabled={busy} onClick={() => void handleLogout()} type="button">{busy ? 'Signing out…' : 'Sign out'}</button>
    : <button className="button primary" disabled={busy} onClick={() => void handleLogin()} type="button">{busy ? 'Redirecting…' : 'Sign in'}</button>;
}
