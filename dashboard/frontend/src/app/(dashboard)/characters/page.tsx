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

import { useApi } from '@/hooks/useApi';
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
  const characters = useApi(() => apiClient.getCharacters(), { refreshInterval: 30000, initialData: [] });
  const schema = useApi(() => apiClient.getCharacterStatsSchema(), { initialData: initialSchema });
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedCharacter, setSelectedCharacter] = useState<CharacterRecord | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [activeCategory, setActiveCategory] = useState<CategoryKey>('stats');
  const [loadingCharacter, setLoadingCharacter] = useState(false);
  const [characterError, setCharacterError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>(null);
  const [saving, setSaving] = useState(false);
  const [grantTemplate, setGrantTemplate] = useState('');
  const [grantAmount, setGrantAmount] = useState('1');
  const [grantSearch, setGrantSearch] = useState('');
  const [grantResult, setGrantResult] = useState<GrantResult | null>(null);
  const [granting, setGranting] = useState(false);
  const [grantingLabel, setGrantingLabel] = useState<string | null>(null);
  const [templateResults, setTemplateResults] = useState<{ id: string; name?: string; count: number; source?: string; category?: string }[]>([]);
  const [searchingTemplates, setSearchingTemplates] = useState(false);
  const [inventoryData, setInventoryData] = useState<Record<string, { template_id: string; stack_size: number; position_index: number; quality_level: number }[]> | null>(null);
  const [loadingInventory, setLoadingInventory] = useState(false);
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
  ]), []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const headerOffset = 96;
    const ids = ['quick', 'combat', 'tools', 'vehicles', 'materials', 'survival', 'apparel', 'cosmetics'];
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

  useEffect(() => {
    if (availableCategories.length === 0) {
      return;
    }
    if (!availableCategories.includes(activeCategory)) {
      setActiveCategory(availableCategories[0]);
    }
  }, [activeCategory, availableCategories]);

  useEffect(() => {
    if (filteredCharacters.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !filteredCharacters.some((character) => character.id === selectedId)) {
      setSelectedId(filteredCharacters[0].id);
    }
  }, [filteredCharacters, selectedId]);

  useEffect(() => {
    if (!selectedId) {
      setSelectedCharacter(null);
      setDraft({});
      return;
    }

    let cancelled = false;
    setLoadingCharacter(true);
    setCharacterError(null);
    void apiClient
      .getCharacter(selectedId)
      .then((character) => {
        if (cancelled) {
          return;
        }
        setSelectedCharacter(character);
        setDraft(buildDraft(character, schema.data?.stats ?? []));
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        const fallback = (characters.data ?? []).find((character) => character.id === selectedId) ?? null;
        setSelectedCharacter(fallback);
        setDraft(buildDraft(fallback, schema.data?.stats ?? []));
        setCharacterError(error instanceof Error ? error.message : 'Unable to load character details.');
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingCharacter(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [characters.data, schema.data?.stats, selectedId]);

  const activeFields = fieldsByCategory[activeCategory] ?? [];
  const selectedSource = selectedCharacter?.source ?? 'unknown';
  const mutationsEnabled = schema.data?.summary.mutationsEnabled ?? false;
  const isEmpty = (characters.data ?? []).length === 0;

  const handleReset = async () => {
    if (!selectedId) {
      return;
    }
    setSaveState(null);
    setLoadingCharacter(true);
    try {
      const character = await apiClient.getCharacter(selectedId);
      setSelectedCharacter(character);
      setDraft(buildDraft(character, schema.data?.stats ?? []));
      setCharacterError(null);
    } catch (error) {
      setCharacterError(error instanceof Error ? error.message : 'Unable to reload character.');
    } finally {
      setLoadingCharacter(false);
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
      if (!templateId) { setGrantTemplate(''); setGrantAmount('1'); }
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

  const loadInventory = useCallback(async () => {
    if (!selectedId) return;
    setLoadingInventory(true);
    try {
      const result = await apiClient.getCharacterInventory(selectedId);
      setInventoryData(result.inventories);
    } catch {
      setInventoryData(null);
    } finally {
      setLoadingInventory(false);
    }
  }, [selectedId]);

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

  useEffect(() => {
    if (selectedId) {
      setInventoryData(null);
      void loadInventory();
      setGrantResult(null);
      setTeleportResult(null);
      setTemplateResults([]);
    }
  }, [loadInventory, selectedId]);

  return (
    <div className="space-y-6">
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="metric-card">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="section-title">Roster</p>
              <h2 className="mt-1 text-3xl font-semibold text-th-text">{characters.data?.length ?? 0}</h2>
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
              <h2 className="mt-1 text-3xl font-semibold text-th-text">{schema.data?.summary.editableStats ?? 0}</h2>
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
              <h2 className="mt-1 text-3xl font-semibold text-th-text">{mutationsEnabled ? 'Live' : 'Safe'}</h2>
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
              <h2 className="mt-1 text-3xl font-semibold text-th-text capitalize">{selectedSource}</h2>
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

      <section className="grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
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

          <div className="max-h-[720px] space-y-3 overflow-y-auto p-4">
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
                      <p className="mt-1 text-xs uppercase tracking-[0.2em] text-th-text-m">{character.id}</p>
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

        <div className="space-y-6">
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
                <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
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
                className="sticky top-2 z-10 mt-5 -mx-1 overflow-x-auto rounded-2xl border border-th-border-m/40 bg-th-bg/85 px-1 py-1.5 backdrop-blur supports-[backdrop-filter]:bg-th-bg/65"
                aria-label="Grant categories"
                style={{ scrollbarWidth: 'thin' }}
              >
                <ul className="flex flex-nowrap items-center gap-1" role="tablist">
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
                            'whitespace-nowrap rounded-xl px-3 py-1.5 text-xs font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60',
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

              <div id="grant-cat-quick" className="mt-5" style={{ scrollMarginTop: '6rem' }}>
                <p className="text-sm font-semibold text-th-text">Quick Grants</p>
                <p className="mt-1 text-xs text-th-text-m">One-click common items and resources. Granted items are staged in the database and appear after the player relogs (no server restart needed).</p>
                <div className="mt-3 grid gap-2 grid-cols-2 md:grid-cols-4">
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantSolari(1000)}>
                    <Coins className="mr-1.5 h-3.5 w-3.5" /> +1,000 Solari
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantSolari(10000)}>
                    <Coins className="mr-1.5 h-3.5 w-3.5" /> +10,000 Solari
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleSetHealth(300)}>
                    <Heart className="mr-1.5 h-3.5 w-3.5" /> 300 HP
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleSetHealth(500)}>
                    <Heart className="mr-1.5 h-3.5 w-3.5" /> 500 HP
                  </button>
                </div>
              </div>

              <div id="grant-cat-combat" className="mt-6 border-b border-th-border-m/40 pb-1" style={{ scrollMarginTop: '6rem' }}>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700/80 dark:text-amber-200/80"><span aria-hidden="true">⚔️ </span>Combat &amp; Armor</p>
              </div>

              <div className="mt-3">
                <p className="text-sm font-semibold text-th-text">Weapons</p>
                <p className="mt-1 text-xs text-th-text-m">Melee weapons, ranged weapons, and ammunition.</p>
                <div className="mt-3 grid gap-2 grid-cols-2 md:grid-cols-4">
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('ScrapMetalKnife', 1)}>
                    <Swords className="mr-1.5 h-3.5 w-3.5" /> Scrap Metal Knife
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('Kindjal', 1)}>
                    <Swords className="mr-1.5 h-3.5 w-3.5" /> Kindjal
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('Dirk', 1)}>
                    <Swords className="mr-1.5 h-3.5 w-3.5" /> Dirk
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('Rapier', 1)}>
                    <Swords className="mr-1.5 h-3.5 w-3.5" /> Rapier
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('CHOAMSword_0', 1)}>
                    <Swords className="mr-1.5 h-3.5 w-3.5" /> Artisan Sword
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('ChoamSda1', 1)}>
                    <Swords className="mr-1.5 h-3.5 w-3.5" /> Choam Sidearm
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('ChoamSda6', 1)}>
                    <Swords className="mr-1.5 h-3.5 w-3.5" /> Adept Maula Pistol
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('SurveyProbeLauncher', 1)}>
                    <Swords className="mr-1.5 h-3.5 w-3.5" /> Survey Probe Launcher
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('Ammo', 1000)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> 1000 Light Darts
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('HeavyAmmo', 1000)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> 1000 Heavy Darts
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('RocketAmmo', 50)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> 50 Rockets
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('InfantryRocketAmmo', 50)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> 50 Missiles
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('Napalm', 50)}>
                    <Flame className="mr-1.5 h-3.5 w-3.5" /> 50 Incendiary Gel
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('T3_Tool_SurveyProbeAmmo', 20)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> 20 Survey Probes
                  </button>
                </div>
              </div>

              <div id="grant-cat-tools" className="mt-6 border-b border-th-border-m/40 pb-1" style={{ scrollMarginTop: '6rem' }}>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700/80 dark:text-amber-200/80"><span aria-hidden="true">🛠️ </span>Tools &amp; Equipment</p>
              </div>

              <div className="mt-3">
                <p className="text-sm font-semibold text-th-text">Tools and Equipment</p>
                <p className="mt-1 text-xs text-th-text-m">Mining tools, building tools, and utility items.</p>
                <div className="mt-3 grid gap-2 grid-cols-2 md:grid-cols-4">
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('MiningTool_1h_Standard', 1)}>
                    <Pickaxe className="mr-1.5 h-3.5 w-3.5" /> Mining Tool
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('Binoculars_1', 1)}>
                    <Search className="mr-1.5 h-3.5 w-3.5" /> Binoculars
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('BasicBuildingTool', 1)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> Building Drone
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('BodyFluidExtractor', 1)}>
                    <Droplets className="mr-1.5 h-3.5 w-3.5" /> Fluid Extractor
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('PowerPack', 1)}>
                    <Flame className="mr-1.5 h-3.5 w-3.5" /> Improvised Power Pack
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('PowerPack5', 1)}>
                    <Flame className="mr-1.5 h-3.5 w-3.5" /> Power Pack Mk1
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('PowerPack4', 1)}>
                    <Flame className="mr-1.5 h-3.5 w-3.5" /> Power Pack Mk6
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('RepairTool', 1)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> Repair Tool
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('WeldingMaterial', 20)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> 20 Welding Material
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('PowerUnitVeryLight', 5)}>
                    <Flame className="mr-1.5 h-3.5 w-3.5" /> 5 Light Power Units
                  </button>
                </div>
              </div>

              <div id="grant-cat-vehicles" className="mt-6 border-b border-th-border-m/40 pb-1" style={{ scrollMarginTop: '6rem' }}>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700/80 dark:text-amber-200/80"><span aria-hidden="true">🚜 </span>Vehicles (Mk6)</p>
              </div>

              <div className="mt-3">
                <p className="text-sm font-semibold text-th-text">Sandbike (Mk6)</p>
                <p className="mt-1 text-xs text-th-text-m">Top-tier sandbike parts. Click Full Kit to grant a complete buildable set.</p>
                <div className="mt-3 grid gap-2 grid-cols-2 md:grid-cols-3">
                  <button type="button" className="dune-button text-xs col-span-2 md:col-span-3" disabled={granting} onClick={() => void handleGrantBatch([
                    { templateId: 'SandbikeChassis_6', quantity: 1 },
                    { templateId: 'SandbikeEngine_6', quantity: 1 },
                    { templateId: 'SandbikeHull_6', quantity: 1 },
                    { templateId: 'SandbikeLocomotion_6', quantity: 1 },
                    { templateId: 'SandbikeGenerator_6', quantity: 1 },
                    { templateId: 'SandbikeBoost_6', quantity: 1 },
                    { templateId: 'SandbikeInventory_2', quantity: 1 },
                    { templateId: 'SandbikeSeat_1', quantity: 1 },
                  ])}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> Full Sandbike Mk6 Kit
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('SandbikeChassis_6', 1)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> Chassis Mk6
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('SandbikeEngine_6', 1)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> Engine Mk6
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('SandbikeHull_6', 1)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> Hull Mk6
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('SandbikeLocomotion_6', 1)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> Tread Mk6
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('SandbikeGenerator_6', 1)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> PSU Mk6
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('SandbikeBoost_6', 1)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> Booster Mk6
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('SandbikeInventory_2', 1)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> Inventory Mk2
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('SandbikeSeat_1', 1)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> Backseat Mk1
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('SandbikeScanner_2', 1)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> Scanner Mk2
                  </button>
                </div>
              </div>

              <div className="mt-5">
                <p className="text-sm font-semibold text-th-text">Buggy (Mk6)</p>
                <p className="mt-1 text-xs text-th-text-m">Top-tier buggy parts including weapons and mining attachments.</p>
                <div className="mt-3 grid gap-2 grid-cols-2 md:grid-cols-3">
                  <button type="button" className="dune-button text-xs col-span-2 md:col-span-3" disabled={granting} onClick={() => void handleGrantBatch([
                    { templateId: 'BuggyChassis_6', quantity: 1 },
                    { templateId: 'BuggyEngine_6', quantity: 1 },
                    { templateId: 'BuggyHullFront_6', quantity: 1 },
                    { templateId: 'BuggyHullBack_6', quantity: 1 },
                    { templateId: 'BuggyGenerator_6', quantity: 1 },
                    { templateId: 'BuggyLocomotion_6', quantity: 1 },
                    { templateId: 'BuggyBoost_6', quantity: 1 },
                    { templateId: 'BuggyInventory_6', quantity: 1 },
                  ])}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> Full Buggy Mk6 Kit
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('BuggyChassis_6', 1)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> Chassis Mk6
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('BuggyEngine_6', 1)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> Engine Mk6
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('BuggyHullFront_6', 1)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> Hull Mk6
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('BuggyHullBack_6', 1)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> Rear Mk6
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('BuggyHullBackExtra_6', 1)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> Utility Rear Mk6
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('BuggyGenerator_6', 1)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> PSU Mk6
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('BuggyLocomotion_6', 1)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> Tread Mk6
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('BuggyBoost_6', 1)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> Booster Mk6
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('BuggyInventory_6', 1)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> Storage Mk6
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('BuggyMining_6', 1)}>
                    <Pickaxe className="mr-1.5 h-3.5 w-3.5" /> Cutteray Mk6
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('BuggyLauncher_6', 1)}>
                    <Swords className="mr-1.5 h-3.5 w-3.5" /> Rocket Launcher Mk6
                  </button>
                </div>
              </div>

              <div className="mt-5">
                <p className="text-sm font-semibold text-th-text">Sandcrawler (Mk6)</p>
                <p className="mt-1 text-xs text-th-text-m">Endgame spice-harvesting vehicle. Mk6 is the only tier.</p>
                <div className="mt-3 grid gap-2 grid-cols-2 md:grid-cols-3">
                  <button type="button" className="dune-button text-xs col-span-2 md:col-span-3" disabled={granting} onClick={() => void handleGrantBatch([
                    { templateId: 'SandcrawlerChassis_6', quantity: 1 },
                    { templateId: 'SandcrawlerEngine_6', quantity: 1 },
                    { templateId: 'SandcrawlerHull_6', quantity: 1 },
                    { templateId: 'SandcrawlerGenerator_6', quantity: 1 },
                    { templateId: 'SandcrawlerLocomotion_6', quantity: 1 },
                    { templateId: 'SandcrawlerSpiceContainer_6', quantity: 1 },
                    { templateId: 'SandcrawlerSpiceHeader_6', quantity: 1 },
                  ])}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> Full Sandcrawler Kit
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('SandcrawlerChassis_6', 1)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> Chassis Mk6
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('SandcrawlerEngine_6', 1)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> Engine Mk6
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('SandcrawlerHull_6', 1)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> Cabin Mk6
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('SandcrawlerGenerator_6', 1)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> PSU Mk6
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('SandcrawlerLocomotion_6', 1)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> Tread Mk6
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('SandcrawlerSpiceContainer_6', 1)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> Centrifuge Mk6
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('SandcrawlerSpiceHeader_6', 1)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> Vacuum Mk6
                  </button>
                </div>
              </div>

              <div className="mt-5">
                <p className="text-sm font-semibold text-th-text">Scout Ornithopter (Mk6)</p>
                <p className="mt-1 text-xs text-th-text-m">Light flying vehicle for exploration and Deep Desert travel.</p>
                <div className="mt-3 grid gap-2 grid-cols-2 md:grid-cols-3">
                  <button type="button" className="dune-button text-xs col-span-2 md:col-span-3" disabled={granting} onClick={() => void handleGrantBatch([
                    { templateId: 'OrnithopterLightChassis_6', quantity: 1 },
                    { templateId: 'OrnithopterLightEngine_6', quantity: 1 },
                    { templateId: 'OrnithopterLightHullFront_6', quantity: 1 },
                    { templateId: 'OrnithopterLightHullBack_6', quantity: 1 },
                    { templateId: 'OrnithopterLightLocomotion_6', quantity: 1 },
                    { templateId: 'OrnithopterLightGenerator_6', quantity: 1 },
                    { templateId: 'OrnithopterLightBoost_6', quantity: 1 },
                    { templateId: 'OrnithopterLightInventory_4', quantity: 1 },
                    { templateId: 'OrnithopterLightScanner_4', quantity: 1 },
                  ])}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> Full Scout Mk6 Kit
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('OrnithopterLightChassis_6', 1)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> Chassis Mk6
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('OrnithopterLightEngine_6', 1)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> Engine Mk6
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('OrnithopterLightHullFront_6', 1)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> Cockpit Mk6
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('OrnithopterLightHullBack_6', 1)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> Hull Mk6
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('OrnithopterLightLocomotion_6', 1)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> Wing Mk6
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('OrnithopterLightLocomotion_Unique_Speed_6', 1)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> Albatross Wing Mk6
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('OrnithopterLightGenerator_6', 1)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> Generator Mk6
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('OrnithopterLightBoost_6', 1)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> Thruster Mk6
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('OrnithopterLightInventory_4', 1)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> Storage Mk4
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('OrnithopterLightScanner_4', 1)}>
                    <Search className="mr-1.5 h-3.5 w-3.5" /> Scan Module
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('OrnithopterLightLauncher_6', 1)}>
                    <Swords className="mr-1.5 h-3.5 w-3.5" /> Rocket Launcher Mk6
                  </button>
                </div>
              </div>

              <div className="mt-5">
                <p className="text-sm font-semibold text-th-text">Assault Ornithopter (Mk6)</p>
                <p className="mt-1 text-xs text-th-text-m">Heavy combat ornithopter with rocket launchers and large cabin.</p>
                <div className="mt-3 grid gap-2 grid-cols-2 md:grid-cols-3">
                  <button type="button" className="dune-button text-xs col-span-2 md:col-span-3" disabled={granting} onClick={() => void handleGrantBatch([
                    { templateId: 'OrnithopterMediumChassis_6', quantity: 1 },
                    { templateId: 'OrnithopterMediumEngine_6', quantity: 1 },
                    { templateId: 'OrnithopterMediumHull_6', quantity: 1 },
                    { templateId: 'OrnithopterMediumHullFront_6', quantity: 1 },
                    { templateId: 'OrnithopterMediumHullBack_6', quantity: 1 },
                    { templateId: 'OrnithopterMediumLocomotion_6', quantity: 1 },
                    { templateId: 'OrnithopterMediumGenerator_6', quantity: 1 },
                    { templateId: 'OrnithopterMediumBoost_6', quantity: 1 },
                    { templateId: 'OrnithopterMediumInventory_5', quantity: 1 },
                  ])}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> Full Assault Mk6 Kit
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('OrnithopterMediumChassis_6', 1)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> Chassis Mk6
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('OrnithopterMediumEngine_6', 1)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> Engine Mk6
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('OrnithopterMediumHull_6', 1)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> Cabin Mk6
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('OrnithopterMediumHullFront_6', 1)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> Cockpit Mk6
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('OrnithopterMediumHullBack_6', 1)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> Tail Mk6
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('OrnithopterMediumLocomotion_6', 1)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> Wing Mk6
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('OrnithopterMediumGenerator_6', 1)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> Generator Mk6
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('OrnithopterMediumBoost_6', 1)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> Thruster Mk6
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('OrnithopterMediumInventory_5', 1)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> Storage Mk5
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('OrnithopterMediumLauncher_6', 1)}>
                    <Swords className="mr-1.5 h-3.5 w-3.5" /> Rocket Launcher Mk6
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('OrnithopterMediumLocomotion_Unique_Strafe_6', 1)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> Hummingbird Wing Mk6
                  </button>
                </div>
              </div>

              <div className="mt-5">
                <p className="text-sm font-semibold text-th-text">Vehicle Schematics & Other</p>
                <p className="mt-1 text-xs text-th-text-m">Unique schematics, respawn beacons, etc.</p>
                <div className="mt-3 grid gap-2 grid-cols-2 md:grid-cols-3">
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('SandbikeEngine_Unique_Speed_1_Schematic', 1)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> Mohandis Engine Schematic
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('RespawnBeacon', 1)}>
                    <MapPin className="mr-1.5 h-3.5 w-3.5" /> Respawn Beacon
                  </button>
                </div>
              </div>

              <div className="mt-5">
                <p className="text-sm font-semibold text-th-text">Carrier Ornithopter (Mk6)</p>
                <p className="mt-1 text-xs text-th-text-m">New transport-class ornithopter shipped with build 1979201.</p>
                <div className="mt-3 grid gap-2 grid-cols-2 md:grid-cols-3">
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantBatch([
                    { templateId: 'OrnithopterTransportChassis_6',   quantity: 1 },
                    { templateId: 'OrnithopterTransportEngine_6',    quantity: 1 },
                    { templateId: 'OrnithopterTransportLocomotion_6', quantity: 1 },
                    { templateId: 'OrnithopterTransportBoost_6',     quantity: 1 },
                    { templateId: 'OrnithopterTransportGenerator_6', quantity: 1 },
                    { templateId: 'OrnithopterTransportHull_6',      quantity: 1 },
                    { templateId: 'OrnithopterTransportHullFront_6', quantity: 1 },
                    { templateId: 'OrnithopterTransportHullBack_6',  quantity: 1 },
                  ])}><Package className="mr-1.5 h-3.5 w-3.5" /> Full Carrier Mk6 Kit</button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('OrnithopterTransportChassis_6', 1)}><Package className="mr-1.5 h-3.5 w-3.5" /> Carrier Chassis Mk6</button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('OrnithopterTransportEngine_6', 1)}><Package className="mr-1.5 h-3.5 w-3.5" /> Carrier Engine Mk6</button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('OrnithopterTransportLocomotion_6', 1)}><Package className="mr-1.5 h-3.5 w-3.5" /> Carrier Wing Mk6</button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('OrnithopterTransportBoost_6', 1)}><Package className="mr-1.5 h-3.5 w-3.5" /> Carrier Thruster Mk6</button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('OrnithopterTransportGenerator_6', 1)}><Package className="mr-1.5 h-3.5 w-3.5" /> Carrier Generator Mk6</button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('OrnithopterTransportHull_6', 1)}><Package className="mr-1.5 h-3.5 w-3.5" /> Carrier Main Hull Mk6</button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('OrnithopterTransportHullFront_6', 1)}><Package className="mr-1.5 h-3.5 w-3.5" /> Carrier Side Hull Mk6</button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('OrnithopterTransportHullBack_6', 1)}><Package className="mr-1.5 h-3.5 w-3.5" /> Carrier Tail Hull Mk6</button>
                </div>
              </div>

              <div className="mt-5">
                <p className="text-sm font-semibold text-th-text">Vehicle Mid-Tier Kits (Mk2 - Mk5)</p>
                <p className="mt-1 text-xs text-th-text-m">Full intermediate-tier kits for testing or quick progression. Click a tier to grant the full set for that vehicle.</p>
                <div className="mt-3 grid gap-2 grid-cols-2 md:grid-cols-3">
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantBatch([
                    { templateId: 'SandbikeChassis_3', quantity: 1 },
                    { templateId: 'SandbikeEngine_3',  quantity: 1 },
                    { templateId: 'SandbikeHull_3',    quantity: 1 },
                    { templateId: 'SandbikeLocomotion_3', quantity: 1 },
                    { templateId: 'SandbikeGenerator_3',  quantity: 1 },
                    { templateId: 'SandbikeBoost_3',   quantity: 1 },
                  ])}><Package className="mr-1.5 h-3.5 w-3.5" /> Full Sandbike Mk3</button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantBatch([
                    { templateId: 'SandbikeChassis_5', quantity: 1 },
                    { templateId: 'SandbikeEngine_5',  quantity: 1 },
                    { templateId: 'SandbikeHull_5',    quantity: 1 },
                    { templateId: 'SandbikeLocomotion_5', quantity: 1 },
                    { templateId: 'SandbikeGenerator_5',  quantity: 1 },
                    { templateId: 'SandbikeBoost_5',   quantity: 1 },
                  ])}><Package className="mr-1.5 h-3.5 w-3.5" /> Full Sandbike Mk5</button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantBatch([
                    { templateId: 'BuggyChassis_3',     quantity: 1 },
                    { templateId: 'BuggyEngine_3',      quantity: 1 },
                    { templateId: 'BuggyHullFront_3',   quantity: 1 },
                    { templateId: 'BuggyHullBack_3',    quantity: 1 },
                    { templateId: 'BuggyLocomotion_3',  quantity: 1 },
                    { templateId: 'BuggyBoost_3',       quantity: 1 },
                    { templateId: 'BuggyGenerator_3',   quantity: 1 },
                    { templateId: 'BuggyInventory_3',   quantity: 1 },
                  ])}><Package className="mr-1.5 h-3.5 w-3.5" /> Full Buggy Mk3</button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantBatch([
                    { templateId: 'BuggyChassis_5',     quantity: 1 },
                    { templateId: 'BuggyEngine_5',      quantity: 1 },
                    { templateId: 'BuggyHullFront_5',   quantity: 1 },
                    { templateId: 'BuggyHullBack_5',    quantity: 1 },
                    { templateId: 'BuggyLocomotion_5',  quantity: 1 },
                    { templateId: 'BuggyBoost_5',       quantity: 1 },
                    { templateId: 'BuggyGenerator_5',   quantity: 1 },
                    { templateId: 'BuggyInventory_5',   quantity: 1 },
                  ])}><Package className="mr-1.5 h-3.5 w-3.5" /> Full Buggy Mk5</button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantBatch([
                    { templateId: 'OrnithopterLightChassis_5',     quantity: 1 },
                    { templateId: 'OrnithopterLightEngine_5',      quantity: 1 },
                    { templateId: 'OrnithopterLightLocomotion_5',  quantity: 1 },
                    { templateId: 'OrnithopterLightBoost_5',       quantity: 1 },
                    { templateId: 'OrnithopterLightGenerator_5',   quantity: 1 },
                    { templateId: 'OrnithopterLightHullFront_5',   quantity: 1 },
                    { templateId: 'OrnithopterLightHullBack_5',    quantity: 1 },
                    { templateId: 'OrnithopterLightLauncher_5',    quantity: 1 },
                  ])}><Package className="mr-1.5 h-3.5 w-3.5" /> Full Scout Ornithopter Mk5</button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantBatch([
                    { templateId: 'OrnithopterMediumChassis_5',     quantity: 1 },
                    { templateId: 'OrnithopterMediumEngine_5',      quantity: 1 },
                    { templateId: 'OrnithopterMediumLocomotion_5',  quantity: 1 },
                    { templateId: 'OrnithopterMediumBoost_5',       quantity: 1 },
                    { templateId: 'OrnithopterMediumGenerator_5',   quantity: 1 },
                    { templateId: 'OrnithopterMediumHull_5',        quantity: 1 },
                    { templateId: 'OrnithopterMediumHullFront_5',   quantity: 1 },
                    { templateId: 'OrnithopterMediumHullBack_5',    quantity: 1 },
                    { templateId: 'OrnithopterMediumLauncher_5',    quantity: 1 },
                  ])}><Package className="mr-1.5 h-3.5 w-3.5" /> Full Assault Ornithopter Mk5</button>
                </div>
              </div>

              <div className="mt-5">
                <p className="text-sm font-semibold text-th-text">Unique Vehicle Modules (Mk6)</p>
                <p className="mt-1 text-xs text-th-text-m">Named, top-tier unique modules with special bonuses.</p>
                <div className="mt-3 grid gap-2 grid-cols-2 md:grid-cols-3">
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('SandbikeEngine_Unique_Speed_6', 1)}><Package className="mr-1.5 h-3.5 w-3.5" /> Mohandis Sandbike Engine Mk6</button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('SandbikeBoost_Unique_LessHeat_6', 1)}><Package className="mr-1.5 h-3.5 w-3.5" /> Night Rider Boost Mk6</button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('BuggyEngine_Unique_Accelerate_06', 1)}><Package className="mr-1.5 h-3.5 w-3.5" /> Bluddshot Buggy Engine Mk6</button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('BuggyBoost_Unique_LessHeat_6', 1)}><Package className="mr-1.5 h-3.5 w-3.5" /> Rattler Boost Mk6</button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('BuggyMining_Unique_YieldIncrease_06', 1)}><Pickaxe className="mr-1.5 h-3.5 w-3.5" /> Focused Buggy Cutteray Mk6</button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('BuggyInventory_Unique_Capacity_06', 1)}><Package className="mr-1.5 h-3.5 w-3.5" /> Bigger Buggy Boot Mk6</button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('OrnithopterLightBoost_Unique_LessHeat_6', 1)}><Package className="mr-1.5 h-3.5 w-3.5" /> Stormrider Boost Mk6</button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('OrnithopterMediumBoost_Unique_LessHeat_6', 1)}><Package className="mr-1.5 h-3.5 w-3.5" /> Steady Assault Boost Mk6</button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('OrnithopterTransportLocomotion_Unique_Speed_6', 1)}><Package className="mr-1.5 h-3.5 w-3.5" /> Roc Carrier Wing</button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('OrnithopterTransportBoost_Unique_LessHeat_06', 1)}><Package className="mr-1.5 h-3.5 w-3.5" /> Steady Carrier Boost Mk6</button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('SandcrawlerEngine_Unique_Speed_06', 1)}><Package className="mr-1.5 h-3.5 w-3.5" /> Walker Sandcrawler Engine Mk6</button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('SandcrawlerLocomotion_Unique_WormThreat_06', 1)}><Package className="mr-1.5 h-3.5 w-3.5" /> Dampened Sandcrawler Treads</button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('SandcrawlerSpiceContainer_Unique_Capacity_6', 1)}><Package className="mr-1.5 h-3.5 w-3.5" /> Upgraded Regis Spice Container</button>
                </div>
              </div>

              <div id="grant-cat-materials" className="mt-6 border-b border-th-border-m/40 pb-1" style={{ scrollMarginTop: '6rem' }}>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700/80 dark:text-amber-200/80"><span aria-hidden="true">📦 </span>Materials &amp; Crafting</p>
              </div>

              <div className="mt-3">
                <p className="text-sm font-semibold text-th-text">Raw Materials</p>
                <p className="mt-1 text-xs text-th-text-m">Crafting resources and metal bars. Stacks auto-cap to 500.</p>
                <div className="mt-3 grid gap-2 grid-cols-2 md:grid-cols-4">
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('ScrapMetal', 500)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> 500 Salvaged Metal
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('Stone', 500)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> 500 Stone
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('PlantFiber', 500)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> 500 Plant Fiber
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('Oil', 500)}>
                    <Droplets className="mr-1.5 h-3.5 w-3.5" /> 500 Oil
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('FlourSand', 100)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> 100 Flour Sand (Spice Sand)
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('SpiceResidue', 500)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> 500 Spice Residue
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('Mouse_Corpse', 50)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> 50 Mouse Corpse
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('WormTooth', 25)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> 25 Worm Tooth
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('Basalt', 500)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> 500 Basalt Stone
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('DolomiteRock', 500)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> 500 Carbon Ore (Dolomite)
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('MagnetiteOre', 500)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> 500 Iron Ore (Magnetite)
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('AzuriteOre', 500)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> 500 Azurite Ore
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('BauxiteOre', 500)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> 500 Aluminum Ore
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('ErythriteCrystal', 500)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> 500 Erythrite Crystal
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('JasmiumCrystal', 500)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> 500 Jasmium Crystal
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('T4MysaTarilComponent1', 500)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> 500 Diamondine Dust
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('T4MysaTarilComponent2', 500)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> 500 Carbide Scraps
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('T5RadiatedCoreComponent', 500)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> 500 Irradiated Slag
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('CopperBar', 500)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> 500 Copper Bars
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('IronBar', 500)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> 500 Iron Bars
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('SteelBar', 500)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> 500 Steel Ingots
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('AluminiumBar', 500)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> 500 Aluminum Ingots
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('DuraluminumRod', 500)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> 500 Duraluminum Ingots
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('CobaltBar', 500)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> 500 Cobalt Paste
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('Silicone', 500)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> 500 Silicon
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('FuelCanister', 10)}>
                    <Flame className="mr-1.5 h-3.5 w-3.5" /> 10 Small Fuel Cells
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('FuelCanister_Medium', 10)}>
                    <Flame className="mr-1.5 h-3.5 w-3.5" /> 10 Medium Fuel Cells
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('FuelCanister_Large', 10)}>
                    <Flame className="mr-1.5 h-3.5 w-3.5" /> 10 Large Fuel Cells
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('SpicedFuelCell', 10)}>
                    <Flame className="mr-1.5 h-3.5 w-3.5" /> 10 Spice-infused Fuel
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('WindTurbineLubricant1', 500)}>
                    <Droplets className="mr-1.5 h-3.5 w-3.5" /> 500 Low-grade Lubricant
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('WindTurbineLubricant2', 500)}>
                    <Droplets className="mr-1.5 h-3.5 w-3.5" /> 500 Industrial Lubricant
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('WindTrapFilter1', 100)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> 100 Makeshift Filter
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('WindTrapFilter2', 100)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> 100 Standard Filter
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('WindTrapFilter3', 100)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> 100 Particulate Filter
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('WindTrapFilter4', 100)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> 100 Adv. Particulate Filter
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('WeldingMaterial', 500)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> 500 Welding Wire
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('PowerUnitVeryLight', 10)}>
                    <Flame className="mr-1.5 h-3.5 w-3.5" /> 10 Light Power Units
                  </button>
                </div>
              </div>

              <div className="mt-5">
                <p className="text-sm font-semibold text-th-text">Crafting Components</p>
                <p className="mt-1 text-xs text-th-text-m">Tier-1 to Tier-6 components used for advanced crafting (servoks, capacitors, machinery, fabrics). All grants use the verified real Unreal IDs - no ghost stacks.</p>
                <div className="mt-3 grid gap-2 grid-cols-2 md:grid-cols-4">
                  {/* Servoks */}
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('T3MiningGalleryComponent1', 500)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> 500 Calibrated Servok
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('OldImperialComponent1', 500)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> 500 Advanced Servoks
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('D_OldImperialComponent9', 500)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> 500 Optimized Servoks
                  </button>
                  {/* Imperial / Specialty */}
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('OldImperialComponent2', 500)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> 500 Particle Capacitor
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('T3MiningGalleryComponent2', 500)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> 500 Ray Amplifier
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('T3MarksmanComponent', 500)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> 500 Range Finder
                  </button>
                  {/* T1 Components */}
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('T1RusherComponent', 500)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> 500 Blade Parts
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('T1AssaultComponent', 500)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> 500 Gun Parts
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('T1ExplorationComponent', 500)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> 500 Holtzman Actuator
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('T1UniqueComponent', 500)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> 500 Spice Copper Dust
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('T2UniqueComponent', 500)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> 500 Spice Iron Dust
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('T3UniqueComponent', 500)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> 500 Spice Steel Dust
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('T4UniqueComponent', 500)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> 500 Spice Aluminum Dust
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('T5UniqueComponent', 500)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> 500 Spice Duralumin Dust
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('T6UniqueComponent', 500)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> 500 Spice Plastanium Dust
                  </button>
                  {/* T2 Machinery */}
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('T2MachineComponent', 500)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> 500 Complex Machinery
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('T6Machinery', 500)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> 500 Advanced Machinery
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('T2HeavyComponent', 500)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> 500 Armor Plating
                  </button>
                  {/* T4 Components */}
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('T4HarkSpiceSiloComponent1', 500)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> 500 Industrial Pump
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('T4HarkSpiceSiloComponent2', 500)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> 500 Heavy Compressor
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('T4HarkSpiceSiloComponent3', 500)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> 500 Light Compressor
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('T4PyonVillageComponent', 500)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> 500 Insulated Fabric
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('T4MaasKharetComponent1', 500)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> 500 Sandtrout Leathers
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('T4MaasKharetComponent2', 500)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> 500 Stillsuit Tubing
                  </button>
                  {/* T5 Components */}
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('T5FactionBaseComponent1', 500)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> 500 Military Power Reg
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('T5FactionBaseComponent2', 500)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> 500 Hydraulic Piston
                  </button>
                  {/* T6 Components */}
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('T6BalisticWeave', 500)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> 500 Ballistic Weave
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('T6FilteredFabric', 500)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> 500 Atmos Filter Fabric
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('T6HeavyCalliberCompressor', 500)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> 500 Fluted Heavy Comp.
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('T6LightCalliberCompressor', 500)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> 500 Fluted Light Comp.
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('T6HoltzmanActuator', 500)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> 500 Improved Holtzman
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('T6Watertube', 500)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> 500 Improved Watertube
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('T6IrradiatedCore', 500)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> 500 Irradiated Core
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('T6CarbidePladeParts', 500)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> 500 Carbide Blade Parts
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('T6PlasteelComponent', 500)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> 500 Plasteel Plate
                  </button>
                  {/* Faction Specialty */}
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('FremenComponent1', 500)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> 500 EMF Generator
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('FremenComponent2', 500)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> 500 Micro-Sandwich Fabric
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('GreatHouseComponent1', 500)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> 500 Plasteel Microflora
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('GreatHouseComponent2', 500)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> 500 Mechanical Parts
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('D_GreatHouseComponent12', 500)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> 500 Adv. Mechanical Parts
                  </button>
                </div>
              </div>

              <div id="grant-cat-survival" className="mt-6 border-b border-th-border-m/40 pb-1" style={{ scrollMarginTop: '6rem' }}>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700/80 dark:text-amber-200/80"><span aria-hidden="true">🍞 </span>Survival &amp; Consumables</p>
              </div>

              <div className="mt-3">
                <p className="text-sm font-semibold text-th-text">Consumables and Survival</p>
                <p className="mt-1 text-xs text-th-text-m">Healkits, water, blood sacks, spice consumables. All use verified-real Unreal IDs.</p>
                <div className="mt-3 grid gap-2 grid-cols-2 md:grid-cols-4">
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('healthpack_channeled', 20)}>
                    <Heart className="mr-1.5 h-3.5 w-3.5" /> 20 Healkits
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('Bloodsack_01', 10)}>
                    <Droplets className="mr-1.5 h-3.5 w-3.5" /> 10 Small Blood Sacks
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('Bloodsack_03', 10)}>
                    <Droplets className="mr-1.5 h-3.5 w-3.5" /> 10 Large Blood Sacks
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('Bloodsack_T6', 5)}>
                    <Droplets className="mr-1.5 h-3.5 w-3.5" /> 5 Massive Blood Sacks
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('Literjon', 5)}>
                    <Droplets className="mr-1.5 h-3.5 w-3.5" /> 5 Literjons
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('Literjon_T6', 5)}>
                    <Droplets className="mr-1.5 h-3.5 w-3.5" /> 5 Literjon Mk6
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('Decajon', 1)}>
                    <Droplets className="mr-1.5 h-3.5 w-3.5" /> 1 Decaliterjon
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('AntiRadiationPill', 20)}>
                    <Heart className="mr-1.5 h-3.5 w-3.5" /> 20 Iodine Pills
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('SaphoJuice', 5)}>
                    <Droplets className="mr-1.5 h-3.5 w-3.5" /> 5 Sapho Juice
                  </button>
                </div>
              </div>

              <div id="grant-cat-apparel" className="mt-6 border-b border-th-border-m/40 pb-1" style={{ scrollMarginTop: '6rem' }}>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700/80 dark:text-amber-200/80"><span aria-hidden="true">🛡️ </span>Apparel &amp; Armor Sets</p>
              </div>

              <div className="mt-3">
                <p className="text-sm font-semibold text-th-text">Armor Sets</p>
                <p className="mt-1 text-xs text-th-text-m">Full armor sets (grants all pieces in one click).</p>
                <div className="mt-3 grid gap-2 grid-cols-2 md:grid-cols-3">
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantBatch([
                    { templateId: 'Combat_Nati_SandtroutLeathers01_Helmet', quantity: 1 },
                    { templateId: 'Combat_Nati_SandtroutLeathers01_Top', quantity: 1 },
                    { templateId: 'Combat_Nati_SandtroutLeathers01_Bottom', quantity: 1 },
                    { templateId: 'Combat_Nati_SandtroutLeathers01_Gloves', quantity: 1 },
                    { templateId: 'Combat_Nati_SandtroutLeathers01_Boots', quantity: 1 },
                  ])}>
                    <Shield className="mr-1.5 h-3.5 w-3.5" /> Sandtrout Leathers (Full)
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantBatch([
                    { templateId: 'Combat_Nati_ScavengerRags02_Helmet', quantity: 1 },
                    { templateId: 'Combat_Nati_ScavengerRags02_Top', quantity: 1 },
                    { templateId: 'Combat_Nati_ScavengerRags02_Bottom', quantity: 1 },
                    { templateId: 'Combat_Nati_ScavengerRags02_Gloves', quantity: 1 },
                    { templateId: 'Combat_Nati_ScavengerRags02_Boots', quantity: 1 },
                  ])}>
                    <Shield className="mr-1.5 h-3.5 w-3.5" /> Scavenger Rags (Full)
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('Stillsuit_Unique_Armored_01_Gloves_Schematic', 1)}>
                    <Shield className="mr-1.5 h-3.5 w-3.5" /> Unique Stillsuit Schematic
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantBatch([
                    { templateId: 'Stillsuit_Neut_Leaking01_Mask', quantity: 1 },
                    { templateId: 'Stillsuit_Neut_Leaking01_Top', quantity: 1 },
                    { templateId: 'Stillsuit_Neut_Leaking01_Gloves', quantity: 1 },
                    { templateId: 'Stillsuit_Neut_Leaking01_Boots', quantity: 1 },
                  ])}>
                    <Shield className="mr-1.5 h-3.5 w-3.5" /> Scavenger Stillsuit (Full)
                  </button>
                </div>
              </div>

              <div className="mt-5">
                <p className="text-sm font-semibold text-th-text">CHOAM Faction Gear</p>
                <p className="mt-1 text-xs text-th-text-m">Heavy and Stillsuit sets from the June 2026 patch. Click Full Set to grant all pieces at once.</p>
                <div className="mt-3 grid gap-2 grid-cols-2 md:grid-cols-3">
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantBatch([
                    { templateId: 'Combat_Choam_Heavy02_Helmet',  quantity: 1 },
                    { templateId: 'Combat_Choam_Heavy02_Top',     quantity: 1 },
                    { templateId: 'Combat_Choam_Heavy02_Bottom',  quantity: 1 },
                    { templateId: 'Combat_Choam_Heavy02_Gloves',  quantity: 1 },
                    { templateId: 'Combat_Choam_Heavy02_Boots',   quantity: 1 },
                  ])}>
                    <Shield className="mr-1.5 h-3.5 w-3.5" /> Kirab Heavy Set (Full)
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantBatch([
                    { templateId: 'Stillsuit_Choam_02_Mask',   quantity: 1 },
                    { templateId: 'Stillsuit_Choam_02_Top',    quantity: 1 },
                    { templateId: 'Stillsuit_Choam_02_Gloves', quantity: 1 },
                    { templateId: 'Stillsuit_Choam_02_Boots',  quantity: 1 },
                  ])}>
                    <Shield className="mr-1.5 h-3.5 w-3.5" /> Kirab Stillsuit (Full)
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantBatch([
                    { templateId: 'Stillsuit_Choam_04_Mask',   quantity: 1 },
                    { templateId: 'Stillsuit_Choam_04_Top',    quantity: 1 },
                    { templateId: 'Stillsuit_Choam_04_Gloves', quantity: 1 },
                    { templateId: 'Stillsuit_Choam_04_Boots',  quantity: 1 },
                  ])}>
                    <Shield className="mr-1.5 h-3.5 w-3.5" /> Native Stillsuit (Full)
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('CHOAMSword', 1)}>
                    <Swords className="mr-1.5 h-3.5 w-3.5" /> CHOAM Standard Sword
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('ChoamSda3', 1)}>
                    <Swords className="mr-1.5 h-3.5 w-3.5" /> CHOAM Standard Maula Pistol
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('ChoamCom1', 1)}>
                    <Swords className="mr-1.5 h-3.5 w-3.5" /> CHOAM Static Compactor
                  </button>
                </div>
              </div>

              <div className="mt-5">
                <p className="text-sm font-semibold text-th-text">Quality of Life Utilities</p>
                <p className="mt-1 text-xs text-th-text-m">Tools, belts, scanners, and other utilities that are not otherwise easy to obtain.</p>
                <div className="mt-3 grid gap-2 grid-cols-2 md:grid-cols-3">
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('BuildingBlueprint_CopyDevice', 1)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> Solido Replicator
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('Scanner_Base_1', 1)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> Resource Scanner
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('HighCapacityLiterjon', 1)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> Hajra Literjon Mk1
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('SuspensorBelt', 1)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> Leap Suspensor Belt
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('PartialStabilizationBelt', 1)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> Planar Suspensor Belt
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('HandHeldTorch', 1)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> Glowtube
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('HoltzmanShieldActiveDrain', 1)}>
                    <Shield className="mr-1.5 h-3.5 w-3.5" /> Holtzman Shield Mk2
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('HoltzmanShieldActiveDrain2', 1)}>
                    <Shield className="mr-1.5 h-3.5 w-3.5" /> Holtzman Shield Mk3
                  </button>
                </div>
              </div>

              <div className="mt-5">
                <p className="text-sm font-semibold text-th-text">Unique / Legendary Weapons</p>
                <p className="mt-1 text-xs text-th-text-m">One-off uniques and house-tier firearms not on the standard ladder.</p>
                <div className="mt-3 grid gap-2 grid-cols-2 md:grid-cols-3">
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('DewReaper_Scythe', 1)}>
                    <Swords className="mr-1.5 h-3.5 w-3.5" /> Dew Scythe Mk4
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('DewReaper_prototype', 1)}>
                    <Swords className="mr-1.5 h-3.5 w-3.5" /> Dew Reaper Mk2
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('MiningTool_1h_Unique_01', 1)}>
                    <Pickaxe className="mr-1.5 h-3.5 w-3.5" /> Sim&apos;s Cutter
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('UniqueSword', 1)}>
                    <Swords className="mr-1.5 h-3.5 w-3.5" /> Pseudo Pulse-Sword
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('UniqueSda_Story_Ari', 1)}>
                    <Swords className="mr-1.5 h-3.5 w-3.5" /> Ari&apos;s Pistol
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('AtreSmg2', 1)}>
                    <Swords className="mr-1.5 h-3.5 w-3.5" /> Disruptor M11 (Atre)
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('HarkAr5', 1)}>
                    <Swords className="mr-1.5 h-3.5 w-3.5" /> House Karpov 38 (Hark)
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('SmugDmr3', 1)}>
                    <Swords className="mr-1.5 h-3.5 w-3.5" /> Artisan JABAL Spitdart
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('Scattergun_Prototype0', 1)}>
                    <Swords className="mr-1.5 h-3.5 w-3.5" /> Artisan GRDA 44
                  </button>
                </div>
              </div>

              <div className="mt-5">
                <p className="text-sm font-semibold text-th-text">Weapon Ladders (Mk0 - Mk3)</p>
                <p className="mt-1 text-xs text-th-text-m">Dirk / Kindjal / Rapier tier progression and house-faction firearms.</p>
                <div className="mt-3 grid gap-2 grid-cols-2 md:grid-cols-3">
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('Dirk_0', 1)}><Swords className="mr-1.5 h-3.5 w-3.5" /> House Dirk</button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('Dirk_1', 1)}><Swords className="mr-1.5 h-3.5 w-3.5" /> Adept Dirk</button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('Dirk_3', 1)}><Swords className="mr-1.5 h-3.5 w-3.5" /> Regis Dirk</button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('Kindjal_1', 1)}><Swords className="mr-1.5 h-3.5 w-3.5" /> Artisan Kindjal</button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('Kindjal_2', 1)}><Swords className="mr-1.5 h-3.5 w-3.5" /> House Kindjal</button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('Kindjal_3', 1)}><Swords className="mr-1.5 h-3.5 w-3.5" /> Adept Kindjal</button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('Rapier_0', 1)}><Swords className="mr-1.5 h-3.5 w-3.5" /> Adept Rapier</button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('Rapier_3', 1)}><Swords className="mr-1.5 h-3.5 w-3.5" /> Regis Rapier</button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('CHOAMSword_2', 1)}><Swords className="mr-1.5 h-3.5 w-3.5" /> Adept Sword (CHOAM)</button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('ChoamSda4', 1)}><Swords className="mr-1.5 h-3.5 w-3.5" /> Artisan Maula Pistol</button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('HarkAr2', 1)}><Swords className="mr-1.5 h-3.5 w-3.5" /> Karpov 38 (Hark)</button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('HarkAr4', 1)}><Swords className="mr-1.5 h-3.5 w-3.5" /> Artisan Karpov 38</button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('Scattergun_Prototype', 1)}><Swords className="mr-1.5 h-3.5 w-3.5" /> Standard GRDA 44</button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('UniqueAr2', 1)}><Swords className="mr-1.5 h-3.5 w-3.5" /> Unique Assault Rifle Mk2</button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('UniqueSda_Doubleshot_04', 1)}><Swords className="mr-1.5 h-3.5 w-3.5" /> Unique Double-Shot Sidearm</button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('UniqueSword_04', 1)}><Swords className="mr-1.5 h-3.5 w-3.5" /> Unique Sword Mk4</button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('UniqueSword_05', 1)}><Swords className="mr-1.5 h-3.5 w-3.5" /> Replica Pulse-Sword Mk5</button>
                </div>
              </div>

              <div className="mt-5">
                <p className="text-sm font-semibold text-th-text">Tool Ladders</p>
                <p className="mt-1 text-xs text-th-text-m">Power packs, blood extractors, welding torches, and other tool tiers.</p>
                <div className="mt-3 grid gap-2 grid-cols-2 md:grid-cols-3">
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('PowerPack2', 1)}><Package className="mr-1.5 h-3.5 w-3.5" /> Power Pack Mk2</button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('PowerPack6', 1)}><Package className="mr-1.5 h-3.5 w-3.5" /> Power Pack Mk3</button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('PowerPack3', 1)}><Package className="mr-1.5 h-3.5 w-3.5" /> Power Pack Mk4</button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('PowerPack7', 1)}><Package className="mr-1.5 h-3.5 w-3.5" /> Power Pack Mk5</button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('repairtool3', 1)}><Package className="mr-1.5 h-3.5 w-3.5" /> Welding Torch Mk3</button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('repairtool5', 1)}><Package className="mr-1.5 h-3.5 w-3.5" /> Welding Torch Mk5</button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('BodyFluidExtractor_02', 1)}><Package className="mr-1.5 h-3.5 w-3.5" /> Blood Extractor Mk2</button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('BodyFluidExtractor_03', 1)}><Package className="mr-1.5 h-3.5 w-3.5" /> Blood Extractor Mk4</button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('BodyFluidExtractor_2h_tier6', 1)}><Package className="mr-1.5 h-3.5 w-3.5" /> Blood Extractor Mk6</button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('MiningTool_1h_Light', 1)}><Pickaxe className="mr-1.5 h-3.5 w-3.5" /> Cutteray Mk2</button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('miningtool_2h_light', 1)}><Pickaxe className="mr-1.5 h-3.5 w-3.5" /> Cutteray Mk5 (2H)</button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('fullsuspensorbelt', 1)}><Package className="mr-1.5 h-3.5 w-3.5" /> Full Suspensor Belt</button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('holtzmanshieldactivedrain3', 1)}><Shield className="mr-1.5 h-3.5 w-3.5" /> Holtzman Shield Mk5</button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('vehiclebackuptool', 1)}><Package className="mr-1.5 h-3.5 w-3.5" /> Vehicle Backup Tool</button>
                </div>
              </div>

              <div className="mt-5">
                <p className="text-sm font-semibold text-th-text">CHOAM Light Mk6 Armor</p>
                <p className="mt-1 text-xs text-th-text-m">Mk6-tier CHOAM light armor; click Full Set for the complete kit.</p>
                <div className="mt-3 grid gap-2 grid-cols-2 md:grid-cols-3">
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantBatch([
                    { templateId: 'combat_choam_light06_helmet', quantity: 1 },
                    { templateId: 'combat_choam_light06_top',    quantity: 1 },
                    { templateId: 'combat_choam_light06_bottom', quantity: 1 },
                    { templateId: 'combat_choam_light06_gloves', quantity: 1 },
                    { templateId: 'combat_choam_light06_boots',  quantity: 1 },
                  ])}><Shield className="mr-1.5 h-3.5 w-3.5" /> CHOAM Light Mk6 (Full)</button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('combat_choam_light06_helmet', 1)}><Shield className="mr-1.5 h-3.5 w-3.5" /> Helmet</button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('combat_choam_light06_top', 1)}><Shield className="mr-1.5 h-3.5 w-3.5" /> Chest</button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('combat_choam_light06_bottom', 1)}><Shield className="mr-1.5 h-3.5 w-3.5" /> Legs</button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('combat_choam_light06_gloves', 1)}><Shield className="mr-1.5 h-3.5 w-3.5" /> Gloves</button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('combat_choam_light06_boots', 1)}><Shield className="mr-1.5 h-3.5 w-3.5" /> Boots</button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('Combat_Choam_Light02_Top', 1)}><Shield className="mr-1.5 h-3.5 w-3.5" /> Kirab Scout Jacket</button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('Combat_Choam_Light02_Gloves', 1)}><Shield className="mr-1.5 h-3.5 w-3.5" /> Kirab Scout Gloves</button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('Combat_Choam_Light03_Boots', 1)}><Shield className="mr-1.5 h-3.5 w-3.5" /> Slaver Scout Boots</button>
                </div>
              </div>

              <div className="mt-5">
                <p className="text-sm font-semibold text-th-text">Unique Stillsuits (Efficient T4 / Batigh T5)</p>
                <p className="mt-1 text-xs text-th-text-m">High-tier unique stillsuit variants with efficient water reclamation.</p>
                <div className="mt-3 grid gap-2 grid-cols-2 md:grid-cols-3">
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantBatch([
                    { templateId: 'Stillsuit_Unique_Efficient_04_mask',   quantity: 1 },
                    { templateId: 'Stillsuit_Unique_Efficient_04_top',    quantity: 1 },
                    { templateId: 'Stillsuit_Unique_Efficient_04_gloves', quantity: 1 },
                    { templateId: 'Stillsuit_Unique_Efficient_04_boots',  quantity: 1 },
                  ])}><Shield className="mr-1.5 h-3.5 w-3.5" /> Efficient T4 (Full)</button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantBatch([
                    { templateId: 'stillsuit_unique_efficient_05_mask',   quantity: 1 },
                    { templateId: 'stillsuit_unique_efficient_05_top',    quantity: 1 },
                    { templateId: 'stillsuit_unique_efficient_05_gloves', quantity: 1 },
                    { templateId: 'stillsuit_unique_efficient_05_boots',  quantity: 1 },
                  ])}><Shield className="mr-1.5 h-3.5 w-3.5" /> Batigh T5 (Full)</button>
                </div>
              </div>

              <div className="mt-5">
                <p className="text-sm font-semibold text-th-text">More Vehicle Parts (lower tiers)</p>
                <p className="mt-1 text-xs text-th-text-m">Mid-tier (Mk1-Mk3) ladder pieces for the Buggy and Sandbike.</p>
                <div className="mt-3 grid gap-2 grid-cols-2 md:grid-cols-3">
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('BuggyBoost_3', 1)}><Package className="mr-1.5 h-3.5 w-3.5" /> Buggy Booster Mk3</button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('BuggyGenerator_3', 1)}><Package className="mr-1.5 h-3.5 w-3.5" /> Buggy PSU Mk3</button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('BuggyInventory_3', 1)}><Package className="mr-1.5 h-3.5 w-3.5" /> Buggy Storage Mk3</button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('SandbikeHull_1', 1)}><Package className="mr-1.5 h-3.5 w-3.5" /> Sandbike Hull Mk1</button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('SandbikeEngine_1', 1)}><Package className="mr-1.5 h-3.5 w-3.5" /> Sandbike Engine Mk1</button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('SandbikeEngine_3', 1)}><Package className="mr-1.5 h-3.5 w-3.5" /> Sandbike Engine Mk3</button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('SandbikeLocomotion_1', 1)}><Package className="mr-1.5 h-3.5 w-3.5" /> Sandbike Tread Mk1</button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('SandbikeBoost_2', 1)}><Package className="mr-1.5 h-3.5 w-3.5" /> Sandbike Booster Mk2</button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('SandbikeGenerator_1', 1)}><Package className="mr-1.5 h-3.5 w-3.5" /> Sandbike PSU Mk1</button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('SandbikeGenerator_3', 1)}><Package className="mr-1.5 h-3.5 w-3.5" /> Sandbike PSU Mk3</button>
                </div>
              </div>

              <div className="mt-5">
                <p className="text-sm font-semibold text-th-text">More Consumables</p>
                <p className="mt-1 text-xs text-th-text-m">Healthpack tiers, blood sacks, and Melange spice food/drink.</p>
                <div className="mt-3 grid gap-2 grid-cols-2 md:grid-cols-3">
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('HealthPack_Channeled_2', 20)}><Heart className="mr-1.5 h-3.5 w-3.5" /> 20 Healkit Mk2</button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('HealthPack_Channeled_3', 20)}><Heart className="mr-1.5 h-3.5 w-3.5" /> 20 Healkit Mk4</button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('HealthPack_Channeled_4', 20)}><Heart className="mr-1.5 h-3.5 w-3.5" /> 20 Healkit Mk6</button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('Bloodsack_02', 5)}><Droplets className="mr-1.5 h-3.5 w-3.5" /> 5 Medium Blood Sack</button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('SpiceAddictionConsumable_01', 10)}><Droplets className="mr-1.5 h-3.5 w-3.5" /> 10 Melange Spiced Food</button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('SpiceAddictionConsumable_02', 10)}><Droplets className="mr-1.5 h-3.5 w-3.5" /> 10 Melange Spiced Beer</button>
                </div>
              </div>

              <div className="mt-5">
                <p className="text-sm font-semibold text-th-text">Emotes</p>
                <p className="mt-1 text-xs text-th-text-m">Character animations and gestures.</p>
                <div className="mt-3 grid gap-2 grid-cols-3 md:grid-cols-6">
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('Emote_Bow_01', 1)}>Bow</button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('Emote_KaitanBow_01', 1)}>Kaitan Bow</button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('Emote_AtreSalute_01', 1)}>Atre Salute</button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('Emote_Clap_01', 1)}>Clap</button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('Emote_Yes_01', 1)}>Yes</button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('Emote_No_01', 1)}>No</button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('Emote_Point_01', 1)}>Point</button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('Emote_Sit_01', 1)}>Sit</button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('Emote_Threaten_01', 1)}>Threaten</button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('Emote_Follow_01', 1)}>Follow</button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('Emote_ShakeOffSand_01', 1)}>Shake Sand</button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('Emote_AdjustStillsuit', 1)}>Adjust Suit</button>
                </div>
              </div>

              <div id="grant-cat-cosmetics" className="mt-6 border-b border-th-border-m/40 pb-1" style={{ scrollMarginTop: '6rem' }}>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700/80 dark:text-amber-200/80"><span aria-hidden="true">✨ </span>Cosmetics, Schematics &amp; Custom</p>
              </div>

              <div className="mt-3">
                <p className="text-sm font-semibold text-th-text">Cosmetics and Schematics</p>
                <p className="mt-1 text-xs text-th-text-m">Social outfits, schematics, and other unique items.</p>
                <div className="mt-3 grid gap-2 grid-cols-2 md:grid-cols-3">
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantBatch([
                    { templateId: 'Social_Choam_MaulaCastOffs01_Top_Fremkit', quantity: 1 },
                    { templateId: 'Social_Choam_MaulaCastOffs01_Bottom', quantity: 1 },
                    { templateId: 'Social_Choam_MaulaCastOffs01_Gloves', quantity: 1 },
                    { templateId: 'Social_Choam_MaulaCastOffs01_Shoes', quantity: 1 },
                  ])}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> Maula Cast-Offs (Full)
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('PowerPack_Unique_Regen_01_Schematic', 1)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> Regen PowerPack Schematic
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('Schematic_UniqueSuspensor', 1)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> Suspensor Schematic
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('Schematic_UniqueLiterjon', 1)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> Unique Literjon Schematic
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('ContractItem', 1)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> Contract Item
                  </button>
                </div>
              </div>

              <div className="mt-6 rounded-3xl border border-th-border-m/80 bg-th-bg/30 p-5">
                <p className="text-sm font-semibold text-th-text">Custom item grant</p>
                <p className="mt-1 text-xs text-th-text-m">Enter any item template ID. Search below to find valid IDs.</p>
                <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto_auto]">
                  <input
                    className="dune-input"
                    placeholder="Template ID (e.g. ScrapMetal)"
                    value={grantTemplate}
                    onChange={(e) => setGrantTemplate(e.target.value)}
                    disabled={granting}
                  />
                  <input
                    className="dune-input w-24"
                    type="number"
                    min={1}
                    placeholder="Qty"
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
                    <input className="dune-input" type="number" placeholder="X" value={teleportX} onChange={(e) => setTeleportX(e.target.value)} disabled={teleporting} />
                    <input className="dune-input" type="number" placeholder="Y" value={teleportY} onChange={(e) => setTeleportY(e.target.value)} disabled={teleporting} />
                    <input className="dune-input" type="number" placeholder="Z" value={teleportZ} onChange={(e) => setTeleportZ(e.target.value)} disabled={teleporting} />
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
    </div>
  );
}
