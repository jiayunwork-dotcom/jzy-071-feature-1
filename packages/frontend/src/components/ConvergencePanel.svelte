<script lang="ts">
  import { convergence } from '../store';

  $: levels = $convergence?.levels ?? [];
  $: metric = 'maxVonMises';

  $: lastChange = levels.length >= 2
    ? Math.abs(levels[levels.length - 1].maxVonMises - levels[levels.length - 2].maxVonMises) /
      levels[levels.length - 1].maxVonMises
    : null;

  $: chart = (() => {
    if (levels.length < 2) return null;
    const xs = levels.map((l) => l.elementCount);
    const ys = levels.map((l) => l.maxVonMises);
    const xmin = Math.min(...xs), xmax = Math.max(...xs);
    const ymin = Math.min(...ys) * 0.98, ymax = Math.max(...ys) * 1.02;
    const W = 260, H = 170, padL = 42, padB = 28, padT = 10, padR = 10;
    const px = (x: number) => padL + ((x - xmin) / (xmax - xmin || 1)) * (W - padL - padR);
    const py = (y: number) => H - padB - ((y - ymin) / (ymax - ymin || 1)) * (H - padB - padT);
    const path = ys.map((y, i) => `${i === 0 ? 'M' : 'L'}${px(xs[i]).toFixed(1)},${py(y).toFixed(1)}`).join(' ');
    const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => {
      const val = ymin + t * (ymax - ymin);
      return { val, y: py(val) };
    });
    return { W, H, padL, padB, path, points: xs.map((x, i) => ({ x: px(x), y: py(ys[i]), v: ys[i], n: x })), yTicks, xmin, xmax, ymin, ymax };
  })();
</script>

{#if $convergence}
  <div class="panel">
    <h3>网格无关性曲线</h3>
    {#if $convergence.error}
      <div class="err">{$convergence.error}</div>
    {/if}
    {#if chart}
      <svg viewBox="0 0 {chart.W} {chart.H}" class="chart">
        <!-- 坐标轴 -->
        <line x1="{chart.padL}" y1="10" x2="{chart.padL}" y2="{chart.H - chart.padB}" stroke="#94a3b8" />
        <line x1="{chart.padL}" y1="{chart.H - chart.padB}" x2="{chart.W - 8}" y2="{chart.H - chart.padB}" stroke="#94a3b8" />
        {#each chart.yTicks as tk}
          <line x1="{chart.padL - 3}" y1="{tk.y}" x2="{chart.W - 8}" y2="{tk.y}" stroke="#e2e8f0" stroke-dasharray="3,3" />
          <text x="{chart.padL - 5}" y="{tk.y + 3}" text-anchor="end" font-size="9" fill="#64748b">{tk.val.toFixed(1)}</text>
        {/each}
        <path d={chart.path} fill="none" stroke="#2563eb" stroke-width="2" />
        {#each chart.points as p}
          <circle cx="{p.x}" cy="{p.y}" r="3.5" fill="#2563eb" />
          <title>单元数 {p.n}，σ_vm = {p.v.toFixed(3)}</title>
        {/each}
        <text x="{chart.W / 2}" y="{chart.H - 6}" text-anchor="middle" font-size="10" fill="#475569">单元数 →</text>
        <text transform="translate(12,{chart.H / 2}) rotate(-90)" text-anchor="middle" font-size="10" fill="#475569">最大 von Mises 应力</text>
      </svg>

      <table>
        <thead>
          <tr><th>级</th><th>种子</th><th>单元数</th><th>σ_vm max</th><th>位移 max</th></tr>
        </thead>
        {#each levels as l}
          <tr>
            <td>{l.level}</td>
            <td>{l.seed.toFixed(2)}</td>
            <td>{l.elementCount}</td>
            <td>{l.maxVonMises.toFixed(3)}</td>
            <td>{l.maxDisplacement.toExponential(3)}</td>
          </tr>
        {/each}
      </table>
      {#if levels.length >= 2 && lastChange !== null}
        <div class="note">
          最细两级最大应力变化：<b class:good={lastChange < 0.05}>{(lastChange * 100).toFixed(2)}%</b>
          {lastChange < 0.05} —— 已接近网格无关解。
        </div>
      {/if}
    {/if}
  </div>
{/if}

<style>
  .panel { padding: 12px; }
  h3 { margin: 0 0 10px; font-size: 14px; }
  .chart { width: 100%; background: #fcfdff; border: 1px solid #e2e8f0; border-radius: 6px; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 11.5px; }
  th, td { padding: 3px 4px; text-align: right; border-bottom: 1px solid #f1f5f9; color: #334155; }
  th { color: #64748b; font-weight: 600; }
  th:first-child, td:first-child { text-align: left; }
  .note { margin-top: 8px; font-size: 12px; color: #475569; }
  .good { color: #15803d; }
  .err { color: #b91c1c; font-size: 12px; }
</style>
