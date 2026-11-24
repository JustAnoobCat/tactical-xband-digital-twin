/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Strictly Typed Frontier Command Palette Controller (SPEC-V3-09)
 *
 * Extracted from monolithic index.html into a modular, headless-testable,
 * strictly typed controller.
 * Handles:
 * 1. Modal dialog lifecycle (open/close, focus trapping, backdrop clicks)
 * 2. Real-time query filtering and fuzzy ranking
 * 3. Cyclic keyboard navigation (ArrowDown, ArrowUp, Home, End, Enter, Esc)
 * 4. Command dispatching with action verification (verifyAllPaletteCommandsBound)
 * 5. Strict XSS sanitization via escapeHtml
 */

import { escapeHtml } from '../domSafety';
import {
  DEFAULT_PALETTE_COMMANDS,
  filterAndRankCommands,
  stepPaletteSelection,
  PaletteCommand,
  RankedPaletteCommand,
} from '../commandPaletteEngine';

// ============================================================================
// Types & Contracts
// ============================================================================

export type CommandActionMap = Record<string, () => void>;

export interface CommandPaletteControllerDeps {
  readonly actionMap?: CommandActionMap;
  readonly documentRef?: Document;
  readonly windowRef?: Window;
  readonly onOpen?: () => void;
  readonly onClose?: () => void;
  readonly onExecute?: (commandId: string) => void;
}

export interface CommandPaletteController {
  readonly open: () => void;
  readonly close: () => void;
  readonly isOpen: () => boolean;
  readonly filter: (query: string) => void;
  readonly selectIndex: (index: number) => void;
  readonly executeSelected: () => void;
  readonly executeCommand: (commandId: string) => void;
  readonly getCurrentIndex: () => number;
  readonly getRankedList: () => ReadonlyArray<RankedPaletteCommand>;
  readonly dispose: () => void;
}

// ============================================================================
// Action Verification Helper
// ============================================================================

/**
 * Validates that all default tactical commands in the catalog have a bound handler.
 */
export function verifyAllPaletteCommandsBound(
  actionMap: CommandActionMap,
  catalog: ReadonlyArray<PaletteCommand> = DEFAULT_PALETTE_COMMANDS
): { readonly valid: boolean; readonly missingCommands: readonly string[] } {
  const missing: string[] = [];
  for (const cmd of catalog) {
    if (typeof actionMap[cmd.id] !== 'function') {
      missing.push(cmd.id);
    }
  }
  return {
    valid: missing.length === 0,
    missingCommands: missing,
  };
}

// ============================================================================
// Default DOM Fallback Action Builder
// ============================================================================

