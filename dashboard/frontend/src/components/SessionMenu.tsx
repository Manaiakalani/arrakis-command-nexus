'use client';

import { LogOut, UserRound } from 'lucide-react';
import { useEffect, useState } from 'react';

interface SessionUser {
  username: string;
  role: string;
  mfaEnabled: boolean;
}

/**
 * Shows who is signed in and offers a way out. Renders nothing when the
 * deployment is still in legacy shared-token mode, so upgrading installs see
 * no change until they create an account.
 */
export function SessionMenu() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    fetch('/api/v1/auth/me', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (!active || !body || body.method !== 'session') return;
        setUser(body.user as SessionUser);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  if (!user) return null;

  const signOut = async () => {
    setBusy(true);
    try {
      await fetch('/api/v1/auth/logout', { method: 'POST' });
    } catch {
      // Even if the call fails the cookie is likely gone; send them onward.
    } finally {
      window.location.assign('/login');
    }
  };

  return (
    <div className="flex items-center gap-2">
      <div className="glass-panel hidden items-center gap-2 px-3 py-2 sm:flex">
        <UserRound className="h-4 w-4 text-th-text-m" aria-hidden="true" />
        <div className="leading-tight">
          <p className="text-sm font-medium text-th-text">{user.username}</p>
          <p className="text-xs uppercase tracking-wider text-th-text-m">{user.role}</p>
        </div>
      </div>
      <button
        type="button"
        onClick={signOut}
        disabled={busy}
        title="Sign out"
        aria-label="Sign out"
        className="glass-panel flex items-center justify-center px-3 py-2 text-th-text-m transition hover:text-th-text disabled:opacity-50"
      >
        <LogOut className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}
