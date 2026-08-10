'use client';

import { useEffect, useState } from 'react';
import { completeLogin } from '../../../lib/oidc';

export default function OidcCallbackPage() {
  const [message, setMessage] = useState('Completing sign-in…');
  useEffect(() => {
    completeLogin(window.location.search)
      .then((returnTo) => { window.location.replace(returnTo); })
      .catch((error: unknown) => { setMessage(error instanceof Error ? error.message : 'OIDC_CALLBACK_FAILED'); });
  }, []);
  return <main className="shell narrow"><section className="card"><p className="eyebrow">AUTHENTICATION</p><h1>{message}</h1></section></main>;
}
