<script lang="ts">
  import {
    polygon,
    mesh,
    globalSeed,
    setStatus,
    resetAll,
    toolMode,
    busy,
    supports,
    nodalLoads,
    tractionLoads,
    bodyLoad,
    material,
    result,
    referenceSolution,
  } from '../store';
  import { fetchMesh, fetchExample, fetchExamples, type ExampleSummary } from '../api';

  let tplKind = 'rectangle';
  let tplL = 100;
  let tplH = 20;

  let examples: ExampleSummary[] = [];
  fetchExamples().then((list) => (examples = list));

  async function generateMesh() {
    const poly = $polygon;
    if (poly.outer.length < 3) {
      setStatus('请先勾勒出至少 3 个顶点的封闭多边形', 'error');
      return;
    }
    busy.set(true);
    try {
      const m = await fetchMesh(poly, $globalSeed);
      mesh.set(m);
      setStatus(`网格生成成功：${m.stats.nodeCount} 节点 / ${m.stats.elementCount} 单元`, 'ok');
    } catch (e) {
      setStatus((e as Error).message, 'error', 8000);
    } finally {
      busy.set(false);
    }
  }

  function buildTemplate() {
    let outer: { x: number; y: number }[] = [];
    let holes: { x: number; y: number }[][] = [];
    if (tplKind === 'rectangle') {
      outer = [
        { x: 0, y: 0 }, { x: tplL, y: 0 }, { x: tplL, y: tplH }, { x: 0, y: tplH },
      ];
    } else if (tplKind === 'lShape') {
      const W = tplL, H = tplL, t = tplL / 3;
      outer = [
        { x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: t },
        { x: t, y: t }, { x: t, y: H }, { x: 0, y: H },
      ];
    } else if (tplKind === 'plateWithHole') {
      const W = tplL, H = tplH, r = Math.min(tplH / 4, tplL / 8);
      outer = [
        { x: -W / 2, y: -H / 2 }, { x: W / 2, y: -H / 2 },
        { x: W / 2, y: H / 2 }, { x: -W / 2, y: H / 2 },
      ];
      const hole: { x: number; y: number }[] = [];
      for (let i = 0; i < 24; i++) {
        const a = -2 * Math.PI * (i / 24);
        hole.push({ x: r * Math.cos(a), y: r * Math.sin(a) });
      }
      holes = [hole];
    } else if (tplKind === 'quarterPlateHole') {
      const r = Math.min(10, tplH / 4);
      const W = tplL, H = tplH;
      outer = [{ x: r, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }, { x: 0, y: r }];
      for (let i = 1; i < 20; i++) {
        const a = Math.PI / 2 - (Math.PI / 2) * (i / 20);
        outer.push({ x: r * Math.cos(a), y: r * Math.sin(a) });
      }
    }
    polygon.set({ outer, holes });
    mesh.set(null);
    toolMode.set('drag');
    setStatus('模板已生成，可切换到「拖动顶点」微调；调整种子后点击生成网格', 'ok');
  }

  async function loadExample(id: string) {
    busy.set(true);
    try {
      const ex = await fetchExample(id);
      polygon.set(ex.polygon);
      mesh.set(ex.mesh);
      globalSeed.set(ex.seed);
      supports.set(ex.supports);
      nodalLoads.set(ex.nodalLoads);
      tractionLoads.set(ex.tractionLoads);
      bodyLoad.set(ex.bodyLoad ?? { fx: 0, fy: 0 });
      material.set(ex.material);
      result.set(null);
      referenceSolution.set(ex.reference);
      setStatus(`已载入算例：${ex.name}`, 'ok');
    } catch (e) {
      setStatus((e as Error).message, 'error');
    } finally {
      busy.set(false);
    }
  }
</script>

<div class="panel">
  <h3>几何与网格</h3>

  <div class="group">
    <div class="group-title">参数化模板</div>
    <label>类型
      <select bind:value={tplKind}>
        <option value="rectangle">矩形梁</option>
        <option value="lShape">L 形截面</option>
        <option value="plateWithHole">带中心圆孔板</option>
        <option value="quarterPlateHole">四分之一带孔板</option>
      </select>
    </label>
    <div class="row">
      <label>长/宽 <input type="number" bind:value={tplL} /></label>
      <label>高 <input type="number" bind:value={tplH} /></label>
    </div>
    <button class="btn" on:click={buildTemplate}>生成模板轮廓</button>
  </div>

  <div class="group">
    <div class="group-title">标准算例（含参考解）</div>
    <select on:change={(e) => e.currentTarget.value && loadExample(e.currentTarget.value)}>
      <option value="">— 选择算例 —</option>
      {#each examples as ex}
        <option value={ex.id}>{ex.name}</option>
      {/each}
    </select>
  </div>

  <div class="group">
    <div class="group-title">网格种子</div>
    <label class="seed">
      全局种子间距
      <input type="range" min="1" max="30" step="0.5" bind:value={$globalSeed} />
      <span class="seed-val">{$globalSeed}</span>
    </label>
    <button class="btn primary" on:click={generateMesh} disabled={$busy || $polygon.outer.length < 3}>
      生成 / 重新剖分网格
    </button>
    <button class="btn ghost" on:click={resetAll}>清空全部</button>
  </div>

  {#if $mesh}
    <div class="group stats">
      <div class="group-title">网格统计</div>
      <table>
        <tr><td>节点数</td><td>{$mesh.stats.nodeCount}</td></tr>
        <tr><td>单元数</td><td>{$mesh.stats.elementCount}</td></tr>
        <tr><td>最小内角</td><td>{(($mesh.stats.minAngle * 180) / Math.PI).toFixed(1)}°</td></tr>
        <tr><td>最大内角</td><td>{(($mesh.stats.maxAngle * 180) / Math.PI).toFixed(1)}°</td></tr>
        <tr><td>平均单元质量</td><td>{$mesh.stats.meanQuality.toFixed(3)}</td></tr>
        <tr><td>最差单元质量</td><td>{$mesh.stats.minQuality.toFixed(3)}</td></tr>
      </table>
    </div>
  {/if}
</div>

<style>
  .panel { padding: 12px; }
  h3 { margin: 0 0 10px; font-size: 14px; color: #0f172a; }
  .group { margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px dashed #e2e8f0; }
  .group-title { font-size: 12px; font-weight: 600; color: #475569; margin-bottom: 8px; }
  label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: #475569; margin-bottom: 8px; }
  select, input[type='number'] {
    padding: 5px 8px; border: 1px solid #cbd5e1; border-radius: 5px; font-size: 13px;
  }
  .row { display: flex; gap: 8px; }
  .row label { flex: 1; }
  .btn {
    width: 100%; padding: 8px; border: 1px solid #cbd5e1; border-radius: 6px;
    background: #f1f5f9; cursor: pointer; font-size: 13px; margin-top: 4px;
  }
  .btn.primary { background: #2563eb; color: white; border-color: #1d4ed8; }
  .btn.ghost { background: transparent; color: #64748b; }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .seed { flex-direction: row; align-items: center; gap: 8px; }
  .seed input[type='range'] { flex: 1; }
  .seed-val { min-width: 32px; text-align: right; font-variant-numeric: tabular-nums; }
  .stats table { width: 100%; font-size: 12.5px; border-collapse: collapse; }
  .stats td { padding: 3px 0; color: #334155; }
  .stats td:last-child { text-align: right; font-variant-numeric: tabular-nums; }
</style>
