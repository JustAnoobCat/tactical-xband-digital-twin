// @ts-nocheck — Composition root for the Tactical X-Band Digital Twin UI (UPG-05)
import { $, createAppContext } from './app/appContext.ts';
import { initWorkerBridgeController } from './app/workerBridgeController.ts';
import { initTerrainUploadController } from './app/terrainUploadController.ts';
import { initViewModeAnd3dController } from './app/viewModeAnd3dController.ts';
import { initMapLibreController } from './app/mapLibreController.ts';
import { initRadar2dAndInteractionController } from './app/radar2dAndInteractionController.ts';
import { initTerrainToolboxCoordinator } from './app/terrainToolboxCoordinator.ts';
import { initDashboardRenderOrchestrator } from './app/dashboardRenderOrchestrator.ts';
import { initScientificScopesAndTimelineController } from './app/scientificScopesAndTimelineController.ts';
import { initDomEventBindings } from './app/domEventBindings.ts';

/* Render-quality layer — applied before canvas context creation */
(function () {
  const gc = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (t, ...a) {
    const c = gc.call(this, t, ...a);
    if (c && t === '2d') {
      c.imageSmoothingQuality = 'high';
      c.lineJoin = 'round';
    }
    return c;
  };
})();

const isTauriRuntime =
  typeof window !== 'undefined' &&
  (('__TAURI__' in window) ||
    ('__TAURI_INTERNALS__' in window) ||
    window.location?.protocol === 'tauri:' ||
    (typeof window.location?.hostname === 'string' &&
      (window.location.hostname === 'tauri.localhost' ||
        window.location.hostname.endsWith('.tauri.localhost'))));

if (
  typeof window !== 'undefined' &&
  typeof navigator !== 'undefined' &&
  'serviceWorker' in navigator &&
  !isTauriRuntime &&
  (window.location.protocol === 'http:' || window.location.protocol === 'https:') &&
  !(typeof navigator.userAgent === 'string' && navigator.userAgent.includes('Electron'))
) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {});
  });
}

(window as any).tbOpen = false;

/* Authoritative simulation Web Worker */
const worker = new Worker(new URL("./worker/simWorker.ts", import.meta.url), {
  type: "module",
});

/* Shared state, engines, canvas contexts, DOM utilities, and action registry */
const ctx = createAppContext(worker);

/* Keep the original radar stage mounted for the lifetime of the application */
const persistentMapMount = $('persistent-map-mount');
const radarStage = document.querySelector('#tab-overview .radar-stage');
if (persistentMapMount && radarStage) persistentMapMount.appendChild(radarStage);

/* Wire cohesive domain controllers in zero-cycle topological order */
initWorkerBridgeController(ctx);
initTerrainUploadController(ctx);
initViewModeAnd3dController(ctx);
initMapLibreController(ctx);
initRadar2dAndInteractionController(ctx);
initDashboardRenderOrchestrator(ctx);
initScientificScopesAndTimelineController(ctx);
initTerrainToolboxCoordinator(ctx);
const { finalizeDomSetup } = initDomEventBindings(ctx);

/* Post-wiring initialization and animation loop kick-off */
ctx.actions.setupTerrainToolbox();
finalizeDomSetup();
ctx.actions.scheduleAnimationLoop();
setTimeout(() => ctx.actions.sendCommand({ type: 'GET_HILLSHADE' }), 80);
