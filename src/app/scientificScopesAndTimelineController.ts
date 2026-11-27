/**
 * Scientific Scopes, Network Telemetry Charts, Path Profiles,
 * Scheduler History & Timeline Controller.
 */
import type { AppContext } from './appContext.ts';
import type { TerrainBoundsTelemetry } from '../core/terrain.ts';
import type {
  FresnelSliceTelemetry,
  NodeTransferTelemetry,
  SelectedLinkBudgetTelemetry,
  TelemetryFrame,
} from '../shared/workerProtocol.ts';
import type { Position3D } from '../shared/types.ts';
import { dissectTdmaSlotAllocation } from '../core/pduDissector.ts';
import { classifyLinkCommunicationStatus } from '../core/linkStatusClassifier.ts';
import { getStatusBadgeInfo } from '../ui/mapLinkStyles.ts';
import { summarizeProfileStatus, renderTerrainProfileViewport } from '../ui/linkProfileViewport.ts';
import { renderTerrainTopView, renderRfTopView, syncCanvasDpr } from '../ui/pathProfileTopView.ts';
import type { TopViewRenderOptions } from '../ui/pathProfileTopView.ts';
import {
  SimulationTimelineRenderer,
  SimulationTimelineController,
} from '../ui/simulationTimelineCanvas.ts';
import {
  inspectTimelineFrame,
  renderFrameInspectorDom,
  transitionTimelineInspectorStatus,
  toggleTimelineInspectorManual,
  resetTimelineInspectorVisibility,
} from '../ui/timelineFrameInspector.ts';
import { exportTimelineDualCsv } from '../ui/timelineCsvExporter.ts';
import { resolveSuperframeTimeline } from '../ui/dataCommVisualization.ts';
import {
  aggregateNetworkSample,
  aggregateTeamNetworkSample,
} from '../ui/networkPerformanceDashboard.ts';
import { collectTeamsFromNodes, parseTeamSelection } from '../core/nodeRegistry.ts';
import { HIGHLAND_THEME } from '../ui/workbench/chartTheme.ts';
import {
  computeNiceTicks,
  drawThresholdLine,
  drawChartHoverCrosshair,
  getCanvasHoverState,
  bindChartHoverCrosshair,
} from '../ui/workbench/chartEnhancements.ts';
import {
  drawPolarAntennaScope as renderPolarAntennaScope,
  drawLinkWaterfallCanvas as renderLinkWaterfallCanvas,
  drawEcdfDelayScope as renderEcdfDelayScope,
  drawSensitivitySweepScope as renderSensitivitySweepScope,
} from '../ui/scientificScopesRenderer.ts';
import { shouldDeferSelectMutation } from '../ui/controllers/telemetryDomUpdaters.ts';

/**
 * Pure timeline dock height clamp allowing vertical stretch up to workspaceHeightPx - 96px.
 */
export function clampTimelineDockHeight(heightPx: number, workspaceHeightPx: number): number {
  const minH = 96;
  const maxH = Math.max(180, Math.round((Number.isFinite(workspaceHeightPx) ? workspaceHeightPx : 900) - 96));
  const safeH = Number.isFinite(heightPx) ? heightPx : 108;
  return Math.max(minH, Math.min(maxH, Math.round(safeH)));
}

