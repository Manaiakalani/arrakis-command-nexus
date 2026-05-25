'use client';

import {
  AlertTriangle,
  Backpack,
  BookOpen,
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
  Shield,
  Swords,
  UserCog,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { useApi } from '@/hooks/useApi';
import { apiClient } from '@/lib/api';
import type { CharacterRecord, CharacterStatField, CharacterStatsSchema } from '@/lib/types';
import { cn } from '@/lib/utils';

type SaveState = {
  tone: 'success' | 'error';
  message: string;
} | null;

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
  const [grantResult, setGrantResult] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const [granting, setGranting] = useState(false);
  const [templateResults, setTemplateResults] = useState<{ id: string; count: number; source?: string; category?: string }[]>([]);
  const [searchingTemplates, setSearchingTemplates] = useState(false);
  const [inventoryData, setInventoryData] = useState<Record<string, { template_id: string; stack_size: number; position_index: number; quality_level: number }[]> | null>(null);
  const [loadingInventory, setLoadingInventory] = useState(false);
  const [teleportX, setTeleportX] = useState('');
  const [teleportY, setTeleportY] = useState('');
  const [teleportZ, setTeleportZ] = useState('');
  const [teleporting, setTeleporting] = useState(false);
  const [teleportResult, setTeleportResult] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [catalogData, setCatalogData] = useState<{ id: string; count: number; source?: string; category?: string }[] | null>(null);
  const [loadingCatalog, setLoadingCatalog] = useState(false);

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
    if (!selectedId) return;
    const tid = templateId ?? grantTemplate.trim();
    const qty = amount ?? (parseInt(grantAmount, 10) || 1);
    if (!tid) {
      setGrantResult({ tone: 'error', message: 'Enter an item template ID.' });
      return;
    }
    setGranting(true);
    setGrantResult(null);
    try {
      const result = await apiClient.grantItem(selectedId, tid, qty);
      setGrantResult({ tone: 'success', message: `Granted ${qty}x ${tid} (item #${result.item_id}). Relog to pick up.` });
      if (!templateId) { setGrantTemplate(''); setGrantAmount('1'); }
    } catch (error) {
      setGrantResult({ tone: 'error', message: error instanceof Error ? error.message : 'Grant failed.' });
    } finally {
      setGranting(false);
    }
  };

  const handleGrantBatch = async (items: { templateId: string; quantity: number }[]) => {
    if (!selectedId || items.length === 0) return;
    setGranting(true);
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
      setGrantResult({ tone: 'success', message: `Granted ${granted} items. Relog to pick up.` });
    } else if (granted > 0) {
      setGrantResult({ tone: 'error', message: `Granted ${granted}/${items.length}. Last error: ${lastError}` });
    } else {
      setGrantResult({ tone: 'error', message: lastError || 'All grants failed.' });
    }
    setGranting(false);
  };

  const handleGrantSolari = async (amount: number) => {
    if (!selectedId) return;
    setGranting(true);
    setGrantResult(null);
    try {
      const result = await apiClient.grantSolari(selectedId, amount);
      setGrantResult({ tone: 'success', message: `Added ${result.solari_added} Solari (total: ${result.new_total}). Relog to pick up.` });
    } catch (error) {
      setGrantResult({ tone: 'error', message: error instanceof Error ? error.message : 'Grant failed.' });
    } finally {
      setGranting(false);
    }
  };

  const handleSetHealth = async (hp: number) => {
    if (!selectedId) return;
    setGranting(true);
    setGrantResult(null);
    try {
      await apiClient.setHealth(selectedId, hp);
      setGrantResult({ tone: 'success', message: `Max health set to ${hp}. Relog to apply.` });
      void handleReset();
    } catch (error) {
      setGrantResult({ tone: 'error', message: error instanceof Error ? error.message : 'Failed.' });
    } finally {
      setGranting(false);
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
    } catch {
      setTemplateResults([]);
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
    } catch {
      setCatalogData([]);
    } finally {
      setLoadingCatalog(false);
    }
  };

  const loadInventory = async () => {
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

  useEffect(() => {
    if (selectedId) {
      setInventoryData(null);
      void loadInventory();
      setGrantResult(null);
      setTeleportResult(null);
      setTemplateResults([]);
    }
  }, [selectedId]);

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
            <h2 className="mt-1 text-xl font-semibold text-th-text">Search and Select</h2>
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
                  <h3 className="text-xl font-semibold text-th-text">No Characters Discovered</h3>
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
                <h2 className="mt-1 text-2xl font-semibold text-th-text">{selectedCharacter?.name ?? 'No character selected'}</h2>
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
            <h2 className="mt-1 text-xl font-semibold text-th-text">Editable Stat Layout</h2>
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
                  <p className="section-title">Grant Items and Resources</p>
                  <h2 className="mt-1 text-xl font-semibold text-th-text">Quick Grant to {selectedCharacter.name}</h2>
                </div>
              </div>

              {grantResult ? (
                <div className={cn('mt-4 rounded-2xl border px-4 py-3 text-sm', grantResult.tone === 'success' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200' : 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-200')}>
                  {grantResult.message}
                </div>
              ) : null}

              <div className="mt-5">
                <p className="text-sm font-semibold text-th-text">Quick Grants</p>
                <p className="mt-1 text-xs text-th-text-m">One-click common items and resources. Player must relog to receive.</p>
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

              <div className="mt-5">
                <p className="text-sm font-semibold text-th-text">Weapons</p>
                <p className="mt-1 text-xs text-th-text-m">Melee weapons, ranged weapons, and ammunition.</p>
                <div className="mt-3 grid gap-2 grid-cols-2 md:grid-cols-4">
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('ScrapMetalKnife', 1)}>
                    <Swords className="mr-1.5 h-3.5 w-3.5" /> Scrap Metal Knife
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('T1_MeleeKindjal0', 1)}>
                    <Swords className="mr-1.5 h-3.5 w-3.5" /> Kindjal
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('ChoamSda1', 1)}>
                    <Swords className="mr-1.5 h-3.5 w-3.5" /> Choam Sidearm
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('ChoamMaulaPistol', 1)}>
                    <Swords className="mr-1.5 h-3.5 w-3.5" /> Maula Pistol
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('AssaultRifle', 1)}>
                    <Swords className="mr-1.5 h-3.5 w-3.5" /> Assault Rifle
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('T3_Tool_SurveyProbeLauncher', 1)}>
                    <Swords className="mr-1.5 h-3.5 w-3.5" /> Survey Probe Launcher
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('Ammo', 500)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> 500 Ammo
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('T3_Tool_SurveyProbeAmmo', 20)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> 20 Survey Probes
                  </button>
                </div>
              </div>

              <div className="mt-5">
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
                    <Flame className="mr-1.5 h-3.5 w-3.5" /> Power Pack
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

              <div className="mt-5">
                <p className="text-sm font-semibold text-th-text">Vehicle Parts</p>
                <p className="mt-1 text-xs text-th-text-m">Sandbike components for crafting a vehicle.</p>
                <div className="mt-3 grid gap-2 grid-cols-2 md:grid-cols-3">
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('T2_Vehicle_Ground__SandBikeBodyHull', 1)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> Sandbike Body Hull
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('T2_Vehicle_Ground__SandBikeChassis', 1)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> Sandbike Chassis
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('T2_SandbikeEngine', 1)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> Sandbike Engine
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('T2_Vehicle_Ground__SandBikeTreads', 1)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> Sandbike Treads
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('T2_Vehicle_Ground__SandBikeInventoryModule', 1)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> Sandbike Inventory Module
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('T1_Structure_RespawnBeacon1', 1)}>
                    <MapPin className="mr-1.5 h-3.5 w-3.5" /> Respawn Beacon
                  </button>
                </div>
              </div>

              <div className="mt-5">
                <p className="text-sm font-semibold text-th-text">Raw Materials</p>
                <p className="mt-1 text-xs text-th-text-m">Crafting resources and building materials.</p>
                <div className="mt-3 grid gap-2 grid-cols-2 md:grid-cols-4">
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('ScrapMetal', 500)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> 500 Scrap Metal
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('Stone', 500)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> 500 Stone
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('PlantFiber', 500)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> 500 Plant Fiber
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('Oil', 200)}>
                    <Droplets className="mr-1.5 h-3.5 w-3.5" /> 200 Oil
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('AzuriteOre', 200)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> 200 Azurite Ore
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('FuelCanister', 10)}>
                    <Flame className="mr-1.5 h-3.5 w-3.5" /> 10 Fuel Canisters
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('T1UniqueComponent', 20)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> 20 T1 Unique Parts
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('T2HeavyComponent', 20)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> 20 T2 Heavy Parts
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('FremenComponent1', 50)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> 50 Fremen Parts I
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('FremenComponent2', 50)}>
                    <Package className="mr-1.5 h-3.5 w-3.5" /> 50 Fremen Parts II
                  </button>
                </div>
              </div>

              <div className="mt-5">
                <p className="text-sm font-semibold text-th-text">Consumables and Survival</p>
                <p className="mt-1 text-xs text-th-text-m">Health packs, water, blood sacks, and other consumables.</p>
                <div className="mt-3 grid gap-2 grid-cols-2 md:grid-cols-4">
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('HealthPack', 20)}>
                    <Heart className="mr-1.5 h-3.5 w-3.5" /> 20 Health Packs
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('healthpack_channeled', 10)}>
                    <Heart className="mr-1.5 h-3.5 w-3.5" /> 10 Channeled Heal
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('Bloodsack_01', 20)}>
                    <Droplets className="mr-1.5 h-3.5 w-3.5" /> 20 Blood Sacks
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantItem('Literjon', 5)}>
                    <Droplets className="mr-1.5 h-3.5 w-3.5" /> 5 Literjons
                  </button>
                </div>
              </div>

              <div className="mt-5">
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
                    { templateId: 'T1_Armor_BanditLeathers_Head', quantity: 1 },
                    { templateId: 'T1_Armor_BanditLeathers_Chest', quantity: 1 },
                    { templateId: 'T1_Armor_BanditLeathers_Legs', quantity: 1 },
                    { templateId: 'T1_Armor_BanditLeathers_Hands', quantity: 1 },
                    { templateId: 'T1_Armor_BanditLeathers_Feet', quantity: 1 },
                  ])}>
                    <Shield className="mr-1.5 h-3.5 w-3.5" /> Bandit Leathers (Full)
                  </button>
                  <button type="button" className="dune-button-muted text-xs" disabled={granting} onClick={() => void handleGrantBatch([
                    { templateId: 'ScavengerRags_Helmet', quantity: 1 },
                    { templateId: 'ScavengerRags_Top', quantity: 1 },
                    { templateId: 'ScavengerRags_Bottom', quantity: 1 },
                    { templateId: 'ScavengerRags_Gloves', quantity: 1 },
                    { templateId: 'ScavengerRags_Boots', quantity: 1 },
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
                    <Shield className="mr-1.5 h-3.5 w-3.5" /> Leaky Stillsuit (Full)
                  </button>
                </div>
              </div>

              <div className="mt-6 rounded-3xl border border-th-border-m/80 bg-th-bg/30 p-5">
                <p className="text-sm font-semibold text-th-text">Custom Item Grant</p>
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
                    {catalogOpen ? 'Hide Catalog' : 'Browse All'}
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
                          <span className="font-medium text-th-text">{t.id}</span>
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
                      const categoryOrder = ['Weapons', 'Tools', 'Resources', 'Consumables', 'Currency', 'Armor', 'Cosmetics', 'Vehicle Parts', 'Schematics', 'Structures', 'Contracts', 'Emotes', 'Unknown'];
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
                                className="group relative rounded-full border border-th-border px-3 py-1 text-xs text-th-text-s hover:border-amber-500/40 hover:bg-amber-500/10 transition-colors"
                                title={`${item.id} (${item.source}${item.count > 0 ? `, ${item.count} in DB` : ''})`}
                                disabled={granting}
                                onClick={() => { setGrantTemplate(item.id); setCatalogOpen(false); }}
                              >
                                {item.id}
                                {item.count > 0 && <span className="ml-1 text-th-text-m">({item.count})</span>}
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
                {inventoryData ? (
                  <div className="mt-4 space-y-4">
                    {Object.entries(inventoryData).map(([invName, items]) => (
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
                  </div>
                ) : loadingInventory ? (
                  <div className="mt-4 flex items-center gap-2 text-sm text-th-text-m">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading inventory...
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
