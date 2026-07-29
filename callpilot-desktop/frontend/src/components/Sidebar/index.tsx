'use client';

// CallPilot sidebar — Figma "16thapartment" treatment, pixel-perfect.
//
// Visual reference: callpilot-desktop/.../figma node-id 1:4 (Aside - Left Sidebar)
//   • 240px wide, white bg, 1px hairline border on the right (#e5e7eb)
//   • Top: workspace picker (24×24 black badge + brand name + chevron-down)
//   • Middle: nav list (Home, Import, Meetings) — 4px gap, 12px row padding
//   • Below Meetings: meeting children rendered inline (no eyebrow header,
//     no count badge — matches Figma's quiet active treatment)
//   • Bottom: 2 footer links (Help, Settings) — same Link style, no divider
//   • Search: inline input styled as a Figma nav row (no border, slate-50 bg)
//   • Active state: bg-[#f3f4f6] + text-[#111827] — no left-edge gradient bar
//   • Collapse: a 16×16 chevron-left sits next to the workspace chevron-down
//
// Functionality preserved end-to-end:
//   - sidebar collapse/expand (stored in SidebarProvider)
//   - instant transcript search (debounced via SidebarProvider)
//   - meeting list + edit/delete + PATCH/DELETE on /api/v1/meetings
//   - Settings modal + About modal (Info)
//   - model-config-updated event listener
//   - authedApiCall routing through the .NET Gateway

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  ChevronLeft,
  ChevronRight as ChevronRightIcon,
  File,
  Settings,
  Home,
  Trash2,
  Search as SearchIcon,
  Pencil,
  NotebookPen,
  X,
  Upload,
  HelpCircle,
} from 'lucide-react';
import { useRouter, usePathname } from 'next/navigation';
import { useSidebar } from './SidebarProvider';
import type { CurrentMeeting } from '@/components/Sidebar/SidebarProvider';
import { ConfirmationModal } from '../ConfirmationModel/confirmation-modal';
import { ModelConfig } from '@/components/ModelSettingsModal';
import { SettingTabs } from '../SettingTabs';
import { TranscriptModelProps } from '@/components/TranscriptSettings';
import Analytics from '@/lib/analytics';
import { invoke } from '@tauri-apps/api/core';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from 'sonner';
import { useImportDialog } from '@/contexts/ImportDialogContext';
import { useConfig } from '@/contexts/ConfigContext';

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog';
import { VisuallyHidden } from '@/components/ui/visually-hidden';

import { MessageToast } from '../MessageToast';
import { UserChip } from './UserChip';
import { Input } from '../ui/input';

// ──────────────────────────────────────────────────────────────────────────────
// Figma pixel-perfect tokens
// ──────────────────────────────────────────────────────────────────────────────
const FIGMA = {
  sidebarBorder: '#e5e7eb',
  activeBg: '#f3f4f6',
  activeText: '#111827',
  inactiveText: '#374151',
  mutedText: '#6b7280',
  dimText: '#9ca3af',
  linkRadius: 6,
  linkPaddingX: 12,
  linkPaddingY: 8,
  linkGap: 12,
  listGap: 4,
  listPaddingBottom: 40,
  footerPaddingBottom: 16,
  iconSize: 20,
  fontSize: 14,
  lineHeight: 20,
  fontWeight: 500,
  workspaceBadgeSize: 24,
  workspaceBadgeRadius: 4,
} as const;

interface SidebarItem {
  id: string;
  title: string;
  type: 'folder' | 'file';
  children?: SidebarItem[];
}

/** Single source of truth for active-route → nav-key mapping. */
function isNavActive(pathname: string | null, key: 'home' | 'meetings' | 'settings'): boolean {
  if (!pathname) return false;
  if (key === 'home') return pathname === '/';
  if (key === 'meetings') return pathname.startsWith('/meeting-details');
  if (key === 'settings') return pathname.startsWith('/settings');
  return false;
}

