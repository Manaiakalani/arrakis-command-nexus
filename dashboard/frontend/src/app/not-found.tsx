import { Home } from 'lucide-react';
import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-dune-radial">
      <div className="text-center">
        <p className="text-8xl font-bold text-amber-500/30">404</p>
        <h1 className="mt-4 text-2xl font-semibold text-slate-100">Lost in the Deep Desert</h1>
        <p className="mt-2 text-sm text-slate-400">This page could not be found in Arrakis.</p>
        <Link href="/" className="dune-button mt-6 inline-flex items-center gap-2">
          <Home className="h-4 w-4" />
          Return to Command Nexus
        </Link>
      </div>
    </div>
  );
}
