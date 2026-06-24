// Server-side only — do not import from client components.

const INTERNAL_API = process.env.INTERNAL_API_URL ?? 'http://dashboard-api:8080/api/v1';
const TOKEN = process.env.DUNE_ADMIN_TOKEN ?? '';

export async function serverFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${INTERNAL_API}${path}`, {
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
    },
    cache: 'no-store',
  });

  if (!res.ok) {
    throw new Error(`Server fetch failed: ${res.status} ${res.statusText}`);
  }

  return res.json() as Promise<T>;
}