/** Reusable Figma nav-link treatment. Drives the entire rail's vocabulary. */
const LinkClass = (active: boolean): string =>
  [
    'group flex w-full items-center rounded-md',
    'gap-3 px-3 py-2',
    'text-sm font-medium',
    'leading-5',
    'transition-colors duration-150',
    active
      ? 'bg-[var(--nav-active-bg)] text-[var(--nav-active-text)]'
      : 'text-[var(--nav-inactive-text)] hover:bg-[var(--nav-active-bg)] hover:text-[var(--nav-active-text)]',
  ].join(' ');

const Sidebar: React.FC = () => {
  const router = useRouter();
  const pathname = usePathname();
  const {
    currentMeeting,
    setCurrentMeeting,
    sidebarItems,
    isCollapsed,
    toggleCollapse,
    searchTranscripts,
    searchResults,
    isSearching,
    meetings,
    setMeetings,
    serverAddress,
  } = useSidebar();

  const { openImportDialog } = useImportDialog();
  const { betaFeatures } = useConfig();
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [showModelSettings, setShowModelSettings] = useState(false);
  const [modelConfig, setModelConfig] = useState<ModelConfig>({
    provider: 'ollama',
    model: '',
    whisperModel: '',
    apiKey: null,
    ollamaEndpoint: null,
  });
  const [transcriptModelConfig, setTranscriptModelConfig] = useState<TranscriptModelProps>({
    provider: 'parakeet',
    model: 'parakeet-tdt-0.6b-v3-int8',
  });
  const [settingsSaveSuccess, setSettingsSaveSuccess] = useState<boolean | null>(null);

  // Edit + delete modal state
  const [editModalState, setEditModalState] = useState<{ isOpen: boolean; meetingId: string | null; currentTitle: string }>({
    isOpen: false,
    meetingId: null,
    currentTitle: '',
  });
  const [editingTitle, setEditingTitle] = useState<string>('');
  const [deleteModalState, setDeleteModalState] = useState<{ isOpen: boolean; itemId: string | null }>({
    isOpen: false,
    itemId: null,
  });

  // ─── Model config fetch ────────────────────────────────────────────────────
  useEffect(() => {
    if (!serverAddress) return;
    const fetchModelConfig = async () => {
      try {
        const data = (await invoke('api_get_model_config')) as any;
        if (data && data.provider !== null) {
          if (data.provider !== 'ollama' && !data.apiKey) {
            try {
              const apiKeyData = (await invoke('api_get_api_key', { provider: data.provider })) as string;
              data.apiKey = apiKeyData;
            } catch (err) {
              console.error('Failed to fetch API key:', err);
            }
          }
          setModelConfig(data);
        }
      } catch (error) {
        console.error('Failed to fetch model config:', error);
      }
    };
    fetchModelConfig();
  }, [serverAddress]);

  useEffect(() => {
    if (!serverAddress) return;
    const fetchTranscriptSettings = async () => {
      try {
        const data = (await invoke('api_get_transcript_config')) as any;
        if (data && data.provider !== null) {
          setTranscriptModelConfig(data);
        }
      } catch (error) {
        console.error('Failed to fetch transcript settings:', error);
      }
    };
    fetchTranscriptSettings();
  }, [serverAddress]);

  useEffect(() => {
    const setupListener = async () => {
      const { listen } = await import('@tauri-apps/api/event');
      const unlisten = await listen<ModelConfig>('model-config-updated', (event) => {
        setModelConfig(event.payload);
      });
      return unlisten;
    };
    let cleanup: (() => void) | undefined;
    setupListener().then((fn) => (cleanup = fn));
    return () => {
      cleanup?.();
    };
  }, []);

  // ─── Save handlers ────────────────────────────────────────────────────────
  const handleSaveModelConfig = async (config: ModelConfig) => {
    try {
      await invoke('api_save_model_config', {
        provider: config.provider,
        model: config.model,
        whisperModel: config.whisperModel,
        apiKey: config.apiKey,
        ollamaEndpoint: config.ollamaEndpoint,
      });
      setModelConfig(config);
      setSettingsSaveSuccess(true);
      const { emit } = await import('@tauri-apps/api/event');
      await emit('model-config-updated', config);
      await Analytics.trackSettingsChanged('model_config', `${config.provider}_${config.model}`);
    } catch (error) {
      console.error('Error saving model config:', error);
      setSettingsSaveSuccess(false);
    }
  };

  const handleSaveTranscriptConfig = async (updatedConfig?: TranscriptModelProps) => {
    try {
      const configToSave = updatedConfig || transcriptModelConfig;
      const payload = {
        provider: configToSave.provider,
        model: configToSave.model,
        apiKey: configToSave.apiKey ?? null,
      };
      await invoke('api_save_transcript_config', {
        provider: payload.provider,
        model: payload.model,
        apiKey: payload.apiKey,
      });
      setSettingsSaveSuccess(true);
      await Analytics.trackSettingsChanged(
        'transcript_config',
        `${configToSave.provider}_${configToSave.model}`,
      );
    } catch (error) {
      console.error('Failed to save transcript config:', error);
      setSettingsSaveSuccess(false);
    }
  };

  // ─── Search ───────────────────────────────────────────────────────────────
  const handleSearchChange = useCallback(
    async (value: string) => {
      setSearchQuery(value);
      if (!value.trim()) return;
      await searchTranscripts(value);
    },
    [searchTranscripts],
  );

  // ─── Filtered meeting list ────────────────────────────────────────────────
  const filteredSidebarItems = useMemo(() => {
    if (!searchQuery.trim()) return sidebarItems;

    if (searchResults.length > 0) {
      const matchedMeetingIds = new Set(searchResults.map((r) => r.id));
      return sidebarItems
        .map((folder) => {
          if (folder.type === 'folder') {
            if (!folder.children) return folder;
            const filteredChildren = folder.children.filter(
              (item) =>
                matchedMeetingIds.has(item.id) ||
                item.title.toLowerCase().includes(searchQuery.toLowerCase()),
            );
            return { ...folder, children: filteredChildren };
          }
          return matchedMeetingIds.has(folder.id) ||
            folder.title.toLowerCase().includes(searchQuery.toLowerCase())
            ? folder
            : undefined;
        })
        .filter((item): item is SidebarItem => item !== undefined);
    }

    return sidebarItems
      .map((folder) => {
        if (folder.type === 'folder') {
          if (!folder.children) return folder;
          const filteredChildren = folder.children.filter((item) =>
            item.title.toLowerCase().includes(searchQuery.toLowerCase()),
          );
          return { ...folder, children: filteredChildren };
        }
        return folder.title.toLowerCase().includes(searchQuery.toLowerCase()) ? folder : undefined;
      })
      .filter((item): item is SidebarItem => item !== undefined);
  }, [sidebarItems, searchQuery, searchResults]);

  // ─── Delete / edit handlers ───────────────────────────────────────────────
  const handleDelete = async (itemId: string) => {
    try {
      const { authedApiCall } = await import('@/lib/auth');
      await authedApiCall('DELETE', `/api/v1/meetings/${itemId}`);
      const updatedMeetings = meetings.filter((m: CurrentMeeting) => m.id !== itemId);
      setMeetings(updatedMeetings);
      Analytics.trackMeetingDeleted(itemId);
      toast.success('Meeting deleted successfully', {
        description: 'All associated data has been removed',
      });
      if (currentMeeting?.id === itemId) {
        setCurrentMeeting({ id: 'intro-call', title: '+ New Call' });
        router.push('/');
      }
    } catch (error) {
      console.error('Failed to delete meeting:', error);
      toast.error('Failed to delete meeting', {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const handleDeleteConfirm = () => {
    if (deleteModalState.itemId) handleDelete(deleteModalState.itemId);
    setDeleteModalState({ isOpen: false, itemId: null });
  };

  const handleEditStart = (meetingId: string, currentTitle: string) => {
    setEditModalState({ isOpen: true, meetingId, currentTitle });
    setEditingTitle(currentTitle);
  };

  const handleEditConfirm = async () => {
    const newTitle = editingTitle.trim();
    const meetingId = editModalState.meetingId;
    if (!meetingId) return;
    if (!newTitle) {
      toast.error('Meeting title cannot be empty');
      return;
    }
    try {
      const { authedApiCall } = await import('@/lib/auth');
      await authedApiCall('PATCH', `/api/v1/meetings/${meetingId}`, { title: newTitle });
      const updatedMeetings = meetings.map((m: CurrentMeeting) =>
        m.id === meetingId ? { ...m, title: newTitle } : m,
      );
      setMeetings(updatedMeetings);
      if (currentMeeting?.id === meetingId) {
        setCurrentMeeting({ id: meetingId, title: newTitle });
      }
      Analytics.trackButtonClick('edit_meeting_title', 'sidebar');
      toast.success('Meeting title updated successfully');
      setEditModalState({ isOpen: false, meetingId: null, currentTitle: '' });
      setEditingTitle('');
    } catch (error) {
      console.error('Failed to update meeting title:', error);
      toast.error('Failed to update meeting title', {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const handleEditCancel = () => {
    setEditModalState({ isOpen: false, meetingId: null, currentTitle: '' });
    setEditingTitle('');
  };

  // Expose openSettings to Rust tray
  useEffect(() => {
    (window as any).openSettings = () => setShowModelSettings(true);
    return () => {
      delete (window as any).openSettings;
    };
  }, []);

  // ─── Collapsed-mode icons (rail of 36×36 squares centred in 64px) ─────────
  const renderCollapsedIcons = () => {
    if (!isCollapsed) return null;
    return (
      <TooltipProvider>
        <div className="flex flex-col items-center gap-1 px-2 pt-3">
          {/* Collapsed brand badge — same 24×24 black square, centred */}
          <div className="pb-2 flex flex-col items-center gap-2">
            <div
              className="flex items-center justify-center rounded-[4px] bg-black"
              style={{ width: FIGMA.workspaceBadgeSize, height: FIGMA.workspaceBadgeSize }}
              aria-label="CallPilot"
            >
              <span className="text-[12px] font-bold text-white leading-4">CP</span>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={toggleCollapse}
                  aria-label="Expand sidebar"
                  title="Expand sidebar"
                  className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--nav-muted-text)] transition-colors hover:bg-[var(--nav-active-bg)] hover:text-[var(--nav-active-text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                >
                  <ChevronRightIcon className="h-3.5 w-3.5" strokeWidth={2} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">
                <p>Expand sidebar</p>
              </TooltipContent>
            </Tooltip>
          </div>

          <SingleIconButton
            active={isNavActive(pathname, 'home')}
            onClick={() => router.push('/')}
            label="Home"
          >
            <Home className="h-[18px] w-[18px]" strokeWidth={1.75} />
          </SingleIconButton>

          {betaFeatures.importAndRetranscribe && (
            <SingleIconButton active={false} onClick={() => openImportDialog()} label="Import Audio">
              <Upload className="h-[18px] w-[18px]" strokeWidth={1.75} />
            </SingleIconButton>
          )}

          <SingleIconButton
            active={isNavActive(pathname, 'meetings')}
            onClick={() => {
              if (isCollapsed) toggleCollapse();
              router.push('/');
            }}
            label="Meetings"
          >
            <NotebookPen className="h-[18px] w-[18px]" strokeWidth={1.75} />
          </SingleIconButton>

          <SingleIconButton
            active={isNavActive(pathname, 'settings')}
            onClick={() => router.push('/settings')}
            label="Settings"
          >
            <Settings className="h-[18px] w-[18px]" strokeWidth={1.75} />
          </SingleIconButton>

          <UserChip collapsed={true} />
        </div>
      </TooltipProvider>
    );
  };

  // ─── Meeting-item row (rendered as children of the Meetings nav item) ─────
  const findMatchingSnippet = (itemId: string) => {
    if (!searchQuery.trim() || !searchResults.length) return null;
    return searchResults.find((r) => r.id === itemId);
  };

  const renderMeetingItem = (item: SidebarItem) => {
    if (item.type !== 'file') return null;
    const isActive = currentMeeting?.id === item.id;
    const isMeetingItem = item.id.includes('-') && !item.id.startsWith('intro-call');
    const matchingResult = isMeetingItem ? findMatchingSnippet(item.id) : null;
    const hasTranscriptMatch = !!matchingResult;

    return (
      <button
        key={item.id}
        type="button"
        onClick={() => {
          setCurrentMeeting({ id: item.id, title: item.title });
          const basePath = item.id.startsWith('intro-call')
            ? '/'
            : `/meeting-details?id=${item.id}`;
          router.push(basePath);
        }}
        className={[
          'group flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-150',
          isActive
            ? 'bg-[var(--nav-active-bg)] text-[var(--nav-active-text)]'
            : 'text-[var(--nav-inactive-text)] hover:bg-[var(--nav-active-bg)] hover:text-[var(--nav-active-text)]',
        ].join(' ')}
        style={{ paddingLeft: 28 /* 12 (parent px) + 16 (icon indent) */ }}
      >
        <File
          className={[
            'h-[16px] w-[16px] shrink-0',
            isActive ? 'text-[var(--nav-active-text)]' : 'text-[var(--nav-muted-text)]',
          ].join(' ')}
          strokeWidth={1.75}
        />
        <span className="flex-1 truncate text-left">{item.title}</span>
        {isMeetingItem && (
          <span className="flex items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                handleEditStart(item.id, item.title);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  e.stopPropagation();
                  handleEditStart(item.id, item.title);
                }
              }}
              className="rounded-md p-1 text-[var(--nav-muted-text)] hover:bg-[var(--nav-active-bg)] hover:text-[var(--nav-active-text)]"
              aria-label="Edit meeting title"
            >
              <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} />
            </span>
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                setDeleteModalState({ isOpen: true, itemId: item.id });
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  e.stopPropagation();
                  setDeleteModalState({ isOpen: true, itemId: item.id });
                }
              }}
              className="rounded-md p-1 text-[var(--nav-muted-text)] hover:bg-red-50 hover:text-red-600"
              aria-label="Delete meeting"
            >
              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
            </span>
          </span>
        )}
      </button>
    );
  };

  return (
    <div className="fixed top-0 left-0 z-40 h-screen">
      <div
        className={`flex h-screen flex-col justify-between bg-white border-r border-[var(--hairline)] transition-all duration-300 ${
          isCollapsed ? 'w-16' : 'w-60'
        }`}
      >
        {/* ─────────────── TOP: workspace + nav + meetings ─────────────── */}
        {!isCollapsed ? (
          <div className="flex flex-col">
            {/* Workspace picker — Figma 1:1: 24×24 black badge + brand name + chevron-down */}
            <div className="flex items-center justify-between px-4 py-4">
              <button
                type="button"
                className="group flex items-center gap-2 rounded-md px-1 py-0.5 transition-colors hover:bg-[var(--nav-active-bg)] focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                aria-label="Workspace selector"
              >
                <span
                  className="flex shrink-0 items-center justify-center rounded-[4px] bg-black"
                  style={{ width: FIGMA.workspaceBadgeSize, height: FIGMA.workspaceBadgeSize }}
                >
                  <span className="text-[12px] font-bold leading-4 text-white">CP</span>
                </span>
                <span className="text-[14px] font-semibold leading-5 text-black">
                  CallPilot
                </span>
              </button>

              <div className="flex items-center gap-1.5">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={toggleCollapse}
                      aria-label="Collapse sidebar"
                      title="Collapse sidebar"
                      className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--nav-muted-text)] transition-colors hover:bg-[var(--nav-active-bg)] hover:text-[var(--nav-active-text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                    >
                      <ChevronLeft className="h-3.5 w-3.5" strokeWidth={2} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    <p>Collapse sidebar</p>
                  </TooltipContent>
                </Tooltip>
              </div>
            </div>

            {/* Search — Figma-style nav row (no border, slate-50 bg, 36px tall) */}
            <div className="px-3">
              <div
                className={[
                  'flex items-center gap-3 rounded-md px-3 py-2 transition-colors duration-150',
                  searchQuery
                    ? 'bg-[var(--nav-active-bg)] text-[var(--nav-active-text)]'
                    : 'text-[var(--nav-inactive-text)] hover:bg-[var(--nav-active-bg)] hover:text-[var(--nav-active-text)]',
                ].join(' ')}
              >
                <SearchIcon
                  className={[
                    'h-5 w-5 shrink-0',
                    searchQuery ? 'text-[var(--nav-active-text)]' : 'text-[var(--nav-muted-text)]',
                  ].join(' ')}
                  strokeWidth={1.75}
                />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  placeholder="Search meetings…"
                  className="h-5 min-w-0 flex-1 border-0 bg-transparent text-sm font-medium leading-5 text-[var(--nav-active-text)] placeholder:text-[var(--nav-muted-text)] focus:outline-none"
                />
                {searchQuery ? (
                  <button
                    type="button"
                    onClick={() => handleSearchChange('')}
                    aria-label="Clear search"
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[var(--nav-muted-text)] hover:bg-[var(--nav-active-bg)] hover:text-[var(--nav-active-text)]"
                  >
                    <X className="h-3.5 w-3.5" strokeWidth={2} />
                  </button>
                ) : isSearching ? (
                  <span className="text-[10px] font-medium text-[var(--nav-muted-text)] animate-pulse">
                    …
                  </span>
                ) : null}
              </div>
            </div>

            {/* Nav list — gap-1 ≈ 4px, px-3, pb-10 */}
            <nav className="flex flex-col gap-1 px-3 pb-10 pt-3">
              <button
                type="button"
                aria-current={isNavActive(pathname, 'home') ? 'page' : undefined}
                onClick={() => router.push('/')}
                className={LinkClass(isNavActive(pathname, 'home'))}
              >
                <Home className="h-5 w-5 shrink-0" strokeWidth={1.75} />
                <span>Home</span>
              </button>

              {betaFeatures.importAndRetranscribe && (
                <button
                  type="button"
                  onClick={() => openImportDialog()}
                  className={LinkClass(false)}
                >
                  <Upload className="h-5 w-5 shrink-0" strokeWidth={1.75} />
                  <span>Import audio</span>
                </button>
              )}

              <button
                type="button"
                aria-current={isNavActive(pathname, 'meetings') ? 'page' : undefined}
                onClick={() => router.push('/meeting-details')}
                className={LinkClass(isNavActive(pathname, 'meetings'))}
              >
                <NotebookPen className="h-5 w-5 shrink-0" strokeWidth={1.75} />
                <span>Meetings</span>
              </button>

              {/* Meeting children — rendered inline when on Meetings or when searching.
                  No eyebrow header, no count badge — matches Figma's quiet rail. */}
              {(isNavActive(pathname, 'meetings') || searchQuery) &&
                filteredSidebarItems
                  .filter((it) => it.type === 'folder' && it.children)
                  .flatMap((folder) => folder.children ?? [])
                  .map((child) => renderMeetingItem(child))}
            </nav>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto">{renderCollapsedIcons()}</div>
        )}

        {/* ─────────────── BOTTOM: Help + Settings (Figma footer) ─────────────── */}
        {!isCollapsed && (
          <nav className="flex flex-col gap-1 px-3 pb-4">
            <button
              type="button"
              onClick={(e) => {
                // Keep the existing "About" modal flow — Info rendered as Help link
                const target = e.currentTarget;
                const dialogTrigger = document.querySelector<HTMLElement>(
                  '[data-sidebar-about-trigger]',
                );
                if (dialogTrigger) dialogTrigger.click();
                else target.blur();
              }}
              className={LinkClass(false)}
            >
              <HelpCircle className="h-5 w-5 shrink-0" strokeWidth={1.75} />
              <span>Help</span>
            </button>

            <button
              type="button"
              aria-current={isNavActive(pathname, 'settings') ? 'page' : undefined}
              onClick={() => router.push('/settings')}
              className={LinkClass(isNavActive(pathname, 'settings'))}
            >
              <Settings className="h-5 w-5 shrink-0" strokeWidth={1.75} />
              <span>Settings</span>
            </button>

            {/* UserChip — kept at the bottom (CallPilot-specific, not in Figma).
                Sized to match Figma's footer rhythm. */}
            <div className="pt-1">
              <UserChip collapsed={false} />
            </div>

            {/* Hidden About dialog trigger — wired to the Help button above. */}
            <span className="sr-only">
              <AboutDialogTrigger />
            </span>
          </nav>
        )}
      </div>

      {/* ─────────────── Modals (preserved) ─────────────── */}
      <ConfirmationModal
        isOpen={deleteModalState.isOpen}
        text="Are you sure you want to delete this meeting? This action cannot be undone."
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteModalState({ isOpen: false, itemId: null })}
      />

      <Dialog
        open={editModalState.isOpen}
        onOpenChange={(open) => {
          if (!open) handleEditCancel();
        }}
      >
        <DialogContent className="sm:max-w-[425px]">
          <VisuallyHidden>
            <DialogTitle>Edit Meeting Title</DialogTitle>
          </VisuallyHidden>
          <div className="py-4">
            <h3 className="mb-4 text-lg font-semibold">Edit Meeting Title</h3>
            <div className="space-y-4">
              <div>
                <label htmlFor="meeting-title" className="mb-2 block text-sm font-medium text-gray-700">
                  Meeting Title
                </label>
                <input
                  id="meeting-title"
                  type="text"
                  value={editingTitle}
                  onChange={(e) => setEditingTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleEditConfirm();
                    else if (e.key === 'Escape') handleEditCancel();
                  }}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Enter meeting title"
                  autoFocus
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <button
              onClick={handleEditCancel}
              className="rounded-md bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200"
            >
              Cancel
            </button>
            <button
              onClick={handleEditConfirm}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
            >
              Save
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Sidebar;

/* ────────────────────────────────────────────────────────────────────────────
 * Reusable pieces
 * ──────────────────────────────────────────────────────────────────────────── */

/** 36×36 square icon button used in the collapsed-mode rail. */
const SingleIconButton: React.FC<{
  active: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}> = ({ active, onClick, label, children }) => {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-current={active ? 'page' : undefined}
          onClick={onClick}
          className={[
            'group relative flex h-9 w-9 items-center justify-center rounded-md transition-colors duration-150',
            active
              ? 'bg-[var(--nav-active-bg)] text-[var(--nav-active-text)]'
              : 'text-[var(--nav-inactive-text)] hover:bg-[var(--nav-active-bg)] hover:text-[var(--nav-active-text)]',
          ].join(' ')}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">
        <p>{label}</p>
      </TooltipContent>
    </Tooltip>
  );
};

/** Hidden trigger that opens the existing About dialog for the Help button. */
const AboutDialogTrigger: React.FC = () => {
  const [About] = useState(() => {
    // Lazy-loaded: the original Info component renders the About modal
    if (typeof window === 'undefined') return null;
    return require('../Info').default as React.ComponentType<{ isCollapsed?: boolean }>;
  });
  if (!About) return null;
  return (
    <span data-sidebar-about-trigger>
      <About isCollapsed={false} />
    </span>
  );
};
