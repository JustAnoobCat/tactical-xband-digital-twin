/**
 * src/ui/workbenchShell.ts
 *
 * Zero-Slop Lattice Obsidian UI Shell Controller.
 *
 * Responsibilities (strictly presentation-layer — ZERO simulation state):
 * 1. Color Vision Deficiency (CVD) mode persistence & toggle (#btn-cvd-mode)
 *    synced to document.documentElement.dataset.cvdMode & 'c2:cvd-mode-change'.
 * 2. Monochrome geometric SVG icon hydration on [data-c2-icon] slots via
 *    src/ui/tacticalIcons.ts (XSS-safe TrustedHtml).
 * 3. Debounced ResizeObserver on #radar-container dispatching window 'resize'
 *    so MapLibre GL, Three.js, and 2D scopes re-measure cleanly on layout shifts.
 */

import { isTacticalIconName, renderTacticalIcon } from './tacticalIcons';

export type CvdVisualMode = 'standard' | 'colorblind-safe';

const CVD_STORAGE_KEY = 'xband-cvd-mode-v1';

export interface WorkbenchShellHandle {
  getCvdMode: () => CvdVisualMode;
  setCvdMode: (mode: CvdVisualMode) => void;
  toggleCvdMode: () => CvdVisualMode;
  hydrateIcons: (root?: ParentNode) => number;
  destroy: () => void;
}

/**
 * Pure helper to determine whether keyboard event target is an editable field
 * so single-key workspace shortcuts never hijack user typing.
 */
export function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== 'object') return false;
  const el = target as { tagName?: string; isContentEditable?: boolean };
  if (el.isContentEditable) return true;
  const tag = (el.tagName || '').toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export function normalizeCvdMode(raw: unknown): CvdVisualMode {
  return raw === 'colorblind-safe' ? 'colorblind-safe' : 'standard';
}

function readStoredCvdMode(): CvdVisualMode {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return normalizeCvdMode(window.localStorage.getItem(CVD_STORAGE_KEY));
    }
  } catch {
    // Storage restricted in sandboxed/private context
  }
  return 'standard';
}

function writeStoredCvdMode(mode: CvdVisualMode): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(CVD_STORAGE_KEY, mode);
    }
  } catch {
    // Non-fatal
  }
}

/**
 * Hydrates all elements with [data-c2-icon="iconName"] using crisp 1.5px
 * monochrome SVG icons from src/ui/tacticalIcons.ts.
 */
export function hydrateTacticalIcons(root?: ParentNode): number {
  const scope = root ?? (typeof document !== 'undefined' ? document : null);
  if (!scope || typeof scope.querySelectorAll !== 'function') return 0;

  let count = 0;
  const nodes = scope.querySelectorAll('[data-c2-icon]');
  for (const el of Array.from(nodes)) {
    const iconKey = el.getAttribute('data-c2-icon') ?? '';
    if (!iconKey || !isTacticalIconName(iconKey)) continue;
    const sizeAttr = Number(el.getAttribute('data-c2-icon-size'));
    const size = Number.isFinite(sizeAttr) && sizeAttr >= 10 && sizeAttr <= 32 ? sizeAttr : 15;
    const svg = renderTacticalIcon(iconKey, { size });
    el.innerHTML = String(svg);
    count += 1;
  }
  return count;
}

/**
 * Initializes the Lattice Obsidian shell enhancements cleanly and idempotently.
 */
export function initWorkbenchShell(): WorkbenchShellHandle {
  let cvdMode: CvdVisualMode = readStoredCvdMode();
  let resizeTimer: ReturnType<typeof setTimeout> | null = null;
  let resizeObserver: ResizeObserver | null = null;

  const applyCvdToDom = (mode: CvdVisualMode): void => {
    cvdMode = mode;
    if (typeof document !== 'undefined' && document.documentElement) {
      document.documentElement.dataset.cvdMode = mode;
    }
    if (typeof document !== 'undefined') {
      const btn = document.getElementById('btn-cvd-mode');
      if (btn) {
        const isSafe = mode === 'colorblind-safe';
        btn.setAttribute('aria-pressed', isSafe ? 'true' : 'false');
        btn.textContent = isSafe ? 'CVD: ON' : 'CVD';
      }
    }
    writeStoredCvdMode(mode);
    if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') {
      window.dispatchEvent(new CustomEvent('c2:cvd-mode-change', { detail: { mode } }));
    }
  };

  const onCvdClick = (): void => {
    applyCvdToDom(cvdMode === 'colorblind-safe' ? 'standard' : 'colorblind-safe');
  };

  applyCvdToDom(cvdMode);
  hydrateTacticalIcons();

  if (typeof document !== 'undefined') {
    const btn = document.getElementById('btn-cvd-mode');
    if (btn) {
      btn.addEventListener('click', onCvdClick);
    }

    const viewport = document.getElementById('radar-container');
    if (viewport && typeof ResizeObserver !== 'undefined') {
      let lastW = 0;
      let lastH = 0;
      resizeObserver = new ResizeObserver((entries) => {
        const rect = entries[0]?.contentRect;
        if (!rect) return;
        const w = Math.round(rect.width);
        const h = Math.round(rect.height);
        if (w === lastW && h === lastH) return;
        lastW = w;
        lastH = h;
        if (resizeTimer !== null) clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
          resizeTimer = null;
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new Event('resize'));
            if (typeof CustomEvent !== 'undefined') {
              window.dispatchEvent(new CustomEvent('c2:viewport-resize', { detail: { width: w, height: h } }));
            }
          }
        }, 40);
      });
      resizeObserver.observe(viewport);
    }
  }

  return {
    getCvdMode: () => cvdMode,
    setCvdMode: (mode) => applyCvdToDom(normalizeCvdMode(mode)),
    toggleCvdMode: () => {
      const next: CvdVisualMode = cvdMode === 'colorblind-safe' ? 'standard' : 'colorblind-safe';
      applyCvdToDom(next);
      return next;
    },
    hydrateIcons: (root) => hydrateTacticalIcons(root),
    destroy: () => {
      if (resizeTimer !== null) {
        clearTimeout(resizeTimer);
        resizeTimer = null;
      }
      if (resizeObserver) {
        resizeObserver.disconnect();
        resizeObserver = null;
      }
      if (typeof document !== 'undefined') {
        const btn = document.getElementById('btn-cvd-mode');
        if (btn) btn.removeEventListener('click', onCvdClick);
      }
    },
  };
}
