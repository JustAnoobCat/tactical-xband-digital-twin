/**
 * Floating Google Maps-inspired Map Layers Control & Popover Panel.
 *
 * Mounts `#map-layers-btn` (Bottom-Right trigger) and `#map-layers-popover`
 * inside the persistent map stage container, syncing bi-directionally with
 * `MapLayerRegistry` without recreating slider DOM nodes during drags.
 */

import {
  MAP_LAYER_CATEGORIES,
  MAP_LAYER_DEFINITIONS,
  MAP_LAYER_PRESETS,
  type MapLayerCategoryId,
  type MapLayerId,
  type MapLayerPresetId,
  MapLayerRegistry,
} from './mapLayerRegistry';

export interface MapLayersPanelOptions {
  container: HTMLElement;
  registry: MapLayerRegistry;
  onChanged?: () => void;
  onOpenChange?: (open: boolean) => void;
}

const PRESET_ORDER: readonly MapLayerPresetId[] = ['operational', 'rf_analysis', 'minimal', 'all'];

export class MapLayersPanel {
  private readonly container: HTMLElement;
  private readonly registry: MapLayerRegistry;
  private readonly onChanged?: () => void;
  private readonly onOpenChange?: (open: boolean) => void;

  private readonly buttonEl: HTMLButtonElement;
  private readonly buttonLabelEl: HTMLSpanElement;
  private readonly popoverEl: HTMLDivElement;
  private readonly focusToggleEl: HTMLInputElement;
  private readonly resetBtnEl: HTMLButtonElement;

  private readonly presetButtons = new Map<MapLayerPresetId, HTMLButtonElement>();
  private readonly categoryCheckboxes = new Map<MapLayerCategoryId, HTMLInputElement>();
  private readonly categorySections = new Map<MapLayerCategoryId, HTMLDivElement>();
  private readonly categoryExpandBtns = new Map<MapLayerCategoryId, HTMLButtonElement>();
  private readonly categoryCounts = new Map<MapLayerCategoryId, HTMLSpanElement>();
  private readonly layerCheckboxes = new Map<MapLayerId, HTMLInputElement>();
  private readonly layerRows = new Map<MapLayerId, HTMLDivElement>();
  private readonly layerSliders = new Map<MapLayerId, HTMLInputElement>();
  private readonly layerOpacityTexts = new Map<MapLayerId, HTMLSpanElement>();

  private open = false;
  private unsubscribeRegistry: (() => void) | null = null;
  private readonly boundDocPointerDown: (ev: MouseEvent) => void;
  private readonly boundDocKeyDown: (ev: KeyboardEvent) => void;

