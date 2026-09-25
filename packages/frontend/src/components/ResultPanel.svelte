<script lang="ts">
  import {
    result,
    showDeformed,
    showStress,
    showOriginal,
    exaggeration,
    stressField,
    referenceSolution,
    mesh,
  } from '../store';
  import type { StressField } from '../types';
  import { legendStops } from '../lib/colormap';

  const fields: Array<{ id: StressField; label: string }> = [
    { id: 'sx', label: 'σx' },
    { id: 'sy', label: 'σy' },
    { id: 'txy', label: 'τxy' },
    { id: 'vm', label: 'von Mises' },
  ];

  $: currentMax = $result
    ? $stressField === 'sx'
      ? $result.maxSx
      : $stressField === 'sy'
        ? $result.maxSy
        : $stressField === 'txy'
          ? $result.maxTxy
          : $result.maxVonMises
    : 0;

  $: legend = $result ? legendStops(-currentMax, currentMax, 7) : [];
</script>

{#if $result}
  <div class="panel">
    <h3>后处理</h3>

    <label class="check"><input type="checkbox" bind:checked={$showDeformed} /> 显示变形图</label>
    {#if $showDeformed}
      <label class="check indent">
        <input type="checkbox" bind:checked={$showOriginal} /> 同时显示原始形状
      </label>
      <label class="slider">
        放大系数
        <input type="range" min="0" max="500" step="1" bind:value={$exaggeration} />
        <span>{$exaggeration}×</span>
      </label>
    {/if}

    <label class="check"><input type="checkbox" bind:checked={$showStress} /> 显示应力云图</label>

    {#if $showStress}
      <div class="field-switch">
        {#each fields as f}
          <button class:active={$stressField === f.id} on:click={() => stressField.set(f.id)}>
            {f.label}
          </button>
        {/each}
      </div>
      <div class="legend">
        {#each legend as s}
          <div class="legend-row">
            <span class="swatch" style="background:rgb({s.color.r},{s.color.g},{s.color.b})"></span>
            <span>{s.value.toFixed(2)}</span>
          </div>
        {/each}
      </div>
    {/if}

    <div class="results">
      <div class="group-title">结果摘要</div>
      <table>
        <tr><td>最大位移</td><td>{$result.maxDisplacement.toExponential(4)}</td></tr>
        <tr><td>max |σx|</td><td>{$result.maxSx.toFixed(3)}</td></tr>
        <tr><td>max |σy|</td><td>{$result.maxSy.toFixed(3)}</td></tr>
        <tr><td>max |τxy|</td><td>{$result.maxTxy.toFixed(3)}</td></tr>
        <tr><td>max von Mises</td><td>{$result.maxVonMises.toFixed(3)}</td></tr>
        <tr><td>约束自由度</td><td>{$result.diagnostics.constrainedDofs}</td></tr>
        <tr><td>求解器</td><td>{$result.diagnostics.solver}</td></tr>
        <tr><td>残差</td><td>{$result.diagnostics.residual.toExponential(2)}</td></tr>
      </table>
    </div>

    {#if $referenceSolution}
      <div class="reference">
        <div class="group-title">参考解析解 · {$referenceSolution.label}</div>
        <div class="formula">{$referenceSolution.formula}</div>
        {#if $referenceSolution.tipDisplacement !== undefined}
          <div class="ref-row">
            <span>理论端部挠度</span>
            <span>{$referenceSolution.tipDisplacement.toFixed(5)}</span>
          </div>
          <div class="ref-row">
            <span>FEM 最大位移</span>
            <span>{$result.maxDisplacement.toFixed(5)}</span>
          </div>
          <div class="ref-row">
            <span>偏差</span>
            <span class:good={
              Math.abs($result.maxDisplacement - $referenceSolution.tipDisplacement) /
                $referenceSolution.tipDisplacement < 0.15
            }>
              {(
                (Math.abs($result.maxDisplacement - $referenceSolution.tipDisplacement) /
                  $referenceSolution.tipDisplacement) *
                100
              ).toFixed(1)}%
            </span>
          </div>
        {/if}
        {#if $referenceSolution.maxStress !== undefined}
          <div class="ref-row">
            <span>理论特征应力</span>
            <span>{$referenceSolution.maxStress.toFixed(3)}</span>
          </div>
        {/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  .panel { padding: 12px; border-bottom: 1px solid #e2e8f0; }
  h3 { margin: 0 0 10px; font-size: 14px; }
  .check { display: flex; align-items: center; gap: 8px; font-size: 13px; color: #334155; margin-bottom: 6px; }
  .check.indent { padding-left: 20px; font-size: 12px; color: #64748b; }
  .slider { display: flex; align-items: center; gap: 8px; font-size: 12px; color: #475569; margin: 6px 0 10px 20px; }
  .slider input { flex: 1; }
  .field-switch { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; margin: 8px 0; }
  .field-switch button {
    padding: 6px 2px; border: 1px solid #cbd5e1; background: #f8fafc;
    border-radius: 5px; cursor: pointer; font-size: 12px;
  }
  .field-switch button.active { background: #2563eb; color: white; border-color: #1d4ed8; }
  .legend {
    display: flex; flex-direction: column; gap: 2px; margin: 6px 0 10px;
    font-size: 11px; color: #475569;
  }
  .legend-row { display: flex; align-items: center; gap: 8px; }
  .swatch { width: 26px; height: 10px; border: 1px solid rgba(0,0,0,0.15); display: inline-block; }
  .results { margin-top: 8px; }
  .group-title { font-size: 12px; font-weight: 600; color: #475569; margin: 8px 0 4px; }
  table { width: 100%; font-size: 12.5px; border-collapse: collapse; }
  td { padding: 2px 0; color: #334155; }
  td:last-child { text-align: right; font-variant-numeric: tabular-nums; }
  .reference {
    margin-top: 10px; padding: 8px 10px; background: #fef9c3;
    border-left: 3px solid #ca8a04; border-radius: 4px;
  }
  .formula { font-size: 11.5px; color: #713f12; margin-bottom: 6px; line-height: 1.5; }
  .ref-row {
    display: flex; justify-content: space-between; font-size: 12px;
    color: #422006; padding: 2px 0;
  }
  .good { color: #15803d; font-weight: 600; }
</style>
