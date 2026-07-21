'use client';

import { useEffect, useRef } from 'react';

/**
 * Prevents accidental navigation away from a page with unsaved changes.
 * Handles both browser navigation (beforeunload) and client-side SPA navigation
 * (click interception on anchor elements).
 */
export function useNavigationGuard(dirty: boolean, message?: string) {
  const msgRef = useRef(message ?? 'You have unsaved changes. Are you sure you want to leave?');
  msgRef.current = message ?? 'You have unsaved changes. Are you sure you want to leave?';
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const historyPushed = useRef(false);

  // Browser navigation (refresh, close tab, URL bar)
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  // Client-side SPA navigation (Next.js Link clicks)
  useEffect(() => {
    if (!dirty) return;

    const handler = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement).closest('a[href]');
      if (!anchor) return;

      const href = anchor.getAttribute('href');
      // Only intercept internal relative paths
      if (!href || href.startsWith('#') || href.startsWith('http') || href.startsWith('mailto:') || href.startsWith('tel:')) return;

      if (!dirtyRef.current) return;

      const confirmed = window.confirm(msgRef.current);
      if (!confirmed) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    document.addEventListener('click', handler, { capture: true });
    return () => document.removeEventListener('click', handler, { capture: true });
  }, [dirty]);

  // Intercept browser back/forward (popstate)
  useEffect(() => {
    if (!dirty) {
      // Clean up sentinel when no longer dirty
      if (historyPushed.current) {
        window.history.back();
        historyPushed.current = false;
      }
      return;
    }

    // Push a single sentinel state (only once) to detect back navigation
    if (!historyPushed.current) {
      window.history.pushState({ __navGuard: true }, '', window.location.href);
      historyPushed.current = true;
    }

    const handler = () => {
      if (!dirtyRef.current) return;

      const confirmed = window.confirm(msgRef.current);
      if (!confirmed) {
        // Re-push to stay on page
        window.history.pushState({ __navGuard: true }, '', window.location.href);
      } else {
        // Complete the navigation the user intended
        historyPushed.current = false;
        window.history.back();
      }
    };

    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, [dirty]);
}