export function initScientificScopesAndTimelineController(ctx: AppContext): void {
  const { worker, state, engines, canvases, dom, actions } = ctx;
  const { $, setText, MONO } = dom;
  const {
    historyBuffer,
    historyController,
    schedHistoryBuffer,
    schedHistoryController,
    sessionCoordinator,
    simSpatialBuffer,
    simEpochStore,
    dataCommVisualizer,
    networkPerformanceHistory,
    networkTrafficTracker,
    terrainProfileViewport,
    terrainTopViewport,
    obstacleEditor,
    trajectoryEditor,
  } = engines;
  const {
    waterfallCanvas,
    waterfallCtx,
    terrainCanvas,
    terrainCtx,
    polarAntennaCanvas,
    polarAntennaCtx,
    linkWaterfallCanvas,
    linkWaterfallCtx,
    ecdfDelayCanvas,
    ecdfDelayCtx,
    sensitivitySweepCanvas,
    sensitivitySweepCtx,
    timelineCanvas,
  } = canvases;

  function networkCanvasContext(id: string) {
    const canvas = $<HTMLCanvasElement>(id);
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.max(1, window.devicePixelRatio || 1);
    const width = Math.max(280, Math.round(rect.width || canvas.parentElement?.clientWidth || 640));
    const height = Math.max(220, Math.round(rect.height || 360));
    if (canvas.width !== width * ratio || canvas.height !== height * ratio) {
      canvas.width = width * ratio;
      canvas.height = height * ratio;
    }
    const g = canvas.getContext('2d');
    if (!g) return null;
    g.setTransform(ratio, 0, 0, ratio, 0, 0);
    return { ctx: g, width, height };
  }

  function networkDrawMetric(
    g: any,
    values: any[],
    label: string,
    unit: string,
    colorFor: (k: any) => string,
    yOffset: number,
    height: number,
    width: number,
    hoverInfo: any = null,
    drawSnrThresholds = false,
    timeSeries: any = null
  ) {
    const left = 72,
      right = 18,
      top = yOffset + 22,
      bottom = yOffset + height - 16;
    const plotWidth = Math.max(20, width - left - right);
    const plotHeight = Math.max(16, bottom - top);
    const finiteValues = values.flatMap((item) => item.values.filter(Number.isFinite));
    let min = finiteValues.length ? Math.min(...finiteValues) : 0;
    let max = finiteValues.length ? Math.max(...finiteValues) : 1;
    if (drawSnrThresholds) {
      min = Math.min(min, HIGHLAND_THEME.thresholds.outageSnrDb - 1.0);
      max = Math.max(max, HIGHLAND_THEME.thresholds.qpskHalfSnrDb + 2.0);
    }
    if (max <= min) {
      const pad = Math.max(1, Math.abs(max) * 0.05);
      min -= pad;
      max += pad;
    }
    const yOf = (val: number) => bottom - ((val - min) / (max - min)) * plotHeight;

    if (yOffset > 0) {
      g.strokeStyle = HIGHLAND_THEME.line.subtle;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(left, yOffset);
      g.lineTo(width - right, yOffset);
      g.stroke();
    }

    g.fillStyle = HIGHLAND_THEME.text.primary;
    g.font = `600 11px ${HIGHLAND_THEME.font.sans}`;
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';
    g.fillText(`${label} (${unit})`, left, yOffset + 14);

    const ticks = computeNiceTicks(min, max, 3);
    g.font = `10px ${HIGHLAND_THEME.font.mono}`;
    ticks.forEach((tick) => {
      const ty = yOf(tick);
      if (ty < top - 2 || ty > bottom + 2) return;
      g.strokeStyle = HIGHLAND_THEME.line.grid;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(left, Math.round(ty) + 0.5);
      g.lineTo(width - right, Math.round(ty) + 0.5);
      g.stroke();
      g.fillStyle = HIGHLAND_THEME.text.faint;
      g.textAlign = 'right';
      g.textBaseline = 'middle';
      g.fillText(Math.abs(tick) >= 100 ? tick.toFixed(0) : tick.toFixed(1), left - 6, ty);
    });

    g.strokeStyle = HIGHLAND_THEME.line.frame;
    g.lineWidth = 1;
    g.strokeRect(left, top, plotWidth, plotHeight);

    const plotBox = { left, right: width - right, top, bottom };
    if (drawSnrThresholds) {
      drawThresholdLine(
        g,
        plotBox,
        yOf(HIGHLAND_THEME.thresholds.outageSnrDb),
        `Outage ${HIGHLAND_THEME.thresholds.outageSnrDb.toFixed(1)} dB`,
        HIGHLAND_THEME.signal.vermilion,
        [4, 3]
      );
      drawThresholdLine(
        g,
        plotBox,
        yOf(HIGHLAND_THEME.thresholds.qpskHalfSnrDb),
        `QPSK 1/2 +${HIGHLAND_THEME.thresholds.qpskHalfSnrDb.toFixed(1)} dB`,
        HIGHLAND_THEME.signal.ochre,
        [5, 4]
      );
    }

    for (const series of values) {
      g.strokeStyle = colorFor(series.key);
      g.lineWidth = 2;
      g.beginPath();
      let started = false;
      series.values.forEach((value: number, index: number) => {
        if (!Number.isFinite(value)) {
          started = false;
          return;
        }
        const x =
          left +
          (series.values.length <= 1 ? 0 : (index / (series.values.length - 1)) * plotWidth);
        const y = yOf(value);
        if (!started) g.moveTo(x, y);
        else g.lineTo(x, y);
        started = true;
      });
      g.stroke();
    }

    if (
      hoverInfo &&
      hoverInfo.active &&
      hoverInfo.cssX >= left &&
      hoverInfo.cssX <= width - right &&
      values.length > 0 &&
      values[0].values.length > 1
    ) {
      const frac = Math.max(0, Math.min(1, (hoverInfo.cssX - left) / plotWidth));
      const idx = Math.round(frac * (values[0].values.length - 1));
      const snapX = left + (idx / (values[0].values.length - 1)) * plotWidth;
      const tLabel =
        timeSeries && Number.isFinite(timeSeries[idx])
          ? `T+${timeSeries[idx].toFixed(2)}s`
          : `Sample #${idx}`;
      const rows = values.slice(0, 5).map((series) => {
        const v = series.values[idx];
        return {
          label: series.label || String(series.key),
          valueText: Number.isFinite(v) ? `${v.toFixed(2)} ${unit}` : '—',
          color: colorFor(series.key),
        };
      });
      drawChartHoverCrosshair(g, plotBox, snapX, tLabel, rows);
    }
  }

  function networkVisibleSamples() {
    const samples = networkPerformanceHistory.getSamples();
    const range = Number($<HTMLSelectElement>('network-time-range')?.value || 30);
    const newest = samples.length ? samples[samples.length - 1].simulationTimeS : 0;
    return samples.filter((sample: any) => sample.simulationTimeS >= newest - range);
  }

  function drawNetworkCharts() {
    bindChartHoverCrosshair($<HTMLCanvasElement>('network-individual-chart'), drawNetworkCharts);
    bindChartHoverCrosshair($<HTMLCanvasElement>('network-aggregate-chart'), drawNetworkCharts);
    const samples = networkVisibleSamples();
    const timeSeries = samples.map((s: any) => s.simulationTimeS);
    const selectedValues = Array.from(
      $<HTMLSelectElement>('network-node-select')?.selectedOptions || []
    ).map((option: HTMLOptionElement) => option.value);
    const selectedSet = new Set(selectedValues);
    const individualCard = $('network-individual-card');
    const aggregateCard = $('network-aggregate-card');
    const mode = $<HTMLSelectElement>('network-view-mode')?.value || 'individual';
    if (individualCard) individualCard.style.display = mode === 'individual' ? '' : 'none';
    if (aggregateCard) aggregateCard.style.display = mode === 'aggregate' ? '' : 'none';
    const empty = $('network-dashboard-empty');
    if (empty)
      empty.textContent =
        samples.length && selectedSet.size
          ? `${selectedSet.size} selection${selectedSet.size === 1 ? '' : 's'} · ${samples.length} samples`
          : 'Select one or more ground nodes or teams to compare performance.';

    const colors = [
      HIGHLAND_THEME.signal.amber,
      HIGHLAND_THEME.signal.sage,
      HIGHLAND_THEME.signal.indigo,
      HIGHLAND_THEME.signal.ochre,
      HIGHLAND_THEME.signal.copper,
      HIGHLAND_THEME.signal.vermilionBright,
    ];

    const individualCanvas = networkCanvasContext('network-individual-chart');
    if (individualCanvas && mode === 'individual') {
      const keys = [...selectedSet];
      const indHover = getCanvasHoverState($<HTMLCanvasElement>('network-individual-chart'));
      const latestSample = samples[samples.length - 1];
      const labelForSelection = (selVal: string): string => {
        const teamKey = parseTeamSelection(selVal);
        if (teamKey) {
          if (latestSample) {
            const agg = aggregateTeamNetworkSample(latestSample, teamKey);
            return `Team: ${agg.teamName} (${agg.activeMemberCount}/${agg.memberCount} up, ${agg.outageMemberCount} out)`;
          }
          return `Team: ${teamKey}`;
        }
        const nid = Number(selVal);
        return state.networkNodeNames.get(nid) || `Node ${nid}`;
      };
      const make = (key: string) =>
        keys.map((selVal) => {
          const teamKey = parseTeamSelection(selVal);
          return {
            key: selVal,
            label: labelForSelection(selVal),
            values: samples.map((sample: any) => {
              if (teamKey) {
                const agg = aggregateTeamNetworkSample(sample, teamKey);
                if (key === 'snr') return agg.averageSinrDb ?? agg.averageSnrDb ?? NaN;
                if (key === 'rate') return agg.totalRateMbps;
                return agg.totalTransferredMb;
              }
              const nid = Number(selVal);
              const node = sample.nodes.find((item: any) => item.nodeId === nid);
              if (!node) return NaN;
              if (key === 'snr') return node.linkValid ? node.snrDb ?? NaN : NaN;
              if (key === 'rate') return node.rateMbps;
              return node.transferredMb;
            }),
          };
        });
      individualCanvas.ctx.clearRect(0, 0, individualCanvas.width, individualCanvas.height);
      individualCanvas.ctx.fillStyle = HIGHLAND_THEME.substrate.void;
      individualCanvas.ctx.fillRect(0, 0, individualCanvas.width, individualCanvas.height);
      const enabled = [
        [$<HTMLInputElement>('network-show-snr')?.checked, 'snr', 'SNR / SINR', 'dB'],
        [$<HTMLInputElement>('network-show-rate')?.checked, 'rate', 'Rate', 'Mbps'],
        [$<HTMLInputElement>('network-show-transferred')?.checked, 'transferred', 'Transferred', 'MB'],
      ].filter((item) => item[0]);
      const rowHeight = enabled.length
        ? individualCanvas.height / enabled.length
        : individualCanvas.height;
      enabled.forEach((item, index) =>
        networkDrawMetric(
          individualCanvas.ctx,
          make(item[1] as string),
          item[2] as string,
          item[3] as string,
          (k) => colors[Math.max(0, keys.indexOf(String(k))) % colors.length],
          index * rowHeight,
          rowHeight,
          individualCanvas.width,
          indHover,
          item[1] === 'snr',
          timeSeries
        )
      );
      const legend = keys
        .map(
          (selVal, index) =>
            `${labelForSelection(selVal)} (${colors[index % colors.length]})`
        )
        .join(' · ');
      setText('network-individual-value', legend || 'No nodes selected');
    }

    const aggregateCanvas = networkCanvasContext('network-aggregate-chart');
    if (aggregateCanvas && mode === 'aggregate') {
      const aggregates = samples.map(aggregateNetworkSample);
      const aggHover = getCanvasHoverState($<HTMLCanvasElement>('network-aggregate-chart'));
      aggregateCanvas.ctx.clearRect(0, 0, aggregateCanvas.width, aggregateCanvas.height);
      aggregateCanvas.ctx.fillStyle = HIGHLAND_THEME.substrate.void;
      aggregateCanvas.ctx.fillRect(0, 0, aggregateCanvas.width, aggregateCanvas.height);
      const enabled = [
        [$<HTMLInputElement>('network-show-snr')?.checked, 'snr', 'SNR avg / min', 'dB'],
        [$<HTMLInputElement>('network-show-rate')?.checked, 'rate', 'Total rate', 'Mbps'],
        [$<HTMLInputElement>('network-show-transferred')?.checked, 'transferred', 'Total transferred', 'MB'],
      ].filter((item) => item[0]);
      const rowHeight = enabled.length
        ? aggregateCanvas.height / enabled.length
        : aggregateCanvas.height;
      enabled.forEach((item, index) => {
        const series =
          item[1] === 'snr'
            ? [
                {
                  key: 'avg',
                  label: 'Mean SNR',
                  values: aggregates.map((value: any) => value.averageSnrDb ?? NaN),
                },
                {
                  key: 'min',
                  label: 'Min SNR',
                  values: aggregates.map((value: any) => value.minimumSnrDb ?? NaN),
                },
              ]
            : [
                {
                  key: item[1],
                  label: item[2],
                  values: aggregates.map((value: any) =>
                    item[1] === 'rate' ? value.totalRateMbps : value.totalTransferredMb
                  ),
                },
              ];
        networkDrawMetric(
          aggregateCanvas.ctx,
          series,
          item[2] as string,
          item[3] as string,
          (key) =>
            key === 'min'
              ? HIGHLAND_THEME.signal.vermilion
              : key === 'avg'
                ? HIGHLAND_THEME.signal.amber
                : HIGHLAND_THEME.signal.sage,
          index * rowHeight,
          rowHeight,
          aggregateCanvas.width,
          aggHover,
          item[1] === 'snr',
          timeSeries
        );
      });
      const last = aggregates[aggregates.length - 1];
      setText(
        'network-aggregate-value',
        last
          ? `${last.validLinkCount} valid links · ${last.totalRateMbps.toFixed(2)} Mbps`
          : 'No network samples'
      );
    }
  }

  function updateNetworkNodeOptions(nodes: readonly any[]) {
    const select = $<HTMLSelectElement>('network-node-select');
    if (!select) return;
    if (shouldDeferSelectMutation(select)) {
      select.dataset.pendingOptSync = '1';
      return;
    }
    const teams = collectTeamsFromNodes(nodes);
    const signature = nodes
      .map(
        (node) =>
          `${node.node_id}:${node.name || ''}:${node.team_id || ''}:${node.team_name || ''}:${node.link_outage === false ? 'up' : 'down'}`
      )
      .join('|');
    if (signature === state.networkNodeOptionsSignature && select.dataset.optSig === signature) return;
    state.networkNodeOptionsSignature = signature;
    select.dataset.optSig = signature;
    const selectedVals = new Set(Array.from(select.selectedOptions).map((option: any) => String(option.value)));
    const ids = nodes.map((node) => node.node_id);

    const children: HTMLElement[] = [];
    if (teams.length > 0) {
      const teamGroup = document.createElement('optgroup');
      teamGroup.label = 'Tactical Teams';
      teams.forEach((t) => {
        const option = document.createElement('option');
        option.value = `team:${t.teamId}`;
        option.textContent = `Team: ${t.teamName} (${t.nodeIds.length} nodes)`;
        option.selected = selectedVals.has(option.value);
        teamGroup.appendChild(option);
      });
      children.push(teamGroup);
    }

    const termGroup = document.createElement('optgroup');
    termGroup.label = 'Individual Terminals';
    nodes.forEach((node) => {
      state.networkNodeNames.set(node.node_id, node.name || `Node ${node.node_id}`);
      const option = document.createElement('option');
      option.value = String(node.node_id);
      const teamSuffix = node.team_name ? ` [${node.team_name}]` : '';
      option.textContent = `${node.name || `Node ${node.node_id}`}${teamSuffix} · ${node.link_outage === false ? 'connected' : 'disconnected'}`;
      option.selected = selectedVals.size
        ? selectedVals.has(String(node.node_id))
        : ids.indexOf(node.node_id) < 3;
      termGroup.appendChild(option);
    });
    children.push(termGroup);

    select.replaceChildren(...children);
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('node') && state.selectedNodeId === -1) {
      const nid = Number(urlParams.get('node'));
      if (nodes.some((n) => n.node_id === nid)) {
        actions.handleNodeSelection(nid);
      }
    }
  }

  function ingestNetworkPerformance(frame: any) {
    const nodes = Array.isArray(frame?.nodes_telemetry) ? frame.nodes_telemetry : [];
    updateNetworkNodeOptions(nodes);
    const sample = networkPerformanceHistory.ingest(
      {
        frameIndex: Number(frame?.frame_index ?? 0),
        simulationTimeS: Number(frame?.sim_time_s ?? 0),
        nodes,
      },
      state.networkGraphUpdatesEnabled
    );
    if (
      sample &&
      (sample.simulationTimeS - state.networkLastRenderTime >= 0.1 ||
        document.visibilityState !== 'visible')
    ) {
      state.networkLastRenderTime = sample.simulationTimeS;
      drawNetworkCharts();
    }
    const activeTabId = document.querySelector('.tab-content.active')?.id;
    if (activeTabId === 'tab-network') {
      actions.renderQosSlaAnalyzer(frame);
    }
  }

  function setupNetworkDashboard() {
    [
      'network-view-mode',
      'network-node-select',
      'network-time-range',
      'network-show-snr',
      'network-show-rate',
      'network-show-transferred',
    ].forEach((id) => {
      $(id)?.addEventListener('change', drawNetworkCharts);
    });
    $('network-pause')?.addEventListener('click', () => {
      state.networkGraphUpdatesEnabled = !state.networkGraphUpdatesEnabled;
      const button = $('network-pause');
      if (button)
        button.textContent = state.networkGraphUpdatesEnabled
          ? 'Pause graph updates'
          : 'Resume graph updates';
      setText(
        'network-dashboard-state',
        state.networkGraphUpdatesEnabled ? 'LIVE' : 'PAUSED'
      );
      drawNetworkCharts();
    });
    $('network-clear')?.addEventListener('click', () => {
      networkPerformanceHistory.clear();
      state.networkLastRenderTime = 0;
      drawNetworkCharts();
    });
    window.addEventListener('resize', drawNetworkCharts);
  }

  function updateStepControlUI(enabled: boolean = true) {
    const btn = $<HTMLButtonElement>('btn-step');
    if (!btn) return;
    btn.disabled = !enabled;
    btn.classList.toggle('disabled', !enabled);
    if (!enabled) {
      btn.setAttribute('aria-disabled', 'true');
      btn.title = 'Stepped cycle in progress...';
    } else {
      btn.removeAttribute('aria-disabled');
      btn.title = 'Advance one 20 ms frame (.)';
    }
  }

  function updatePauseButtonUI() {
    const btn = $('btn-pause');
    if (!btn) return;
    const pbMode = dataCommVisualizer.getPlaybackMode();
    const stepState = dataCommVisualizer.getSteppedLifecycle();
    const visualPaused = dataCommVisualizer.isVisualPaused();

    if (pbMode === 'stepped') {
      if (stepState === 'playing') {
        btn.textContent = visualPaused ? 'RESUME' : 'PAUSE';
        btn.classList.toggle('active', visualPaused);
        btn.title = visualPaused
          ? 'Resume stepped visual playback (Space)'
          : 'Pause stepped visual playback (Space)';
      } else if (stepState === 'complete') {
        btn.textContent = 'RESUME SIM';
        btn.classList.add('active');
        btn.title = 'Resume continuous simulation (Space)';
      } else {
        btn.textContent = state.isPaused ? 'RESUME' : 'PAUSE';
        btn.classList.toggle('active', state.isPaused);
        btn.title = 'Pause or resume (Space)';
      }
    } else {
      btn.textContent = state.isPaused ? 'RESUME' : 'PAUSE';
      btn.classList.toggle('active', state.isPaused);
      btn.title = 'Pause or resume (Space)';
    }
  }

  dataCommVisualizer.setOnSteppedCycleComplete(() => {
    updateStepControlUI(true);
    updatePauseButtonUI();
  });

  function resolveFloorRfRecord(buffer: any, targetFrame: number) {
    const span = buffer.getSpan();
    if (span.count < 1 || span.oldestFrame === null || span.newestFrame === null) return null;
    if (targetFrame < span.oldestFrame) return null;
    const cappedTarget = Math.min(targetFrame, span.newestFrame);
    for (let f = cappedTarget; f >= span.oldestFrame && f >= cappedTarget - 128; f--) {
      const rec = buffer.getByFrameIndex(f);
      if (rec) return rec;
    }
    return null;
  }

  function resolveFloorSchedulerRecord(buffer: any, targetFrame: number) {
    const span = buffer.getSpan();
    if (span.count < 1 || span.oldestFrame === null || span.newestFrame === null) return null;
    if (targetFrame < span.oldestFrame) return null;
    const cappedTarget = Math.min(targetFrame, span.newestFrame);
    for (let f = cappedTarget; f >= span.oldestFrame && f >= cappedTarget - 128; f--) {
      const rec = buffer.getByFrameIndex(f);
      if (rec) return rec;
    }
    const records = buffer.getChronologicalRecords();
    let lo = 0,
      hi = records.length - 1,
      best = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (records[mid].frameIndex <= cappedTarget) {
        best = records[mid];
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return best;
  }

  function clearHistoricalUnavailableMetrics(targetFrame: number, playheadTimeS: number) {
    const msg = `Historical telemetry for frame #${targetFrame} (T+${playheadTimeS.toFixed(2)}s) is evicted or outside the retained rolling buffer. Live simulation continues undisturbed.`;
    const schedNotice = $('sched-evicted-notice');
    if (schedNotice) {
      schedNotice.textContent = msg;
      schedNotice.classList.add('is-visible');
    }
    const snapPanel = $('sched-snapshot-panel');
    if (snapPanel) {
      snapPanel.style.display = 'block';
      setText('sched-snapshot-badge', `UNAVAILABLE #${targetFrame}`);
      [
        'snap-time',
        'snap-mode',
        'snap-util',
        'snap-goodput',
        'snap-drops',
        'snap-backlog',
        'snap-cum-goodput',
        'snap-cum-drops',
      ].forEach((id) => setText(id, '—'));
    }
    ['alloc-node-label', 'alloc-airtime', 'alloc-segments'].forEach((id) => setText(id, '—'));
    setText('alloc-inspector-note', msg);
  }

  function clearRfUnavailableMetrics(targetFrame: number, playheadTimeS: number) {
    const msg = `Historical RF link profile for frame #${targetFrame} (T+${playheadTimeS.toFixed(2)}s) is evicted or unavailable. Zero fabricated fallbacks applied.`;
    const rfNotice = $('rf-evicted-notice');
    if (rfNotice) {
      rfNotice.textContent = msg;
      rfNotice.classList.add('is-visible');
    }
    setText('terrain-node-label', `Unavailable [Historical #${targetFrame}]`);
    [
      'link-modcod-tag',
      'lb-slant',
      'lb-snr',
      'lb-se',
      'lb-fspl',
      'lb-diff',
      'lb-prx',
      'lb-pnoise',
      'lb-bulge',
      'lb-gas',
      'lb-rain',
    ].forEach((id) => setText(id, '—'));
  }

  function initTimelineController() {
    setupNetworkDashboard();

    if (!timelineCanvas) return;

    state.simTimelineRenderer = new SimulationTimelineRenderer({
      canvas: timelineCanvas,
      spatialBuffer: simSpatialBuffer,
      epochStore: simEpochStore,
      viewDurationS: 20.0,
      isLive: true,
    });
    state.simTimelineRenderer.attachEventListeners();

    const applyTimelineInspectorVisibility = (nextState: any) => {
      const prevExpanded = state.timelineInspectorVisibility.isExpanded;
      state.timelineInspectorVisibility = nextState;
      $('sim-timeline-panel')?.classList.toggle('is-expanded', nextState.isExpanded);
      if (prevExpanded !== nextState.isExpanded && state.simTimelineRenderer) {
        state.simTimelineRenderer.syncCanvas();
        state.simTimelineRenderer.render();
      }
    };
    state.handleTimelineInspectorReset = () => {
      applyTimelineInspectorVisibility(resetTimelineInspectorVisibility());
    };
    const clearAuxiliaryTimelineBuffers = () => {
      sessionCoordinator?.reset?.();
      state.currentSpatialRevision = 0;
      historyController?.reset?.();
      schedHistoryController?.reset?.();
      dataCommVisualizer?.reset?.();
      networkTrafficTracker?.clear?.();
      state.handleTimelineInspectorReset();
    };

    const toggleInspectorExpand = () => {
      const timelineInspectorVisibility = state.timelineInspectorVisibility;
      applyTimelineInspectorVisibility(
        toggleTimelineInspectorManual(timelineInspectorVisibility)
      );
      const targetFrame = Math.max(
        0,
        Math.round((state.simTimelineController?.playheadTimeS ?? 0) / 0.02)
      );
      updateInspectorDom(targetFrame);
    };

    const updateInspectorDom = (targetFrame: number) => {
      const inspectorMount = $('sim-timeline-inspector-container');
      if (inspectorMount && state.simTimelineController) {
        const payload = inspectTimelineFrame({
          frameIndex: targetFrame,
          spatialBuffer: simSpatialBuffer,
          epochStore: simEpochStore,
          isSimRunning: !state.isPaused,
          currentSimTimeS: state.simTimelineController.playheadTimeS,
          tdmaAccumulatorS: 0,
          selectedNodeId: typeof state.selectedNodeId === 'number' ? state.selectedNodeId : null,
        });
        renderFrameInspectorDom(payload, inspectorMount, {
          isExpanded: state.timelineInspectorVisibility.isExpanded,
          onExpandToggle: toggleInspectorExpand,
        });
      }
    };

    state.simTimelineController = new SimulationTimelineController({
      spatialBuffer: simSpatialBuffer,
      epochStore: simEpochStore,
      renderer: state.simTimelineRenderer,
      onFirstTaggedActivation: () => {
        clearAuxiliaryTimelineBuffers();
      },
      onReset: () => {
        clearAuxiliaryTimelineBuffers();
      },
      onMapRedrawNeeded: () => {
        actions.markRadarDirty();
        state.schedulerNeedsRender = true;
        state.terrainNeedsRender = true;
        actions.drawRadar();
        drawWaterfall();
        drawFresnel();
        if (state.terrainMapMode === 'maplibre' && state.mapLibreInitialized) {
          actions.updateMapLibreOverlay();
        }
        if (state.stageViewMode === '3d' && state.threeController) {
          const snap = state.simTimelineController?.isHistoricalInspecting
            ? state.simTimelineController.getActiveSpatialSnapshot()
            : null;
          if (snap) {
            state.threeController.updateTelemetry({
              acn_telemetry: {
                pos_x: snap.acn.posX,
                pos_y: snap.acn.posY,
                altitude_msl_m: snap.acn.altitudeMslM,
                position_m: [snap.acn.posX, snap.acn.posY, snap.acn.altitudeMslM],
                heading_rad: snap.acn.headingRad,
                heading_deg: (snap.acn.headingRad * 180) / Math.PI,
                flight_path: state.latestTelemetry?.acn_telemetry?.flight_path,
              },
              nodes_telemetry: snap.nodes.map((n: any) => {
                const liveNode = state.latestTelemetry?.nodes_telemetry?.find(
                  (ln: any) => ln.node_id === n.nodeId
                );
                return {
                  node_id: n.nodeId,
                  name: liveNode?.name,
                  node_type: liveNode?.node_type,
                  color_hex: liveNode?.color_hex,
                  x_m: n.posX,
                  y_m: n.posY,
                  z_m: n.posZ,
                  terrain_is_los: n.isLos,
                  obstacle_blocked: n.isObstacleBlocked,
                  link_outage: n.isOutage,
                  snr_db: n.snrDb,
                  state_name: n.currentState,
                };
              }),
            });
          } else if (state.latestTelemetry) {
            state.threeController.updateTelemetry(state.latestTelemetry);
          }
        }
      },
      onStatusChange: (isLive: boolean, playheadTimeS: number) => {
        const timeDisplay = $('timeline-time-display');
        if (timeDisplay) timeDisplay.textContent = `${playheadTimeS.toFixed(2)}s`;
        const liveBtn = $('timeline-btn-live');
        if (liveBtn) {
          if (isLive) {
            liveBtn.classList.add('active');
            liveBtn.textContent = '● LIVE';
          } else {
            liveBtn.classList.remove('active');
            liveBtn.textContent = '↩ Return to Live';
          }
        }
        const playBtn = $('timeline-btn-play');
        if (playBtn) {
          playBtn.classList.toggle(
            'is-playing',
            Boolean(state.simTimelineController?.isPlayingHistory)
          );
        }

        const wasHistorical = state.bridgeHistoricalActive;
        const targetFrame = Math.max(0, Math.round(playheadTimeS / 0.02));
        state.bridgeHistoricalActive = !isLive;
        state.bridgeHistoricalFrame = isLive ? null : targetFrame;

        if (!isLive) {
          document.body.classList.add('is-historical-mode');
          const banner = $('historical-mode-banner');
          if (banner) banner.hidden = false;
          const chromeBadge = $('map-chrome-mode-badge');
          if (chromeBadge) chromeBadge.textContent = `Historical T+${playheadTimeS.toFixed(2)}s`;

          setText(
            'historical-banner-summary',
            `Inspecting frame #${targetFrame} (T+${playheadTimeS.toFixed(2)}s) — spatial edits locked while live worker runs in background.`
          );

          const schedRec = resolveFloorSchedulerRecord(schedHistoryBuffer, targetFrame);
          state.bridgeHistSchedRec = schedRec;
          if (schedRec) {
            $('sched-evicted-notice')?.classList.remove('is-visible');
            schedHistoryController.enterHistorical(schedRec.frameIndex, false);
            syncSchedulerHistoricalUIState();
          } else {
            schedHistoryController.exitHistorical();
            clearHistoricalUnavailableMetrics(targetFrame, playheadTimeS);
            drawWaterfall();
            drawSchedulerCharts();
          }

          const rfRec = resolveFloorRfRecord(historyBuffer, targetFrame);
          state.bridgeHistRfRec = rfRec;
          if (rfRec) {
            $('rf-evicted-notice')?.classList.remove('is-visible');
            historyController.enterHistorical(rfRec.frameIndex, false);
            syncHistoricalUIState();
          } else {
            historyController.exitHistorical();
            clearRfUnavailableMetrics(targetFrame, playheadTimeS);
            drawFresnel();
          }

          dataCommVisualizer.enterHistorical();
          actions.renderSelectedNodeDetails();
          actions.syncRadarHudMode();
        } else if (wasHistorical) {
          document.body.classList.remove('is-historical-mode');
          const banner = $('historical-mode-banner');
          if (banner) banner.hidden = true;
          const chromeBadge = $('map-chrome-mode-badge');
          if (chromeBadge) chromeBadge.textContent = 'Live picture';

          state.bridgeHistSchedRec = null;
          state.bridgeHistRfRec = null;
          $('sched-evicted-notice')?.classList.remove('is-visible');
          $('rf-evicted-notice')?.classList.remove('is-visible');
          historyController.exitHistorical();
          schedHistoryController.exitHistorical();
          syncLiveUIState();
          syncSchedulerLiveUIState();
          dataCommVisualizer.exitHistorical(state.isPaused);
          updateStepControlUI(!state.isPaused || dataCommVisualizer.canStep());
          actions.renderSelectedNodeDetails();
          actions.syncRadarHudMode();
        }

        const timelineInspectorVisibility = state.timelineInspectorVisibility;
        applyTimelineInspectorVisibility(
          transitionTimelineInspectorStatus(timelineInspectorVisibility, isLive)
        );
        updateInspectorDom(targetFrame);
      },
    });

    $('timeline-btn-toggle-expand')?.addEventListener('click', toggleInspectorExpand);

    $('timeline-btn-play')?.addEventListener('click', () => {
      state.simTimelineController?.togglePlayPause();
      actions.markUiDirtyAndWake();
    });
    $('timeline-btn-step-back')?.addEventListener('click', () => {
      state.simTimelineController?.stepBackward(0.02);
      actions.markUiDirtyAndWake();
    });
    $('timeline-btn-step-fwd')?.addEventListener('click', () => {
      state.simTimelineController?.stepForward(0.02);
      actions.markUiDirtyAndWake();
    });
    $('timeline-btn-live')?.addEventListener('click', () => {
      state.simTimelineController?.jumpToLive();
      actions.markUiDirtyAndWake();
    });
    $('timeline-btn-zoom-in')?.addEventListener('click', () => {
      state.simTimelineController?.zoomIn();
      actions.scheduleAnimationLoop();
    });
    $('timeline-btn-zoom-out')?.addEventListener('click', () => {
      state.simTimelineController?.zoomOut();
      actions.scheduleAnimationLoop();
    });
    $('timeline-btn-fit')?.addEventListener('click', () => {
      state.simTimelineController?.fitHorizon();
      actions.scheduleAnimationLoop();
    });
    $('timeline-btn-export-csv')?.addEventListener('click', async () => {
      const btn = $('timeline-btn-export-csv');
      try {
        if (btn) btn.textContent = 'Exporting…';
        await exportTimelineDualCsv({
          spatialBuffer: simSpatialBuffer,
          epochStore: simEpochStore,
          autoDispatch: true,
        });
        if (btn) btn.textContent = 'CSV';
      } catch (err) {
        console.error('Failed to export CSVs:', err);
        if (btn) btn.textContent = 'CSV';
      }
    });

    // Resizable & Collapsible Timeline (localStorage persisted, uncapped vertical stretch)
    const timelinePanel = $('sim-timeline-panel');
    const timelineHandle = $('sim-timeline-resize-handle');
    const timelineCollapseBtn = $('timeline-btn-collapse');
    const TL_HEIGHT_KEY = 'xband-timeline-height-v1';
    const TL_COLLAPSED_KEY = 'xband-timeline-collapsed-v1';
    const DEFAULT_TL_HEIGHT = 108;
    const getWorkspaceHeight = () => {
      const mapPanelH = $('persistent-map-panel')?.getBoundingClientRect().height ?? 0;
      return mapPanelH > 200 ? mapPanelH : (window.innerHeight || 900);
    };
    const getMaxTimelineHeight = () => Math.max(180, Math.round(getWorkspaceHeight() - 96));
    const clampTimelineHeight = (h: number) => clampTimelineDockHeight(h, getWorkspaceHeight());

    let hasPersistedTimelineHeight = false;
    let savedTimelineHeight = 160;
    let savedTimelineCollapsed = false;
    try {
      const rawStr = localStorage.getItem(TL_HEIGHT_KEY);
      const rawH = rawStr === null ? Number.NaN : Number(rawStr);
      if (Number.isFinite(rawH) && rawH >= 96 && rawH <= Math.max(getMaxTimelineHeight(), 2400)) {
        hasPersistedTimelineHeight = true;
        savedTimelineHeight = clampTimelineHeight(rawH);
      }
      const rawC = localStorage.getItem(TL_COLLAPSED_KEY);
      savedTimelineCollapsed = rawC === '1' || rawC === 'true';
    } catch (_) {}

    const syncTimelineAriaNow = () => {
      if (!timelinePanel || !timelineHandle) return;
      const maxH = getMaxTimelineHeight();
      timelineHandle.setAttribute('aria-valuemax', String(maxH));
      if (hasPersistedTimelineHeight && !timelinePanel.classList.contains('is-collapsed')) {
        const reclamped = clampTimelineHeight(savedTimelineHeight);
        if (reclamped !== savedTimelineHeight) {
          savedTimelineHeight = reclamped;
          timelinePanel.style.setProperty('--timeline-height', `${reclamped}px`);
        }
      }
      const h = Math.round(timelinePanel.getBoundingClientRect().height || savedTimelineHeight);
      timelineHandle.setAttribute('aria-valuenow', String(clampTimelineHeight(h)));
    };

    let tlResizeRafPending = false;
    const scheduleTimelineCanvasResize = () => {
      state.simTimelineRenderer?.resize?.();
      if (tlResizeRafPending) return;
      tlResizeRafPending = true;
      requestAnimationFrame(() => {
        tlResizeRafPending = false;
        state.simTimelineRenderer?.resize?.();
        actions.resizeCanvases();
      });
    };

    const applyTimelineHeight = (heightPx: number, persist = true) => {
      if (!timelinePanel) return;
      const clamped = clampTimelineHeight(heightPx);
      timelinePanel.style.setProperty('--timeline-height', `${clamped}px`);
      timelineHandle?.setAttribute('aria-valuemax', String(getMaxTimelineHeight()));
      timelineHandle?.setAttribute('aria-valuenow', String(clamped));
      if (persist && !timelinePanel.classList.contains('is-collapsed')) {
        hasPersistedTimelineHeight = true;
        savedTimelineHeight = clamped;
        try {
          localStorage.setItem(TL_HEIGHT_KEY, String(clamped));
        } catch (_) {}
      }
      scheduleTimelineCanvasResize();
    };

    const resetTimelineHeightToDefault = () => {
      if (!timelinePanel) return;
      hasPersistedTimelineHeight = false;
      savedTimelineHeight = DEFAULT_TL_HEIGHT;
      timelinePanel.style.removeProperty('--timeline-height');
      try {
        localStorage.removeItem(TL_HEIGHT_KEY);
      } catch (_) {}
      syncTimelineAriaNow();
      scheduleTimelineCanvasResize();
    };

    const applyTimelineCollapsed = (collapsed: boolean, persist = true) => {
      if (!timelinePanel) return;
      timelinePanel.classList.toggle('is-collapsed', collapsed);
      timelineCollapseBtn?.setAttribute('aria-expanded', String(!collapsed));
      timelineCollapseBtn?.classList.toggle('is-collapsed', collapsed);
      if (timelineCollapseBtn) {
        timelineCollapseBtn.title = collapsed ? 'Expand timeline' : 'Collapse timeline';
      }
      if (persist) {
        try {
          localStorage.setItem(TL_COLLAPSED_KEY, collapsed ? '1' : '0');
        } catch (_) {}
      }
      state.simTimelineRenderer?.resize?.();
      requestAnimationFrame(() => actions.resizeCanvases());
      setTimeout(() => {
        state.simTimelineRenderer?.resize?.();
        actions.resizeCanvases();
        syncTimelineAriaNow();
      }, 220);
    };

    if (hasPersistedTimelineHeight) {
      applyTimelineHeight(savedTimelineHeight, false);
    } else {
      requestAnimationFrame(syncTimelineAriaNow);
    }
    window.addEventListener('resize', syncTimelineAriaNow);
    applyTimelineCollapsed(savedTimelineCollapsed, false);

    timelineCollapseBtn?.addEventListener('click', (e: any) => {
      e.preventDefault();
      e.stopPropagation();
      const nextCollapsed = !timelinePanel?.classList.contains('is-collapsed');
      applyTimelineCollapsed(nextCollapsed, true);
    });

    if (timelineHandle && timelinePanel) {
      let tlDragging = false;
      let tlStartY = 0;
      let tlStartH = savedTimelineHeight;
      timelineHandle.addEventListener('pointerdown', (event: any) => {
        if (event.button !== 0) return;
        if (timelinePanel.classList.contains('is-collapsed')) return;
        tlDragging = true;
        tlStartY = event.clientY;
        tlStartH = timelinePanel.getBoundingClientRect().height || savedTimelineHeight;
        timelineHandle.setPointerCapture(event.pointerId);
        timelinePanel.classList.add('is-resizing');
        event.preventDefault();
      });
      timelineHandle.addEventListener('pointermove', (event: any) => {
        if (!tlDragging) return;
        const nextH = tlStartH - (event.clientY - tlStartY);
        applyTimelineHeight(nextH, true);
      });
      timelineHandle.addEventListener('dblclick', (event: any) => {
        if (timelinePanel.classList.contains('is-collapsed')) return;
        event.preventDefault();
        resetTimelineHeightToDefault();
      });
      const stopTimelineDrag = () => {
        if (!tlDragging) return;
        tlDragging = false;
        timelinePanel.classList.remove('is-resizing');
        state.simTimelineRenderer?.resize?.();
        actions.resizeCanvases();
      };
      timelineHandle.addEventListener('pointerup', stopTimelineDrag);
      timelineHandle.addEventListener('pointercancel', stopTimelineDrag);
      timelineHandle.addEventListener('keydown', (event: any) => {
        if (timelinePanel.classList.contains('is-collapsed')) return;
        const currentH = timelinePanel.getBoundingClientRect().height || savedTimelineHeight;
        if (event.key === 'ArrowUp') {
          applyTimelineHeight(currentH + 16, true);
          event.preventDefault();
        } else if (event.key === 'ArrowDown') {
          applyTimelineHeight(currentH - 16, true);
          event.preventDefault();
        } else if (event.key === 'Home') {
          applyTimelineHeight(96, true);
          event.preventDefault();
        } else if (event.key === 'End') {
          applyTimelineHeight(getMaxTimelineHeight(), true);
          event.preventDefault();
        }
      });
    }
  }

  function setupWorkspaceResizing() {
    const workspace = $('main-workspace');
    const handle = $('map-resize-handle');
    if (!workspace || !handle) return;
    const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
    let saved = 58;
    try {
      const parsed = Number(localStorage.getItem('xband-map-width-pct'));
      if (Number.isFinite(parsed) && parsed >= 24 && parsed <= 76) saved = parsed;
    } catch (_) {}
    let dragStartX = 0,
      dragStartPct = saved,
      dragging = false;
    const setWidth = (pct: number, persist = true) => {
      const bounds = workspace.getBoundingClientRect();
      const minPct = Math.max((260 / Math.max(bounds.width, 1)) * 100, 24);
      const maxPct = Math.min(76, 100 - (340 / Math.max(bounds.width, 1)) * 100);
      const next = clamp(pct, minPct, maxPct);
      workspace.style.setProperty('--map-width', `${next}%`);
      handle.setAttribute('aria-valuenow', String(Math.round(next)));
      if (persist) {
        try {
          localStorage.setItem('xband-map-width-pct', String(next));
        } catch (_) {}
      }
      requestAnimationFrame(() => actions.resizeCanvases());
    };
    const initRect = workspace.getBoundingClientRect();
    if (initRect.width > 0) setWidth(saved, false);
    else {
      const next = clamp(saved, 28, 72);
      workspace.style.setProperty('--map-width', `${next}%`);
      handle.setAttribute('aria-valuenow', String(Math.round(next)));
    }
    handle.addEventListener('pointerdown', (event: any) => {
      if (event.button !== 0) return;
      dragging = true;
      dragStartX = event.clientX;
      const mapWidth = $('persistent-map-panel')?.getBoundingClientRect().width ?? 0;
      dragStartPct = (mapWidth / workspace.getBoundingClientRect().width) * 100;
      handle.setPointerCapture(event.pointerId);
      document.body.classList.add('is-resizing');
      event.preventDefault();
    });
    handle.addEventListener('pointermove', (event: any) => {
      if (!dragging) return;
      const width = workspace.getBoundingClientRect().width;
      setWidth(dragStartPct + ((event.clientX - dragStartX) / width) * 100);
    });
    const stop = () => {
      dragging = false;
      document.body.classList.remove('is-resizing');
    };
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
    handle.addEventListener('keydown', (event: any) => {
      const current =
        (($('persistent-map-panel')?.getBoundingClientRect().width ?? 0) /
          workspace.getBoundingClientRect().width) *
        100;
      if (event.key === 'ArrowLeft') {
        setWidth(current - 2);
        event.preventDefault();
      }
      if (event.key === 'ArrowRight') {
        setWidth(current + 2);
        event.preventDefault();
      }
      if (event.key === 'Home') {
        setWidth(30);
        event.preventDefault();
      }
      if (event.key === 'End') {
        setWidth(70);
        event.preventDefault();
      }
    });
    window.addEventListener('resize', () => requestAnimationFrame(() => actions.resizeCanvases()));
    document
      .querySelectorAll(
        '.scheduler-layout > *, .terrain-layout > *, .terrain-grid > *, .terminal-layout > *, .doc-layout > .report-section'
      )
      .forEach((panel) => {
        panel.classList.add('resizable-panel', 'is-vert-resizable');
      });
  }

  function recordHistoricalFrame(frame: any) {
    if (!frame) return;
    const f = frame.selected_node_fresnel;
    if (!f || !f.profile || !f.profile.valid) return;

    const selNode =
      (frame.nodes_telemetry || []).find((n: any) => n.node_id === frame.selected_node_id) || {};
    const status = summarizeProfileStatus(f.profile, f);
    const acn = frame.acn_telemetry || {};
    const acnPos: Position3D = [acn.pos_x ?? 0, acn.pos_y ?? 0, acn.pos_z ?? 5000];
    const groundNodePos: Position3D = selNode.position
      ? [Number(selNode.position[0] ?? 0), Number(selNode.position[1] ?? 0), Number(selNode.position[2] ?? 0)]
      : [0, 0, 0];
    const slantKm =
      typeof selNode.slant_range_km === 'number'
        ? selNode.slant_range_km
        : typeof f.distance_km === 'number'
          ? f.distance_km
          : 0;

    const lb = frame.selected_link_budget || f.link_budget;
    historyBuffer.pushRaw({
      frameIndex: frame.frame_index,
      simulationTimeS: frame.sim_time_s,
      spatialRevision:
        typeof frame.spatial_revision === 'number'
          ? frame.spatial_revision
          : state.currentSpatialRevision,
      selectedNodeId: frame.selected_node_id,
      nodeName: selNode.name
        ? `Node ${selNode.node_id} (${selNode.name})`
        : `Node ${frame.selected_node_id}`,
      profileSerial: state.latestProfileSerial,
      groundNodePositionMslM: groundNodePos,
      acnPositionMslM: acnPos,
      profile: f.profile,
      obstruction: {
        terrainIsLos: status.terrainIsLos,
        obstacleBlocked: status.obstacleBlocked,
        minClearanceM: status.terrainClearanceM,
        diffractionLossDb: status.diffractionLossDb,
        primaryBlockedObstacleId: status.primaryBlockedObstacleId,
        terrainStatusText: status.terrainStatusText,
        terrainBadgeClass: status.terrainBadgeClass,
        obstacleStatusText: status.obstacleStatusText,
        obstacleBadgeClass: status.obstacleBadgeClass,
      },
      linkBudget: {
        modcodName: lb ? lb.modcod_name : selNode.modcod_name || 'UNKNOWN',
        snrDb: lb ? lb.snr_db : typeof selNode.snr_db === 'number' ? selNode.snr_db : 0,
        spectralEfficiencyBpsHz: lb
          ? lb.spectral_efficiency_bps_hz
          : typeof selNode.spectral_efficiency_bps_hz === 'number'
            ? selNode.spectral_efficiency_bps_hz
            : 0,
        slantRangeKm: lb ? lb.slant_range_km : slantKm,
        fsplDb: lb ? Number(lb.fspl_db.toFixed(1)) : 0,
        diffractionLossDb: lb
          ? lb.diffraction_loss_db
          : typeof selNode.diffraction_loss_db === 'number'
            ? selNode.diffraction_loss_db
            : 0,
        rxPowerDbm: lb ? Number(lb.prx_dbm.toFixed(1)) : 0,
        earthBulgeM: lb ? Number(lb.earth_bulge_m.toFixed(1)) : 0,
        gaseousLossDb: lb ? Number(lb.gas_loss_db.toFixed(2)) : 0,
        pNoiseDbm: lb && typeof lb.pnoise_dbm === 'number' ? Number(lb.pnoise_dbm.toFixed(2)) : undefined,
        rainLossDb: lb && typeof lb.rain_loss_db === 'number' ? Number(lb.rain_loss_db.toFixed(1)) : undefined,
      },
      profilePoints: f.profile_points,
      groundNodeAglM:
        typeof selNode.agl_m === 'number'
          ? selNode.agl_m
          : typeof selNode.antenna_height_m === 'number'
            ? selNode.antenna_height_m
            : 2.0,
    });
    updateScrubberUI();
  }

  function updateScrubberUI() {
    const scrubber = $<HTMLInputElement>('profile-history-scrubber');
    if (!scrubber) return;
    const span = historyBuffer.getSpan();

    if (span.count < 1 || span.oldestFrame === null || span.newestFrame === null) {
      scrubber.disabled = true;
      scrubber.min = '0';
      scrubber.max = '0';
      scrubber.value = '0';
      return;
    }

    scrubber.min = String(span.oldestFrame);
    scrubber.max = String(span.newestFrame);

    const oldestEl = $('history-span-oldest');
    if (oldestEl) oldestEl.textContent = `T+${(span.oldestTimeS ?? 0).toFixed(2)}s (#${span.oldestFrame})`;
    const newestEl = $('history-span-newest');
    if (newestEl) newestEl.textContent = `T+${(span.newestTimeS ?? 0).toFixed(2)}s (#${span.newestFrame})`;

    if (!historyController.isInspecting) {
      scrubber.disabled = false;
      scrubber.value = String(span.newestFrame);
      const posEl = $('history-current-pos');
      if (posEl)
        posEl.innerHTML = `<b>T+${(span.newestTimeS ?? 0).toFixed(2)}s</b> <small>(#${span.newestFrame})</small>`;
      const targetEl = $('history-target-pill');
      if (targetEl) targetEl.textContent = `Node ${state.selectedNodeId}`;
      const evWarn = $('history-eviction-warning');
      if (evWarn) evWarn.style.display = 'none';
      const spatWarn = $('history-spatial-revision-warning');
      if (spatWarn) spatWarn.style.display = 'none';
    } else {
      const currentFrame = historyController.currentInspectedFrame;
      if (currentFrame !== null) {
        scrubber.value = String(currentFrame);
        const rec = historyController.getActiveHistoricalRecord();
        if (rec) {
          const posEl = $('history-current-pos');
          if (posEl)
            posEl.innerHTML = `<b>T+${rec.simulationTimeS.toFixed(2)}s</b> <small>(#${rec.frameIndex})</small>`;
          const targetEl = $('history-target-pill');
          if (targetEl) targetEl.textContent = rec.nodeName;
          const spatWarn = $('history-spatial-revision-warning');
          if (spatWarn) {
            if (
              typeof rec.spatialRevision === 'number' &&
              rec.spatialRevision !== state.currentSpatialRevision
            ) {
              spatWarn.style.display = 'block';
              spatWarn.textContent = `[WARN] Spatial environment modified (snapshot rev ${rec.spatialRevision} vs current rev ${state.currentSpatialRevision}). Historical profile reflects prior geometry.`;
            } else {
              spatWarn.style.display = 'none';
            }
          }
        }
      }
      const evWarn = $('history-eviction-warning');
      if (evWarn) evWarn.style.display = historyController.isEvicted ? 'block' : 'none';
      if (historyController.isEvicted) {
        syncHistoricalUIState();
      }
    }
  }

  function syncHistoricalUIState() {
    const rec = historyController.getActiveHistoricalRecord();
    if (!rec) return;

    $('btn-history-live')?.classList.remove('active');
    const pill = $('history-mode-pill');
    if (pill) {
      pill.className = 'kpi-badge badge-amber';
      pill.textContent = 'HISTORICAL INSPECTION';
    }

    const targetEl = $('history-target-pill');
    if (targetEl) targetEl.textContent = rec.nodeName;
    const posEl = $('history-current-pos');
    if (posEl)
      posEl.innerHTML = `<b>T+${rec.simulationTimeS.toFixed(2)}s</b> <small>(#${rec.frameIndex})</small>`;
    const evWarn = $('history-eviction-warning');
    if (evWarn) evWarn.style.display = historyController.isEvicted ? 'block' : 'none';
    const spatWarn = $('history-spatial-revision-warning');
    if (spatWarn) {
      if (
        typeof rec.spatialRevision === 'number' &&
        rec.spatialRevision !== state.currentSpatialRevision
      ) {
        spatWarn.style.display = 'block';
        spatWarn.textContent = `[WARN] Spatial environment modified (snapshot rev ${rec.spatialRevision} vs current rev ${state.currentSpatialRevision}). Historical profile reflects prior geometry.`;
      } else {
        spatWarn.style.display = 'none';
      }
    }

    ['quickNodeSelect', 'termNodeSelect', 'vsa-node-select', 'eud-node-select'].forEach((id) => {
      const el = $<HTMLSelectElement>(id);
      if (el) {
        el.disabled = true;
        el.title = 'Node selection is locked during historical inspection. Return to LIVE to select nodes.';
      }
    });

    const rfContext = document.querySelector('#tab-terrain .analysis-context') as HTMLElement | null;
    if (rfContext) {
      const kicker = rfContext.querySelector('.context-kicker') as HTMLElement | null;
      if (kicker) {
        kicker.textContent = `HISTORICAL (T+${rec.simulationTimeS.toFixed(2)}s, #${rec.frameIndex})`;
        kicker.style.color = 'var(--warn)';
      }
      const nodeEl = rfContext.querySelector('[data-context-node]');
      if (nodeEl) nodeEl.textContent = `${rec.nodeName} [Hist]`;
      const timeEl = rfContext.querySelector('[data-context-time]');
      if (timeEl) timeEl.textContent = `T+${rec.simulationTimeS.toFixed(2)}s`;
      const frameEl = rfContext.querySelector('[data-context-frame]');
      if (frameEl) frameEl.textContent = `#${rec.frameIndex}`;
      const histInput = {
        terrain_is_los: rec.obstruction.terrainIsLos,
        obstacle_blocked: rec.obstruction.obstacleBlocked,
        link_outage:
          rec.linkBudget.modcodName === 'LINK_OUTAGE' ||
          rec.linkBudget.modcodName === 'OBSTACLE_BLOCKED' ||
          rec.linkBudget.snrDb < -1.5,
        is_outage:
          rec.linkBudget.modcodName === 'LINK_OUTAGE' ||
          rec.linkBudget.modcodName === 'OBSTACLE_BLOCKED' ||
          rec.linkBudget.snrDb < -1.5,
        modcod_name: rec.linkBudget.modcodName,
        diffraction_loss_db: rec.linkBudget.diffractionLossDb,
        snr_db: rec.linkBudget.snrDb,
        fresnel_clearance_m: rec.obstruction.minClearanceM,
      };
      const histClass = classifyLinkCommunicationStatus(histInput);
      const histBadge = getStatusBadgeInfo(histClass.status);

      const linkEl = rfContext.querySelector('[data-context-link]');
      const snrFmt = Number.isFinite(rec.linkBudget.snrDb) ? `${rec.linkBudget.snrDb.toFixed(1)} dB` : '--';
      if (linkEl) linkEl.textContent = `SNR ${snrFmt} (${histBadge.badgeText})`;
    }

    setText('terrain-node-label', `${rec.nodeName} [Historical #${rec.frameIndex}]`);
    setText('link-modcod-tag', rec.linkBudget.modcodName || '--');
    setText(
      'lb-slant',
      Number.isFinite(rec.linkBudget.slantRangeKm)
        ? `${rec.linkBudget.slantRangeKm.toFixed(2)} km`
        : '--'
    );
    setText(
      'lb-snr',
      Number.isFinite(rec.linkBudget.snrDb) ? `${rec.linkBudget.snrDb.toFixed(1)} dB` : '--'
    );
    setText(
      'lb-se',
      Number.isFinite(rec.linkBudget.spectralEfficiencyBpsHz)
        ? `${rec.linkBudget.spectralEfficiencyBpsHz.toFixed(2)} bps/Hz`
        : '--'
    );
    setText(
      'lb-fspl',
      Number.isFinite(rec.linkBudget.fsplDb) ? `${rec.linkBudget.fsplDb.toFixed(1)} dB` : '--'
    );
    setText(
      'lb-diff',
      Number.isFinite(rec.linkBudget.diffractionLossDb)
        ? `${rec.linkBudget.diffractionLossDb.toFixed(1)} dB`
        : '--'
    );
    setText(
      'lb-prx',
      Number.isFinite(rec.linkBudget.rxPowerDbm)
        ? `${rec.linkBudget.rxPowerDbm.toFixed(1)} dBm`
        : '--'
    );
    setText(
      'lb-bulge',
      Number.isFinite(rec.linkBudget.earthBulgeM)
        ? `${rec.linkBudget.earthBulgeM.toFixed(1)} m`
        : '--'
    );
    setText(
      'lb-gas',
      Number.isFinite(rec.linkBudget.gaseousLossDb)
        ? `${rec.linkBudget.gaseousLossDb.toFixed(2)} dB`
        : '--'
    );
    setText(
      'lb-pnoise',
      typeof rec.linkBudget.pNoiseDbm === 'number' && Number.isFinite(rec.linkBudget.pNoiseDbm)
        ? `${rec.linkBudget.pNoiseDbm.toFixed(2)} dBm`
        : '--'
    );
    setText(
      'lb-rain',
      typeof rec.linkBudget.rainLossDb === 'number' && Number.isFinite(rec.linkBudget.rainLossDb)
        ? `${rec.linkBudget.rainLossDb.toFixed(1)} dB`
        : '--'
    );

    drawFresnel();
    actions.syncSelectedNodeAglUI();
  }

  function syncLiveUIState() {
    $('btn-history-live')?.classList.add('active');
    const pill = $('history-mode-pill');
    if (pill) {
      pill.className = 'kpi-badge badge-emerald';
      pill.textContent = 'LIVE STREAM';
    }

    const evWarn = $('history-eviction-warning');
    if (evWarn) evWarn.style.display = 'none';
    const spatWarn = $('history-spatial-revision-warning');
    if (spatWarn) spatWarn.style.display = 'none';

    ['quickNodeSelect', 'termNodeSelect', 'vsa-node-select', 'eud-node-select'].forEach((id) => {
      const el = $<HTMLSelectElement>(id);
      if (el) {
        el.disabled = false;
        el.title = '';
        el.value = String(state.selectedNodeId);
      }
    });

    const rfContext = document.querySelector('#tab-terrain .analysis-context');
    if (rfContext) {
      const kicker = rfContext.querySelector('.context-kicker') as HTMLElement | null;
      if (kicker) {
        kicker.textContent = 'Live';
        kicker.style.color = '';
      }
    }

    updateScrubberUI();
    if (state.latestTelemetry) actions.updateDashboardDOM(state.latestTelemetry, true);
    drawFresnel();
    actions.syncSelectedNodeAglUI();
  }

  (window as any).returnToLive = function () {
    if (!historyController.isInspecting) return;
    historyController.exitHistorical();
    syncLiveUIState();

    const { shouldResumeWorker } = sessionCoordinator.onExitHistorical({
      rfInspecting: historyController.isInspecting,
      schedInspecting: schedHistoryController.isInspecting,
    });

    if (shouldResumeWorker && state.isPaused) {
      state.isPaused = false;
      actions.sendCommand({ type: 'SIM_CONTROL', action: 'resume' });
      const pauseBtn = $('btn-pause');
      if (pauseBtn) {
        pauseBtn.textContent = 'PAUSE';
        pauseBtn.classList.remove('active');
      }
    }

    dataCommVisualizer.exitHistorical(state.isPaused);
    updateStepControlUI(!state.isPaused || dataCommVisualizer.canStep());
  };

  function recordSchedulerHistoricalFrame(frame: any) {
    if (!frame || typeof frame.frame_index !== 'number') return;
    const kpi = frame.comparative_kpi_dashboard || {};
    const nodes = frame.nodes_telemetry || [];
    const allocations = Array.isArray(frame.active_gantt_allocations)
      ? frame.active_gantt_allocations
      : [];
    const staticAllocations = Array.isArray(frame.static_gantt_allocations)
      ? frame.static_gantt_allocations
      : undefined;
    const tacAllocations = Array.isArray(frame.tac_gantt_allocations)
      ? frame.tac_gantt_allocations
      : undefined;

    const nodeBacklogs = nodes.map((n: any) => ({
      nodeId: n.node_id,
      name: n.name,
      c2Bytes: n.c2_bytes ?? 0,
      voiceBytes: n.voice_bytes ?? 0,
      videoBytes: n.video_bytes ?? 0,
      photoBytes: n.photo_bytes ?? 0,
      totalBacklogBytes: n.total_backlog_bytes ?? 0,
      c2Packets: n.c2_backlog ?? 0,
      voicePackets: n.voice_backlog ?? 0,
      videoPackets: n.video_backlog ?? 0,
      photoPackets: n.photo_backlog ?? 0,
      snrDb: n.snr_db,
      bitrateMbps:
        n.bitrate_mbps !== undefined
          ? n.bitrate_mbps
          : n.bitrate_bps
            ? n.bitrate_bps / 1e6
            : 0,
      stateName: n.state_name,
      linkOutage: n.link_outage,
      obstacleBlocked: n.obstacle_blocked,
    }));

    const mapAllocs = (arr: any[]) =>
      arr
        ? arr.map((a) => ({
            nodeId: a.node_id ?? a.nodeId,
            startMs: a.start_ms ?? a.startMs ?? 0,
            durationMs: a.duration_ms ?? a.durationMs ?? (a.duration_s || a.durationS || 0) * 1000,
            durationS: a.duration_s ?? a.durationS ?? (a.duration_ms || a.durationMs || 0) / 1000,
            slotStartS: a.slot_start_s ?? a.slotStartS ?? 0,
            capacityBits: a.capacity_bits ?? a.capacityBits ?? 0,
            modcodName: a.modcod_name ?? a.modcodName,
            spectralEfficiency: a.spectral_efficiency ?? a.spectralEfficiency,
            c2Bytes: a.c2_bytes ?? a.c2Bytes,
            voiceBytes: a.voice_bytes ?? a.voiceBytes,
            videoBytes: a.video_bytes ?? a.videoBytes,
            photoBytes: a.photo_bytes ?? a.photoBytes,
            isPreOcclusionFlush: Boolean(a.is_pre_occlusion_flush ?? a.isPreOcclusionFlush),
          }))
        : [];

    const resolvedNodeId =
      typeof state.selectedNodeId === 'number'
        ? state.selectedNodeId
        : typeof frame.selected_node_id === 'number'
          ? frame.selected_node_id
          : null;

    schedHistoryBuffer.pushRaw({
      frameIndex: frame.frame_index,
      simulationTimeS: frame.sim_time_s,
      spatialRevision:
        typeof frame.spatial_revision === 'number'
          ? frame.spatial_revision
          : state.currentSpatialRevision,
      schedulerMode: frame.scheduler_mode || 'tac_tad',
      selectedNodeId: resolvedNodeId,
      activeAllocations: mapAllocs(allocations),
      staticAllocations: staticAllocations ? mapAllocs(staticAllocations) : undefined,
      tacAllocations: tacAllocations ? mapAllocs(tacAllocations) : undefined,
      ctrlDurationMs: frame.downlink_telemetry?.ctrl_duration_ms ?? 1.0,
      dlDurationMs: frame.downlink_telemetry?.dl_duration_ms ?? 3.0,
      superframeDurationMs: frame.tdma_frame_config?.frameDurationMs ?? 20.0,
      nodeBacklogs,
      kpi: {
        staticGoodputMb: kpi.static_goodput_mb ?? 0,
        tacGoodputMb: kpi.tac_goodput_mb ?? 0,
        gainMultiplier: kpi.gain_multiplier ?? 1.0,
        staticWastePct: kpi.static_waste_pct ?? 0,
        tacWastePct: kpi.tac_waste_pct ?? 0,
        staticDrops: kpi.static_drops ?? 0,
        staticDropPct: kpi.static_drop_pct ?? 0,
        tacDrops: kpi.tac_drops ?? 0,
        tacDropPct: kpi.tac_drop_pct ?? 0,
        ulUtilizationPct: kpi.ul_utilization_pct ?? 0,
        staticUtilizationPct: kpi.static_utilization_pct,
        tacUtilizationPct: kpi.tac_utilization_pct,
        activeGoodputFrameBits: kpi.active_goodput_frame_bits,
        staticGoodputFrameBits: kpi.static_goodput_frame_bits,
        tacGoodputFrameBits: kpi.tac_goodput_frame_bits,
        activeWastedFrameBits: kpi.active_wasted_frame_bits,
        staticWastedFrameBits: kpi.static_wasted_frame_bits,
        tacWastedFrameBits: kpi.tac_wasted_frame_bits,
        activeDropFramePkts: kpi.active_drop_frame_pkts,
        staticDropFramePkts: kpi.static_drop_frame_pkts,
        tacDropFramePkts: kpi.tac_drop_frame_pkts,
        activeDropDelayFramePkts: kpi.active_drop_delay_frame_pkts,
        activeDropOverflowFramePkts: kpi.active_drop_overflow_frame_pkts,
        staticDropDelayFramePkts: kpi.static_drop_delay_frame_pkts,
        staticDropOverflowFramePkts: kpi.static_drop_overflow_frame_pkts,
        tacDropDelayFramePkts: kpi.tac_drop_delay_frame_pkts,
        tacDropOverflowFramePkts: kpi.tac_drop_overflow_frame_pkts,
        node4PreShadowBacklogKb: kpi.node4_pre_shadow_backlog_kb,
        staticNode4PreShadowBacklogKb: kpi.static_node4_pre_shadow_backlog_kb,
        node4EvacStatus: kpi.node4_evac_status,
        staticSelectedBacklogKb: kpi.static_selected_backlog_kb,
        tacSelectedBacklogKb: kpi.tac_selected_backlog_kb,
      },
    });
    updateSchedulerScrubberUI();
    if ($('tab-scheduler')?.classList.contains('active')) {
      drawSchedulerCharts();
    }
  }

  function updateSchedulerScrubberUI() {
    const scrubber = $<HTMLInputElement>('sched-history-scrubber');
    if (!scrubber) return;
    const span = schedHistoryBuffer.getSpan();

    if (span.count < 1 || span.oldestFrame === null || span.newestFrame === null) {
      scrubber.disabled = true;
      scrubber.min = '0';
      scrubber.max = '0';
      scrubber.value = '0';
      return;
    }

    scrubber.min = String(span.oldestFrame);
    scrubber.max = String(span.newestFrame);

    const oldestEl = $('sched-history-span-oldest');
    if (oldestEl) oldestEl.textContent = `T+${(span.oldestTimeS ?? 0).toFixed(2)}s (#${span.oldestFrame})`;
    const newestEl = $('sched-history-span-newest');
    if (newestEl) newestEl.textContent = `T+${(span.newestTimeS ?? 0).toFixed(2)}s (#${span.newestFrame})`;

    if (!schedHistoryController.isInspecting) {
      scrubber.disabled = false;
      scrubber.value = String(span.newestFrame);
      const posEl = $('sched-history-current-pos');
      if (posEl)
        posEl.innerHTML = `<b>T+${(span.newestTimeS ?? 0).toFixed(2)}s</b> <small>(#${span.newestFrame})</small>`;
      const nodes = (state.latestTelemetry && state.latestTelemetry.nodes_telemetry) || [];
      const sel =
        typeof state.selectedNodeId === 'number'
          ? nodes.find((n: any) => n.node_id === state.selectedNodeId)
          : null;
      const targetLabel =
        typeof state.selectedNodeId === 'number'
          ? sel?.name
            ? `Node ${state.selectedNodeId} (${sel.name})`
            : `Node ${state.selectedNodeId}`
          : 'No terminal selected';
      const targetEl = $('sched-history-target-pill');
      if (targetEl) targetEl.textContent = targetLabel;
      const evWarn = $('sched-history-eviction-warning');
      if (evWarn) evWarn.style.display = 'none';
      const spatWarn = $('sched-spatial-revision-warning');
      if (spatWarn) spatWarn.style.display = 'none';
    } else {
      const currentFrame = schedHistoryController.currentInspectedFrame;
      if (currentFrame !== null) {
        scrubber.value = String(currentFrame);
        const rec = schedHistoryController.getActiveHistoricalRecord();
        if (rec) {
          const posEl = $('sched-history-current-pos');
          if (posEl)
            posEl.innerHTML = `<b>T+${rec.simulationTimeS.toFixed(2)}s</b> <small>(#${rec.frameIndex})</small>`;
          const inspectNodeId =
            typeof state.selectedNodeId === 'number' ? state.selectedNodeId : rec.selectedNodeId;
          const selBacklog =
            typeof inspectNodeId === 'number'
              ? rec.nodeBacklogs.find((nb: any) => nb.nodeId === inspectNodeId)
              : null;
          const targetLabel =
            typeof inspectNodeId === 'number'
              ? selBacklog?.name
                ? `Node ${inspectNodeId} (${selBacklog.name})`
                : `Node ${inspectNodeId}`
              : 'No terminal selected';
          const targetEl = $('sched-history-target-pill');
          if (targetEl) targetEl.textContent = targetLabel;
          const spatWarn = $('sched-spatial-revision-warning');
          if (spatWarn) {
            if (
              typeof rec.spatialRevision === 'number' &&
              rec.spatialRevision !== state.currentSpatialRevision
            ) {
              spatWarn.style.display = 'block';
              spatWarn.textContent = `[WARN] Spatial environment modified (snapshot rev ${rec.spatialRevision} vs current rev ${state.currentSpatialRevision}). Historical scheduler state reflects prior geometry.`;
            } else {
              spatWarn.style.display = 'none';
            }
          }
        }
      }
      const evWarn = $('sched-history-eviction-warning');
      if (evWarn) evWarn.style.display = schedHistoryController.isEvicted ? 'block' : 'none';
      if (schedHistoryController.isEvicted) {
        syncSchedulerHistoricalUIState();
      }
    }
  }

  function syncSchedulerHistoricalUIState() {
    const rec = schedHistoryController.getActiveHistoricalRecord();
    if (!rec) return;

    $('btn-sched-history-live')?.classList.remove('active');
    const pill = $('sched-history-mode-pill');
    if (pill) {
      pill.className = 'kpi-badge badge-amber';
      pill.textContent = 'HISTORICAL INSPECTION';
    }

    const inspectNodeId =
      typeof state.selectedNodeId === 'number' ? state.selectedNodeId : rec.selectedNodeId;
    const selBacklog =
      typeof inspectNodeId === 'number'
        ? rec.nodeBacklogs.find((nb: any) => nb.nodeId === inspectNodeId)
        : null;
    const targetLabel =
      typeof inspectNodeId === 'number'
        ? selBacklog?.name
          ? `Node ${inspectNodeId} (${selBacklog.name})`
          : `Node ${inspectNodeId}`
        : 'No terminal selected';

    const targetEl = $('sched-history-target-pill');
    if (targetEl) targetEl.textContent = targetLabel;
    const posEl = $('sched-history-current-pos');
    if (posEl)
      posEl.innerHTML = `<b>T+${rec.simulationTimeS.toFixed(2)}s</b> <small>(#${rec.frameIndex})</small>`;
    const evWarn = $('sched-history-eviction-warning');
    if (evWarn) evWarn.style.display = schedHistoryController.isEvicted ? 'block' : 'none';
    const spatWarn = $('sched-spatial-revision-warning');
    if (spatWarn) {
      if (
        typeof rec.spatialRevision === 'number' &&
        rec.spatialRevision !== state.currentSpatialRevision
      ) {
        spatWarn.style.display = 'block';
        spatWarn.textContent = `[WARN] Spatial environment modified (snapshot rev ${rec.spatialRevision} vs current rev ${state.currentSpatialRevision}). Historical scheduler state reflects prior geometry.`;
      } else {
        spatWarn.style.display = 'none';
      }
    }

    const schedContext = document.querySelector('#tab-scheduler .analysis-context');
    if (schedContext) {
      const kicker = schedContext.querySelector('.context-kicker') as HTMLElement | null;
      if (kicker) {
        kicker.textContent = `HISTORICAL (T+${rec.simulationTimeS.toFixed(2)}s, #${rec.frameIndex})`;
        kicker.style.color = 'var(--warn)';
      }
      const nodeEl = schedContext.querySelector('[data-context-node]');
      if (nodeEl)
        nodeEl.textContent =
          typeof inspectNodeId === 'number' ? `${targetLabel} [Hist]` : 'No terminal selected [Hist]';
      const timeEl = schedContext.querySelector('[data-context-time]');
      if (timeEl) timeEl.textContent = `T+${rec.simulationTimeS.toFixed(2)}s`;
      const frameEl = schedContext.querySelector('[data-context-frame]');
      if (frameEl) frameEl.textContent = `#${rec.frameIndex}`;
      const modeEl = schedContext.querySelector('[data-context-mode]');
      if (modeEl) modeEl.textContent = `${rec.schedulerMode} [Hist]`;
    }

    const snapPanel = $('sched-snapshot-panel');
    if (snapPanel) {
      snapPanel.style.display = 'block';
      setText('sched-snapshot-badge', `HISTORICAL #${rec.frameIndex}`);
      setText('snap-time', `T+${rec.simulationTimeS.toFixed(2)}s (#${rec.frameIndex})`);
      setText(
        'snap-mode',
        rec.schedulerMode === 'tac_tad' ? 'Tac-TAD (Dynamic)' : 'Legacy Static TDMA'
      );
      setText('snap-util', `${rec.kpi.ulUtilizationPct.toFixed(1)}%`);

      if (rec.kpi.activeGoodputFrameBits !== undefined) {
        const kb = (rec.kpi.activeGoodputFrameBits / 8 / 1024).toFixed(1);
        const rateMbps = (rec.kpi.activeGoodputFrameBits / 0.02 / 1e6).toFixed(2);
        setText('snap-goodput', `${kb} KB (${rateMbps} Mbps)`);
      } else {
        setText('snap-goodput', 'Unavailable');
      }

      if (rec.kpi.activeDropFramePkts !== undefined) {
        setText(
          'snap-drops',
          `${rec.kpi.activeDropFramePkts} pkts (D:${rec.kpi.activeDropDelayFramePkts ?? 0}, O:${rec.kpi.activeDropOverflowFramePkts ?? 0})`
        );
      } else {
        setText('snap-drops', 'Unavailable');
      }

      if (selBacklog) {
        const totalKb = (selBacklog.totalBacklogBytes / 1024).toFixed(1);
        const c2Kb = (selBacklog.c2Bytes / 1024).toFixed(1);
        const voKb = (selBacklog.voiceBytes / 1024).toFixed(1);
        const viKb = (selBacklog.videoBytes / 1024).toFixed(1);
        const phKb = (selBacklog.photoBytes / 1024).toFixed(0);
        setText('snap-backlog', `${totalKb} KB (C2:${c2Kb}K, Vo:${voKb}K, Vi:${viKb}K, Ph:${phKb}K)`);
      } else {
        setText(
          'snap-backlog',
          typeof inspectNodeId === 'number' ? 'No backlog recorded' : 'No terminal selected'
        );
      }

      setText(
        'snap-cum-goodput',
        `Tac:${rec.kpi.tacGoodputMb.toFixed(2)} Mb | Stat:${rec.kpi.staticGoodputMb.toFixed(2)} Mb (${rec.kpi.gainMultiplier.toFixed(2)}×)`
      );
      setText(
        'snap-cum-drops',
        `Tac:${rec.kpi.tacDrops} (${rec.kpi.tacDropPct.toFixed(1)}%) | Stat:${rec.kpi.staticDrops} (${rec.kpi.staticDropPct.toFixed(1)}%)`
      );
    }

    const selAllocations =
      typeof inspectNodeId === 'number'
        ? rec.activeAllocations.filter((a: any) => a.nodeId === inspectNodeId)
        : [];
    const allocatedMs = selAllocations.reduce((sum: number, a: any) => sum + a.durationMs, 0);
    setText(
      'alloc-node-label',
      typeof inspectNodeId === 'number'
        ? `${targetLabel} [Historical #${rec.frameIndex}]`
        : 'No terminal selected'
    );
    setText('alloc-airtime', typeof inspectNodeId === 'number' ? `${allocatedMs.toFixed(2)} ms` : '--');
    setText(
      'alloc-segments',
      typeof inspectNodeId === 'number' ? String(selAllocations.length) : '--'
    );
    setText(
      'alloc-inspector-note',
      typeof inspectNodeId === 'number'
        ? selAllocations.length
          ? `Historical frame #${rec.frameIndex} (T+${rec.simulationTimeS.toFixed(2)}s) · ${selAllocations.length} allocation segment(s) recorded under ${rec.schedulerMode}. This is exact per-frame airtime.`
          : `No allocation segment recorded for Node ${inspectNodeId} in historical frame #${rec.frameIndex}.`
        : 'No terminal selected. Select a terminal to inspect its historical allocations.'
    );

    drawWaterfall();
    drawSchedulerCharts();
  }

  function syncSchedulerLiveUIState() {
    $('btn-sched-history-live')?.classList.add('active');
    const pill = $('sched-history-mode-pill');
    if (pill) {
      pill.className = 'kpi-badge badge-emerald';
      pill.textContent = 'LIVE STREAM';
    }

    const evWarn = $('sched-history-eviction-warning');
    if (evWarn) evWarn.style.display = 'none';
    const spatWarn = $('sched-spatial-revision-warning');
    if (spatWarn) spatWarn.style.display = 'none';

    const snapPanel = $('sched-snapshot-panel');
    if (snapPanel) snapPanel.style.display = 'none';

    const schedContext = document.querySelector('#tab-scheduler .analysis-context');
    if (schedContext) {
      const kicker = schedContext.querySelector('.context-kicker') as HTMLElement | null;
      if (kicker) {
        kicker.textContent = 'Live';
        kicker.style.color = '';
      }
    }

    updateSchedulerScrubberUI();
    if (state.latestTelemetry) actions.updateDashboardDOM(state.latestTelemetry, true);
    drawWaterfall();
    drawSchedulerCharts();
  }

  function returnSchedulerToLive() {
    if (!schedHistoryController.isInspecting) return;
    schedHistoryController.exitHistorical();
    syncSchedulerLiveUIState();

    const { shouldResumeWorker } = sessionCoordinator.onExitHistorical({
      rfInspecting: historyController.isInspecting,
      schedInspecting: schedHistoryController.isInspecting,
    });

    if (shouldResumeWorker && state.isPaused) {
      state.isPaused = false;
      actions.sendCommand({ type: 'SIM_CONTROL', action: 'resume' });
      const pauseBtn = $('btn-pause');
      if (pauseBtn) {
        pauseBtn.textContent = 'PAUSE';
        pauseBtn.classList.remove('active');
      }
    }

    dataCommVisualizer.exitHistorical(state.isPaused);
    updateStepControlUI(!state.isPaused || dataCommVisualizer.canStep());
  }
  (window as any).returnSchedulerToLive = returnSchedulerToLive;

  function drawSchedulerCharts() {
    const records = schedHistoryBuffer.getChronologicalRecords();
    const utilCanvas = $<HTMLCanvasElement>('sched-chart-utilization');
    const backlogCanvas = $<HTMLCanvasElement>('sched-chart-backlog');
    if (!utilCanvas || !backlogCanvas) return;

    bindChartHoverCrosshair(utilCanvas, drawSchedulerCharts);
    bindChartHoverCrosshair(backlogCanvas, drawSchedulerCharts);

    const inspectedFrame = schedHistoryController.isInspecting
      ? schedHistoryController.currentInspectedFrame
      : records.length > 0
        ? records[records.length - 1].frameIndex
        : null;

    const effectiveNodeId =
      typeof state.selectedNodeId === 'number'
        ? state.selectedNodeId
        : inspectedFrame !== null && schedHistoryController.isInspecting
          ? schedHistoryController.getActiveHistoricalRecord()?.selectedNodeId ?? null
          : null;

    drawUtilizationChart(utilCanvas, records, inspectedFrame);
    drawBacklogChart(backlogCanvas, records, inspectedFrame, effectiveNodeId);
  }

  function drawUtilizationChart(canvas: HTMLCanvasElement, records: any[], inspectedFrame: number | null) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.floor(rect.width * dpr),
      h = Math.floor(rect.height * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const g = canvas.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cw = rect.width,
      ch = rect.height;
    g.clearRect(0, 0, cw, ch);

    const pad = { l: 38, r: 12, t: 10, b: 18 },
      pw = cw - pad.l - pad.r,
      ph = ch - pad.t - pad.b;

    g.lineWidth = 1;
    [0, 25, 50, 75, 100].forEach((pct) => {
      const y = pad.t + ph * (1 - pct / 100);
      g.strokeStyle = pct === 50 ? HIGHLAND_THEME.line.gridMajor : HIGHLAND_THEME.line.grid;
      g.beginPath();
      g.moveTo(pad.l, Math.round(y) + 0.5);
      g.lineTo(cw - pad.r, Math.round(y) + 0.5);
      g.stroke();
      if (pct === 0 || pct === 50 || pct === 100) {
        g.fillStyle = HIGHLAND_THEME.text.faint;
        g.font = `9px ${HIGHLAND_THEME.font.mono}`;
        g.textAlign = 'right';
        g.fillText(`${pct}%`, pad.l - 5, y + 3);
      }
    });

    if (records.length < 2) {
      g.fillStyle = HIGHLAND_THEME.text.muted;
      g.font = `10.5px ${HIGHLAND_THEME.font.sans}`;
      g.textAlign = 'center';
      g.fillText('Collecting simulation frames…', cw / 2, ch / 2);
      setText('chart-util-val', '--');
      return;
    }

    g.fillStyle = HIGHLAND_THEME.text.faint;
    g.font = `9px ${HIGHLAND_THEME.font.mono}`;
    g.textAlign = 'left';
    g.fillText(`T+${records[0].simulationTimeS.toFixed(1)}s`, pad.l, ch - 4);
    g.textAlign = 'right';
    g.fillText(`T+${records[records.length - 1].simulationTimeS.toFixed(1)}s`, cw - pad.r, ch - 4);

    g.strokeStyle = HIGHLAND_THEME.signal.amber;
    g.lineWidth = 1.8;
    g.beginPath();
    let cursorX: number | null = null,
      cursorVal: number | null = null;
    const n = records.length;

    for (let i = 0; i < n; i++) {
      const r = records[i];
      const x = pad.l + (i / (n - 1)) * pw;
      const util = Math.max(0, Math.min(100, r.kpi.ulUtilizationPct));
      const y = pad.t + ph * (1 - util / 100);
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);

      if (inspectedFrame !== null && r.frameIndex === inspectedFrame) {
        cursorX = x;
        cursorVal = util;
      }
    }
    g.stroke();

    if (cursorX !== null) {
      g.strokeStyle = HIGHLAND_THEME.signal.ochre;
      g.lineWidth = 1.4;
      g.setLineDash([3, 3]);
      g.beginPath();
      g.moveTo(cursorX, pad.t);
      g.lineTo(cursorX, pad.t + ph);
      g.stroke();
      g.setLineDash([]);

      if (cursorVal !== null) {
        const cy = pad.t + ph * (1 - cursorVal / 100);
        g.fillStyle = HIGHLAND_THEME.signal.ochre;
        g.beginPath();
        g.arc(cursorX, cy, 3.5, 0, Math.PI * 2);
        g.fill();
      }
      setText('chart-util-val', `${(cursorVal ?? 0).toFixed(1)}%`);
    } else {
      const last = records[records.length - 1];
      setText('chart-util-val', `${last.kpi.ulUtilizationPct.toFixed(1)}%`);
    }

    const hover = getCanvasHoverState(canvas);
    if (hover.active && hover.cssX >= pad.l && hover.cssX <= cw - pad.r) {
      const idx = Math.max(
        0,
        Math.min(n - 1, Math.round(((hover.cssX - pad.l) / pw) * (n - 1)))
      );
      const rec = records[idx];
      const sx = pad.l + (idx / (n - 1)) * pw;
      drawChartHoverCrosshair(
        g,
        { left: pad.l, right: cw - pad.r, top: pad.t, bottom: pad.t + ph },
        sx,
        `T+${rec.simulationTimeS.toFixed(2)}s (#${rec.frameIndex})`,
        [
          {
            label: 'UL Util',
            valueText: `${rec.kpi.ulUtilizationPct.toFixed(1)}%`,
            color: HIGHLAND_THEME.signal.amber,
          },
        ]
      );
    }
  }

  function drawBacklogChart(
    canvas: HTMLCanvasElement,
    records: any[],
    inspectedFrame: number | null,
    targetNodeId: number | null
  ) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.floor(rect.width * dpr),
      h = Math.floor(rect.height * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const g = canvas.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cw = rect.width,
      ch = rect.height;
    g.clearRect(0, 0, cw, ch);

    if (typeof targetNodeId !== 'number') {
      setText('chart-backlog-label', 'Queue backlog & drops');
      setText('chart-backlog-val', '--');
      g.fillStyle = HIGHLAND_THEME.text.muted;
      g.font = `10.5px ${HIGHLAND_THEME.font.sans}`;
      g.textAlign = 'center';
      g.fillText('No terminal selected', cw / 2, ch / 2);
      return;
    }

    const pad = { l: 42, r: 12, t: 10, b: 18 },
      pw = cw - pad.l - pad.r,
      ph = ch - pad.t - pad.b;

    const targetNode = (state.latestTelemetry?.nodes_telemetry || []).find(
      (n: any) => n.node_id === targetNodeId
    );
    const targetLabel = targetNode?.name
      ? `Node ${targetNodeId} (${targetNode.name})`
      : `Node ${targetNodeId}`;
    setText('chart-backlog-label', `${targetLabel} backlog & drops`);

    if (records.length < 2) {
      g.fillStyle = HIGHLAND_THEME.text.muted;
      g.font = `10.5px ${HIGHLAND_THEME.font.sans}`;
      g.textAlign = 'center';
      g.fillText('Collecting simulation frames…', cw / 2, ch / 2);
      setText('chart-backlog-val', '--');
      return;
    }

    let maxBytes = 10 * 1024;
    const nodeValues = records.map((r) => {
      const nb = r.nodeBacklogs.find((n: any) => n.nodeId === targetNodeId);
      const bytes = nb?.totalBacklogBytes ?? 0;
      if (bytes > maxBytes) maxBytes = bytes;
      return {
        bytes,
        drops: r.kpi.activeDropFramePkts ?? 0,
        frameIndex: r.frameIndex,
        simTimeS: r.simulationTimeS,
      };
    });

    const maxKb = maxBytes / 1024;
    const ticks = computeNiceTicks(0, maxKb, 3);
    g.lineWidth = 1;
    ticks.forEach((tk) => {
      const y = pad.t + ph * (1 - tk / Math.max(1, maxKb));
      if (y < pad.t - 2 || y > pad.t + ph + 2) return;
      g.strokeStyle = HIGHLAND_THEME.line.grid;
      g.beginPath();
      g.moveTo(pad.l, Math.round(y) + 0.5);
      g.lineTo(cw - pad.r, Math.round(y) + 0.5);
      g.stroke();
      g.fillStyle = HIGHLAND_THEME.text.faint;
      g.font = `9px ${HIGHLAND_THEME.font.mono}`;
      g.textAlign = 'right';
      g.fillText(`${tk.toFixed(0)} KB`, pad.l - 4, y + 3);
    });

    g.fillStyle = HIGHLAND_THEME.text.faint;
    g.font = `9px ${HIGHLAND_THEME.font.mono}`;
    g.textAlign = 'left';
    g.fillText(`T+${records[0].simulationTimeS.toFixed(1)}s`, pad.l, ch - 4);
    g.textAlign = 'right';
    g.fillText(`T+${records[records.length - 1].simulationTimeS.toFixed(1)}s`, cw - pad.r, ch - 4);

    g.strokeStyle = HIGHLAND_THEME.signal.sage;
    g.lineWidth = 1.8;
    g.beginPath();
    let cursorX: number | null = null,
      cursorKb: number | null = null,
      cursorDrops = 0;
    const n = nodeValues.length;

    for (let i = 0; i < n; i++) {
      const val = nodeValues[i];
      const x = pad.l + (i / (n - 1)) * pw;
      const kb = val.bytes / 1024;
      const y = pad.t + ph * (1 - Math.min(1.0, val.bytes / maxBytes));
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);

      if (val.drops > 0) {
        g.save();
        g.fillStyle = HIGHLAND_THEME.signal.vermilion;
        g.beginPath();
        g.arc(x, pad.t + 3, 3, 0, Math.PI * 2);
        g.fill();
        g.restore();
      }

      if (inspectedFrame !== null && val.frameIndex === inspectedFrame) {
        cursorX = x;
        cursorKb = kb;
        cursorDrops = val.drops;
      }
    }
    g.stroke();

    if (cursorX !== null) {
      g.strokeStyle = HIGHLAND_THEME.signal.ochre;
      g.lineWidth = 1.4;
      g.setLineDash([3, 3]);
      g.beginPath();
      g.moveTo(cursorX, pad.t);
      g.lineTo(cursorX, pad.t + ph);
      g.stroke();
      g.setLineDash([]);

      if (cursorKb !== null) {
        const cy = pad.t + ph * (1 - Math.min(1.0, (cursorKb * 1024) / maxBytes));
        g.fillStyle = HIGHLAND_THEME.signal.ochre;
        g.beginPath();
        g.arc(cursorX, cy, 3.5, 0, Math.PI * 2);
        g.fill();
      }
      const dropText = cursorDrops > 0 ? ` · ${cursorDrops} drops` : '';
      setText('chart-backlog-val', `${(cursorKb ?? 0).toFixed(1)} KB${dropText}`);
    } else {
      const last = nodeValues[nodeValues.length - 1];
      setText('chart-backlog-val', `${(last.bytes / 1024).toFixed(1)} KB`);
    }
    setText('chart-backlog-label', `${targetLabel} backlog & drops`);

    const hover = getCanvasHoverState(canvas);
    if (hover.active && hover.cssX >= pad.l && hover.cssX <= cw - pad.r) {
      const idx = Math.max(
        0,
        Math.min(n - 1, Math.round(((hover.cssX - pad.l) / pw) * (n - 1)))
      );
      const item = nodeValues[idx];
      const sx = pad.l + (idx / (n - 1)) * pw;
      drawChartHoverCrosshair(
        g,
        { left: pad.l, right: cw - pad.r, top: pad.t, bottom: pad.t + ph },
        sx,
        `T+${item.simTimeS.toFixed(2)}s (#${item.frameIndex})`,
        [
          {
            label: 'Backlog',
            valueText: `${(item.bytes / 1024).toFixed(1)} KB`,
            color: HIGHLAND_THEME.signal.sage,
          },
          {
            label: 'Frame Drops',
            valueText: `${item.drops}`,
            color: HIGHLAND_THEME.signal.vermilion,
          },
        ]
      );
    }
  }

  function gfxRRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    g.beginPath();
    g.moveTo(x + r, y);
    g.lineTo(x + w - r, y);
    g.arcTo(x + w, y, x + w, y + r, r);
    g.lineTo(x + w, y + h - r);
    g.arcTo(x + w, y + h, x + w - r, y + h, r);
    g.lineTo(x + r, y + h);
    g.arcTo(x, y + h, x, y + h - r, r);
    g.lineTo(x, y + r);
    g.arcTo(x, y, x + r, y, r);
    g.closePath();
  }

  function gfxNiceStep(range: number, target: number) {
    const raw = Math.max(range, 1e-6) / target,
      mag = Math.pow(10, Math.floor(Math.log10(raw))),
      n = raw / mag;
    return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
  }

  function drawPolarAntennaScope(frame: any) {
    try {
      renderPolarAntennaScope(polarAntennaCanvas, polarAntennaCtx, frame, state.selectedNodeId, setText);
    } catch (err) {
      console.error('drawPolarAntennaScope exception:', err);
    }
  }

  function drawLinkWaterfallCanvas(frame: any) {
    try {
      renderLinkWaterfallCanvas(linkWaterfallCanvas, linkWaterfallCtx, frame, state.selectedNodeId, setText);
    } catch (err) {
      console.error('drawLinkWaterfallCanvas exception:', err);
    }
  }

  function updateScientificAblationMatrix(frame: any) {
    actions.getDashboardAndAuthoringController().updateScientificAblationMatrix(frame);
  }

  function drawEcdfDelayScope(frame: any) {
    try {
      renderEcdfDelayScope(ecdfDelayCanvas, ecdfDelayCtx, frame);
    } catch (err) {
      console.error('drawEcdfDelayScope exception:', err);
    }
  }

  function drawSensitivitySweepScope(frame: any) {
    try {
      renderSensitivitySweepScope(
        sensitivitySweepCanvas,
        sensitivitySweepCtx,
        frame,
        state.activeSensitivityAxis,
        $('sci-sweep-active-readout')
      );
    } catch (err) {
      console.error('drawSensitivitySweepScope exception:', err);
    }
  }

  (window as any).exportLatexAblationTable = function () {
    return actions.getDashboardAndAuthoringController().exportLatexAblationTable();
  };

  function drawWaterfall() {
    try {
      const cvs = waterfallCanvas;
      if (!cvs) return;
      const syncResult = syncCanvasDpr(waterfallCanvas, waterfallCtx);
      if (!syncResult.isVisible) return;
      const w = syncResult.cssWidth,
        h = syncResult.cssHeight;
      if (w <= 0 || h <= 0) return;
      const g = waterfallCtx;
      g.clearRect(0, 0, w, h);

      const isTimelineHist = Boolean(
        state.simTimelineController && state.simTimelineController.isHistoricalInspecting
      );
      const isHistorical =
        isTimelineHist ||
        (typeof schedHistoryController !== 'undefined' && Boolean(schedHistoryController.isInspecting));
      const histSchedRec = isHistorical
        ? state.bridgeHistSchedRec ?? schedHistoryController.getActiveHistoricalRecord()
        : null;
      const activeSnap = dataCommVisualizer.getActiveSnapshot();

      if (isHistorical && !histSchedRec) {
        g.fillStyle = HIGHLAND_THEME.substrate.void;
        g.fillRect(0, 0, w, h);
        g.fillStyle = HIGHLAND_THEME.signal.ochre;
        g.font = `600 11px ${MONO}`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('Historical superframe allocation unavailable or evicted at this playhead', w / 2, h / 2);
        return;
      }

      const useSnap =
        activeSnap &&
        ((!isHistorical && activeSnap.source === 'live') ||
          (isHistorical &&
            histSchedRec &&
            activeSnap.source === 'historical' &&
            activeSnap.frameIndex === histSchedRec.frameIndex))
          ? activeSnap
          : null;

      const superframeDurationMs = Math.max(
        1.0,
        useSnap && Number.isFinite(useSnap.superframeDurationMs)
          ? useSnap.superframeDurationMs
          : histSchedRec?.superframeDurationMs ??
              (Number.isFinite(state.latestTelemetry?.tdma_frame_config?.frameDurationMs)
                ? state.latestTelemetry!.tdma_frame_config!.frameDurationMs
                : 20.0)
      );

      const waterfallTitle = $('waterfall-superframe-label');
      if (waterfallTitle) {
        waterfallTitle.textContent = `Superframe airtime allocation (${superframeDurationMs.toFixed(1)} ms)`;
      }

      const schedMode = useSnap
        ? useSnap.schedulerMode
        : histSchedRec
          ? histSchedRec.schedulerMode
          : state.latestTelemetry?.scheduler_mode || 'tac_tad';

      const ctrlDurationMs = Math.max(
        0.0,
        useSnap && Number.isFinite(useSnap.ctrlDurationMs)
          ? useSnap.ctrlDurationMs
          : histSchedRec?.ctrlDurationMs ??
              (isHistorical ? 1.0 : state.latestTelemetry?.downlink_telemetry?.ctrl_duration_ms ?? 1.0)
      );

      const dlDurationMs = Math.max(
        0.0,
        useSnap && Number.isFinite(useSnap.dlDurationMs)
          ? useSnap.dlDurationMs
          : histSchedRec?.dlDurationMs ??
              (isHistorical ? 3.0 : state.latestTelemetry?.downlink_telemetry?.dl_duration_ms ?? 3.0)
      );

      type WaterfallNodeLike = {
        nodeId?: number;
        node_id?: number;
        state_name?: string;
        stateName?: string;
        linkOutage?: boolean;
        link_outage?: boolean;
        isOutage?: boolean;
        isBlocked?: boolean;
        slant_range_m?: number;
        [key: string]: unknown;
      };
      const nodes: readonly WaterfallNodeLike[] =
        ((useSnap?.nodes ??
          (histSchedRec
            ? histSchedRec.nodeBacklogs
            : isHistorical
              ? []
              : state.latestTelemetry?.nodes_telemetry || [])) as readonly WaterfallNodeLike[]) ||
        [];

      const staticAllocations =
        useSnap?.staticAllocations ??
        (histSchedRec
          ? histSchedRec.staticAllocations ||
            (schedMode === 'static' ? histSchedRec.activeAllocations || [] : [])
          : isHistorical
            ? []
            : state.latestTelemetry?.static_gantt_allocations ||
              (schedMode === 'static' ? state.latestTelemetry?.active_gantt_allocations || [] : []));

      const tacAllocations =
        useSnap?.tacAllocations ??
        (histSchedRec
          ? histSchedRec.tacAllocations ||
            (schedMode !== 'static' ? histSchedRec.activeAllocations || [] : [])
          : isHistorical
            ? []
            : state.latestTelemetry?.tac_gantt_allocations ||
              (schedMode !== 'static' ? state.latestTelemetry?.active_gantt_allocations || [] : []));

      const isStaticMulti =
        Array.isArray(staticAllocations) &&
        staticAllocations.some((a: any) => (a.sector_id ?? a.sectorId) !== undefined);
      const isTacMulti =
        Array.isArray(tacAllocations) &&
        tacAllocations.some((a: any) => (a.sector_id ?? a.sectorId) !== undefined);
      const isMultiSector = isStaticMulti || isTacMulti;

      const padL = isMultiSector ? 136 : 118,
        padR = 18,
        padT = 22,
        padB = 24,
        gap = 18;
      const plotW = Math.max(60, w - padL - padR);
      const trackH = Math.max(34, Math.min(64, (h - padT - padB - gap) / 2));
      const yStatic = padT,
        yTac = padT + trackH + gap;
      const xOfMs = (ms: number) => padL + (ms / superframeDurationMs) * plotW;
      const sel = typeof state.selectedNodeId === 'number' ? state.selectedNodeId : -1;

      const staticTimeline = resolveSuperframeTimeline({
        allocations: staticAllocations,
        schedulerMode: 'static',
        nodes,
        ctrlDurationMs,
        dlDurationMs,
        superframeDurationMs,
      });

      const tacTimeline = resolveSuperframeTimeline({
        allocations: tacAllocations,
        schedulerMode: 'tac_tad',
        nodes,
        ctrlDurationMs,
        dlDurationMs,
        superframeDurationMs,
      });

      const activeTimeline = schedMode === 'static' ? staticTimeline : tacTimeline;
      const subframeOffsetMs = dataCommVisualizer.getCurrentSubframeOffsetMs();
      const activeSlot = activeTimeline.resolveAt(subframeOffsetMs);

      const renderedGanttSlots: any[] = [];
      const drawTaGuard = (x: number, y: number, width: number, height: number, taUs: number) => {
        if (width <= 8) return;
        const taMs = Math.max(0.05, (taUs || 100.0) / 1000.0);
        const taPx = Math.max(3, Math.min(width * 0.45, (taMs / superframeDurationMs) * plotW));
        const gx = x + width - taPx;
        g.save();
        gfxRRect(g, gx, y, taPx, height, 2);
        g.fillStyle = 'rgba(245, 158, 11, 0.28)';
        g.fill();
        g.clip();
        g.strokeStyle = 'rgba(245, 158, 11, 0.75)';
        g.lineWidth = 1;
        for (let k = -height; k < taPx + height; k += 4) {
          g.beginPath();
          g.moveTo(gx + k, y + height);
          g.lineTo(gx + k + height, y);
          g.stroke();
        }
        g.restore();
      };

      g.font = `10px ${MONO}`;
      g.textAlign = 'center';
      g.lineWidth = 1;
      const stepMs = gfxNiceStep(superframeDurationMs, 10);
      for (let ms = 0; ms <= superframeDurationMs + 1e-4; ms += stepMs) {
        const x = Math.round(xOfMs(ms)) + 0.5;
        g.strokeStyle =
          Math.round(ms / stepMs) % 2 === 0
            ? HIGHLAND_THEME.line.gridMajor
            : HIGHLAND_THEME.line.grid;
        g.beginPath();
        g.moveTo(x, padT - 6);
        g.lineTo(x, yTac + trackH + 5);
        g.stroke();
        g.fillStyle = HIGHLAND_THEME.text.faint;
        g.fillText(String(Number(ms.toFixed(1))), x, h - 8);
      }
      g.textAlign = 'left';
      g.fillText('ms', padL + plotW + 3, h - 8);

      const trackLabel = (title: string, sub: string, y: number, col: string) => {
        g.textAlign = 'right';
        const labelX = isMultiSector ? padL - 24 : padL - 12;
        g.fillStyle = col;
        g.font = `600 11px ${MONO}`;
        g.fillText(title, labelX, y + trackH / 2 - 1);
        g.fillStyle = HIGHLAND_THEME.text.faint;
        g.font = `10px ${MONO}`;
        g.fillText(sub, labelX, y + trackH / 2 + 12);
      };
      const staticSlotCount = staticTimeline.allocations.length || 16;
      trackLabel('STATIC TDMA', `${staticSlotCount} slots`, yStatic, HIGHLAND_THEME.text.primary);
      trackLabel('TAC-TAD', 'dynamic slots', yTac, HIGHLAND_THEME.signal.ochre);

      const drawSectorSubLanes = (yTrack: number) => {
        const subLaneH = trackH / 4;
        g.strokeStyle = 'rgba(255, 255, 255, 0.07)';
        g.lineWidth = 1;
        for (let s = 1; s < 4; s++) {
          const yDiv = Math.round(yTrack + s * subLaneH) + 0.5;
          g.beginPath();
          g.moveTo(padL, yDiv);
          g.lineTo(padL + plotW, yDiv);
          g.stroke();
        }
        g.font = `10px ${MONO}`;
        g.textAlign = 'right';
        g.fillStyle = HIGHLAND_THEME.text.faint;
        for (let s = 0; s < 4; s++) {
          const ySec = yTrack + s * subLaneH + subLaneH / 2 + 3.5;
          g.fillText(`S${s}`, padL - 6, ySec);
        }
      };

      gfxRRect(g, padL, yStatic, plotW, trackH, 4);
      g.fillStyle = HIGHLAND_THEME.substrate.void;
      g.fill();
      g.strokeStyle = HIGHLAND_THEME.line.frame;
      g.lineWidth = 1;
      g.stroke();
      if (isStaticMulti) {
        drawSectorSubLanes(yStatic);
      }

      const staticUlSegments = staticTimeline.segments.filter((s: any) => s.phase === 'UPLINK_SLOT');
      if (isStaticMulti && staticAllocations && staticAllocations.length > 0) {
        const ctrlSeg = staticTimeline.segments.find((s: any) => s.phase === 'CONTROL_BROADCAST');
        if (ctrlSeg && ctrlSeg.durationMs > 0) {
          const cx = xOfMs(ctrlSeg.startMs),
            cw = Math.max(1, (ctrlSeg.durationMs / superframeDurationMs) * plotW);
          g.fillStyle = HIGHLAND_THEME.signal.indigoSoft;
          g.fillRect(cx, yStatic + 1, cw, trackH - 2);
          g.fillStyle = HIGHLAND_THEME.signal.indigo;
          g.font = `9px ${MONO}`;
          g.textAlign = 'left';
          g.fillText('CTRL', cx + 1, yStatic - 5);
        }
        const dlSeg = staticTimeline.segments.find((s: any) => s.phase === 'DOWNLINK_BROADCAST');
        if (dlSeg && dlSeg.durationMs > 0) {
          const dx = xOfMs(dlSeg.startMs),
            dw = Math.max(1, (dlSeg.durationMs / superframeDurationMs) * plotW);
          g.fillStyle = HIGHLAND_THEME.signal.amberSoft;
          g.fillRect(dx, yStatic + 1, dw, trackH - 2);
          g.fillStyle = HIGHLAND_THEME.signal.amberBright;
          g.font = `9px ${MONO}`;
          g.textAlign = 'left';
          g.fillText('DL', dx + 2, yStatic - 5);
        }

        const subLaneH = trackH / 4;
        staticAllocations.forEach((alloc: any) => {
          const nid = alloc.node_id ?? alloc.nodeId ?? -1;
          const startMs = alloc.start_ms ?? alloc.startMs ?? 0;
          const durMs = alloc.duration_ms ?? alloc.durationMs ?? 0;
          const secId = alloc.sector_id ?? alloc.sectorId ?? 0;
          const sx = xOfMs(startMs) + 0.5,
            sw = Math.max(2, (durMs / superframeDurationMs) * plotW - 1);
          const sy = yStatic + secId * subLaneH + 1.5,
            sh = Math.max(3, subLaneH - 3);

          const n = nodes.find((nd: any) => (nd.node_id ?? nd.nodeId) === nid);
          const out =
            !!n &&
            ((n.state_name ?? n.stateName) === 'HARD_SHADOW_CUTOFF' ||
              n.linkOutage ||
              n.link_outage ||
              n.isOutage ||
              n.isBlocked);
          const isActiveStatic =
            schedMode === 'static' &&
            activeSlot.phase === 'UPLINK_SLOT' &&
            activeSlot.scheduledNodeId === nid;

          gfxRRect(g, sx, sy, sw, sh, 2);
          g.fillStyle = out ? HIGHLAND_THEME.signal.vermilionSoft : HIGHLAND_THEME.signal.ashSoft;
          g.fill();
          if (out) {
            g.save();
            g.clip();
            g.strokeStyle = HIGHLAND_THEME.signal.vermilionStrokeSoft;
            g.lineWidth = 1;
            for (let k = -sh; k < sw + sh; k += 6) {
              g.beginPath();
              g.moveTo(sx + k, sy + sh);
              g.lineTo(sx + k + sh, sy);
              g.stroke();
            }
            g.restore();
          }
          gfxRRect(g, sx, sy, sw, sh, 2);
          g.strokeStyle = isActiveStatic
            ? HIGHLAND_THEME.signal.amberBright
            : nid === sel
              ? '#ffffff'
              : out
                ? HIGHLAND_THEME.signal.vermilionBright
                : HIGHLAND_THEME.signal.ashStrokeSoft;
          g.lineWidth = isActiveStatic ? 2.0 : nid === sel ? 1.8 : 1;
          g.stroke();

          const taUs =
            alloc.timing_advance_us ??
            alloc.timingAdvanceUs ??
            (n?.slant_range_m ? ((2.0 * n.slant_range_m) / 299792458.0) * 1e6 : 100.0);
          drawTaGuard(sx, sy, sw, sh, taUs);
          renderedGanttSlots.push({
            x: sx,
            y: sy,
            w: sw,
            h: sh,
            alloc,
            schedulerType: 'Static',
            nodeId: nid,
            sectorId: secId,
            isOutage: out,
            isPreOcclusionFlush: false,
            taUs,
          });

          if (sw > 16) {
            g.fillStyle = out
              ? HIGHLAND_THEME.signal.vermilionBright
              : isActiveStatic
                ? HIGHLAND_THEME.signal.amberBright
                : HIGHLAND_THEME.text.muted;
            g.font = `10px ${MONO}`;
            g.textAlign = 'center';
            g.fillText(`S${nid}`, sx + (sw - 4) / 2, sy + sh / 2 + 3.5);
          }
        });
      } else if (staticUlSegments.length > 0) {
        const ctrlSeg = staticTimeline.segments.find((s: any) => s.phase === 'CONTROL_BROADCAST');
        if (ctrlSeg && ctrlSeg.durationMs > 0) {
          const cx = xOfMs(ctrlSeg.startMs),
            cw = Math.max(1, (ctrlSeg.durationMs / superframeDurationMs) * plotW);
          g.fillStyle = HIGHLAND_THEME.signal.indigoSoft;
          g.fillRect(cx, yStatic + 1, cw, trackH - 2);
          g.fillStyle = HIGHLAND_THEME.signal.indigo;
          g.font = `9px ${MONO}`;
          g.textAlign = 'left';
          g.fillText('CTRL', cx + 1, yStatic - 5);
        }
        const dlSeg = staticTimeline.segments.find((s: any) => s.phase === 'DOWNLINK_BROADCAST');
        if (dlSeg && dlSeg.durationMs > 0) {
          const dx = xOfMs(dlSeg.startMs),
            dw = Math.max(1, (dlSeg.durationMs / superframeDurationMs) * plotW);
          g.fillStyle = HIGHLAND_THEME.signal.amberSoft;
          g.fillRect(dx, yStatic + 1, dw, trackH - 2);
          g.fillStyle = HIGHLAND_THEME.signal.amberBright;
          g.font = `9px ${MONO}`;
          g.textAlign = 'left';
          g.fillText('DL', dx + 2, yStatic - 5);
        }

        const staticGuardSegments = staticTimeline.segments.filter(
          (s: any) => s.phase === 'GUARD' && s.durationMs >= 0.1
        );
        staticGuardSegments.forEach((seg: any) => {
          const gx = xOfMs(seg.startMs),
            gw = Math.max(1, (seg.durationMs / superframeDurationMs) * plotW);
          g.fillStyle = HIGHLAND_THEME.line.subtle;
          g.fillRect(gx, yStatic + 3, gw, trackH - 6);
        });

        staticUlSegments.forEach((seg: any) => {
          const nid = seg.scheduledNodeId ?? -1;
          const sx = xOfMs(seg.startMs) + 0.5,
            sw = Math.max(2, (seg.durationMs / superframeDurationMs) * plotW - 1);
          const sy = yStatic + 3,
            sh = trackH - 6;
          const out = Boolean(seg.isWastedAirtime);
          const isActiveStatic =
            schedMode === 'static' &&
            activeSlot.phase === 'UPLINK_SLOT' &&
            activeSlot.scheduledNodeId === nid;

          gfxRRect(g, sx, sy, sw, sh, 3);
          g.fillStyle = out ? HIGHLAND_THEME.signal.vermilionSoft : HIGHLAND_THEME.signal.ashSoft;
          g.fill();
          if (out) {
            g.save();
            g.clip();
            g.strokeStyle = HIGHLAND_THEME.signal.vermilionStrokeSoft;
            g.lineWidth = 1;
            for (let k = -sh; k < sw + sh; k += 6) {
              g.beginPath();
              g.moveTo(sx + k, sy + sh);
              g.lineTo(sx + k + sh, sy);
              g.stroke();
            }
            g.restore();
          }
          gfxRRect(g, sx, sy, sw, sh, 3);
          g.strokeStyle = isActiveStatic
            ? HIGHLAND_THEME.signal.amberBright
            : nid === sel
              ? '#ffffff'
              : out
                ? HIGHLAND_THEME.signal.vermilionBright
                : HIGHLAND_THEME.signal.ashStrokeSoft;
          g.lineWidth = isActiveStatic ? 2.0 : nid === sel ? 1.8 : 1;
          g.stroke();

          const n = nodes.find((nd: any) => (nd.node_id ?? nd.nodeId) === nid);
          const taUs =
            seg.allocation?.timing_advance_us ??
            seg.timing_advance_us ??
            (n?.slant_range_m ? ((2.0 * n.slant_range_m) / 299792458.0) * 1e6 : 100.0);
          drawTaGuard(sx, sy, sw, sh, taUs);
          renderedGanttSlots.push({
            x: sx,
            y: sy,
            w: sw,
            h: sh,
            alloc: seg.allocation ?? seg,
            schedulerType: 'Static',
            nodeId: nid,
            sectorId: 0,
            isOutage: out,
            isPreOcclusionFlush: false,
            taUs,
          });

          if (sw > 16) {
            g.fillStyle = out
              ? HIGHLAND_THEME.signal.vermilionBright
              : isActiveStatic
                ? HIGHLAND_THEME.signal.amberBright
                : HIGHLAND_THEME.text.muted;
            g.font = `10px ${MONO}`;
            g.textAlign = 'center';
            g.fillText(`S${nid}`, sx + (sw - 4) / 2, sy + sh / 2 + 3.5);
          }
        });
      } else {
        const fallbackK = state.latestTelemetry?.tdma_frame_config?.fixedSlotCount ?? 16;
        const slotW = plotW / fallbackK;
        for (let i = 0; i < fallbackK; i++) {
          const x = padL + i * slotW + 1.5,
            sw = slotW - 3,
            y = yStatic + 3,
            sh = trackH - 6;
          const n = nodes.find((nd: any) => (nd.node_id ?? nd.nodeId) === i);
          const out =
            !!n &&
            ((n.state_name ?? n.stateName) === 'HARD_SHADOW_CUTOFF' ||
              n.linkOutage ||
              n.link_outage);
          gfxRRect(g, x, y, sw, sh, 3);
          g.fillStyle = out ? HIGHLAND_THEME.signal.vermilionSoft : HIGHLAND_THEME.signal.ashSoft;
          g.fill();
          if (out) {
            g.save();
            g.clip();
            g.strokeStyle = HIGHLAND_THEME.signal.vermilionStrokeSoft;
            g.lineWidth = 1;
            for (let k = -sh; k < sw + sh; k += 6) {
              g.beginPath();
              g.moveTo(x + k, y + sh);
              g.lineTo(x + k + sh, y);
              g.stroke();
            }
            g.restore();
          }
          gfxRRect(g, x, y, sw, sh, 3);
          g.strokeStyle =
            i === sel
              ? '#ffffff'
              : out
                ? HIGHLAND_THEME.signal.vermilionBright
                : HIGHLAND_THEME.signal.ashStrokeSoft;
          g.lineWidth = i === sel ? 1.8 : 1;
          g.stroke();
          if (slotW > 20) {
            g.fillStyle = out ? HIGHLAND_THEME.signal.vermilionBright : HIGHLAND_THEME.text.muted;
            g.font = `10px ${MONO}`;
            g.textAlign = 'center';
            g.fillText(`S${i}`, x + sw / 2, y + sh / 2 + 3.5);
          }
        }
      }

      gfxRRect(g, padL, yTac, plotW, trackH, 4);
      g.fillStyle = HIGHLAND_THEME.substrate.void;
      g.fill();
      g.strokeStyle = HIGHLAND_THEME.line.frame;
      g.lineWidth = 1;
      g.stroke();
      if (isTacMulti) {
        drawSectorSubLanes(yTac);
      }

      const ctrlSeg = tacTimeline.segments.find((s: any) => s.phase === 'CONTROL_BROADCAST');
      if (ctrlSeg && ctrlSeg.durationMs > 0) {
        const cx = xOfMs(ctrlSeg.startMs),
          cw = Math.max(1, (ctrlSeg.durationMs / superframeDurationMs) * plotW);
        g.fillStyle = HIGHLAND_THEME.signal.indigoSoft;
        g.fillRect(cx, yTac + 1, cw, trackH - 2);
        g.fillStyle = HIGHLAND_THEME.signal.indigo;
        g.font = `9px ${MONO}`;
        g.textAlign = 'left';
        g.fillText('CTRL', cx + 1, yTac - 5);
      }
      const dlSeg = tacTimeline.segments.find((s: any) => s.phase === 'DOWNLINK_BROADCAST');
      if (dlSeg && dlSeg.durationMs > 0) {
        const dx = xOfMs(dlSeg.startMs),
          dw = Math.max(1, (dlSeg.durationMs / superframeDurationMs) * plotW);
        g.fillStyle = HIGHLAND_THEME.signal.amberSoft;
        g.fillRect(dx, yTac + 1, dw, trackH - 2);
        g.fillStyle = HIGHLAND_THEME.signal.amberBright;
        g.font = `9px ${MONO}`;
        g.textAlign = 'left';
        g.fillText('DL', dx + 2, yTac - 5);
      }

      if (isTacMulti && tacAllocations && tacAllocations.length > 0) {
        const subLaneH = trackH / 4;
        tacAllocations.forEach((alloc: any) => {
          const nid = alloc.node_id ?? alloc.nodeId ?? -1;
          const startMs = alloc.start_ms ?? alloc.startMs ?? 0;
          const durMs = alloc.duration_ms ?? alloc.durationMs ?? 0;
          const secId = alloc.sector_id ?? alloc.sectorId ?? 0;
          const ax = xOfMs(startMs),
            aw = Math.max(2, (durMs / superframeDurationMs) * plotW);
          const y = yTac + secId * subLaneH + 1.5,
            sh = Math.max(3, subLaneH - 3);
          const isActiveTac =
            schedMode !== 'static' &&
            activeSlot.phase === 'UPLINK_SLOT' &&
            activeSlot.scheduledNodeId === nid;

          let col: string = HIGHLAND_THEME.signal.sage;
          if (alloc.is_pre_occlusion_flush ?? alloc.isPreOcclusionFlush)
            col = HIGHLAND_THEME.signal.amberBright;
          else if (nid === 15) col = HIGHLAND_THEME.signal.amber;

          gfxRRect(g, ax, y, Math.max(1.5, aw - 1), sh, 2);
          const grad = g.createLinearGradient(0, y, 0, y + sh);
          grad.addColorStop(0, col);
          grad.addColorStop(1, col + 'bb');
          g.fillStyle = grad;
          g.fill();

          if (isActiveTac) {
            g.strokeStyle = '#ffffff';
            g.lineWidth = 2.0;
            g.stroke();
          } else if (nid === sel) {
            g.strokeStyle = '#ffffff';
            g.lineWidth = 1.6;
            g.stroke();
          }
          const n = nodes.find((nd: any) => (nd.node_id ?? nd.nodeId) === nid);
          const taUs =
            alloc.timing_advance_us ??
            alloc.timingAdvanceUs ??
            (n?.slant_range_m ? ((2.0 * n.slant_range_m) / 299792458.0) * 1e6 : 100.0);
          drawTaGuard(ax, y, Math.max(1.5, aw - 1), sh, taUs);
          renderedGanttSlots.push({
            x: ax,
            y,
            w: Math.max(1.5, aw - 1),
            h: sh,
            alloc,
            schedulerType: 'Tac-TAD',
            nodeId: nid,
            sectorId: secId,
            isOutage: false,
            isPreOcclusionFlush: Boolean(
              alloc.is_pre_occlusion_flush ?? alloc.isPreOcclusionFlush
            ),
            taUs,
          });

          if (aw > 20) {
            g.fillStyle = HIGHLAND_THEME.substrate.void;
            g.font = `bold 10px ${MONO}`;
            g.textAlign = 'center';
            g.fillText(`S${nid}`, ax + (aw - 4) / 2 - 0.5, y + sh / 2 + 3.5);
          }
        });

        const drawReclaimedGap = (startMs: number, durMs: number, sy: number, sh: number) => {
          const rx = xOfMs(startMs),
            rw = Math.max(2, (durMs / superframeDurationMs) * plotW - 1);
          gfxRRect(g, rx, sy, rw, sh, 2);
          g.fillStyle = 'rgba(82, 183, 136, 0.08)';
          g.fill();
          g.save();
          g.clip();
          g.strokeStyle = 'rgba(82, 183, 136, 0.24)';
          g.lineWidth = 1;
          for (let k = -sh; k < rw + sh; k += 8) {
            g.beginPath();
            g.moveTo(rx + k, sy + sh);
            g.lineTo(rx + k + sh, sy);
            g.stroke();
          }
          g.restore();
          gfxRRect(g, rx, sy, rw, sh, 2);
          g.strokeStyle = HIGHLAND_THEME.signal.sageStrokeSoft;
          g.lineWidth = 1;
          g.stroke();
          if (rw > 50) {
            g.fillStyle = HIGHLAND_THEME.signal.sageBright;
            g.font = `600 8.5px ${MONO}`;
            g.textAlign = 'center';
            g.fillText('RECLAIMED', rx + rw / 2, sy + sh / 2 + 3);
          }
        };

        const ulStartMs = ctrlDurationMs + dlDurationMs;
        for (let s = 0; s < 4; s++) {
          const secAllocs = tacAllocations
            .filter((a: any) => (a.sector_id ?? a.sectorId ?? 0) === s)
            .sort((a: any, b: any) => (a.start_ms ?? a.startMs ?? 0) - (b.start_ms ?? b.startMs ?? 0));
          let cursor = ulStartMs;
          const sy = yTac + s * subLaneH + 1.5;
          const sh = Math.max(3, subLaneH - 3);
          for (const a of secAllocs) {
            const aStart = a.start_ms ?? a.startMs ?? 0;
            const aDur = a.duration_ms ?? a.durationMs ?? 0;
            if (aStart > cursor + 0.05) {
              drawReclaimedGap(cursor, aStart - cursor, sy, sh);
            }
            cursor = Math.max(cursor, aStart + aDur);
          }
          if (cursor < superframeDurationMs - 0.05) {
            drawReclaimedGap(cursor, superframeDurationMs - cursor, sy, sh);
          }
        }
      } else {
        const tacUlSegments = tacTimeline.segments.filter((s: any) => s.phase === 'UPLINK_SLOT');
        tacUlSegments.forEach((seg: any) => {
          const nid = seg.scheduledNodeId ?? -1;
          const ax = xOfMs(seg.startMs),
            aw = Math.max(2, (seg.durationMs / superframeDurationMs) * plotW);
          const y = yTac + 3,
            sh = trackH - 6;
          const isActiveTac =
            schedMode !== 'static' &&
            activeSlot.phase === 'UPLINK_SLOT' &&
            activeSlot.scheduledNodeId === nid;

          let col: string = HIGHLAND_THEME.signal.sage;
          if (seg.isPreOcclusionFlush) col = HIGHLAND_THEME.signal.amberBright;
          else if (nid === 15) col = HIGHLAND_THEME.signal.amber;

          gfxRRect(g, ax, y, Math.max(1.5, aw - 1), sh, 3);
          const grad = g.createLinearGradient(0, y, 0, y + sh);
          grad.addColorStop(0, col);
          grad.addColorStop(1, col + 'bb');
          g.fillStyle = grad;
          g.fill();

          if (isActiveTac) {
            g.strokeStyle = '#ffffff';
            g.lineWidth = 2.2;
            g.stroke();
          } else if (nid === sel) {
            g.strokeStyle = '#ffffff';
            g.lineWidth = 1.6;
            g.stroke();
          }
          const n = nodes.find((nd: any) => (nd.node_id ?? nd.nodeId) === nid);
          const taUs =
            seg.allocation?.timing_advance_us ??
            seg.timing_advance_us ??
            (n?.slant_range_m ? ((2.0 * n.slant_range_m) / 299792458.0) * 1e6 : 100.0);
          drawTaGuard(ax, y, Math.max(1.5, aw - 1), sh, taUs);
          const secId = seg.allocation?.sector_id ?? seg.sector_id ?? seg.sectorId;
          renderedGanttSlots.push({
            x: ax,
            y,
            w: Math.max(1.5, aw - 1),
            h: sh,
            alloc: seg.allocation ?? seg,
            schedulerType: 'Tac-TAD',
            nodeId: nid,
            sectorId: secId ?? 0,
            isOutage: false,
            isPreOcclusionFlush: Boolean(seg.isPreOcclusionFlush),
            taUs,
          });

          if (aw > 36 && secId !== undefined) {
            g.fillStyle = HIGHLAND_THEME.substrate.void;
            g.font = `bold 10px ${MONO}`;
            g.textAlign = 'center';
            g.fillText(`S${nid}·sec${secId}`, ax + (aw - 4) / 2 - 0.5, y + sh / 2 + 3.5);
          } else if (aw > 20) {
            g.fillStyle = HIGHLAND_THEME.substrate.void;
            g.font = `bold 10px ${MONO}`;
            g.textAlign = 'center';
            g.fillText(`S${nid}`, ax + (aw - 4) / 2 - 0.5, y + sh / 2 + 3.5);
          }
        });

        const tacReclaimedSegments = tacTimeline.segments.filter(
          (s: any) => s.phase === 'IDLE_RECLAIMED'
        );
        tacReclaimedSegments.forEach((seg: any) => {
          const rx = xOfMs(seg.startMs),
            rw = Math.max(2, (seg.durationMs / superframeDurationMs) * plotW - 1);
          const ry = yTac + 3,
            rh = trackH - 6;
          gfxRRect(g, rx, ry, rw, rh, 3);
          g.fillStyle = 'rgba(82, 183, 136, 0.08)';
          g.fill();
          g.save();
          g.clip();
          g.strokeStyle = 'rgba(82, 183, 136, 0.24)';
          g.lineWidth = 1;
          for (let k = -rh; k < rw + rh; k += 8) {
            g.beginPath();
            g.moveTo(rx + k, ry + rh);
            g.lineTo(rx + k + rh, ry);
            g.stroke();
          }
          g.restore();
          gfxRRect(g, rx, ry, rw, rh, 3);
          g.strokeStyle = HIGHLAND_THEME.signal.sageStrokeSoft;
          g.lineWidth = 1;
          g.stroke();
          if (rw > 60) {
            g.fillStyle = HIGHLAND_THEME.signal.sageBright;
            g.font = `600 9px ${MONO}`;
            g.textAlign = 'center';
            g.fillText('RECLAIMED AIRTIME', rx + rw / 2, ry + rh / 2 + 3);
          } else if (rw > 28) {
            g.fillStyle = HIGHLAND_THEME.signal.sageBright;
            g.font = `600 8.5px ${MONO}`;
            g.textAlign = 'center';
            g.fillText('RECLAIMED', rx + rw / 2, ry + rh / 2 + 3);
          }
        });
      }

      const renderTrackConflicts = (conflicts: readonly any[], yTrack: number) => {
        conflicts.forEach((conf) => {
          const cx = xOfMs(conf.startMs);
          const cw = Math.max(
            3,
            (Math.max(0, conf.endMs - conf.startMs) / superframeDurationMs) * plotW
          );
          const cy = yTrack + 2,
            ch = trackH - 4;
          g.save();
          gfxRRect(g, cx, cy, cw, ch, 2);
          g.fillStyle = HIGHLAND_THEME.signal.vermilionSoft;
          g.fill();
          g.clip();
          g.strokeStyle = HIGHLAND_THEME.signal.vermilion;
          g.lineWidth = 1.2;
          for (let k = -ch; k < cw + ch; k += 5) {
            g.beginPath();
            g.moveTo(cx + k, cy + ch);
            g.lineTo(cx + k + ch, cy);
            g.stroke();
          }
          g.restore();
          gfxRRect(g, cx, cy, cw, ch, 2);
          g.strokeStyle = HIGHLAND_THEME.signal.vermilion;
          g.lineWidth = 1.5;
          g.stroke();
          if (cw > 24) {
            g.fillStyle = HIGHLAND_THEME.signal.vermilionBright;
            g.font = `bold 8.5px ${MONO}`;
            g.textAlign = 'center';
            g.fillText('CONFLICT', cx + cw / 2, cy + ch / 2 + 3);
          }
        });
      };
      if (staticTimeline.conflictIntervals.length > 0)
        renderTrackConflicts(staticTimeline.conflictIntervals, yStatic);
      if (tacTimeline.conflictIntervals.length > 0)
        renderTrackConflicts(tacTimeline.conflictIntervals, yTac);

      if (
        Number.isFinite(subframeOffsetMs) &&
        subframeOffsetMs >= 0 &&
        subframeOffsetMs <= superframeDurationMs
      ) {
        const px = Math.round(xOfMs(subframeOffsetMs)) + 0.5;
        const isConflict = activeSlot.phase === 'CONFLICT';
        const playheadCol = isConflict
          ? HIGHLAND_THEME.signal.vermilion
          : HIGHLAND_THEME.signal.amberBright;
        g.save();
        g.strokeStyle = playheadCol;
        g.lineWidth = isConflict ? 2.0 : 1.5;
        g.beginPath();
        g.moveTo(px, padT - 4);
        g.lineTo(px, yTac + trackH + 4);
        g.stroke();

        g.fillStyle = playheadCol;
        g.beginPath();
        g.moveTo(px, padT - 3);
        g.lineTo(px - 3.5, padT - 9);
        g.lineTo(px + 3.5, padT - 9);
        g.closePath();
        g.fill();

        g.font = `bold 9px ${MONO}`;
        g.fillStyle = playheadCol;
        g.textAlign = 'center';
        const playheadText = isConflict
          ? `${subframeOffsetMs.toFixed(1)}ms [CONFLICT]`
          : `${subframeOffsetMs.toFixed(1)}ms`;
        g.fillText(playheadText, px, padT - 11);
        g.restore();
      }

      state.activeRenderedGanttSlots = renderedGanttSlots;

      if (
        state.ganttHoverState.active &&
        state.ganttHoverState.x >= padL &&
        state.ganttHoverState.x <= padL + plotW
      ) {
        const hx = Math.round(state.ganttHoverState.x) + 0.5;
        g.save();
        g.strokeStyle = '#00f0ff';
        g.lineWidth = 1.0;
        g.setLineDash([3, 2]);
        g.beginPath();
        g.moveTo(hx, padT - 4);
        g.lineTo(hx, yTac + trackH + 6);
        g.stroke();
        g.setLineDash([]);

        const hoverMs = Math.max(
          0,
          Math.min(
            superframeDurationMs,
            ((state.ganttHoverState.x - padL) / plotW) * superframeDurationMs
          )
        );
        const hoverUs = Math.round(hoverMs * 1000);
        const pillText = `t = ${hoverMs.toFixed(3)} ms (${hoverUs} μs)`;
        g.font = `600 10px ${MONO}`;
        const tw = g.measureText(pillText).width;
        const pillW = tw + 12,
          pillH = 18;
        const pillX = Math.max(
          padL,
          Math.min(padL + plotW - pillW, state.ganttHoverState.x - pillW / 2)
        );
        const pillY = padT - 20;
        gfxRRect(g, pillX, pillY, pillW, pillH, 3);
        g.fillStyle = 'rgba(7, 9, 12, 0.95)';
        g.fill();
        g.strokeStyle = '#00f0ff';
        g.lineWidth = 1.0;
        g.stroke();
        g.fillStyle = '#00f0ff';
        g.textAlign = 'center';
        g.fillText(pillText, pillX + pillW / 2, pillY + 12.5);
        g.restore();

        if (state.ganttHoverState.hoveredSlot) {
          const hs = state.ganttHoverState.hoveredSlot;
          g.save();
          gfxRRect(g, hs.x - 1, hs.y - 1, hs.w + 2, hs.h + 2, 3);
          g.strokeStyle = '#00f0ff';
          g.lineWidth = 2.0;
          g.stroke();
          g.restore();
        }
      }

      if (!state.pduDissectorState.autoFollow && state.pduDissectorState.pinnedSlot) {
        const ps = state.pduDissectorState.pinnedSlot;
        const match = renderedGanttSlots.find(
          (s) =>
            s.nodeId === ps.nodeId &&
            s.sectorId === ps.sectorId &&
            s.schedulerType === ps.schedulerType
        );
        const highlightSlot = match || ps;
        g.save();
        gfxRRect(g, highlightSlot.x - 1, highlightSlot.y - 1, highlightSlot.w + 2, highlightSlot.h + 2, 3);
        g.strokeStyle = HIGHLAND_THEME.signal.amberBright;
        g.lineWidth = 2.0;
        g.stroke();
        g.restore();
      }

      updatePduDissectorPanel(nodes, schedMode, subframeOffsetMs);
    } catch (err) {
      console.error('Error drawing waterfall canvas:', err);
    }
  }

  function updatePduDissectorPanel(nodes: readonly any[], schedMode: string, _subframeOffsetMs: number) {
    try {
      const dissectorPanel = $('pdu-dissector-panel');
      if (!dissectorPanel) return;

      let targetSlot: any = null;
      let inspectionReason = 'AUTO-FOLLOW TOP ACTIVE SLOT';

      if (state.ganttHoverState.active && state.ganttHoverState.hoveredSlot) {
        targetSlot = state.ganttHoverState.hoveredSlot;
        inspectionReason = `HOVER INSPECTION: NID:${targetSlot.nodeId} · SEC:S${targetSlot.sectorId} (${targetSlot.schedulerType})`;
      } else if (!state.pduDissectorState.autoFollow && state.pduDissectorState.pinnedSlot) {
        const match = state.activeRenderedGanttSlots.find(
          (s: any) =>
            s.nodeId === state.pduDissectorState.pinnedSlot.nodeId &&
            s.sectorId === state.pduDissectorState.pinnedSlot.sectorId &&
            s.schedulerType === state.pduDissectorState.pinnedSlot.schedulerType
        );
        targetSlot = match || state.pduDissectorState.pinnedSlot;
        inspectionReason = `PINNED SLOT: NID:${targetSlot.nodeId} · SEC:S${targetSlot.sectorId} (${targetSlot.schedulerType})`;
      } else {
        const currentSched = schedMode === 'static' ? 'Static' : 'Tac-TAD';
        const selId = typeof state.selectedNodeId === 'number' ? state.selectedNodeId : -1;
        let candidate = null;
        if (selId >= 0) {
          candidate = state.activeRenderedGanttSlots.find(
            (s: any) => s.nodeId === selId && s.schedulerType === currentSched
          );
        }
        if (!candidate && state.activeRenderedGanttSlots.length > 0) {
          candidate =
            state.activeRenderedGanttSlots.find((s: any) => s.schedulerType === currentSched) ||
            state.activeRenderedGanttSlots[0];
        }
        targetSlot = candidate;
        if (targetSlot) {
          inspectionReason = `LIVE AUTO-TRACKING: NID:${targetSlot.nodeId} · SEC:S${targetSlot.sectorId} (${targetSlot.schedulerType})`;
        } else {
          inspectionReason = 'LIVE AUTO-TRACKING: IDLE FRAME';
        }
      }

      const subhead = $('pdu-slot-subhead');
      if (subhead) subhead.textContent = inspectionReason;

      const autoBtn = $('btn-pdu-auto-follow');
      if (autoBtn) {
        if (state.pduDissectorState.autoFollow) {
          autoBtn.textContent = 'Auto-Follow Top Slot [ON]';
          autoBtn.style.borderColor = 'var(--line)';
          autoBtn.style.color = 'var(--text)';
        } else {
          autoBtn.textContent = 'Auto-Follow Top Slot [PINNED]';
          autoBtn.style.borderColor = 'var(--hi-amber, #f59e0b)';
          autoBtn.style.color = 'var(--hi-amber, #f59e0b)';
        }
      }

      if (!targetSlot) return;

      const nid = targetSlot.nodeId ?? 0;
      const n = Array.isArray(nodes)
        ? nodes.find((nd) => (nd.node_id ?? nd.nodeId) === nid)
        : null;
      const alloc = targetSlot.alloc || {};

      const pdu = dissectTdmaSlotAllocation(
        {
          nodeId: nid,
          sectorId: targetSlot.sectorId ?? alloc.sector_id ?? alloc.sectorId ?? 0,
          slotStartS: alloc.slot_start_s ?? (alloc.start_ms ? alloc.start_ms / 1000 : 0),
          durationS:
            alloc.duration_s ??
            (alloc.duration_ms
              ? alloc.duration_ms / 1000
              : targetSlot.w
                ? (targetSlot.w / 600) * 0.02
                : 0.001),
          timingAdvanceUs: targetSlot.taUs ?? alloc.timing_advance_us ?? alloc.timingAdvanceUs,
          modcodName: alloc.modcod_name ?? alloc.modcodName ?? n?.modcod_name ?? '16APSK 3/4',
          spectralEfficiency:
            alloc.spectral_efficiency ??
            alloc.spectralEfficiency ??
            n?.spectral_efficiency_bps_hz ??
            2.966,
          capacityBits:
            alloc.capacity_bits ??
            alloc.capacityBits ??
            (alloc.duration_ms ? Math.floor(alloc.duration_ms * 1e-3 * 20e6 * 2.5) : 5000),
          isPreOcclusionFlush: Boolean(
            targetSlot.isPreOcclusionFlush ??
              alloc.is_pre_occlusion_flush ??
              alloc.isPreOcclusionFlush
          ),
          isOutage: Boolean(
            targetSlot.isOutage ?? n?.linkOutage ?? n?.link_outage ?? n?.is_outage
          ),
        },
        targetSlot.schedulerType ?? 'Tac-TAD',
        {
          q_c2:
            n?.c2_bytes ??
            (alloc.c2_bytes !== undefined
              ? alloc.c2_bytes
              : n?.c2_backlog
                ? n.c2_backlog * 128
                : 128),
          q_voice: n?.voice_bytes ?? (alloc.voice_bytes !== undefined ? alloc.voice_bytes : 0),
          q_video: n?.video_bytes ?? (alloc.video_bytes !== undefined ? alloc.video_bytes : 0),
          q_photo: n?.photo_bytes ?? (alloc.photo_bytes !== undefined ? alloc.photo_bytes : 0),
          slant_range_m: n?.slant_range_m ?? 25000.0,
          snr_db: n?.snr_db ?? 16.0,
          is_outage: Boolean(
            targetSlot.isOutage ?? n?.linkOutage ?? n?.link_outage ?? n?.is_outage
          ),
        }
      );

      const capReadout = $('pdu-capacity-readout');
      if (capReadout) {
        capReadout.textContent = `${pdu.totalCapacityBits.toLocaleString()} bits / ${pdu.totalCapacityBytes.toLocaleString()} B`;
      }

      const totBits = Math.max(1, pdu.totalCapacityBits);
      const pFraming = (pdu.framingOverheadBits / totBits) * 100;
      const pC2 = (pdu.c2Bits / totBits) * 100;
      const pVoice = (pdu.voiceBits / totBits) * 100;
      const pVideo = (pdu.videoBits / totBits) * 100;
      const pPhoto = (pdu.photoBits / totBits) * 100;
      const pPadding = (pdu.paddingBits / totBits) * 100;

      const bFraming = $('pdu-bar-framing'),
        bC2 = $('pdu-bar-c2'),
        bVoice = $('pdu-bar-voice');
      const bVideo = $('pdu-bar-video'),
        bPhoto = $('pdu-bar-photo'),
        bPadding = $('pdu-bar-padding');

      if (bFraming) bFraming.style.width = `${pFraming.toFixed(1)}%`;
      if (bC2) bC2.style.width = `${pC2.toFixed(1)}%`;
      if (bVoice) bVoice.style.width = `${pVoice.toFixed(1)}%`;
      if (bVideo) bVideo.style.width = `${pVideo.toFixed(1)}%`;
      if (bPhoto) bPhoto.style.width = `${pPhoto.toFixed(1)}%`;
      if (bPadding) bPadding.style.width = `${pPadding.toFixed(1)}%`;

      const lFraming = $('pdu-leg-framing'),
        lC2 = $('pdu-leg-c2'),
        lVoice = $('pdu-leg-voice');
      const lVideo = $('pdu-leg-video'),
        lPhoto = $('pdu-leg-photo'),
        lPadding = $('pdu-leg-padding');

      if (lFraming)
        lFraming.textContent = `Framing: ${pdu.framingOverheadBytes}B (${pFraming.toFixed(1)}%)`;
      if (lC2) lC2.textContent = `5QI-69 C2: ${pdu.c2Bytes}B (${pC2.toFixed(1)}%)`;
      if (lVoice) lVoice.textContent = `5QI-65 Voice: ${pdu.voiceBytes}B (${pVoice.toFixed(1)}%)`;
      if (lVideo) lVideo.textContent = `5QI-67 Video: ${pdu.videoBytes}B (${pVideo.toFixed(1)}%)`;
      if (lPhoto) lPhoto.textContent = `5QI-70 Photo: ${pdu.photoBytes}B (${pPhoto.toFixed(1)}%)`;
      if (lPadding) lPadding.textContent = `Padding: ${pdu.paddingBytes}B (${pPadding.toFixed(1)}%)`;

      const phyWin = $('pdu-phy-window'),
        phyTa = $('pdu-phy-ta'),
        phySec = $('pdu-phy-sector');
      const phyMc = $('pdu-phy-modcod'),
        phyCap = $('pdu-phy-cap');

      if (phyWin)
        phyWin.textContent = `[${pdu.slotStartMs.toFixed(2)} .. ${pdu.slotEndMs.toFixed(2)}] ms (${pdu.durationMs.toFixed(2)} ms)`;
      if (phyTa) phyTa.textContent = `${pdu.timingAdvanceUs.toFixed(1)} μs`;
      if (phySec) phySec.textContent = `Sector S${pdu.sectorId} (${pdu.sectorId * 90}° boresight)`;
      if (phyMc) phyMc.textContent = `${pdu.modcodName} (${pdu.spectralEfficiency.toFixed(2)} bps/Hz)`;
      if (phyCap)
        phyCap.textContent = `${pdu.totalCapacityBits.toLocaleString()} bits (${pdu.totalCapacityBytes.toLocaleString()} B)`;

      const macFraming = $('pdu-mac-framing'),
        macC2 = $('pdu-mac-c2'),
        macVoice = $('pdu-mac-voice');
      const macVideo = $('pdu-mac-video'),
        macPhoto = $('pdu-mac-photo'),
        macPadding = $('pdu-mac-padding');

      if (macFraming)
        macFraming.textContent = `${pdu.framingOverheadBytes} B (${pdu.framingOverheadBits} bits)`;
      if (macC2) macC2.textContent = `${pdu.c2Bytes} B (${pdu.c2Bits} bits)`;
      if (macVoice) macVoice.textContent = `${pdu.voiceBytes} B (${pdu.voiceBits} bits)`;
      if (macVideo) macVideo.textContent = `${pdu.videoBytes} B (${pdu.videoBits} bits)`;
      if (macPhoto) macPhoto.textContent = `${pdu.photoBytes} B (${pdu.photoBits} bits)`;
      if (macPadding) macPadding.textContent = `${pdu.paddingBytes} B (${pdu.paddingBits} bits)`;

      const schedType = $('pdu-sched-type'),
        schedModeEl = $('pdu-sched-mode'),
        schedStatus = $('pdu-sched-status');
      const schedRange = $('pdu-sched-range'),
        schedSnr = $('pdu-sched-snr');

      if (schedType) schedType.textContent = pdu.scheduler;
      if (schedModeEl)
        schedModeEl.textContent = pdu.isPreOcclusionFlush
          ? 'PRE_OCCLUSION_FLUSH'
          : pdu.isOutage
            ? 'STATIC_OUTAGE_WASTE'
            : 'NORMAL_PF';
      if (schedStatus) {
        schedStatus.textContent = pdu.deliveryStatus;
        schedStatus.style.color =
          pdu.deliveryStatus === 'OUTAGE_WASTED_BURST'
            ? '#ef4444'
            : pdu.deliveryStatus === 'PRE_OCCLUSION_EVAC_BURST'
              ? '#f59e0b'
              : '#10b981';
      }
      if (schedRange) schedRange.textContent = `${(pdu.slantRangeM / 1000).toFixed(2)} km`;
      if (schedSnr) schedSnr.textContent = `${pdu.snrDb.toFixed(1)} dB`;

      const hexDump = $('pdu-hex-dump');
      if (hexDump) {
        hexDump.textContent = pdu.hexHeaderDump;
      }
    } catch (err) {
      console.warn('Error updating PDU dissector panel:', err);
    }
  }

  function drawFresnel() {
    try {
      const isTimelineHist = Boolean(
        state.simTimelineController && state.simTimelineController.isHistoricalInspecting
      );
      const isHistRf = isTimelineHist || historyController.isInspecting;
      const histRecord = isTimelineHist
        ? state.bridgeHistRfRec
        : historyController.getActiveHistoricalRecord();
      const histSnap =
        isHistRf && state.simTimelineController
          ? state.simTimelineController.getActiveSpatialSnapshot()
          : null;

      const liveFrame = state.latestTelemetry as
        | (TelemetryFrame & {
            scenario_config?: { waypoints?: readonly [number, number][]; trajectory_mode?: string };
          })
        | null;
      const f = isHistRf
        ? null
        : (liveFrame?.selected_node_fresnel as
            | (FresnelSliceTelemetry & {
                selected_link_budget?: SelectedLinkBudgetTelemetry;
                transfer_telemetry?: NodeTransferTelemetry;
              })
            | null
            | undefined);
      const profile = isHistRf
        ? histRecord
          ? histRecord.profile
          : null
        : f && f.profile && f.profile.valid
          ? f.profile
          : null;

      const selNode = isHistRf
        ? null
        : (liveFrame?.nodes_telemetry || []).find(
            (n: any) => n.node_id === state.selectedNodeId
          );
      const histSelNode = histSnap
        ? histSnap.nodes.find((n: any) => n.nodeId === state.selectedNodeId)
        : null;

      const rawAcnPos = isHistRf
        ? histRecord
          ? histRecord.acnPositionMslM
          : histSnap
            ? ([histSnap.acn.posX, histSnap.acn.posY, histSnap.acn.altitudeMslM] as Position3D)
            : null
        : ((liveFrame?.acn_telemetry as { position_m?: Position3D } | undefined)?.position_m ??
          (profile ? profile.acnPositionMslM : null));
      const acnPos: Position3D | null = rawAcnPos
        ? [rawAcnPos[0] ?? 0, rawAcnPos[1] ?? 0, rawAcnPos[2] ?? 0]
        : null;
      const rawNodePos = isHistRf
        ? histRecord
          ? histRecord.groundNodePositionMslM
          : histSelNode
            ? ([histSelNode.posX, histSelNode.posY, histSelNode.posZ ?? 0] as Position3D)
            : null
        : selNode
          ? ([selNode.x_m ?? 0, selNode.y_m ?? 0, (selNode.terrain_elevation_msl_m || 0) + (selNode.agl_m || 2)] as Position3D)
          : profile
            ? profile.groundNodePositionMslM
            : null;
      const nodePos: Position3D | null = rawNodePos
        ? [rawNodePos[0] ?? 0, rawNodePos[1] ?? 0, rawNodePos[2] ?? 0]
        : null;

      if (terrainCanvas && terrainCtx) {
        const syncResult = syncCanvasDpr(terrainCanvas, terrainCtx);
        if (syncResult.isVisible) {
          const tw = syncResult.cssWidth;
          const th = syncResult.cssHeight;
          terrainCtx.clearRect(0, 0, tw, th);
          const tLayout = { width: tw, height: th, padL: 60, padR: 24, padT: 28, padB: 34 };

          terrainProfileViewport.syncProfile(profile);
          terrainTopViewport.syncLink(nodePos, acnPos, {
            selectedNodeId: state.selectedNodeId,
            layout: tLayout,
          });

          const tNodeLabel = $('terrain-node-label');
          if (tNodeLabel) {
            tNodeLabel.textContent = histRecord
              ? `${histRecord.nodeName} [Historical #${histRecord.frameIndex}]`
              : isHistRf
                ? `Unavailable [Historical #${state.bridgeHistoricalFrame ?? '--'}]`
                : state.selectedNodeId >= 0 && selNode
                  ? `Node ${state.selectedNodeId} (${selNode?.name || 'Terminal'})`
                  : 'No Node Selected (ACN Only)';
          }

          const tZoomLabel = $('terrain-zoom-label');
          if (tZoomLabel) {
            const zf =
              state.terrainProfileViewMode === 'top' || state.terrainProfileViewMode === 'rf-top'
                ? terrainTopViewport.zoomFactor
                : terrainProfileViewport.zoomFactor;
            tZoomLabel.textContent = `${zf.toFixed(1)}×`;
          }

          const tClearBadge = $('terrain-clearance-badge');
          if (tClearBadge) {
            if (!profile && !histRecord) {
              tClearBadge.className = 'kpi-badge';
              tClearBadge.textContent = 'CLEARANCE: --';
            } else {
              const clr = profile
                ? profile.terrainMinimumClearanceM
                : histRecord
                  ? histRecord.obstruction.minClearanceM
                  : 0;
              const isLos = profile
                ? profile.terrainIsLos
                : histRecord
                  ? histRecord.obstruction.terrainIsLos
                  : true;
              tClearBadge.className = isLos
                ? 'kpi-badge badge-emerald'
                : 'kpi-badge badge-crimson';
              tClearBadge.textContent = isLos
                ? `CLEARANCE: +${clr.toFixed(0)}m`
                : `OCCLUSION: ${clr.toFixed(0)}m`;
            }
          }

          const tCrestBadge = $('terrain-crest-badge');
          if (tCrestBadge) {
            let maxElev = 0;
            if (profile && profile.samples) {
              for (let i = 0; i < profile.samples.length; i++) {
                if (profile.samples[i].terrainElevationMslM > maxElev)
                  maxElev = profile.samples[i].terrainElevationMslM;
              }
            }
            tCrestBadge.textContent = maxElev > 0 ? `PEAK: ${Math.round(maxElev)}m MSL` : 'PEAK: --';
          }

          const topViewAcn = isHistRf
            ? histSnap
              ? {
                  pos_x: histSnap.acn.posX,
                  pos_y: histSnap.acn.posY,
                  heading_deg: (((histSnap.acn.headingRad * 180) / Math.PI) % 360 + 360) % 360,
                  altitude_msl_m: histSnap.acn.altitudeMslM,
                }
              : null
            : liveFrame?.acn_telemetry ?? null;

          const topViewAllNodes = isHistRf
            ? histSnap
              ? histSnap.nodes.map((n: any) => ({
                  node_id: n.nodeId,
                  x_m: n.posX,
                  y_m: n.posY,
                  terrain_is_los: n.isLos,
                  obstacle_blocked: n.isObstacleBlocked,
                  link_outage: n.isOutage,
                  snr_db: n.snrDb,
                }))
              : []
            : liveFrame?.nodes_telemetry;

          const topViewSelNode = isHistRf
            ? topViewAllNodes?.find((n: any) => n.node_id === state.selectedNodeId) ?? null
            : selNode;

          const b = state.activeTerrainBounds;
          const strictBounds: TerrainBoundsTelemetry | null =
            b &&
            typeof b.minX === 'number' &&
            typeof b.maxX === 'number' &&
            typeof b.minY === 'number' &&
            typeof b.maxY === 'number'
              ? {
                  ...(b as TerrainBoundsTelemetry),
                  minX: b.minX,
                  maxX: b.maxX,
                  minY: b.minY,
                  maxY: b.maxY,
                }
              : null;

          const topViewOpts: TopViewRenderOptions = {
            hillshadeCanvas: state.hillshadeCanvas,
            activeTerrainBounds: strictBounds,
            acnTelemetry: topViewAcn as TopViewRenderOptions['acnTelemetry'],
            selectedNode: topViewSelNode,
            allNodes: topViewAllNodes,
            obstacles: obstacleEditor.committed,
            waypoints: isHistRf
              ? undefined
              : liveFrame?.scenario_config?.waypoints ??
                (trajectoryEditor && trajectoryEditor.preview.mode === 'waypoints'
                  ? trajectoryEditor.preview.points
                  : undefined),
            trajectoryMode: isHistRf
              ? undefined
              : liveFrame?.scenario_config?.trajectory_mode ??
                (trajectoryEditor ? trajectoryEditor.preview.mode : undefined),
          };

          if (isHistRf && !histRecord && !histSnap) {
            terrainCtx.fillStyle = HIGHLAND_THEME.substrate.void;
            terrainCtx.fillRect(0, 0, tw, th);
            terrainCtx.fillStyle = HIGHLAND_THEME.signal.ochre;
            terrainCtx.font = `600 11px ${MONO}`;
            terrainCtx.textAlign = 'center';
            terrainCtx.textBaseline = 'middle';
            terrainCtx.fillText(
              'Historical terrain & RF snapshot unavailable at this playhead',
              tw / 2,
              th / 2
            );
            return;
          }

          const profReadout = $('prof-physics-readout');
          if (profReadout) {
            if (profile) {
              const kVal = profile.kFactor ?? 1.3333333333333333;
              const gradVal = profile.refractivityGradNPerKm ?? 157.0 * (1.0 / kVal - 1.0);
              const bulgeVal = profile.maxEarthBulgeM ?? 0;
              const kStr = kVal.toFixed(Math.abs(kVal - 4.0 / 3.0) < 1e-4 ? 3 : 2);
              const gradStr = `${gradVal > 0 ? '+' : ''}${Math.round(gradVal)} N/km`;
              const bulgeStr = `+${bulgeVal.toFixed(2)} m`;
              const apexStr = profile.bullingtonApex
                ? `${(profile.bullingtonApex.distM / 1000).toFixed(1)} km (ν = ${profile.bullingtonApex.diffractionParameterNu.toFixed(2)}, J = ${profile.bullingtonApex.lossDb.toFixed(1)} dB)`
                : '--';
              const crestStr =
                profile.crestRadiusM !== undefined ? `${Math.round(profile.crestRadiusM)} m` : '--';
              profReadout.textContent = `K-Factor: ${kStr} (${gradStr}) | Midpoint Bulge: ${bulgeStr} | Bullington Apex: ${apexStr} | R_crest: ${crestStr}`;
            } else {
              profReadout.textContent =
                'K-Factor: 1.333 (-39 N/km) | Midpoint Bulge: +5.89 m | Bullington Apex: -- | R_crest: --';
            }
          }

          if (state.terrainProfileViewMode === 'top') {
            renderTerrainTopView(terrainCtx, tLayout, terrainTopViewport, profile, topViewOpts);
          } else if (state.terrainProfileViewMode === 'rf-top') {
            const lb = (histRecord
              ? histRecord.linkBudget
              : f
                ? f.selected_link_budget ?? null
                : null) as Parameters<typeof renderRfTopView>[4];
            const commStatus = classifyLinkCommunicationStatus(topViewSelNode);
            const transferState = (histRecord
              ? (histRecord as typeof histRecord & { transferState?: NodeTransferTelemetry }).transferState ?? null
              : f
                ? f.transfer_telemetry ?? null
                : null) as Parameters<typeof renderRfTopView>[6];
            renderRfTopView(
              terrainCtx,
              tLayout,
              terrainTopViewport,
              profile,
              lb,
              commStatus,
              transferState,
              topViewOpts
            );
          } else {
            renderTerrainProfileViewport(
              terrainCtx,
              tLayout,
              terrainProfileViewport,
              profile,
              histRecord ? histRecord.profilePoints : f ? f.profile_points : null,
              {
                showFresnel: state.profMultiFresnelOrders,
                showMultiFresnel: state.profMultiFresnelOrders,
                showBullingtonRays: state.profMultiFresnelOrders,
                hoverInfo: state.profHoverInfo,
              }
            );
          }
        }
      }
    } catch (err) {
      console.error('Error drawing Path Profiles:', err);
    }
  }

  function setupScopeAndHistoryListeners() {
    if (waterfallCanvas) {
      waterfallCanvas.addEventListener('mousemove', (e: any) => {
        const rect = waterfallCanvas.getBoundingClientRect();
        const cssX = e.clientX - rect.left;
        const cssY = e.clientY - rect.top;
        state.ganttHoverState.active = true;
        state.ganttHoverState.x = cssX;
        state.ganttHoverState.y = cssY;

        let hit: (typeof state.activeRenderedGanttSlots)[number] | null = null;
        for (let i = state.activeRenderedGanttSlots.length - 1; i >= 0; i--) {
          const s = state.activeRenderedGanttSlots[i];
          if (
            typeof s.x === 'number' &&
            typeof s.w === 'number' &&
            typeof s.y === 'number' &&
            typeof s.h === 'number' &&
            cssX >= s.x &&
            cssX <= s.x + s.w &&
            cssY >= s.y &&
            cssY <= s.y + s.h
          ) {
            hit = s;
            break;
          }
        }
        state.ganttHoverState.hoveredSlot = hit;
        waterfallCanvas.style.cursor = hit ? 'pointer' : 'crosshair';
        state.schedulerNeedsRender = true;
        drawWaterfall();
      });

      waterfallCanvas.addEventListener('mouseleave', () => {
        state.ganttHoverState.active = false;
        state.ganttHoverState.hoveredSlot = null;
        waterfallCanvas.style.cursor = 'default';
        state.schedulerNeedsRender = true;
        drawWaterfall();
      });

      waterfallCanvas.addEventListener('click', (e: any) => {
        const rect = waterfallCanvas.getBoundingClientRect();
        const cssX = e.clientX - rect.left;
        const cssY = e.clientY - rect.top;
        let clicked: (typeof state.activeRenderedGanttSlots)[number] | null = null;
        for (let i = state.activeRenderedGanttSlots.length - 1; i >= 0; i--) {
          const s = state.activeRenderedGanttSlots[i];
          if (
            typeof s.x === 'number' &&
            typeof s.w === 'number' &&
            typeof s.y === 'number' &&
            typeof s.h === 'number' &&
            cssX >= s.x &&
            cssX <= s.x + s.w &&
            cssY >= s.y &&
            cssY <= s.y + s.h
          ) {
            clicked = s;
            break;
          }
        }
        if (clicked) {
          state.pduDissectorState.pinnedSlot = clicked;
          state.pduDissectorState.autoFollow = false;
          state.schedulerNeedsRender = true;
          drawWaterfall();
        }
      });
    }

    $('btn-pdu-auto-follow')?.addEventListener('click', () => {
      state.pduDissectorState.autoFollow = !state.pduDissectorState.autoFollow;
      if (state.pduDissectorState.autoFollow) {
        state.pduDissectorState.pinnedSlot = null;
      }
      state.schedulerNeedsRender = true;
      drawWaterfall();
    });

    (window as any).onRefractivityChange = function (val: string) {
      const k = parseFloat(val);
      if (!Number.isFinite(k) || k <= 0) return;
      worker.postMessage({
        type: 'SET_SCIENTIFIC_PARAMS',
        earthRadiusFactorK: k,
      });
      state.terrainNeedsRender = true;
      drawFresnel();
    };

    (window as any).toggleMultiOrderFresnel = function () {
      state.profMultiFresnelOrders = !state.profMultiFresnelOrders;
      const btn = $('prof-toggle-fresnel-orders');
      if (btn) {
        btn.setAttribute('aria-pressed', String(state.profMultiFresnelOrders));
        btn.classList.toggle('active', state.profMultiFresnelOrders);
        btn.textContent = state.profMultiFresnelOrders
          ? 'Fresnel Zones F1–F3 & Apex [ON]'
          : 'Fresnel Zones F1–F3 & Apex [OFF]';
      }
      state.terrainNeedsRender = true;
      drawFresnel();
    };

    $('sci-sweep-axis-select')?.addEventListener('change', (e: any) => {
      state.activeSensitivityAxis = e.target.value;
      state.schedulerNeedsRender = true;
      if (state.latestTelemetry) {
        drawSensitivitySweepScope(state.latestTelemetry);
      }
    });

    // Path Profiles interactions
    $('btn-terrain-view-profile')?.addEventListener('click', (e: any) => {
      e.stopPropagation();
      state.terrainProfileViewMode = 'profile';
      $('btn-terrain-view-profile')?.classList.add('active');
      $('btn-terrain-view-top')?.classList.remove('active');
      $('btn-terrain-view-rf-top')?.classList.remove('active');
      drawFresnel();
    });

    $('btn-terrain-view-top')?.addEventListener('click', (e: any) => {
      e.stopPropagation();
      state.terrainProfileViewMode = 'top';
      $('btn-terrain-view-top')?.classList.add('active');
      $('btn-terrain-view-profile')?.classList.remove('active');
      $('btn-terrain-view-rf-top')?.classList.remove('active');
      drawFresnel();
    });

    $('btn-terrain-view-rf-top')?.addEventListener('click', (e: any) => {
      e.stopPropagation();
      state.terrainProfileViewMode = 'rf-top';
      $('btn-terrain-view-rf-top')?.classList.add('active');
      $('btn-terrain-view-profile')?.classList.remove('active');
      $('btn-terrain-view-top')?.classList.remove('active');
      drawFresnel();
    });

    if (terrainCanvas) {
      terrainCanvas.style.cursor = 'grab';
      terrainCanvas.tabIndex = 0;

      const getTerrainLayout = () => {
        const w = terrainCanvas.parentElement?.clientWidth || 800;
        const h = terrainCanvas.parentElement?.clientHeight || 320;
        return { width: w, height: h, padL: 60, padR: 24, padT: 28, padB: 34 };
      };

      let isPanningTerrain = false;
      let panStartX = 0;
      let panStartY = 0;

      terrainCanvas.addEventListener('pointerdown', (e: any) => {
        e.stopPropagation();
        isPanningTerrain = true;
        panStartX = e.clientX;
        panStartY = e.clientY;
        terrainCanvas.style.cursor = 'grabbing';
        try {
          terrainCanvas.setPointerCapture(e.pointerId);
        } catch (_) {}
      });

      terrainCanvas.addEventListener('pointermove', (e: any) => {
        e.stopPropagation();
        if (!isPanningTerrain) {
          if (state.terrainProfileViewMode === 'profile') {
            const rect = terrainCanvas.getBoundingClientRect();
            const canvasX = e.clientX - rect.left;
            const tLay = getTerrainLayout();
            const f = state.latestTelemetry
              ? (state.latestTelemetry as TelemetryFrame & {
                  fresnel_slice?: FresnelSliceTelemetry | null;
                }).fresnel_slice ?? null
              : null;
            const prof =
              f && f.profile && f.profile.valid && f.profile.samples && f.profile.samples.length >= 2
                ? f.profile
                : null;
            if (prof && prof.samples) {
              const distKm = terrainProfileViewport.canvasToX(canvasX, tLay);
              let closest = null;
              let minDiff = Infinity;
              for (let i = 0; i < prof.samples.length; i++) {
                const s = prof.samples[i];
                const diff = Math.abs(s.horizontalGroundDistanceM / 1000 - distKm);
                if (diff < minDiff) {
                  minDiff = diff;
                  closest = s;
                }
              }
              if (closest) {
                state.profHoverInfo = {
                  canvasX,
                  distKm: closest.horizontalGroundDistanceM / 1000,
                  elevM: closest.terrainElevationMslM,
                  bulgeM:
                    closest.earthBulgeM ??
                    closest.effectiveTerrainElevationMslM - closest.terrainElevationMslM,
                  losM: closest.losElevationMslM,
                  clearanceM: closest.effectiveTerrainClearanceM,
                  nu: closest.nu ?? 0,
                };
                drawFresnel();
              }
            }
          }
          return;
        }
        const dx = e.clientX - panStartX;
        const dy = e.clientY - panStartY;
        panStartX = e.clientX;
        panStartY = e.clientY;
        if (state.terrainProfileViewMode === 'top' || state.terrainProfileViewMode === 'rf-top') {
          terrainTopViewport.pan(dx, dy, getTerrainLayout());
        } else {
          terrainProfileViewport.pan(dx, dy, getTerrainLayout());
        }
        drawFresnel();
      });

      terrainCanvas.addEventListener('pointerleave', () => {
        if (state.profHoverInfo) {
          state.profHoverInfo = null;
          drawFresnel();
        }
      });

      const endPanTerrain = (e: any) => {
        if (isPanningTerrain) {
          e.stopPropagation();
          isPanningTerrain = false;
          terrainCanvas.style.cursor = 'grab';
          try {
            terrainCanvas.releasePointerCapture(e.pointerId);
          } catch (_) {}
        }
      };
      terrainCanvas.addEventListener('pointerup', endPanTerrain);
      terrainCanvas.addEventListener('pointercancel', endPanTerrain);

      terrainCanvas.addEventListener(
        'wheel',
        (e: any) => {
          e.preventDefault();
          e.stopPropagation();
          const rect = terrainCanvas.getBoundingClientRect();
          const px = e.clientX - rect.left;
          const py = e.clientY - rect.top;
          const factor = e.deltaY < 0 ? 1.15 : 0.87;
          if (state.terrainProfileViewMode === 'top' || state.terrainProfileViewMode === 'rf-top') {
            terrainTopViewport.zoomAt(factor, px, py, getTerrainLayout());
          } else {
            terrainProfileViewport.zoomAt(factor, px, py, getTerrainLayout());
          }
          drawFresnel();
        },
        { passive: false }
      );

      terrainCanvas.addEventListener('dblclick', (e: any) => {
        e.preventDefault();
        e.stopPropagation();
        if (state.terrainProfileViewMode === 'top' || state.terrainProfileViewMode === 'rf-top') {
          terrainTopViewport.resetFit();
        } else {
          terrainProfileViewport.resetFit();
        }
        drawFresnel();
      });

      $('btn-terrain-zoom-in')?.addEventListener('click', (e: any) => {
        e.stopPropagation();
        if (state.terrainProfileViewMode === 'top' || state.terrainProfileViewMode === 'rf-top')
          terrainTopViewport.zoom(1.25);
        else terrainProfileViewport.zoom(1.25);
        drawFresnel();
      });

      $('btn-terrain-zoom-out')?.addEventListener('click', (e: any) => {
        e.stopPropagation();
        if (state.terrainProfileViewMode === 'top' || state.terrainProfileViewMode === 'rf-top')
          terrainTopViewport.zoom(0.8);
        else terrainProfileViewport.zoom(0.8);
        drawFresnel();
      });

      $('btn-terrain-reset-fit')?.addEventListener('click', (e: any) => {
        e.stopPropagation();
        if (state.terrainProfileViewMode === 'top' || state.terrainProfileViewMode === 'rf-top')
          terrainTopViewport.resetFit();
        else terrainProfileViewport.resetFit();
        drawFresnel();
      });
    }

    // Historical Timeline Scrubber Listeners
    const profScrubber = $('profile-history-scrubber');
    if (profScrubber) {
      profScrubber.addEventListener('input', (e: any) => {
        const targetFrame = parseInt(e.target.value, 10);
        if (!Number.isFinite(targetFrame)) return;

        const span = historyBuffer.getSpan();
        if (span.newestFrame !== null && targetFrame >= span.newestFrame) {
          (window as any).returnToLive();
          return;
        }

        if (!historyController.isInspecting) {
          const { shouldPauseWorker } = sessionCoordinator.onEnterHistorical({
            isCurrentlyRunning: !state.isPaused,
            rfInspecting: historyController.isInspecting,
            schedInspecting: schedHistoryController.isInspecting,
          });
          historyController.enterHistorical(targetFrame, sessionCoordinator.wasRunningBefore);
          dataCommVisualizer.enterHistorical();
          updateStepControlUI(false);
          if (shouldPauseWorker) {
            state.isPaused = true;
            actions.sendCommand({ type: 'SIM_CONTROL', action: 'pause' });
            const pauseBtn = $('btn-pause');
            if (pauseBtn) {
              pauseBtn.textContent = 'RESUME';
              pauseBtn.classList.add('active');
            }
          }
        } else {
          historyController.scrubTo(targetFrame);
          dataCommVisualizer.enterHistorical();
          updateStepControlUI(false);
        }

        syncHistoricalUIState();
      });
    }

    const histLiveBtn = $('btn-history-live');
    if (histLiveBtn) {
      histLiveBtn.addEventListener('click', (window as any).returnToLive);
    }

    const schedScrubber = $('sched-history-scrubber');
    if (schedScrubber) {
      schedScrubber.addEventListener('input', (e: any) => {
        const targetFrame = parseInt(e.target.value, 10);
        if (!Number.isFinite(targetFrame)) return;

        const span = schedHistoryBuffer.getSpan();
        if (span.newestFrame !== null && targetFrame >= span.newestFrame) {
          returnSchedulerToLive();
          return;
        }

        if (!schedHistoryController.isInspecting) {
          const { shouldPauseWorker } = sessionCoordinator.onEnterHistorical({
            isCurrentlyRunning: !state.isPaused,
            rfInspecting: historyController.isInspecting,
            schedInspecting: schedHistoryController.isInspecting,
          });
          schedHistoryController.enterHistorical(targetFrame, sessionCoordinator.wasRunningBefore);
          dataCommVisualizer.enterHistorical();
          updateStepControlUI(false);
          if (shouldPauseWorker) {
            state.isPaused = true;
            actions.sendCommand({ type: 'SIM_CONTROL', action: 'pause' });
            const pauseBtn = $('btn-pause');
            if (pauseBtn) {
              pauseBtn.textContent = 'RESUME';
              pauseBtn.classList.add('active');
            }
          }
        } else {
          schedHistoryController.scrubTo(targetFrame);
          dataCommVisualizer.enterHistorical();
          updateStepControlUI(false);
        }

        syncSchedulerHistoricalUIState();
      });
    }

    const schedLiveBtn = $('btn-sched-history-live');
    if (schedLiveBtn) {
      schedLiveBtn.addEventListener('click', returnSchedulerToLive);
    }
  }

  initTimelineController();
  setupWorkspaceResizing();
  setupScopeAndHistoryListeners();

  Object.assign(actions, {
    drawNetworkCharts,
    updateNetworkNodeOptions,
    ingestNetworkPerformance,
    updateStepControlUI,
    updatePauseButtonUI,
    recordHistoricalFrame,
    updateScrubberUI,
    syncHistoricalUIState,
    syncLiveUIState,
    recordSchedulerHistoricalFrame,
    updateSchedulerScrubberUI,
    syncSchedulerHistoricalUIState,
    syncSchedulerLiveUIState,
    returnSchedulerToLive,
    drawSchedulerCharts,
    drawPolarAntennaScope,
    drawLinkWaterfallCanvas,
    updateScientificAblationMatrix,
    drawEcdfDelayScope,
    drawSensitivitySweepScope,
    drawWaterfall,
    updatePduDissectorPanel,
    drawFresnel,
  });
}
