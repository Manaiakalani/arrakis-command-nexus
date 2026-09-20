'use client';

import { LogOut, UserRound } from 'lucide-react';
import { useRouter } from 'next/navigation';
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
  const router = useRouter();
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
      router.replace('/login');
      router.refresh();
    }
  };

  return (
    <div className="flex items-center gap-2" data-testid="session-menu">
      <div className="header-chip hidden sm:inline-flex" title={`${user.username} (${user.role})`}>
        <UserRound className="h-3.5 w-3.5 text-th-text-m" aria-hidden="true" />
        <span className="font-medium text-th-text">{user.username}</span>
        <span className="text-th-text-m">{user.role}</span>
      </div>
      <button
        type="button"
        onClick={signOut}
        disabled={busy}
        title="Sign out"
        aria-label="Sign out"
        className="header-chip px-2.5 text-th-text-m transition hover:text-th-text disabled:opacity-50"
      >
        <LogOut className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}
