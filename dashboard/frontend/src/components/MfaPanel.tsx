'use client';

import { KeyRound, ShieldCheck } from 'lucide-react';
import { useCallback, useState } from 'react';
import useSWR from 'swr';

import { useToast } from '@/components/ToastProvider';
import { apiClient } from '@/lib/api';

interface MeResponse {
  method: 'session' | 'token';
  user: { username: string; role: string; mfaEnabled: boolean };
}

/**
 * Per-account MFA enrolment. Only rendered for a signed-in session — a
 * deployment still using the shared token has no account to enrol.
 */
async function fetchMe(): Promise<MeResponse | null> {
  const res = await fetch('/api/v1/auth/me', { cache: 'no-store' });
  if (!res.ok) return null;
  const body = (await res.json()) as MeResponse;
  return body.method === 'session' ? body : null;
}

export function MfaPanel() {
  const { toast } = useToast();
  const { data: me, mutate: refreshMe } = useSWR('auth/me', fetchMe, { revalidateOnFocus: false });
  const refresh = useCallback(async () => {
    await refreshMe();
  }, [refreshMe]);
  const [secret, setSecret] = useState('');
  const [otpauth, setOtpauth] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  if (!me) return null;

  const enroll = async () => {
    setBusy(true);
    try {
      const res = await apiClient.enrollMfa();
      setSecret(res.secret);
      setOtpauth(res.otpauthUrl);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not start MFA enrolment.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const activate = async () => {
    setBusy(true);
    try {
      await apiClient.activateMfa(code.trim());
      setSecret('');
      setOtpauth('');
      setCode('');
      await refresh();
      toast('Multi-factor authentication is now active on your account.', 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'That code did not match.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    try {
      await apiClient.disableMfa();
      await refresh();
      toast('Multi-factor authentication disabled.', 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not disable MFA.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-6 border-t border-th-border-m/80 pt-5">
      <div className="mb-3 flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-th-text-m" aria-hidden="true" />
        <h4 className="text-sm font-semibold text-th-text">
          Your account &middot; <span className="text-th-text-m">{me.user.username}</span>
        </h4>
      </div>

      {me.user.mfaEnabled ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
            MFA active
          </span>
          <button type="button" className="dune-button-muted text-xs" onClick={() => void disable()} disabled={busy}>
            Disable MFA
          </button>
        </div>
      ) : secret ? (
        <div className="space-y-3">
          <p className="text-sm text-th-text-m">
            Add this secret to your authenticator app, then enter the six-digit code it shows.
          </p>
          <code className="block break-all rounded-lg border border-th-border-m bg-th-surface px-3 py-2 font-mono text-xs text-th-text">
            {secret}
          </code>
          <a href={otpauth} className="block truncate text-xs text-amber-600 hover:underline dark:text-amber-400">
            Open in authenticator app
          </a>
          <div className="flex items-end gap-2">
            <div>
              <label htmlFor="mfaCode" className="block text-sm font-medium text-th-text-s">
                Verification code
              </label>
              <input
                id="mfaCode"
                inputMode="numeric"
                maxLength={6}
                placeholder="000000"
                className="dune-input mt-1 w-32 font-mono tracking-widest"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              />
            </div>
            <button
              type="button"
              className="dune-button"
              onClick={() => void activate()}
              disabled={busy || code.length !== 6}
            >
              Activate
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-th-text-m">
            Protect your sign-in with a time-based one-time code.
          </p>
          <button type="button" className="dune-button-muted text-xs" onClick={() => void enroll()} disabled={busy}>
            <KeyRound className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            Set up MFA
          </button>
        </div>
      )}
    </div>
  );
}