export function createDefaultDomActionMap(
  doc?: Document,
  win?: Window
): CommandActionMap {
  const getDoc = (): Document | undefined => {
    if (doc) return doc;
    if (typeof document !== 'undefined') return document;
    return undefined;
  };
  const getWin = (): Window | undefined => {
    if (win) return win;
    if (typeof window !== 'undefined') return window;
    return undefined;
  };

  const $ = (id: string): HTMLElement | null => {
    const d = getDoc();
    return d ? d.getElementById(id) : null;
  };

  const winAny = getWin() as
    | {
        switchMainTab?: (tabId: string) => void;
        switchDocSubview?: (subviewId: string) => void;
        onDemSectorChange?: (val: string) => void;
        setStageViewMode?: (mode: '2d' | '3d') => void;
        onBiomeEmToggleChange?: (enabled: boolean) => void;
        togglePause?: () => void;
        stepSim?: () => void;
        runKargilScenario?: () => void;
      }
    | undefined;

  return {
    'nav:overview': () => winAny?.switchMainTab?.('tab-overview'),
    'nav:scheduler': () => winAny?.switchMainTab?.('tab-scheduler'),
    'nav:network': () => winAny?.switchMainTab?.('tab-network'),
    'nav:terrain': () => winAny?.switchMainTab?.('tab-terrain'),
    'nav:terminal': () => winAny?.switchMainTab?.('tab-terminal'),
    'nav:authoring': () => winAny?.switchMainTab?.('tab-authoring'),
    'nav:doc': () => winAny?.switchMainTab?.('tab-doc'),
    'nav:registration': () => winAny?.switchMainTab?.('tab-registration'),
    'nav:soldier': () => winAny?.switchMainTab?.('tab-soldier'),
    'nav:analytics': () => winAny?.switchMainTab?.('tab-scheduler'),
    'nav:calibration': () => {
      winAny?.switchMainTab?.('tab-doc');
      winAny?.switchDocSubview?.('diag');
    },

    'biome:ladakh': () => {
      const sel = $('dem-sector-select') as HTMLSelectElement | null;
      if (sel) sel.value = 'ladakh';
      winAny?.onDemSectorChange?.('ladakh');
    },
    'biome:kargil': () => {
      const sel = $('dem-sector-select') as HTMLSelectElement | null;
      if (sel) sel.value = 'kargil';
      winAny?.onDemSectorChange?.('kargil');
    },
    'biome:arid_desert': () => {
      const sel = $('dem-sector-select') as HTMLSelectElement | null;
      if (sel) sel.value = 'arid_desert';
      winAny?.onDemSectorChange?.('arid_desert');
    },
    'biome:open_plains': () => {
      const sel = $('dem-sector-select') as HTMLSelectElement | null;
      if (sel) sel.value = 'open_plains';
      winAny?.onDemSectorChange?.('open_plains');
    },
    'biome:tropical_jungle': () => {
      const sel = $('dem-sector-select') as HTMLSelectElement | null;
      if (sel) sel.value = 'tropical_jungle';
      winAny?.onDemSectorChange?.('tropical_jungle');
    },
    'biome:maritime_littoral': () => {
      const sel = $('dem-sector-select') as HTMLSelectElement | null;
      if (sel) sel.value = 'maritime_littoral';
      winAny?.onDemSectorChange?.('maritime_littoral');
    },

    'tools:2d3d': () => {
      const btn3D = $('btnView3D');
      const btn2D = $('btnView2D');
      const is3D = btn3D?.classList.contains('active');
      if (typeof winAny?.setStageViewMode === 'function') {
        winAny.setStageViewMode(is3D ? '2d' : '3d');
      } else if (is3D && btn2D) {
        btn2D.click();
      } else if (!is3D && btn3D) {
        btn3D.click();
      }
    },
    'tools:cvd': () => $('btn-cvd-mode')?.click(),
    'tools:fresnel': () => $('btn-3d-fresnel')?.click(),
    'tools:lobes': () => $('btn-3d-lobes')?.click(),
    'tools:volumes': () => $('btn-3d-volumes')?.click(),
    'tools:mgrs': () => {
      const chk = $('toggle-mgrs-grid') as HTMLInputElement | null;
      if (chk) {
        chk.checked = !chk.checked;
        chk.dispatchEvent(new Event('change'));
      }
    },
    'tools:ruler': () => $('tb-bar-transect')?.click(),
    'tools:probe': () => $('tb-bar-probe')?.click(),
    'tools:area': () => $('tb-bar-region')?.click(),
    'tools:barrier': () => $('tb-bar-obstacle')?.click(),
    'tools:pan': () => $('tb-bar-pan')?.click(),

    'physics:high_fidelity': () => $('btn-hifi-all-toggle')?.click(),
    'physics:biome_em': () => {
      const chk = $('toggle-biome-em') as HTMLInputElement | null;
      if (chk) {
        chk.checked = !chk.checked;
        if (typeof winAny?.onBiomeEmToggleChange === 'function') {
          winAny.onBiomeEmToggleChange(chk.checked);
        }
      }
    },

    'sim:pause_resume': () => {
      if (typeof winAny?.togglePause === 'function') winAny.togglePause();
      else $('btn-pause')?.click();
    },
    'sim:step': () => {
      if (typeof winAny?.stepSim === 'function') winAny.stepSim();
      else $('btn-step')?.click();
    },
    'sim:reset': () => $('btn-sim-reset')?.click(),
    'sim:kargil_transit': () => {
      if (typeof winAny?.runKargilScenario === 'function') winAny.runKargilScenario();
    },
    'sim:calibrate': () => $('btn-cal-auto-solve')?.click(),

    'export:scenario_json': () => $('btn-scenario-save-json')?.click(),
    'export:kml': () => $('btn-export-kml')?.click(),
    'export:cot_xml': () => $('btn-export-cot-xml')?.click(),
    'export:aar_md': () => $('btn-export-aar-md')?.click(),
    'export:aar_html': () => $('btn-export-aar-html')?.click(),
  };
}

