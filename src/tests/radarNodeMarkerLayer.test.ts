import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  computeMarkerMotionDelta,
  createRadarNodeMarkerLayer,
  didRadarCameraChange,
  formatRadarNodeTag,
  mapLinkStatusToMarkerStatus,
  resolveRadarNodeMarkerStatus,
  type RadarCameraSignature,
} from '../ui/radarNodeMarkerLayer';

class FakeElement {
  tagName: string;
  className = '';
  hidden = false;
  textContent = '';
  style: Record<string, string> = {};
  attrs = new Map<string, string>();
  children: FakeElement[] = [];
  parent: FakeElement | null = null;
  animateCalls: Array<{ keyframes: unknown; options: unknown }> = [];

  constructor(tagName: string) {
    this.tagName = tagName;
  }

  setAttribute(name: string, value: string): void {
    this.attrs.set(name, String(value));
  }

  getAttribute(name: string): string | null {
    return this.attrs.has(name) ? (this.attrs.get(name) as string) : null;
  }

  appendChild(child: FakeElement): FakeElement {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  remove(): void {
    if (!this.parent) return;
    const idx = this.parent.children.indexOf(this);
    if (idx >= 0) this.parent.children.splice(idx, 1);
    this.parent = null;
  }

  animate(keyframes: unknown, options: unknown): { cancel: () => void } {
    this.animateCalls.push({ keyframes, options });
    return { cancel: () => undefined };
  }
}

function createFakeDoc() {
  return {
    createElement: (tag: string) => new FakeElement(tag),
  } as unknown as Document;
}

describe('radarNodeMarkerLayer pure logic', () => {
  it('maps authoritative LinkCommunicationStatus values to CSS data-status tokens', () => {
    assert.equal(mapLinkStatusToMarkerStatus('CONNECTED'), 'connected');
    assert.equal(mapLinkStatusToMarkerStatus('DEGRADED'), 'degraded');
    assert.equal(mapLinkStatusToMarkerStatus('BLOCKED_TERRAIN'), 'blocked-terrain');
    assert.equal(mapLinkStatusToMarkerStatus('BLOCKED_OBSTACLE'), 'blocked-obstacle');
    assert.equal(mapLinkStatusToMarkerStatus('OUTAGE_DISCONNECTED'), 'outage');
    assert.equal(mapLinkStatusToMarkerStatus('UNKNOWN'), 'unknown');
  });

  it('classifies live and historical ground node telemetry accurately', () => {
    assert.equal(
      resolveRadarNodeMarkerStatus({
        terrain_is_los: true,
        obstacle_blocked: false,
        link_outage: false,
        diffraction_loss_db: 0,
        snr_db: 18.5,
        modcod_name: '16-APSK 4/5',
      }),
      'connected'
    );

    assert.equal(
      resolveRadarNodeMarkerStatus({
        terrain_is_los: true,
        obstacle_blocked: false,
        link_outage: false,
        diffraction_loss_db: 2.4,
        snr_db: 11.2,
        modcod_name: 'QPSK 3/4',
      }),
      'degraded'
    );

    assert.equal(
      resolveRadarNodeMarkerStatus({
        terrain_is_los: false,
        obstacle_blocked: false,
        link_outage: true,
        snr_db: -12,
      }),
      'blocked-terrain'
    );

    assert.equal(
      resolveRadarNodeMarkerStatus({
        terrain_is_los: true,
        obstacle_blocked: true,
        link_outage: true,
        snr_db: -20,
      }),
      'blocked-obstacle'
    );

    assert.equal(
      resolveRadarNodeMarkerStatus({
        isLos: true,
        isObstacleBlocked: false,
        isOutage: true,
        snrDb: -4.2,
      }),
      'outage'
    );

    assert.equal(resolveRadarNodeMarkerStatus(null), 'unknown');
  });

  it('detects camera pan, zoom, and resize changes to prevent marker rubber-banding', () => {
    const base: RadarCameraSignature = { width: 800, height: 600, rangeM: 60000, panX: 0, panY: 0 };
    assert.equal(didRadarCameraChange(null, base), true);
    assert.equal(didRadarCameraChange(base, { ...base }), false);
    assert.equal(didRadarCameraChange(base, { ...base, panX: 250 }), true);
    assert.equal(didRadarCameraChange(base, { ...base, rangeM: 30000 }), true);
    assert.equal(didRadarCameraChange(base, { ...base, width: 920 }), true);
  });

  it('computes screen-space motion deltas and headings above threshold', () => {
    assert.equal(computeMarkerMotionDelta(undefined, { x: 100, y: 100 }).moved, false);
    assert.equal(computeMarkerMotionDelta({ x: 100, y: 100 }, { x: 100.1, y: 100.1 }).moved, false);
    const east = computeMarkerMotionDelta({ x: 100, y: 100 }, { x: 112, y: 100 });
    assert.equal(east.moved, true);
    assert.equal(east.distancePx, 12);
    assert.equal(east.headingDeg, 0);
  });

  it('formats concise ground terminal tags', () => {
    assert.equal(formatRadarNodeTag(3, 'ALPHA-1'), 'ALPHA-1');
    assert.equal(formatRadarNodeTag(3, '   '), 'S3');
    assert.equal(formatRadarNodeTag(7, 'VERY-LONG-CALLSIGN-NAME'), 'S7');
  });
});

describe('createRadarNodeMarkerLayer DOM & Web Animations API transitions', () => {
  const cam: RadarCameraSignature = { width: 800, height: 600, rangeM: 60000, panX: 0, panY: 0 };

  it('creates markers with spawn WAAPI animations and transitions fleet movement smoothly when camera is steady', () => {
    const container = new FakeElement('div');
    const layer = createRadarNodeMarkerLayer({
      container: container as unknown as HTMLElement,
      documentRef: createFakeDoc(),
      prefersReducedMotion: () => false,
    });

    // Frame 1: initial camera + spawn
    layer.sync(
      [{ nodeId: 1, x: 200, y: 150, status: 'connected', selected: false, label: 'S1' }],
      cam,
      true
    );

    assert.equal(layer.getMarkerCount(), 1);
    assert.equal(container.getAttribute('data-camera-moving'), 'true');
    const markerRoot = container.children[0];
    const [pulseEl, , dotEl] = markerRoot.children;
    assert.equal(markerRoot.style.transform, 'translate3d(200.00px, 150.00px, 0)');
    assert.equal(dotEl.animateCalls.length, 1);
    assert.equal(pulseEl.animateCalls.length, 1);

    // Frame 2: fleet moves while camera is steady -> smooth CSS transition enabled
    layer.sync(
      [{ nodeId: 1, x: 214.5, y: 158.25, status: 'connected', selected: false, label: 'S1' }],
      cam,
      true
    );

    assert.equal(container.getAttribute('data-camera-moving'), 'false');
    assert.equal(markerRoot.getAttribute('data-moving'), 'true');
    assert.equal(markerRoot.style.transform, 'translate3d(214.50px, 158.25px, 0)');
    // Status did not change -> no redundant WAAPI status pulse fired
    assert.equal(pulseEl.animateCalls.length, 1);

    // Frame 3: user pans camera -> instant repositioning (data-camera-moving=true)
    layer.sync(
      [{ nodeId: 1, x: 260, y: 180, status: 'connected', selected: false, label: 'S1' }],
      { ...cam, panX: 4000 },
      true
    );
    assert.equal(container.getAttribute('data-camera-moving'), 'true');
    assert.equal(markerRoot.getAttribute('data-moving'), 'false');
  });

  it('triggers WAAPI status pulse & selection lock-on animations only on actual state changes', () => {
    const container = new FakeElement('div');
    const layer = createRadarNodeMarkerLayer({
      container: container as unknown as HTMLElement,
      documentRef: createFakeDoc(),
      prefersReducedMotion: () => false,
    });

    layer.sync(
      [{ nodeId: 2, x: 300, y: 240, status: 'connected', selected: false, label: 'S2' }],
      cam,
      true
    );

    const markerRoot = container.children[0];
    const [pulseEl, reticleEl, dotEl] = markerRoot.children;
    assert.equal(pulseEl.animateCalls.length, 1);
    assert.equal(dotEl.animateCalls.length, 1);
    assert.equal(reticleEl.animateCalls.length, 0);

    // Status degrades -> WAAPI pulse + dot emphasis pop
    layer.sync(
      [{ nodeId: 2, x: 302, y: 240, status: 'degraded', selected: true, label: 'S2' }],
      cam,
      true
    );
    assert.equal(markerRoot.getAttribute('data-status'), 'degraded');
    assert.equal(markerRoot.getAttribute('data-selected'), 'true');
    assert.equal(pulseEl.animateCalls.length, 2);
    assert.equal(dotEl.animateCalls.length, 2);
    assert.equal(reticleEl.animateCalls.length, 1);

    // Next frame keeps same degraded/selected status -> no extra WAAPI spam
    layer.sync(
      [{ nodeId: 2, x: 304, y: 240, status: 'degraded', selected: true, label: 'S2' }],
      cam,
      true
    );
    assert.equal(pulseEl.animateCalls.length, 2);
    assert.equal(dotEl.animateCalls.length, 2);
    assert.equal(reticleEl.animateCalls.length, 1);
  });

  it('respects prefers-reduced-motion and cleans up despawned/hidden markers', () => {
    const container = new FakeElement('div');
    const layer = createRadarNodeMarkerLayer({
      container: container as unknown as HTMLElement,
      documentRef: createFakeDoc(),
      prefersReducedMotion: () => true,
    });

    layer.sync(
      [{ nodeId: 9, x: 100, y: 120, status: 'blocked-terrain', selected: true, label: 'S9' }],
      cam,
      true
    );
    const markerRoot = container.children[0];
    const [pulseEl, reticleEl, dotEl] = markerRoot.children;
    assert.equal(pulseEl.animateCalls.length, 0);
    assert.equal(dotEl.animateCalls.length, 0);
    assert.equal(reticleEl.animateCalls.length, 0);

    // Despawn node 9
    layer.sync([], cam, true);
    assert.equal(layer.getMarkerCount(), 0);
    assert.equal(container.children.length, 0);

    // Hide layer (e.g. switching to Geo or 3D mode)
    layer.hide();
    assert.equal(container.hidden, true);
    assert.equal(container.getAttribute('aria-hidden'), 'true');
  });
});
