<script lang="ts">
  import {
    supports,
    nodalLoads,
    tractionLoads,
    bodyLoad,
    loadFx,
    loadFy,
    tractionTx,
    tractionTy,
  } from '../store';
  import type { Region } from '../types';

  let fxProxy = $loadFx;
  let fyProxy = $loadFy;
  let txProxy = $tractionTx;
  let tyProxy = $tractionTy;

  function regionLabel(r: Region): string {
    if (r.kind === 'point') return `点(${r.x.toFixed(1)}, ${r.y.toFixed(1)})`;
    if (r.kind === 'line')
      return `线(${r.x1.toFixed(1)},${r.y1.toFixed(1)})→(${r.x2.toFixed(1)},${r.y2.toFixed(1)})`;
    return '区域';
  }

  const supportLabel: Record<string, string> = {
    fixed: '固定',
    slideX: '水平滑移 ux=0',
    slideY: '竖直滑移 uy=0',
  };

  function removeSupport(id: string) {
    supports.update((l) => l.filter((s) => s.id !== id));
  }
  function removeLoad(id: string) {
    nodalLoads.update((l) => l.filter((s) => s.id !== id));
  }
  function removeTraction(id: string) {
    tractionLoads.update((l) => l.filter((s) => s.id !== id));
  }
</script>

<div class="panel">
  <h3>约束与载荷</h3>

  <div class="group">
    <div class="group-title">约束（{$supports.length}）</div>
    {#each $supports as s (s.id)}
      <div class="item">
        <span class="tag teal">{supportLabel[s.type]}</span>
        <span class="where">{regionLabel(s.region)}</span>
        <button class="x" on:click={() => removeSupport(s.id)}>×</button>
      </div>
    {:else}
      <div class="empty">选择顶部「约束」工具后在节点上点击</div>
    {/each}
  </div>

  <div class="group">
    <div class="group-title">节点集中力（{$nodalLoads.length}）</div>
    {#each $nodalLoads as l (l.id)}
      <div class="item">
        <span class="tag red">F=({l.fx}, {l.fy})</span>
        <span class="where">{regionLabel(l.region)}</span>
        <button class="x" on:click={() => removeLoad(l.id)}>×</button>
      </div>
    {:else}
      <div class="empty">选择「集中力」工具后在节点上点击</div>
    {/each}
  </div>

  <div class="group">
    <div class="group-title">分布面力（{$tractionLoads.length}）</div>
    {#each $tractionLoads as l (l.id)}
      <div class="item">
        <span class="tag orange">t=({l.tx}, {l.ty})</span>
        <span class="where">{regionLabel(l.region)}</span>
        <button class="x" on:click={() => removeTraction(l.id)}>×</button>
      </div>
    {:else}
      <div class="empty">选择「面力」工具，沿边界点击两点</div>
    {/each}
  </div>

  <div class="group">
    <div class="group-title">即将施加的集中力分量</div>
    <div class="row">
      <label>Fx <input type="number" step="any" bind:value={fxProxy} on:change={() => loadFx.set(fxProxy)} /></label>
      <label>Fy <input type="number" step="any" bind:value={fyProxy} on:change={() => loadFy.set(fyProxy)} /></label>
    </div>
    <div class="group-title" style="margin-top:8px">即将施加的面力分量（力/面积）</div>
    <div class="row">
      <label>tx <input type="number" step="any" bind:value={txProxy} on:change={() => tractionTx.set(txProxy)} /></label>
      <label>ty <input type="number" step="any" bind:value={tyProxy} on:change={() => tractionTy.set(tyProxy)} /></label>
    </div>
  </div>

  <div class="group">
    <div class="group-title">全域体力（如重力，力/体积）</div>
    <div class="row">
      <label>bx <input type="number" step="any" bind:value={$bodyLoad.fx} /></label>
      <label>by <input type="number" step="any" bind:value={$bodyLoad.fy} /></label>
    </div>
    <div class="tip">mm-N-MPa 单位制下钢的重力密度约 7.7×10⁻⁵ N/mm³（y 向上时 by 取负）。</div>
  </div>
</div>

<style>
  .panel { padding: 12px; }
  h3 { margin: 0 0 10px; font-size: 14px; }
  .group { margin-bottom: 14px; }
  .group-title { font-size: 12px; font-weight: 600; color: #475569; margin-bottom: 6px; }
  .item {
    display: flex; align-items: center; gap: 6px; padding: 4px 0;
    border-bottom: 1px dotted #e2e8f0; font-size: 12px;
  }
  .tag { padding: 2px 7px; border-radius: 4px; color: white; font-size: 11px; white-space: nowrap; }
  .teal { background: #0f766e; }
  .red { background: #dc2626; }
  .orange { background: #f97316; }
  .where { color: #64748b; flex: 1; font-size: 11px; }
  .x {
    border: none; background: transparent; color: #94a3b8; font-size: 16px;
    cursor: pointer; line-height: 1; padding: 0 4px;
  }
  .x:hover { color: #dc2626; }
  .empty, .tip { font-size: 11.5px; color: #94a3b8; padding: 2px 0; }
  .tip { margin-top: 4px; line-height: 1.5; }
  .row { display: flex; gap: 8px; }
  .row label { flex: 1; font-size: 11.5px; color: #475569; display: flex; align-items: center; gap: 4px; }
  input { width: 100%; padding: 4px 6px; border: 1px solid #cbd5e1; border-radius: 5px; font-size: 12.5px; }
</style>
