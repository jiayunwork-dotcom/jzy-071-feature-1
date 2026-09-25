<script lang="ts">
  import {
    buildModelDTO,
    busy,
    setStatus,
    vibrationResult,
    vibrationModeCount,
    vibrationMassType,
    selectedModeOrder,
    vibrationReference,
  } from '../store';
  import { fetchVibration } from '../api';

  async function solveVibration() {
    busy.set(true);
    vibrationResult.set(null);
    selectedModeOrder.set(null);
    try {
      const model = buildModelDTO();
      const r = await fetchVibration(model, $vibrationModeCount, $vibrationMassType);
      vibrationResult.set(r);
      if (r.modes.length > 0) selectedModeOrder.set(r.modes[0].order);
      const rigidNote = r.rigidBodyModes > 0
        ? `（已识别并剔除 ${r.rigidBodyModes} 个刚体模态）`
        : '';
      setStatus(
        `自由振动完成：${r.modes.length} 阶弹性模态${rigidNote}，` +
          `一阶 ${r.modes[0]?.frequencyHz.toFixed(2) ?? '—'} Hz，` +
          `正交性误差 ${r.diagnostics.maxCrossOrthogonality.toExponential(1)}`,
        'ok',
        9000,
      );
    } catch (e) {
      setStatus((e as Error).message, 'error', 12000);
    } finally {
      busy.set(false);
    }
  }

  // 频率对照：把解析参考与 FEM 模态按「性质 + 次序」粗略配对显示
  function refFor(kind: 'bending' | 'longitudinal' | 'other', seen: Map<string, number>) {
    if (!$vibrationReference) return undefined;
    const list = $vibrationReference.frequencies.filter((f) => f.kind === kind);
    const idx = seen.get(kind) ?? 0;
    seen.set(kind, idx + 1);
    return list[idx];
  }

  let seenMap: Map<string, number>;
  $: seenMap = new Map();
</script>

<div class="panel">
  <h3>自由振动分析</h3>
  <p class="sub">求解 (K − ω²M)φ = 0，取最低若干阶弹性模态。</p>

  <button class="solve" on:click={solveVibration} disabled={$busy}>
    {$busy ? '特征值求解中…' : '∿ 求解固有频率与振型'}
  </button>

  <label class="row">
    所求阶数
    <input type="number" min="1" max="30" step="1" bind:value={$vibrationModeCount} />
  </label>

  <div class="mass-switch">
    <button
      class:active={$vibrationMassType === 'consistent'}
      on:click={() => (vibrationMassType.set('consistent'))}
      title="保留单元内耦合，非对角；系统性偏柔、频率偏低"
    >
      一致质量（非对角）
    </button>
    <button
      class:active={$vibrationMassType === 'lumped'}
      on:click={() => (vibrationMassType.set('lumped'))}
      title="集中到节点的纯对角质量；系统性偏刚、频率偏高"
    >
      集中质量（对角）
    </button>
  </div>

  {#if $vibrationResult}
    <div class="meta">
      <span>自由自由度 {$vibrationResult.freeDofs}</span>
      <span>约束 {$vibrationResult.constrainedDofs}</span>
      <span>刚体剔除 {$vibrationResult.rigidBodyModes}</span>
    </div>

    <table class="freqs">
      <thead>
        <tr><th>阶</th><th>Hz</th><th>rad/s</th><th>类型</th>{#if $vibrationReference}<th>解析</th>{/if}</tr>
      </thead>
      <tbody>
        {#each $vibrationResult.modes as m (m.order)}
          {@const isLong = m.xKineticFraction > 0.7}
          {@const ref = $vibrationReference ? refFor(isLong ? 'longitudinal' : 'bending', seenMap) : undefined}
          <tr
            class:selected={$selectedModeOrder === m.order}
            on:click={() => selectedModeOrder.set(m.order)}
          >
            <td class="ord">{$selectedModeOrder === m.order ? '▶ ' : ''}{m.order}</td>
            <td>{m.frequencyHz.toFixed(3)}</td>
            <td>{m.omega.toFixed(2)}</td>
            <td class="kind">{isLong ? '纵向' : '弯曲'}</td>
            {#if $vibrationReference}
              <td class:close={ref && Math.abs(m.frequencyHz - ref.hz) / ref.hz < 0.1}>
                {ref ? `${ref.hz.toFixed(2)}` : '—'}
              </td>
            {/if}
          </tr>
        {/each}
      </tbody>
    </table>

    <div class="diag">
      迭代 {$vibrationResult.diagnostics.iterations} 步 ·
      总质量 {$vibrationResult.diagnostics.totalMass.toExponential(3)} ·
      最大质量正交误差 {$vibrationResult.diagnostics.maxCrossOrthogonality.toExponential(1)}
    </div>
  {/if}

  {#if $vibrationReference}
    <div class="reference">
      <div class="group-title">频率解析参考 · {$vibrationReference.label}</div>
      <div class="formula">{$vibrationReference.formula}</div>
    </div>
  {/if}
</div>

<style>
  .panel { padding: 12px; border-bottom: 1px solid #e2e8f0; }
  h3 { margin: 0 0 4px; font-size: 14px; }
  .sub { margin: 0 0 10px; font-size: 11.5px; color: #64748b; }
  .solve {
    width: 100%; padding: 11px; border: none; border-radius: 7px; cursor: pointer;
    background: linear-gradient(135deg, #0d9488, #0f766e); color: white;
    font-size: 14px; font-weight: 600; margin-bottom: 8px;
  }
  .solve:disabled { opacity: 0.6; cursor: wait; }
  .row {
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    font-size: 12px; color: #475569; margin-bottom: 8px;
  }
  .row input { width: 70px; padding: 5px 8px; border: 1px solid #cbd5e1; border-radius: 5px; }
  .mass-switch { display: flex; gap: 0; border: 1px solid #cbd5e1; border-radius: 6px; overflow: hidden; }
  .mass-switch button {
    flex: 1; padding: 7px 4px; border: none; background: #f8fafc; cursor: pointer; font-size: 11.5px;
  }
  .mass-switch button.active { background: #0f766e; color: white; }
  .meta { display: flex; gap: 10px; flex-wrap: wrap; font-size: 11px; color: #64748b; margin: 10px 0 6px; }
  table.freqs { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 4px; }
  .freqs th { text-align: left; color: #64748b; font-weight: 600; padding: 3px 4px; border-bottom: 1px solid #e2e8f0; }
  .freqs td { padding: 4px; font-variant-numeric: tabular-nums; color: #334155; }
  .freqs tbody tr { cursor: pointer; }
  .freqs tbody tr:hover { background: #f0fdfa; }
  .freqs tr.selected { background: #ccfbf1; }
  .freqs .ord { color: #0f766e; font-weight: 600; }
  .freqs .kind { color: #94a3b8; font-size: 11px; }
  td.close { color: #15803d; font-weight: 600; }
  .diag { margin-top: 8px; font-size: 10.5px; color: #94a3b8; line-height: 1.5; }
  .reference {
    margin-top: 10px; padding: 8px 10px; background: #f0fdfa;
    border-left: 3px solid #0d9488; border-radius: 4px;
  }
  .group-title { font-size: 12px; font-weight: 600; color: #115e59; margin-bottom: 4px; }
  .formula { font-size: 11px; color: #134e4a; line-height: 1.5; font-family: ui-monospace, monospace; }
</style>
