<script lang="ts">
  import {
    buildModelDTO,
    busy,
    result,
    setStatus,
    convergence,
    globalSeed,
  } from '../store';
  import { fetchAnalyze, fetchConvergence } from '../api';

  let convLevels = 5;

  async function solve() {
    busy.set(true);
    try {
      const model = buildModelDTO();
      const r = await fetchAnalyze(model);
      result.set(r);
      setStatus(
        `求解完成（${r.diagnostics.solver}，残差 ${r.diagnostics.residual.toExponential(2)}）：最大位移 ${r.maxDisplacement.toExponential(3)}，最大 von Mises ${r.maxVonMises.toFixed(2)}`,
        'ok',
        8000,
      );
    } catch (e) {
      result.set(null);
      setStatus((e as Error).message, 'error', 12000);
    } finally {
      busy.set(false);
    }
  }

  async function runConvergenceStudy() {
    busy.set(true);
    convergence.set(null);
    try {
      const model = buildModelDTO();
      const study = await fetchConvergence(model, $globalSeed, convLevels);
      convergence.set(study);
      if (study.error) setStatus(study.error, 'error');
      else setStatus(`收敛研究完成：共 ${study.levels.length} 级网格`, 'ok');
    } catch (e) {
      setStatus((e as Error).message, 'error', 10000);
    } finally {
      busy.set(false);
    }
  }
</script>

<div class="panel">
  <button class="solve" on:click={solve} disabled={$busy}>
    {$busy ? '计算中…' : '▶ 求解 Ku = F'}
  </button>
  <button class="btn" on:click={runConvergenceStudy} disabled={$busy}>
    网格无关性验证（{convLevels} 级加密）
  </button>
  <div class="levels">
    <label>加密级数
      <input type="range" min="2" max="7" step="1" bind:value={convLevels} />
      <span>{convLevels}</span>
    </label>
  </div>
</div>

<style>
  .panel { padding: 12px; border-bottom: 1px solid #e2e8f0; }
  .solve {
    width: 100%; padding: 11px; border: none; border-radius: 7px; cursor: pointer;
    background: linear-gradient(135deg, #2563eb, #1d4ed8); color: white;
    font-size: 15px; font-weight: 600; margin-bottom: 8px;
  }
  .solve:disabled { opacity: 0.6; cursor: wait; }
  .btn {
    width: 100%; padding: 8px; border: 1px solid #cbd5e1; border-radius: 6px;
    background: #f1f5f9; cursor: pointer; font-size: 13px;
  }
  .btn:disabled { opacity: 0.5; cursor: wait; }
  .levels { margin-top: 8px; }
  .levels label { display: flex; align-items: center; gap: 8px; font-size: 12px; color: #475569; }
  .levels input { flex: 1; }
</style>
