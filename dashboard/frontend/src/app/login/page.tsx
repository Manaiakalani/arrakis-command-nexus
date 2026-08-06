'use client';

import { KeyRound, Loader2, ShieldCheck, TriangleAlert } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';

const MIN_PASSWORD_LENGTH = 12;

interface AuthStatus {
  authEnabled: boolean;
  setupRequired: boolean;
  mfaRequired: boolean;
}

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json();
    return body?.error?.message || body?.detail || fallback;
  } catch {
    return fallback;
  }
}

function LoginForm() {
  const params = useSearchParams();
  const nextPath = params.get('next') || '/';

  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [totp, setTotp] = useState('');
  const [needsTotp, setNeedsTotp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    fetch('/api/v1/auth/status', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((body: AuthStatus) => {
        if (!active) return;
        setStatus(body);
        setNeedsTotp(Boolean(body.mfaRequired));
      })
      .catch(() => active && setError('Could not reach the dashboard API. Is the backend running?'));
    return () => {
      active = false;
    };
  }, []);

  const isSetup = status?.setupRequired === true;

  const submit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      setError('');

      if (isSetup) {
        if (password.length < MIN_PASSWORD_LENGTH) {
          setError(`Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.`);
          return;
        }
        if (password !== confirm) {
          setError('The two passwords do not match.');
          return;
        }
      }

      setBusy(true);
      try {
        if (isSetup) {
          const res = await fetch('/api/v1/auth/setup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: username.trim(), password }),
          });
          if (!res.ok) {
            setError(await readError(res, 'Could not create the account.'));
            return;
          }
        }

        const res = await fetch('/api/v1/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: username.trim(),
            password,
            totp: totp.trim() || undefined,
          }),
        });

        if (!res.ok) {
          if (res.headers.get('X-MFA-Required')) setNeedsTotp(true);
          setError(await readError(res, 'Sign-in failed.'));
          return;
        }

        // Full reload so server components re-render with the new session.
        window.location.assign(nextPath);
      } catch {
        setError('Could not reach the dashboard API.');
      } finally {
        setBusy(false);
      }
    },
    [confirm, isSetup, nextPath, password, totp, username],
  );

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500/10 ring-1 ring-amber-500/30">
            <ShieldCheck className="h-7 w-7 text-amber-400" aria-hidden="true" />
          </div>
          <h1 className="text-2xl font-semibold text-slate-100">Arrakis Command Nexus</h1>
          <p className="mt-2 text-sm text-slate-400">
            {isSetup ? 'Create the first administrator account to secure this dashboard.' : 'Sign in to continue.'}
          </p>
        </div>

        <form
          onSubmit={submit}
          className="space-y-5 rounded-2xl border border-slate-800 bg-slate-900/70 p-6 shadow-xl backdrop-blur"
        >
          {isSetup && (
            <div className="flex gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <p>
                This dashboard currently has no sign-in accounts, so anyone who can reach it has full control. Creating
                an account switches on authentication for everyone.
              </p>
            </div>
          )}

          <div>
            <label htmlFor="username" className="mb-1.5 block text-sm font-medium text-slate-300">
              Username
            </label>
            <input
              id="username"
              name="username"
              type="text"
              autoComplete="username"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none transition focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
            />
          </div>

          <div>
            <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-slate-300">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete={isSetup ? 'new-password' : 'current-password'}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none transition focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
            />
            {isSetup && (
              <p className="mt-1.5 text-xs text-slate-500">At least {MIN_PASSWORD_LENGTH} characters.</p>
            )}
          </div>

          {isSetup && (
            <div>
              <label htmlFor="confirm" className="mb-1.5 block text-sm font-medium text-slate-300">
                Confirm password
              </label>
              <input
                id="confirm"
                name="confirm"
                type="password"
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none transition focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
              />
            </div>
          )}

          {needsTotp && !isSetup && (
            <div>
              <label htmlFor="totp" className="mb-1.5 block text-sm font-medium text-slate-300">
                Authentication code
              </label>
              <input
                id="totp"
                name="totp"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                placeholder="000000"
                value={totp}
                onChange={(e) => setTotp(e.target.value.replace(/\D/g, ''))}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono tracking-[0.3em] text-slate-100 outline-none transition focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
              />
              <p className="mt-1.5 text-xs text-slate-500">From your authenticator app.</p>
            </div>
          )}

          {error && (
            <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={busy || status === null}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-amber-500 px-4 py-2.5 font-medium text-slate-950 transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <KeyRound className="h-4 w-4" aria-hidden="true" />
            )}
            {isSetup ? 'Create account and sign in' : 'Sign in'}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-slate-600">
          Locked out? Remove the account rows from <code className="text-slate-500">admin_users</code> in the dashboard
          database to return to shared-token access.
        </p>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-slate-950" />}>
      <LoginForm />
    </Suspense>
  );
}