// ============================================================================
// Controller Factory
// ============================================================================

export function initCommandPaletteController(
  deps?: CommandPaletteControllerDeps
): CommandPaletteController {
  const getDoc = (): Document | undefined => {
    if (deps?.documentRef) return deps.documentRef;
    if (typeof document !== 'undefined') return document;
    return undefined;
  };

  const getWin = (): Window | undefined => {
    if (deps?.windowRef) return deps.windowRef;
    if (typeof window !== 'undefined') return window;
    return undefined;
  };

  const $ = (id: string): HTMLElement | null => {
    const doc = getDoc();
    return doc ? doc.getElementById(id) : null;
  };

  const defaultActionMap = createDefaultDomActionMap(getDoc(), getWin());
  const combinedActionMap: CommandActionMap = {
    ...defaultActionMap,
    ...(deps?.actionMap || {}),
  };

  let paletteIsOpen = false;
  let paletteCurrentIndex = 0;
  let paletteRankedList: ReadonlyArray<RankedPaletteCommand> = [];

  function isOpen(): boolean {
    return paletteIsOpen;
  }

  function getCurrentIndex(): number {
    return paletteCurrentIndex;
  }

  function getRankedList(): ReadonlyArray<RankedPaletteCommand> {
    return paletteRankedList;
  }

  function open(): void {
    const modal = $('c2-cmd-palette-modal');
    const input = $('c2-cmd-palette-input') as HTMLInputElement | null;
    if (!modal || !input) return;

    paletteIsOpen = true;
    modal.hidden = false;
    input.value = '';
    paletteCurrentIndex = 0;
    renderPaletteItems('');
    if (typeof input.focus === 'function') {
      setTimeout(() => input.focus(), 20);
    }
    if (deps?.onOpen) deps.onOpen();
  }

  function close(): void {
    const modal = $('c2-cmd-palette-modal');
    if (!modal) return;
    paletteIsOpen = false;
    modal.hidden = true;
    if (deps?.onClose) deps.onClose();
  }

  function scrollPaletteSelectionIntoView(): void {
    const list = $('c2-cmd-palette-list');
    if (!list) return;
    const sel = list.querySelector('.c2-cmd-palette-item.is-selected') as HTMLElement | null;
    if (sel && typeof sel.scrollIntoView === 'function') {
      sel.scrollIntoView({ block: 'nearest' });
    }
  }

  function updatePaletteSelectionUI(): void {
    const list = $('c2-cmd-palette-list');
    if (!list) return;
    const items = list.querySelectorAll('.c2-cmd-palette-item');
    items.forEach((item, idx) => {
      const isSel = idx === paletteCurrentIndex;
      item.classList.toggle('is-selected', isSel);
      item.setAttribute('aria-selected', String(isSel));
    });
    scrollPaletteSelectionIntoView();
  }

  function renderPaletteItems(query: string): void {
    const doc = getDoc();
    const list = $('c2-cmd-palette-list');
    if (!list || !doc) return;

    paletteRankedList = filterAndRankCommands(query, DEFAULT_PALETTE_COMMANDS);
    list.innerHTML = '';

    if (paletteRankedList.length === 0) {
      const emptyLi = doc.createElement('li');
      emptyLi.className = 'c2-cmd-palette-empty';
      emptyLi.textContent = `No tactical commands match "${query.trim()}"`;
      list.appendChild(emptyLi);
      paletteCurrentIndex = -1;
      return;
    }

    if (paletteCurrentIndex >= paletteRankedList.length || paletteCurrentIndex < 0) {
      paletteCurrentIndex = 0;
    }

    paletteRankedList.forEach((ranked, idx) => {
      const cmd = ranked.command;
      const li = doc.createElement('li');
      li.id = `c2-cmd-opt-${idx}`;
      li.className = `c2-cmd-palette-item${idx === paletteCurrentIndex ? ' is-selected' : ''}`;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', String(idx === paletteCurrentIndex));

      let html = `<span class="c2-cmd-palette-cat-badge">${escapeHtml(cmd.category)}</span>` +
        `<span class="c2-cmd-palette-label">${escapeHtml(cmd.label)}</span>`;
      if (cmd.shortcut) {
        html += `<span class="c2-cmd-palette-shortcut">${escapeHtml(cmd.shortcut)}</span>`;
      }

      li.innerHTML = html;
      li.addEventListener('click', () => {
        executeCommand(cmd.id);
      });
      li.addEventListener('mouseenter', () => {
        paletteCurrentIndex = idx;
        updatePaletteSelectionUI();
      });
      list.appendChild(li);
    });

    scrollPaletteSelectionIntoView();
  }

  function filter(query: string): void {
    paletteCurrentIndex = 0;
    renderPaletteItems(query);
  }

  function selectIndex(index: number): void {
    if (paletteRankedList.length === 0) {
      paletteCurrentIndex = -1;
      return;
    }
    paletteCurrentIndex = Math.max(0, Math.min(paletteRankedList.length - 1, index));
    updatePaletteSelectionUI();
  }

  function executeCommand(commandId: string): void {
    close();
    if (deps?.onExecute) {
      deps.onExecute(commandId);
    }
    const handler = combinedActionMap[commandId];
    if (typeof handler === 'function') {
      handler();
    }
  }

  function executeSelected(): void {
    if (
      paletteRankedList.length > 0 &&
      paletteCurrentIndex >= 0 &&
      paletteCurrentIndex < paletteRankedList.length
    ) {
      executeCommand(paletteRankedList[paletteCurrentIndex].command.id);
    }
  }

  // Event Listeners
  const triggerBtn = $('btn-command-palette');
  const modal = $('c2-cmd-palette-modal');
  const input = $('c2-cmd-palette-input') as HTMLInputElement | null;
  const closeBtn = $('c2-cmd-palette-close');

  const onTriggerClick = (): void => {
    if (modal && modal.hidden) {
      open();
    } else {
      close();
    }
  };

  const onCloseClick = (): void => {
    close();
  };

  const onModalClick = (e: MouseEvent): void => {
    if (e.target === modal) {
      close();
    }
  };

  const onInputEvent = (): void => {
    if (input) {
      filter(input.value);
    }
  };

  const onInputKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      paletteCurrentIndex = stepPaletteSelection(
        paletteCurrentIndex,
        paletteRankedList.length,
        e.key
      );
      updatePaletteSelectionUI();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      executeSelected();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };

  const win = getWin();
  const onGlobalKeyDown = (e: KeyboardEvent): void => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      if (modal && modal.hidden) {
        open();
      } else {
        close();
      }
    }
  };

  if (triggerBtn) triggerBtn.addEventListener('click', onTriggerClick);
  if (closeBtn) closeBtn.addEventListener('click', onCloseClick);
  if (modal) modal.addEventListener('click', onModalClick as EventListener);
  if (input) {
    input.addEventListener('input', onInputEvent);
    input.addEventListener('keydown', onInputKeyDown as EventListener);
  }
  if (win) {
    win.addEventListener('keydown', onGlobalKeyDown as EventListener);
  }

  function dispose(): void {
    if (triggerBtn) triggerBtn.removeEventListener('click', onTriggerClick);
    if (closeBtn) closeBtn.removeEventListener('click', onCloseClick);
    if (modal) modal.removeEventListener('click', onModalClick as EventListener);
    if (input) {
      input.removeEventListener('input', onInputEvent);
      input.removeEventListener('keydown', onInputKeyDown as EventListener);
    }
    if (win) {
      win.removeEventListener('keydown', onGlobalKeyDown as EventListener);
    }
  }

  return {
    open,
    close,
    isOpen,
    filter,
    selectIndex,
    executeSelected,
    executeCommand,
    getCurrentIndex,
    getRankedList,
    dispose,
  };
}