  constructor(options: MapLayersPanelOptions) {
    this.container = options.container;
    this.registry = options.registry;
    this.onChanged = options.onChanged;
    this.onOpenChange = options.onOpenChange;

    this.syncOpenAttributes(false);

    // 1. Trigger button (#map-layers-btn)
    this.buttonEl = document.createElement('button');
    this.buttonEl.id = 'map-layers-btn';
    this.buttonEl.type = 'button';
    this.buttonEl.className = 'map-layers-btn';
    this.buttonEl.title = 'Configure visible map layers';
    this.buttonEl.setAttribute('aria-haspopup', 'true');
    this.buttonEl.setAttribute('aria-expanded', 'false');
    this.buttonEl.setAttribute('aria-controls', 'map-layers-popover');

    this.buttonEl.innerHTML = `<svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none;" aria-hidden="true"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 12 12 17 22 12"/><polyline points="2 17 12 22 22 17"/></svg>`;
    this.buttonLabelEl = document.createElement('span');
    this.buttonLabelEl.textContent = `Layers · ${this.registry.getEnabledCount()}/${this.registry.getTotalCount()}`;
    this.buttonEl.appendChild(this.buttonLabelEl);

    // 2. Popover panel (#map-layers-popover)
    this.popoverEl = document.createElement('div');
    this.popoverEl.id = 'map-layers-popover';
    this.popoverEl.className = 'map-layers-popover is-closed';
    this.popoverEl.setAttribute('role', 'dialog');
    this.popoverEl.setAttribute('aria-label', 'Map layers control');
    this.popoverEl.setAttribute('aria-hidden', 'true');

    // Header bar
    const header = document.createElement('div');
    header.className = 'mlp-header';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'mlp-title-wrap';
    const title = document.createElement('strong');
    title.className = 'mlp-title';
    title.textContent = 'Map Layers';
    titleWrap.appendChild(title);

    const actionsWrap = document.createElement('div');
    actionsWrap.className = 'mlp-header-actions';

    const focusLabel = document.createElement('label');
    focusLabel.className = 'mlp-focus-toggle';
    focusLabel.title = 'Dim unrelated links and markers when a terminal is selected';
    this.focusToggleEl = document.createElement('input');
    this.focusToggleEl.type = 'checkbox';
    this.focusToggleEl.id = 'mlp-focus-selection';
    const focusSpan = document.createElement('span');
    focusSpan.textContent = 'Focus on selection';
    focusLabel.append(this.focusToggleEl, focusSpan);

    this.resetBtnEl = document.createElement('button');
    this.resetBtnEl.type = 'button';
    this.resetBtnEl.id = 'mlp-reset-defaults';
    this.resetBtnEl.className = 'mlp-reset-btn';
    this.resetBtnEl.textContent = 'Reset defaults';

    actionsWrap.append(focusLabel, this.resetBtnEl);
    header.append(titleWrap, actionsWrap);
    this.popoverEl.appendChild(header);

    // Quick Presets row
    const presetRow = document.createElement('div');
    presetRow.className = 'mlp-presets';
    presetRow.setAttribute('role', 'group');
    presetRow.setAttribute('aria-label', 'Layer presets');
    for (const presetId of PRESET_ORDER) {
      const preset = MAP_LAYER_PRESETS[presetId];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'mlp-preset-pill';
      btn.dataset.preset = presetId;
      btn.textContent = preset.label;
      btn.addEventListener('click', () => {
        this.registry.applyPreset(presetId);
      });
      this.presetButtons.set(presetId, btn);
      presetRow.appendChild(btn);
    }
    this.popoverEl.appendChild(presetRow);

    // Categories accordion container
    const listEl = document.createElement('div');
    listEl.className = 'mlp-body';

    for (const cat of MAP_LAYER_CATEGORIES) {
      const section = document.createElement('div');
      section.className = 'mlp-category';
      section.dataset.category = cat.id;

      const catHead = document.createElement('div');
      catHead.className = 'mlp-cat-head';

      const expandBtn = document.createElement('button');
      expandBtn.type = 'button';
      expandBtn.className = 'mlp-cat-expand';
      expandBtn.setAttribute('aria-expanded', 'true');
      expandBtn.setAttribute('aria-label', `Toggle ${cat.label} group`);
      expandBtn.innerHTML = `<svg viewBox="0 0 12 12" width="10" height="10" style="pointer-events:none;" aria-hidden="true"><path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

      const catCheckbox = document.createElement('input');
      catCheckbox.type = 'checkbox';
      catCheckbox.className = 'mlp-cat-checkbox';
      catCheckbox.setAttribute('aria-label', `Toggle all layers in ${cat.label}`);

      const catTitleBtn = document.createElement('button');
      catTitleBtn.type = 'button';
      catTitleBtn.className = 'mlp-cat-title';
      catTitleBtn.textContent = `${cat.code}. ${cat.label}`;

      const catCount = document.createElement('span');
      catCount.className = 'mlp-cat-count';

      catHead.append(expandBtn, catCheckbox, catTitleBtn, catCount);

      const catBody = document.createElement('div');
      catBody.className = 'mlp-cat-body';

      const catLayers = MAP_LAYER_DEFINITIONS.filter((def) => def.category === cat.id);
      for (const def of catLayers) {
        const row = document.createElement('div');
        row.className = 'mlp-layer-row';
        row.dataset.layerId = def.id;

        const mainLine = document.createElement('div');
        mainLine.className = 'mlp-layer-main';

        const checkboxLabel = document.createElement('label');
        checkboxLabel.className = 'mlp-layer-check-label';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'mlp-layer-checkbox';
        checkbox.dataset.layerId = def.id;

        const swatch = document.createElement('span');
        swatch.className = 'mlp-swatch';
        swatch.style.backgroundColor = def.swatchColor;
        swatch.setAttribute('aria-hidden', 'true');

        const nameSpan = document.createElement('span');
        nameSpan.className = 'mlp-layer-name';
        nameSpan.textContent = def.label;

        checkboxLabel.append(checkbox, swatch, nameSpan);
        mainLine.appendChild(checkboxLabel);

        if (def.scopeTag) {
          const scopeBadge = document.createElement('span');
          scopeBadge.className = 'mlp-scope-badge';
          scopeBadge.textContent = def.scopeTag;
          mainLine.appendChild(scopeBadge);
        }

        row.appendChild(mainLine);

        if (def.supportsOpacity) {
          const opRow = document.createElement('div');
          opRow.className = 'mlp-opacity-row';

          const opTag = document.createElement('span');
          opTag.className = 'mlp-opacity-tag';
          opTag.textContent = 'Opacity';

          const slider = document.createElement('input');
          slider.type = 'range';
          slider.className = 'mlp-opacity-slider';
          slider.min = '15';
          slider.max = '100';
          slider.step = '1';
          slider.setAttribute('aria-label', `${def.label} opacity`);

          const opVal = document.createElement('span');
          opVal.className = 'mlp-opacity-val';

          slider.addEventListener('input', () => {
            const pct = Number(slider.value);
            this.registry.setLayerOpacity(def.id, pct / 100);
          });

          opRow.append(opTag, slider, opVal);
          row.appendChild(opRow);

          this.layerSliders.set(def.id, slider);
          this.layerOpacityTexts.set(def.id, opVal);
        }

        checkbox.addEventListener('change', () => {
          this.registry.setLayerVisible(def.id, checkbox.checked);
        });

        this.layerCheckboxes.set(def.id, checkbox);
        this.layerRows.set(def.id, row);
        catBody.appendChild(row);
      }

      const toggleAccordion = () => {
        const nextCollapsed = !this.registry.isCategoryCollapsed(cat.id);
        this.registry.setCategoryCollapsed(cat.id, nextCollapsed);
      };
      expandBtn.addEventListener('click', toggleAccordion);
      catTitleBtn.addEventListener('click', toggleAccordion);

      catCheckbox.addEventListener('change', () => {
        this.registry.setCategoryVisible(cat.id, catCheckbox.checked);
      });

      this.categorySections.set(cat.id, section);
      this.categoryCheckboxes.set(cat.id, catCheckbox);
      this.categoryExpandBtns.set(cat.id, expandBtn);
      this.categoryCounts.set(cat.id, catCount);

      section.append(catHead, catBody);
      listEl.appendChild(section);
    }

    this.popoverEl.appendChild(listEl);

    // Wire panel interactions
    this.buttonEl.addEventListener('click', (ev) => {
      ev.stopPropagation();
      this.setOpen(!this.open);
    });

    this.focusToggleEl.addEventListener('change', () => {
      this.registry.setContextualFocusEnabled(this.focusToggleEl.checked);
    });

    this.resetBtnEl.addEventListener('click', () => {
      this.registry.resetDefaults();
    });

    this.boundDocPointerDown = (ev: MouseEvent) => {
      if (!this.open) return;
      const target = ev.target as Node | null;
      if (!target) return;
      if (this.popoverEl.contains(target) || this.buttonEl.contains(target)) return;
      this.setOpen(false);
    };

    this.boundDocKeyDown = (ev: KeyboardEvent) => {
      if (!this.open) return;
      if (ev.key === 'Escape') {
        ev.preventDefault();
        this.setOpen(false);
        this.buttonEl.focus();
      }
    };

    document.addEventListener('mousedown', this.boundDocPointerDown);
    document.addEventListener('keydown', this.boundDocKeyDown);

    this.container.appendChild(this.popoverEl);
    this.container.appendChild(this.buttonEl);

    this.unsubscribeRegistry = this.registry.subscribe(() => {
      this.sync();
      this.onChanged?.();
    });

    this.sync();
  }

  isOpen(): boolean {
    return this.open;
  }

  private syncOpenAttributes(open: boolean): void {
    const val = open ? 'true' : 'false';
    this.container.setAttribute('data-layers-open', val);
    this.container.closest('#radar-stage')?.setAttribute('data-layers-open', val);
  }

  setOpen(open: boolean): void {
    if (this.open === open) return;
    this.open = open;
    this.popoverEl.classList.toggle('is-closed', !open);
    this.popoverEl.setAttribute('aria-hidden', open ? 'false' : 'true');
    this.buttonEl.classList.toggle('is-active', open);
    this.buttonEl.setAttribute('aria-expanded', open ? 'true' : 'false');
    this.syncOpenAttributes(open);
    this.onOpenChange?.(open);
  }

  sync(): void {
    const enabledCount = this.registry.getEnabledCount();
    const totalCount = this.registry.getTotalCount();
    this.buttonLabelEl.textContent = `Layers · ${enabledCount}/${totalCount}`;

    this.focusToggleEl.checked = this.registry.isContextualFocusEnabled();

    const activePreset = this.registry.getActivePresetId();
    for (const [presetId, btn] of this.presetButtons.entries()) {
      const isMatch = presetId === activePreset;
      btn.classList.toggle('active', isMatch);
      btn.setAttribute('aria-pressed', isMatch ? 'true' : 'false');
    }

    for (const cat of MAP_LAYER_CATEGORIES) {
      const state = this.registry.getCategoryState(cat.id);
      const cb = this.categoryCheckboxes.get(cat.id);
      if (cb) {
        cb.checked = state.checked;
        cb.indeterminate = state.indeterminate;
      }
      const countEl = this.categoryCounts.get(cat.id);
      if (countEl) {
        countEl.textContent = `${state.enabledCount}/${state.totalCount}`;
      }
      const collapsed = this.registry.isCategoryCollapsed(cat.id);
      const section = this.categorySections.get(cat.id);
      if (section) {
        section.classList.toggle('is-collapsed', collapsed);
      }
      const expandBtn = this.categoryExpandBtns.get(cat.id);
      if (expandBtn) {
        expandBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      }
    }

    for (const def of MAP_LAYER_DEFINITIONS) {
      const visible = this.registry.isLayerVisible(def.id);
      const cb = this.layerCheckboxes.get(def.id);
      if (cb) cb.checked = visible;

      const row = this.layerRows.get(def.id);
      if (row) row.classList.toggle('is-off', !visible);

      if (def.supportsOpacity) {
        const pct = Math.round(this.registry.getLayerOpacity(def.id) * 100);
        const slider = this.layerSliders.get(def.id);
        if (slider && slider.value !== String(pct)) {
          slider.value = String(pct);
        }
        const txt = this.layerOpacityTexts.get(def.id);
        if (txt) txt.textContent = `${pct}%`;
      }
    }
  }

  destroy(): void {
    document.removeEventListener('mousedown', this.boundDocPointerDown);
    document.removeEventListener('keydown', this.boundDocKeyDown);
    this.unsubscribeRegistry?.();
    this.unsubscribeRegistry = null;
    this.buttonEl.remove();
    this.popoverEl.remove();
  }
}
