<script lang="ts">
  import { toolMode, supportType } from '../store';
  import type { ToolMode } from '../types';

  const tools: Array<{ id: ToolMode; label: string; icon: string; needsMesh?: boolean }> = [
    { id: 'draw', label: '绘制轮廓', icon: '✎' },
    { id: 'drag', label: '拖动顶点', icon: '✥' },
    { id: 'support', label: '约束', icon: '⏚', needsMesh: true },
    { id: 'load', label: '集中力', icon: '↓', needsMesh: true },
    { id: 'traction', label: '面力', icon: '⇉', needsMesh: true },
    { id: 'pan', label: '平移', icon: '✋' },
  ];
</script>

<div class="toolbar">
  {#each tools as t}
    <button
      class="tool"
      class:active={$toolMode === t.id}
      title={t.label}
      on:click={() => toolMode.set(t.id)}
    >
      <span class="icon">{t.icon}</span>
      <span>{t.label}</span>
    </button>
  {/each}

  {#if $toolMode === 'support'}
    <select bind:value={$supportType} class="mini-select">
      <option value="fixed">固定 (ux=uy=0)</option>
      <option value="slideX">水平滑移 (ux=0)</option>
      <option value="slideY">竖直滑移 (uy=0)</option>
    </select>
  {/if}
</div>

<style>
  .toolbar {
    display: flex;
    gap: 6px;
    align-items: center;
    flex-wrap: wrap;
    padding: 8px 12px;
    background: #fff;
    border-bottom: 1px solid #e2e8f0;
  }
  .tool {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 6px 10px;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    background: #f8fafc;
    cursor: pointer;
    font-size: 13px;
    color: #334155;
  }
  .tool:hover { background: #eff6ff; }
  .tool.active {
    background: #2563eb;
    color: white;
    border-color: #1d4ed8;
  }
  .icon { font-size: 15px; line-height: 1; }
  .mini-select {
    margin-left: 8px;
    padding: 5px 8px;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    font-size: 13px;
  }
</style>
