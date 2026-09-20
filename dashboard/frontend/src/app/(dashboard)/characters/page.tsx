'use client';

import {
  AlertTriangle,
  Backpack,
  BookOpen,
  Check,
  Coins,
  Droplets,
  Flame,
  Heart,
  Loader2,
  MapPin,
  Package,
  Pickaxe,
  RefreshCcw,
  Save,
  Search,
  Server,
  Shield,
  Swords,
  UserCog,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';

import { ConfirmDialog } from '@/components/ConfirmDialog';
import { GrantCatalog } from '@/components/GrantCatalog';
import { useApiSWR } from '@/hooks/useApiSWR';
import { useToast } from '@/components/ToastProvider';
import { apiClient } from '@/lib/api';
import type { CharacterRecord, CharacterStatField, CharacterStatsSchema } from '@/lib/types';
import { cn } from '@/lib/utils';

type SaveState = {
  tone: 'success' | 'error';
  message: string;
} | null;

type GrantResult = {
  tone: 'success' | 'error' | 'staged';
  title: string;
  message: string;
  relogRequired?: boolean;
  online?: boolean;
};

type CategoryKey = 'stats' | 'spice' | 'economy' | 'specialization';

const categoryMeta: Record<CategoryKey, { label: string; icon: typeof Droplets; description: string }> = {
  stats: {
    label: 'Vitals',
    icon: Droplets,
    description: 'Health, hydration, and survival stats.',
  },
  spice: {
    label: 'Spice',
    icon: Flame,
    description: 'Spice levels, addiction, tolerance, and Eyes of Ibad.',
  },
  economy: {
    label: 'Economy',
    icon: Coins,
    description: 'Solari currency and wallet balances.',
  },
  specialization: {
    label: 'Specialization',
    icon: Pickaxe,
    description: 'Tech knowledge and specialization points.',
  },
};

const initialSchema: CharacterStatsSchema = {
  stats: [],
  summary: {
    mutationsEnabled: false,
    editableStats: 0,
    categories: ['stats', 'spice', 'economy', 'specialization'],
  },
};

function buildDraft(character: CharacterRecord | null, fields: CharacterStatField[]) {
  const keys = fields.length > 0 ? fields.map((field) => field.key) : Object.keys(character?.stats ?? {});
  return keys.reduce<Record<string, string>>((acc, key) => {
    const value = character?.stats?.[key];
    acc[key] = value === null || value === undefined ? '' : String(value);
    return acc;
  }, {});
}

function normalizeUpdates(fields: CharacterStatField[], draft: Record<string, string>) {
  return fields.reduce<Record<string, number | string | boolean>>((acc, field) => {
    const raw = draft[field.key];
    if (raw === undefined || raw.trim() === '') {
      return acc;
    }
    if (field.type === 'number') {
      const parsed = Number(raw);
      if (!Number.isNaN(parsed)) {
        acc[field.key] = parsed;
      }
      return acc;
    }
    acc[field.key] = raw;
    return acc;
  }, {});
}

export default function CharactersPage() {
  const { toast } = useToast();
  const characters = useApiSWR('api/characters', () => apiClient.getCharacters(), { refreshInterval: 30000, initialData: [] });
  const schema = useApiSWR('api/characters/stats-schema', () => apiClient.getCharacterStatsSchema(), { initialData: initialSchema });
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedCharacter, setSelectedCharacter] = useState<CharacterRecord | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [activeCategory, setActiveCategory] = useState<CategoryKey>('stats');
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [characterError, setCharacterError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>(null);
  const [saving, setSaving] = useState(false);
  const [grantTemplate, setGrantTemplate] = useState('');
  const [grantAmount, setGrantAmount] = useState('1');
  const [grantSearch, setGrantSearch] = useState('');
  const [grantResult, setGrantResult] = useState<GrantResult | null>(null);
  const [granting, setGranting] = useState(false);
  const [grantingLabel, setGrantingLabel] = useState<string | null>(null);
  const [grantConfirm, setGrantConfirm] = useState<{ title: string; message: string; run: () => Promise<void> } | null>(null);
  const [templateResults, setTemplateResults] = useState<{ id: string; name?: string; count: number; source?: string; category?: string }[]>([]);
  const [searchingTemplates, setSearchingTemplates] = useState(false);
  const { data: inventoryData = null, isLoading: loadingInventory, mutate: loadInventory } = useSWR(
    selectedId ? (['character-inventory', selectedId] as const) : null,
    async ([, id]) => {
      const result = await apiClient.getCharacterInventory(id);
      return result.inventories;
    },
  );
  const [teleportX, setTeleportX] = useState('');
  const [teleportY, setTeleportY] = useState('');
  const [teleportZ, setTeleportZ] = useState('');
  const [teleporting, setTeleporting] = useState(false);
  const [teleportResult, setTeleportResult] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [catalogData, setCatalogData] = useState<{ id: string; name?: string; count: number; source?: string; category?: string }[] | null>(null);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [activeGrantCat, setActiveGrantCat] = useState<string>('quick');

  const grantCategories = useMemo(() => ([
    { id: 'quick', label: 'Quick Grants', icon: '⚡' },
    { id: 'combat', label: 'Combat & Armor', icon: '⚔️' },
    { id: 'tools', label: 'Tools', icon: '🛠️' },
    { id: 'vehicles', label: 'Vehicles', icon: '🚜' },
    { id: 'materials', label: 'Materials', icon: '📦' },
    { id: 'survival', label: 'Survival', icon: '🍞' },
    { id: 'apparel', label: 'Apparel', icon: '🛡️' },
    { id: 'cosmetics', label: 'Cosmetics & Custom', icon: '✨' },
    { id: 'live', label: 'Live finds', icon: '📡' },
  ]), []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const headerOffset = 96;
    const ids = ['quick', 'combat', 'tools', 'vehicles', 'materials', 'survival', 'apparel', 'cosmetics', 'live'];
    const elements = ids
      .map((id) => ({ id, el: document.getElementById(`grant-cat-${id}`) }))
      .filter((x): x is { id: string; el: HTMLElement } => x.el !== null);
    if (elements.length === 0) return;
    const onScroll = () => {
      const y = window.scrollY + headerOffset;
      let current = elements[0].id;
      for (const { id, el } of elements) {
        if (el.offsetTop <= y) current = id;
      }
      setActiveGrantCat((prev) => (prev === current ? prev : current));
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [grantCategories]);

  const handleGrantCatJump = (id: string) => {
    if (typeof document === 'undefined') return;
    const el = document.getElementById(`grant-cat-${id}`);
    if (!el) return;
    const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'start' });
    setActiveGrantCat(id);
  };

  const filteredCharacters = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (characters.data ?? []).filter((character) => {
      if (!term) {
        return true;
      }
      return [character.name, character.id, character.metadata?.house, character.metadata?.clan]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term));
    });
  }, [characters.data, search]);

  const availableCategories = useMemo<CategoryKey[]>(() => {
    const categories = schema.data?.summary.categories ?? initialSchema.summary.categories;
    return categories.filter((category): category is CategoryKey => category in categoryMeta);
  }, [schema.data?.summary.categories]);

  const fieldsByCategory = useMemo(() => {
    return (schema.data?.stats ?? []).reduce<Record<CategoryKey, CharacterStatField[]>>(
      (acc, field) => {
        if (field.category in acc) {
          acc[field.category as CategoryKey].push(field);
        }
        return acc;
      },
      {
        stats: [],
        spice: [],
        economy: [],
        specialization: [],
      },
    );
  }, [schema.data?.stats]);

  if (availableCategories.length > 0 && !availableCategories.includes(activeCategory)) {
    setActiveCategory(availableCategories[0]);
  }
  const nextSelectedId = filteredCharacters.length === 0
    ? null
    : (!selectedId || !filteredCharacters.some((character) => character.id === selectedId)
      ? filteredCharacters[0].id
      : selectedId);
  if (nextSelectedId !== selectedId) {
    setSelectedId(nextSelectedId);
  }

  if (!selectedId && selectedCharacter !== null) {
    setSelectedCharacter(null);
    setDraft({});
    setCharacterError(null);
  }

  useEffect(() => {
    if (!selectedId) {
      return;
    }

    let cancelled = false;
    void apiClient
      .getCharacter(selectedId)
      .then((character) => {
        if (cancelled) {
          return;
        }
        setSelectedCharacter(character);
        setDraft(buildDraft(character, schema.data?.stats ?? []));
        setCharacterError(null);
        setLoadedId(selectedId);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        const fallback = (characters.data ?? []).find((character) => character.id === selectedId) ?? null;
        setSelectedCharacter(fallback);
        setDraft(buildDraft(fallback, schema.data?.stats ?? []));
        setCharacterError(error instanceof Error ? error.message : 'Unable to load character details.');
        setLoadedId(selectedId);
      });

    return () => {
      cancelled = true;
    };
  }, [characters.data, schema.data?.stats, selectedId]);

  const loadingCharacter = Boolean(selectedId) && loadedId !== selectedId;
  const activeFields = fieldsByCategory[activeCategory] ?? [];
  const selectedSource = selectedCharacter?.source ?? 'unknown';
  const mutationsEnabled = schema.data?.summary.mutationsEnabled ?? false;
  const isEmpty = (characters.data ?? []).length === 0;

  const handleReset = async () => {
    if (!selectedId) {
      return;
    }
    setSaveState(null);
    setLoadedId(null);
    try {
      const character = await apiClient.getCharacter(selectedId);
      setSelectedCharacter(character);
      setDraft(buildDraft(character, schema.data?.stats ?? []));
      setCharacterError(null);
      setLoadedId(selectedId);
    } catch (error) {
      setCharacterError(error instanceof Error ? error.message : 'Unable to reload character.');
      setLoadedId(selectedId);
    }
  };

  const handleSave = async () => {
    if (!selectedId) {
      return;
    }

    setSaving(true);
    setSaveState(null);
    try {
      const updated = await apiClient.updateCharacter(selectedId, normalizeUpdates(schema.data?.stats ?? [], draft));
      setSelectedCharacter(updated);
      setDraft(buildDraft(updated, schema.data?.stats ?? []));
      setSaveState({ tone: 'success', message: `Updated ${updated.name}.` });
      await characters.refetch();
    } catch (error) {
      setSaveState({
        tone: 'error',
        message: error instanceof Error ? error.message : 'Unable to save character changes.',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleGrantItem = async (templateId?: string, amount?: number) => {
    if (!selectedId) {
      setGrantResult({ tone: 'error', title: 'No character selected', message: 'Select a character before granting items.' });
      return;
    }
    const tid = templateId ?? grantTemplate.trim();
    const qty = amount ?? (grantAmount.trim() === '' ? 1 : Number(grantAmount));
    if (!tid) {
      setGrantResult({ tone: 'error', title: 'Missing item', message: 'Enter an item template ID.' });
      return;
    }
    if (!Number.isInteger(qty) || qty < 1 || qty > 10000) {
      setGrantResult({ tone: 'error', title: 'Invalid quantity', message: 'Quantity must be a whole number between 1 and 10000.' });
      return;
    }
    setGrantConfirm({
      title: `Grant ${qty}× ${tid}?`,
      message: 'The row is written to the database. The character must fully log out and back in for the item to appear.',
      run: () => executeGrantItem(tid, qty, !templateId),
    });
  };

  const executeGrantItem = async (tid: string, qty: number, clearCustom: boolean) => {
    if (!selectedId) return;
    setGranting(true);
    setGrantingLabel(tid);
    setGrantResult(null);
    try {
      const result = await apiClient.grantItem(selectedId, tid, qty);
      setGrantResult({
        tone: 'staged',
        title: `Staged ${qty}x ${tid}`,
        message: `Item #${result.item_id} written to the database.${result.warning ? `\n${result.warning}` : ''}`,
        relogRequired: true,
        online: result.player_online,
      });
      if (clearCustom) { setGrantTemplate(''); setGrantAmount('1'); }
    } catch (error) {
      setGrantResult({ tone: 'error', title: 'Grant failed', message: error instanceof Error ? error.message : 'Grant failed.' });
    } finally {
      setGranting(false);
      setGrantingLabel(null);
    }
  };

  const handleGrantBatch = async (items: { templateId: string; quantity: number }[]) => {
    if (!selectedId) {
      setGrantResult({ tone: 'error', title: 'No character selected', message: 'Select a character before granting items.' });
      return;
    }
    if (items.length === 0) return;
    setGrantConfirm({
      title: `Grant ${items.length} items?`,
      message: 'Each row is written to the database. The character must fully log out and back in for the items to appear.',
      run: () => executeGrantBatch(items),
    });
  };

  const executeGrantBatch = async (items: { templateId: string; quantity: number }[]) => {
    if (!selectedId) return;
    setGranting(true);
    setGrantingLabel(`${items.length} items`);
    setGrantResult(null);
    let granted = 0;
    let lastError = '';
    for (const item of items) {
      try {
        await apiClient.grantItem(selectedId, item.templateId, item.quantity);
        granted++;
      } catch (error) {
        lastError = error instanceof Error ? error.message : 'Grant failed.';
      }
    }
    if (granted === items.length) {
      setGrantResult({ tone: 'staged', title: `Staged ${granted} items`, message: `${granted} item rows written to the database.`, relogRequired: true });
    } else if (granted > 0) {
      setGrantResult({ tone: 'error', title: `Partial: ${granted}/${items.length}`, message: `Last error: ${lastError}` });
    } else {
      setGrantResult({ tone: 'error', title: 'All grants failed', message: lastError || 'All grants failed.' });
    }
    setGranting(false);
    setGrantingLabel(null);
  };

  const handleGrantSolari = async (amount: number) => {
    if (!selectedId) {
      setGrantResult({ tone: 'error', title: 'No character selected', message: 'Select a character before granting Solari.' });
      return;
    }
    setGrantConfirm({
      title: `Grant ${amount.toLocaleString()} Solari?`,
      message: 'The wallet update is written to the database. The character must fully log out and back in for the new total to appear.',
      run: () => executeGrantSolari(amount),
    });
  };

  const executeGrantSolari = async (amount: number) => {
    if (!selectedId) return;
    setGranting(true);
    setGrantingLabel(`${amount} Solari`);
    setGrantResult(null);
    try {
      const result = await apiClient.grantSolari(selectedId, amount);
      setGrantResult({ tone: 'staged', title: `Staged ${result.solari_added} Solari`, message: `New total: ${result.new_total}.`, relogRequired: true });
    } catch (error) {
      setGrantResult({ tone: 'error', title: 'Grant failed', message: error instanceof Error ? error.message : 'Grant failed.' });
    } finally {
      setGranting(false);
      setGrantingLabel(null);
    }
  };

  const handleSetHealth = async (hp: number) => {
    if (!selectedId) {
      setGrantResult({ tone: 'error', title: 'No character selected', message: 'Select a character before adjusting health.' });
      return;
    }
    setGranting(true);
    setGrantingLabel(`${hp} HP`);
    setGrantResult(null);
    try {
      const updated = await apiClient.setHealth(selectedId, hp);
      setSelectedCharacter(updated);
      setDraft(buildDraft(updated, schema.data?.stats ?? []));
      setGrantResult({ tone: 'success', title: 'Health updated', message: `Max health set to ${hp}. Relog to apply.` });
    } catch (error) {
      setGrantResult({ tone: 'error', title: 'Failed', message: error instanceof Error ? error.message : 'Failed.' });
    } finally {
      setGranting(false);
      setGrantingLabel(null);
    }
  };

  const handleSearchTemplates = async () => {
    const term = grantSearch.trim();
    if (!term) {
      void handleBrowseCatalog();
      return;
    }
    setSearchingTemplates(true);
    try {
      const result = await apiClient.searchItemTemplates(term);
      setTemplateResults(result.templates);
      if (result.templates.length === 0) {
        toast(`No item templates match "${term}".`, 'info');
      }
    } catch (error) {
      setTemplateResults([]);
      toast(`Template search failed: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
    } finally {
      setSearchingTemplates(false);
    }
  };

  const handleBrowseCatalog = async () => {
    if (catalogData) {
      setCatalogOpen(!catalogOpen);
      return;
    }
    setLoadingCatalog(true);
    try {
      const result = await apiClient.searchItemTemplates('*');
      setCatalogData(result.templates);
      setCatalogOpen(true);
    } catch (error) {
      setCatalogData([]);
      toast(`Could not load the item catalog: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
    } finally {
      setLoadingCatalog(false);
    }
  };

  const handleTeleport = async (x?: number, y?: number, z?: number) => {
    if (!selectedId) return;
    const px = x ?? parseFloat(teleportX);
    const py = y ?? parseFloat(teleportY);
    const pz = z ?? parseFloat(teleportZ);
    if (isNaN(px) || isNaN(py) || isNaN(pz)) {
      setTeleportResult({ tone: 'error', message: 'Enter valid X, Y, Z coordinates.' });
      return;
    }
    setTeleporting(true);
    setTeleportResult(null);
    try {
      await apiClient.teleportCharacter(selectedId, px, py, pz);
      setTeleportResult({ tone: 'success', message: `Teleport set to (${px.toFixed(0)}, ${py.toFixed(0)}, ${pz.toFixed(0)}). Relog to move.` });
      setTeleportX(''); setTeleportY(''); setTeleportZ('');
      void handleReset();
    } catch (error) {
      setTeleportResult({ tone: 'error', message: error instanceof Error ? error.message : 'Teleport failed.' });
    } finally {
      setTeleporting(false);
    }
  };

  const [prevInvId, setPrevInvId] = useState(selectedId);
  if (selectedId !== prevInvId) {
    setPrevInvId(selectedId);
    setGrantResult(null);
    setTeleportResult(null);
    setTemplateResults([]);
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-3">
        <div className="rounded-2xl bg-amber-500/15 p-3 text-amber-600 dark:text-amber-300">
          <UserCog className="h-5 w-5" aria-hidden="true" />
        </div>
        <div>
          <h2 className="text-2xl font-semibold text-th-text">Characters</h2>
          <p className="text-sm text-th-text-m">Inspect and edit player characters from the game database.</p>
        </div>
      </div>
      <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        <div className="metric-card">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="section-title">Roster</p>
              <p className="mt-1 text-3xl font-semibold text-th-text">{characters.data?.length ?? 0}</p>
              <p className="mt-2 text-sm text-th-text-m">Detected characters from the game DB or the safe mock fallback.</p>
            </div>
            <div className="rounded-2xl bg-amber-500/15 p-3 text-amber-600 dark:text-amber-300">
              <UserCog className="h-6 w-6" />
            </div>
          </div>
        </div>
        <div className="metric-card">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="section-title">Editable stats</p>
              <p className="mt-1 text-3xl font-semibold text-th-text">{schema.data?.summary.editableStats ?? 0}</p>
              <p className="mt-2 text-sm text-th-text-m">Organized into {availableCategories.length} category views.</p>
            </div>
            <div className="rounded-2xl bg-amber-500/15 p-3 text-amber-600 dark:text-amber-300">
              <Swords className="h-6 w-6" />
            </div>
          </div>
        </div>
        <div className="metric-card">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="section-title">Mutation mode</p>
              <p className="mt-1 text-3xl font-semibold text-th-text">{mutationsEnabled ? 'Live' : 'Safe'}</p>
              <p className="mt-2 text-sm text-th-text-m">Writes require DUNE_ADMIN_MUTATIONS_ENABLED=true.</p>
            </div>
            <div className={cn('rounded-2xl p-3', mutationsEnabled ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'bg-amber-500/15 text-amber-600 dark:text-amber-300')}>
              <AlertTriangle className="h-6 w-6" />
            </div>
          </div>
        </div>
        <div className="metric-card">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="section-title">Selected source</p>
              <p className="mt-1 text-3xl font-semibold capitalize text-th-text">{selectedSource}</p>
              <p className="mt-2 text-sm text-th-text-m">Showing {selectedCharacter?.table ?? 'no active character yet'}.</p>
            </div>
            <div className="rounded-2xl bg-th-surface-s/70 p-3 text-th-text-s">
              <Flame className="h-6 w-6" />
            </div>
          </div>
        </div>
      </section>

      {!mutationsEnabled ? (
        <div className="rounded-3xl border border-amber-500/30 bg-amber-500/10 px-5 py-4 text-sm text-amber-800 dark:text-amber-100">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-300" />
            <div>
              <p className="font-semibold text-amber-700 dark:text-amber-200">Character editing is in safe preview mode.</p>
              <p className="mt-1 text-amber-800/80 dark:text-amber-100/80">Fields, schema, and DB discovery are live, but saving remains disabled until DUNE_ADMIN_MUTATIONS_ENABLED is set to true.</p>
            </div>
          </div>
        </div>
      ) : null}

      <section className="grid gap-8 xl:grid-cols-[0.8fr_1.2fr]">
        <div className="glass-panel overflow-hidden">
          <div className="border-b border-th-border-m/80 p-5">
            <p className="section-title">Character roster</p>
            <h2 className="mt-1 inline-flex items-center gap-2 text-xl font-semibold text-th-text"><Search className="h-5 w-5 text-amber-600 dark:text-amber-300" /> Search and Select</h2>
            <label className="relative mt-4 block">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-th-text-m" />
              <input
                className="dune-input pl-11"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Filter by name, clan, house, or ID"
              />
            </label>
          </div>

          {characters.error ? <p className="px-5 pt-5 text-sm text-red-700 dark:text-red-300">{characters.error.message}</p> : null}

          <div className="max-h-[720px] space-y-4 overflow-y-auto p-5">
            {characters.loading && (characters.data ?? []).length === 0 ? (
              <div className="flex items-center justify-center gap-3 rounded-3xl border border-th-border-m/80 bg-th-bg/30 px-4 py-12 text-th-text-m">
                <Loader2 className="h-5 w-5 animate-spin" /> Loading characters\u2026
              </div>
            ) : null}

            {isEmpty ? (
              <div className="flex min-h-[360px] flex-col items-center justify-center gap-4 rounded-3xl border border-th-border-m/80 bg-th-bg/30 p-8 text-center">
                <UserCog className="h-10 w-10 text-amber-600 dark:text-amber-300" />
                <div>
                  <h3 className="text-xl font-semibold text-th-text">No characters discovered</h3>
                  <p className="mt-2 max-w-sm text-sm text-th-text-m">The dashboard could not read the game schema yet. Once character tables are exposed, this panel will automatically populate.</p>
                </div>
              </div>
            ) : null}

            {!isEmpty && filteredCharacters.length === 0 ? (
              <div className="rounded-3xl border border-th-border-m/80 bg-th-bg/30 px-4 py-12 text-center text-th-text-m">No characters matched your filter.</div>
            ) : null}

            {filteredCharacters.map((character) => {
              const statCount = Object.values(character.stats ?? {}).filter((value) => value !== null && value !== undefined).length;
              const active = character.id === selectedId;
              return (
                <button
                  key={character.id}
                  type="button"
                  onClick={() => {
                    setSelectedId(character.id);
                    setSaveState(null);
                  }}
                  className={cn(
                    'w-full rounded-3xl border p-4 text-left transition-[color,background-color,border-color,box-shadow] dune-focus',
                    active
                      ? 'border-amber-500/40 bg-amber-500/10 shadow-dune'
                      : 'border-th-border-m/80 bg-th-bg/30 hover:border-th-border hover:bg-th-surface-s/60',
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-base font-semibold text-th-text">{character.name}</p>
                      <p className="mt-1 text-xs text-th-text-m">
                        {character.metadata?.platform ? `${String(character.metadata.platform)} · ` : ''}
                        {character.id}
                      </p>
                    </div>
                    <span className={cn('rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.2em]', character.source === 'mock' ? 'border-sky-500/20 bg-sky-500/10 text-sky-200' : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200')}>
                      {character.source}
                    </span>
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-th-text-m">
                    <span className="rounded-full border border-th-border px-3 py-1">{statCount} mapped stats</span>
                    {character.metadata?.house ? <span className="rounded-full border border-th-border px-3 py-1">{String(character.metadata.house)}</span> : null}
                    {character.metadata?.clan ? <span className="rounded-full border border-th-border px-3 py-1">{String(character.metadata.clan)}</span> : null}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-8">
          <div className="glass-panel p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="section-title">Character editor</p>
                <h2 className="mt-1 inline-flex items-center gap-2 text-2xl font-semibold text-th-text"><UserCog className="h-6 w-6 text-amber-600 dark:text-amber-300" /> {selectedCharacter?.name ?? 'No character selected'}</h2>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-th-text-m">
                  {selectedCharacter?.id ? <span className="rounded-full border border-th-border px-3 py-1 uppercase tracking-[0.18em]">{selectedCharacter.id}</span> : null}
                  {selectedCharacter?.table ? <span className="rounded-full border border-th-border px-3 py-1">{selectedCharacter.table}</span> : null}
                  {selectedCharacter?.lastUpdated ? <span className="rounded-full border border-th-border px-3 py-1">Updated {new Date(selectedCharacter.lastUpdated).toLocaleString()}</span> : null}
                </div>
              </div>
              <div className="flex flex-wrap gap-3">
                <button type="button" className="dune-button-muted" onClick={() => void handleReset()} disabled={!selectedId || loadingCharacter}>
                  <RefreshCcw className="mr-2 h-4 w-4" /> Reload
                </button>
                <button type="button" className="dune-button" onClick={() => void handleSave()} disabled={!selectedId || saving || !mutationsEnabled}>
                  <Save className="mr-2 h-4 w-4" /> {saving ? 'Saving\u2026' : 'Save changes'}
                </button>
              </div>
            </div>

            {characterError ? <p className="mt-4 text-sm text-red-700 dark:text-red-300">{characterError}</p> : null}
            {saveState ? (
              <div className={cn('mt-4 rounded-2xl border px-4 py-3 text-sm', saveState.tone === 'success' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200' : 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-200')}>
                {saveState.message}
              </div>
            ) : null}

            {!selectedCharacter ? (
              <div className="mt-6 flex min-h-[360px] flex-col items-center justify-center gap-4 rounded-3xl border border-dashed border-th-border/80 bg-th-bg/25 p-8 text-center text-th-text-m">
                <UserCog className="h-10 w-10 text-amber-600 dark:text-amber-300" />
                <div>
                  <h3 className="text-xl font-semibold text-th-text">Select a Character</h3>
                  <p className="mt-2 max-w-md text-sm text-th-text-m">Choose a roster entry to inspect the discovered stat mapping and prepare edits.</p>
                </div>
              </div>
            ) : (
              <>
                <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  {availableCategories.map((category) => {
                    const meta = categoryMeta[category];
                    const Icon = meta.icon;
                    const isActive = category === activeCategory;
                    return (
                      <button
                        key={category}
                        type="button"
                        onClick={() => setActiveCategory(category)}
                        className={cn(
                          'rounded-3xl border px-4 py-4 text-left transition-[color,background-color,border-color] dune-focus',
                          isActive ? 'border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-100' : 'border-th-border-m/80 bg-th-bg/30 text-th-text-s hover:border-th-border hover:bg-th-surface-s/60',
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold">{meta.label}</p>
                            <p className="mt-1 text-xs text-th-text-m">{fieldsByCategory[category]?.length ?? 0} fields</p>
                          </div>
                          <Icon className="h-5 w-5" />
                        </div>
                        <p className="mt-3 text-xs text-th-text-m">{meta.description}</p>
                      </button>
                    );
                  })}
                </div>

                <div className="mt-6 rounded-3xl border border-th-border-m/80 bg-th-bg/30 p-5">
                  <div className="flex items-center gap-3">
                    {(() => {
                      const Icon = categoryMeta[activeCategory].icon;
                      return <Icon className="h-5 w-5 text-amber-600 dark:text-amber-300" />;
                    })()}
                    <div>
                      <h3 className="font-semibold text-th-text">{categoryMeta[activeCategory].label}</h3>
                      <p className="text-sm text-th-text-m">{categoryMeta[activeCategory].description}</p>
                    </div>
                  </div>

                  <div className="mt-5 grid gap-4 md:grid-cols-2">
                    {activeFields.map((field) => (
                      <label key={field.key} className="block rounded-2xl border border-th-border-m/80 bg-th-surface-s/60 p-4">
                        <span className="block text-sm font-medium text-th-text">{field.label}</span>
                        <span className="mt-1 block text-xs uppercase tracking-[0.18em] text-th-text-m">{field.key}</span>
                        <input
                          className="dune-input mt-3"
                          type={field.type === 'number' ? 'number' : 'text'}
                          value={draft[field.key] ?? ''}
                          onChange={(event) => setDraft((current) => ({ ...current, [field.key]: event.target.value }))}
                          disabled={loadingCharacter}
                        />
                      </label>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="glass-panel p-5">
            <p className="section-title">Schema summary</p>
            <h2 className="mt-1 inline-flex items-center gap-2 text-xl font-semibold text-th-text"><BookOpen className="h-5 w-5 text-amber-600 dark:text-amber-300" /> Editable Stat Layout</h2>
            <div className="mt-5 grid gap-3 md:grid-cols-2">
              {availableCategories.map((category) => {
                const meta = categoryMeta[category];
                const Icon = meta.icon;
                return (
                  <div key={category} className="rounded-3xl border border-th-border-m/80 bg-th-bg/30 p-4">
                    <div className="flex items-center gap-3">
                      <div className="rounded-2xl bg-amber-500/15 p-3 text-amber-600 dark:text-amber-300">
                        <Icon className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="font-semibold text-th-text">{meta.label}</p>
                        <p className="text-sm text-th-text-m">{fieldsByCategory[category]?.length ?? 0} available inputs</p>
                      </div>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {(fieldsByCategory[category] ?? []).map((field) => (
                        <span key={field.key} className="rounded-full border border-th-border px-3 py-1 text-xs text-th-text-s">
                          {field.label}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {selectedCharacter && mutationsEnabled ? (
            <div className="glass-panel p-5">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl bg-amber-500/15 p-3 text-amber-600 dark:text-amber-300">
                  <Package className="h-5 w-5" />
                </div>
                <div>
                  <p className="section-title">Grant items and resources</p>
                  <h2 className="mt-1 text-xl font-semibold text-th-text">Quick Grant to {selectedCharacter.name}</h2>
                </div>
              </div>

              {granting && grantingLabel ? (
                <div className="mt-4 flex items-center gap-2 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-200" aria-live="polite">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Granting {grantingLabel}…
                </div>
              ) : null}

              {grantResult ? (
                <div className={cn('mt-4 rounded-2xl border px-4 py-3 text-sm',
                  grantResult.tone === 'success' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200'
                  : grantResult.tone === 'staged' ? 'border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200'
                  : 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-200')}
                  aria-live="polite"
                >
                  <div className="flex items-start gap-2">
                    {grantResult.tone === 'staged' ? <Server className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> : grantResult.tone === 'error' ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> : <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}
                    <div className="min-w-0">
                      <p className="font-semibold">{grantResult.title}</p>
                      {grantResult.message ? <p className="mt-0.5 whitespace-pre-line text-xs opacity-90">{grantResult.message}</p> : null}
                    </div>
                  </div>
                  {grantResult.relogRequired ? (
                    <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
                      <p className="text-xs font-semibold">Relog to load the item</p>
                      <p className="mt-1 text-xs opacity-90">
                        {grantResult.online
                          ? 'The player is online, so the item is not visible yet. Have them return to the main menu and rejoin the server — the inventory is read from the database on login. No server restart is needed. (If it does not appear after relogging, re-grant while the player sits at the main menu, then rejoin.)'
                          : 'The item is staged in the database. It loads when the player next joins the server — the inventory is read from the database on login. No server restart is needed.'}
                      </p>
                    </div>
                  ) : null}
                </div>
              ) : null}

              <nav
                className="sticky top-2 z-10 mt-6 rounded-2xl border border-th-border-m/40 bg-th-bg/85 p-2 backdrop-blur supports-[backdrop-filter]:bg-th-bg/65"
                aria-label="Grant categories"
              >
                <ul className="flex flex-wrap items-center gap-1.5" role="tablist">
                  {grantCategories.map((cat) => {
                    const active = activeGrantCat === cat.id;
                    return (
                      <li key={cat.id} role="presentation">
                        <button
                          type="button"
                          role="tab"
                          aria-selected={active}
                          aria-current={active ? 'true' : undefined}
                          onClick={() => handleGrantCatJump(cat.id)}
                          className={cn(
                            'inline-flex min-h-11 items-center whitespace-nowrap rounded-xl px-3 text-xs font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60',
                            active
                              ? 'bg-amber-500/20 text-amber-800 dark:text-amber-100'
                              : 'text-th-text-m hover:bg-th-border-m/30 hover:text-th-text',
                          )}
                        >
                          <span aria-hidden="true">{cat.icon}</span> <span translate="no">{cat.label}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </nav>

              <GrantCatalog
                granting={granting}
                onGrantItem={(id, qty) => void handleGrantItem(id, qty)}
                onGrantBatch={(items) => void handleGrantBatch(items)}
                onGrantSolari={(amount) => void handleGrantSolari(amount)}
                onSetHealth={(hp) => void handleSetHealth(hp)}
              />

              <div className="mt-6 rounded-3xl border border-th-border-m/80 bg-th-bg/30 p-5">
                <p className="text-sm font-semibold text-th-text">Custom item grant</p>
                <p className="mt-1 text-xs text-th-text-m">Enter any item template ID. Search below to find valid IDs.</p>
                <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto_auto]">
                  <input
                    className="dune-input"
                    placeholder="Template ID (e.g. ScrapMetal)"
                    aria-label="Item template ID"
                    value={grantTemplate}
                    onChange={(e) => setGrantTemplate(e.target.value)}
                    disabled={granting}
                  />
                  <input
                    className="dune-input w-24"
                    type="number"
                    min={1}
                    placeholder="Qty"
                    aria-label="Grant quantity"
                    value={grantAmount}
                    onChange={(e) => setGrantAmount(e.target.value)}
                    disabled={granting}
                  />
                  <button type="button" className="dune-button" disabled={granting || !grantTemplate.trim()} onClick={() => void handleGrantItem()}>
                    {granting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Package className="mr-2 h-4 w-4" />}
                    Grant
                  </button>
                </div>
              </div>

              <div className="mt-6 rounded-3xl border border-th-border-m/80 bg-th-bg/30 p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-th-text">Item Template Search</p>
                    <p className="mt-1 text-xs text-th-text-m">Search items from inventory, recipes, and the known catalog. Press Enter or click Search with empty field to browse all.</p>
                  </div>
                  <button type="button" className="dune-button-muted text-xs" disabled={loadingCatalog} onClick={() => void handleBrowseCatalog()}>
                    {loadingCatalog ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <BookOpen className="mr-1.5 h-3.5 w-3.5" />}
                    {catalogOpen ? 'Hide catalog' : 'Browse all'}
                  </button>
                </div>
                <div className="mt-3 flex gap-3">
                  <input
                    className="dune-input flex-1"
                    placeholder="Search items (e.g. Knife, Armor, Oil) or press Enter for all"
                    value={grantSearch}
                    onChange={(e) => setGrantSearch(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void handleSearchTemplates(); }}
                  />
                  <button type="button" className="dune-button-muted" disabled={searchingTemplates} onClick={() => void handleSearchTemplates()}>
                    {searchingTemplates ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
                    Search
                  </button>
                </div>
                {templateResults.length > 0 ? (
                  <div className="mt-3 max-h-72 overflow-y-auto rounded-2xl border border-th-border-m/80">
                    {templateResults.map((t) => (
                      <div
                        key={t.id}
                        className="flex w-full items-center justify-between border-b border-th-border-m/40 px-4 py-2.5 text-left text-sm last:border-b-0 transition-colors hover:bg-th-surface-s/60"
                      >
                        <button type="button" className="flex-1 text-left" onClick={() => { setGrantTemplate(t.id); setTemplateResults([]); }}>
                          <span className="font-medium text-th-text">{t.name || t.id}</span>
                          {t.name && t.name !== t.id && <span className="ml-2 text-xs text-th-text-m font-mono">{t.id}</span>}
                        </button>
                        <span className="flex items-center gap-2 text-xs text-th-text-m">
                          {t.category && <span className="rounded-full bg-th-surface-s px-2 py-0.5">{t.category}</span>}
                          {t.source === 'inventory' ? `${t.count} in DB` : t.source === 'recipe' ? 'from recipe' : 'catalog'}
                          <button type="button" className="ml-1 rounded-full bg-amber-500/15 px-2.5 py-0.5 text-amber-600 hover:bg-amber-500/30 dark:text-amber-300" disabled={granting} onClick={() => void handleGrantItem(t.id, 1)}>
                            +1
                          </button>
                        </span>
                      </div>
                    ))}
                  </div>
                ) : null}

                {catalogOpen && catalogData ? (
                  <div className="mt-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-th-text-m mb-3">
                      Item Catalog ({catalogData.length} items)
                    </p>
                    {(() => {
                      const grouped: Record<string, typeof catalogData> = {};
                      for (const item of catalogData) {
                        const cat = item.category || 'Unknown';
                        (grouped[cat] ??= []).push(item);
                      }
                      const categoryOrder = ['Weapons', 'Tools', 'Resources', 'Components', 'Consumables', 'Currency', 'Armor', 'Cosmetics', 'Vehicle Parts', 'Ornithopter Parts', 'Schematics', 'Structures', 'Contracts', 'Emotes', 'Unknown'];
                      const sorted = Object.entries(grouped).sort(([a], [b]) => {
                        const ai = categoryOrder.indexOf(a);
                        const bi = categoryOrder.indexOf(b);
                        return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
                      });
                      return sorted.map(([category, items]) => (
                        <div key={category} className="mb-4">
                          <p className="text-xs font-semibold text-th-text mb-2">{category} ({items.length})</p>
                          <div className="flex flex-wrap gap-1.5">
                            {items.map((item) => (
                              <button
                                key={item.id}
                                type="button"
                                className="group relative flex flex-col items-start rounded-lg border border-th-border px-3 py-1.5 text-xs text-th-text-s hover:border-amber-500/40 hover:bg-amber-500/10 transition-colors"
                                disabled={granting}
                                onClick={() => { setGrantTemplate(item.id); setCatalogOpen(false); }}
                              >
                                <span className="font-medium text-th-text">{item.name || item.id}{item.count > 0 && <span className="ml-1 font-normal text-th-text-m">({item.count})</span>}</span>
                                {item.name && item.name !== item.id && <span className="font-mono text-[10px] text-th-text-m leading-tight">{item.id}</span>}
                              </button>
                            ))}
                          </div>
                        </div>
                      ));
                    })()}
                  </div>
                ) : null}
              </div>

              <div className="mt-6 rounded-3xl border border-th-border-m/80 bg-th-bg/30 p-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Backpack className="h-5 w-5 text-amber-600 dark:text-amber-300" />
                    <div>
                      <p className="text-sm font-semibold text-th-text">Current Inventory</p>
                      <p className="text-xs text-th-text-m">{selectedCharacter.name}&apos;s items</p>
                    </div>
                  </div>
                  <button type="button" className="dune-button-muted text-xs" onClick={() => void loadInventory()} disabled={loadingInventory}>
                    <RefreshCcw className={cn('mr-1.5 h-3.5 w-3.5', loadingInventory && 'animate-spin')} /> Refresh
                  </button>
                </div>
                <p className="mt-2 text-xs text-th-text-m italic">
                  Reads from the last database save. Items consumed, dropped, or moved in-game may still appear until the game server saves again (on logout or periodic save).
                </p>
                {inventoryData ? (
                  <div className="mt-4 space-y-4">
                    {Object.entries(inventoryData)
                      .filter(([invName]) => ['backpack', 'equipment', 'hotbar'].includes(invName))
                      .map(([invName, items]) => (
                      <div key={invName}>
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-th-text-m">{invName} ({items.length} items)</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {items.map((item, i) => (
                            <span
                              key={`${item.template_id}-${i}`}
                              className="cursor-pointer rounded-full border border-th-border px-3 py-1 text-xs text-th-text-s hover:border-amber-500/40 hover:bg-amber-500/10 transition-colors"
                              title={`Slot ${item.position_index}, Quality ${item.quality_level}`}
                              onClick={() => setGrantTemplate(item.template_id)}
                            >
                              {item.template_id} x{item.stack_size}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                    {Object.entries(inventoryData).some(([invName]) => !['backpack', 'equipment', 'hotbar'].includes(invName)) && (
                      <details className="text-xs">
                        <summary className="cursor-pointer text-th-text-m hover:text-th-text">Other inventories (emotes, quest, etc.)</summary>
                        <div className="mt-2 space-y-3">
                          {Object.entries(inventoryData)
                            .filter(([invName]) => !['backpack', 'equipment', 'hotbar'].includes(invName))
                            .map(([invName, items]) => (
                            <div key={invName}>
                              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-th-text-m">{invName} ({items.length} items)</p>
                              <div className="mt-1 flex flex-wrap gap-2">
                                {items.map((item, i) => (
                                  <span key={`${item.template_id}-${i}`} className="rounded-full border border-th-border/50 px-2 py-0.5 text-xs text-th-text-m">
                                    {item.template_id} x{item.stack_size}
                                  </span>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </details>
                    )}
                  </div>
                ) : loadingInventory ? (
                  <div className="mt-4 flex items-center gap-2 text-sm text-th-text-m">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading inventory…
                  </div>
                ) : null}
              </div>

              <div className="mt-6 rounded-3xl border border-th-border-m/80 bg-th-bg/30 p-5">
                <div className="flex items-center gap-3">
                  <MapPin className="h-5 w-5 text-amber-600 dark:text-amber-300" />
                  <div>
                    <p className="text-sm font-semibold text-th-text">Teleport</p>
                    <p className="text-xs text-th-text-m">
                      Move {selectedCharacter.name} to any coordinates.
                      {selectedCharacter.metadata?.position ? (() => { const p = selectedCharacter.metadata.position as {x: number; y: number; z: number}; return ` Current: (${Math.round(p.x)}, ${Math.round(p.y)}, ${Math.round(p.z)})`; })() : ''}
                    </p>
                  </div>
                </div>

                <div className="mt-4">
                  <p className="text-xs font-semibold text-th-text mb-2">Quick Teleport</p>
                  <div className="grid gap-2 grid-cols-2 md:grid-cols-3">
                    <button type="button" className="dune-button-muted text-xs" disabled={teleporting} onClick={() => void handleTeleport(157100, 315000, 662)}>
                      <MapPin className="mr-1.5 h-3.5 w-3.5" /> Spawn Point
                    </button>
                    <button type="button" className="dune-button-muted text-xs" disabled={teleporting} onClick={() => void handleTeleport(230651, 224403, 1006)}>
                      <MapPin className="mr-1.5 h-3.5 w-3.5" /> Hagga Basin Center
                    </button>
                    {(characters.data ?? []).filter(c => c.id !== selectedId && c.metadata?.position).map(c => {
                      const pos = c.metadata!.position as {x: number; y: number; z: number};
                      return (
                        <button
                          key={c.id}
                          type="button"
                          className="dune-button-muted text-xs"
                          disabled={teleporting}
                          onClick={() => void handleTeleport(pos.x, pos.y, pos.z)}
                        >
                          <MapPin className="mr-1.5 h-3.5 w-3.5" /> To {c.name}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="mt-4">
                  <p className="text-xs font-semibold text-th-text mb-2">Custom Coordinates</p>
                  <div className="grid gap-3 grid-cols-[1fr_1fr_1fr_auto]">
                    <input className="dune-input" type="number" placeholder="X" aria-label="Teleport X" value={teleportX} onChange={(e) => setTeleportX(e.target.value)} disabled={teleporting} />
                    <input className="dune-input" type="number" placeholder="Y" aria-label="Teleport Y" value={teleportY} onChange={(e) => setTeleportY(e.target.value)} disabled={teleporting} />
                    <input className="dune-input" type="number" placeholder="Z" aria-label="Teleport Z" value={teleportZ} onChange={(e) => setTeleportZ(e.target.value)} disabled={teleporting} />
                    <button type="button" className="dune-button" disabled={teleporting || !teleportX || !teleportY || !teleportZ} onClick={() => void handleTeleport()}>
                      {teleporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <MapPin className="mr-2 h-4 w-4" />}
                      Teleport
                    </button>
                  </div>
                  <p className="mt-2 text-xs text-th-text-m">Player must relog for teleport to take effect. Rotation is preserved.</p>
                  {teleportResult ? (
                    <div className={cn('mt-3 rounded-2xl border px-4 py-3 text-sm', teleportResult.tone === 'success' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200' : 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-200')}>
                      {teleportResult.message}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </section>
      <ConfirmDialog
        open={!!grantConfirm}
        title={grantConfirm?.title ?? ''}
        message={grantConfirm?.message ?? ''}
        confirmLabel="Grant"
        onCancel={() => setGrantConfirm(null)}
        onConfirm={() => {
          const run = grantConfirm?.run;
          setGrantConfirm(null);
          if (run) void run();
        }}
      />
    </div>
  );
}
