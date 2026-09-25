<script lang="ts">
  import { material } from '../store';
</script>

<div class="panel">
  <h3>材料（线弹性）</h3>
  <label>弹性模量 E（MPa）
    <input type="number" step="any" bind:value={$material.E} />
  </label>
  <label>泊松比 ν
    <input type="number" step="0.01" min="0" max="0.49" bind:value={$material.nu} />
  </label>
  <label>厚度 t（mm，平面应力）
    <input type="number" step="any" bind:value={$material.thickness} />
  </label>
  <label>质量密度 ρ（kg/mm³，自由振动用）
    <input
      type="number"
      step="any"
      bind:value={$material.rho}
      placeholder="7.85e-6（钢）"
    />
  </label>

  <div class="model-switch">
    <button
      class:active={$material.model === 'planeStress'}
      on:click={() => ($material = { ...$material, model: 'planeStress' })}
    >
      平面应力
    </button>
    <button
      class:active={$material.model === 'planeStrain'}
      on:click={() => ($material = { ...$material, model: 'planeStrain' })}
    >
      平面应变
    </button>
  </div>

  <div class="note">
    {#if $material.model === 'planeStress'}
      D = E/(1−ν²) · [1, ν, 0; ν, 1, 0; 0, 0, (1−ν)/2]
    {:else}
      D = E/((1+ν)(1−2ν)) · [1−ν, ν, 0; ν, 1−ν, 0; 0, 0, (1−2ν)/2]
    {/if}
    <div class="rho-note">质量矩阵按 ρ 装配；钢在 mm-N-MPa 单位制下 ρ = 7.85×10⁻⁶ kg/mm³。</div>
  </div>
</div>

<style>
  .panel { padding: 12px; border-bottom: 1px solid #e2e8f0; }
  h3 { margin: 0 0 10px; font-size: 14px; }
  label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: #475569; margin-bottom: 10px; }
  input { padding: 5px 8px; border: 1px solid #cbd5e1; border-radius: 5px; font-size: 13px; }
  .model-switch { display: flex; gap: 0; border: 1px solid #cbd5e1; border-radius: 6px; overflow: hidden; }
  .model-switch button {
    flex: 1; padding: 7px; border: none; background: #f8fafc; cursor: pointer; font-size: 13px;
  }
  .model-switch button.active { background: #2563eb; color: white; }
  .note {
    margin-top: 8px; font-size: 11px; color: #64748b; line-height: 1.5;
    font-family: ui-monospace, monospace; word-break: break-all;
  }
  .rho-note { margin-top: 4px; font-family: inherit; color: #94a3b8; }
</style>
