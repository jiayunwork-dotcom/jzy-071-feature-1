<script lang="ts">
  import {
    vibrationResult,
    selectedModeOrder,
    modeExaggeration,
    modeAnimate,
    showOriginalMeshInMode,
  } from '../store';

  $: selected = $vibrationResult?.modes.find((m) => m.order === $selectedModeOrder) ?? null;
</script>

{#if $vibrationResult && selected}
  <div class="panel mode-panel">
    <h3>
      模态振型 · 第 {selected.order} 阶
      <span class="badge">{selected.xKineticFraction > 0.7 ? '纵向' : '弯曲'}</span>
    </h3>

    <div class="freq-big">
      <div><span class="num">{selected.frequencyHz.toFixed(3)}</span><span class="unit">Hz</span></div>
      <div class="omega">ω = {selected.omega.toFixed(2)} rad/s</div>
    </div>

    <label class="check">
      <input type="checkbox" bind:checked={$showOriginalMeshInMode} />
      叠加原始网格
    </label>
    <label class="check">
      <input type="checkbox" bind:checked={$modeAnimate} />
      来回摆动动画
    </label>

    <label class="slider">
      振型放大系数
      <input type="range" min="0" max="200" step="0.5" bind:value={$modeExaggeration} />
      <span>{$modeExaggeration}×</span>
    </label>

    <div class="nav">
      <button
        disabled={selected.order <= 1}
        on:click={() => selectedModeOrder.set(selected.order - 1)}
      >‹ 上一阶</button>
      <span class="page">{selected.order} / {$vibrationResult.modes.length}</span>
      <button
        disabled={selected.order >= $vibrationResult.modes.length}
        on:click={() => selectedModeOrder.set(selected.order + 1)}
      >下一阶 ›</button>
    </div>

    <div class="note">
      振型只表示各节点的<b>相对</b>运动方向与比例，已按质量矩阵归一（φᵀMφ=1），
      幅值本身没有物理意义——用放大系数把形状放大到可辨。动画按
      u(t) = φ·sin(ωt) 摆动。
    </div>
  </div>
{/if}

<style>
  .mode-panel { background: #f0fdfa; border-bottom: 1px solid #99f6e4; }
  h3 { margin: 0 0 8px; font-size: 14px; color: #115e59; display: flex; align-items: center; gap: 8px; }
  .badge {
    font-size: 10.5px; font-weight: 600; background: #0f766e; color: white;
    padding: 2px 8px; border-radius: 10px;
  }
  .freq-big { margin-bottom: 10px; }
  .num { font-size: 26px; font-weight: 700; color: #0f766e; font-variant-numeric: tabular-nums; }
  .unit { font-size: 13px; color: #0f766e; margin-left: 4px; }
  .omega { font-size: 12px; color: #0d9488; font-variant-numeric: tabular-nums; }
  .check { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: #134e4a; margin-bottom: 6px; }
  .slider { display: flex; align-items: center; gap: 8px; font-size: 12px; color: #134e4a; margin: 6px 0 10px; }
  .slider input { flex: 1; }
  .nav { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
  .nav button {
    padding: 6px 10px; border: 1px solid #5eead4; background: white; border-radius: 6px;
    cursor: pointer; font-size: 12px; color: #0f766e;
  }
  .nav button:disabled { opacity: 0.4; cursor: default; }
  .page { font-size: 12px; color: #0f766e; font-variant-numeric: tabular-nums; }
  .note { font-size: 11px; color: #0f766e; line-height: 1.6; opacity: 0.85; }
</style>
