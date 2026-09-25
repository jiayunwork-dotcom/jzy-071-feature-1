<script lang="ts">
  import Toolbar from './components/Toolbar.svelte';
  import FemCanvas from './components/FemCanvas.svelte';
  import GeometryPanel from './components/GeometryPanel.svelte';
  import MaterialPanel from './components/MaterialPanel.svelte';
  import BcPanel from './components/BcPanel.svelte';
  import SolvePanel from './components/SolvePanel.svelte';
  import VibrationPanel from './components/VibrationPanel.svelte';
  import ResultPanel from './components/ResultPanel.svelte';
  import ModeViewPanel from './components/ModeViewPanel.svelte';
  import ConvergencePanel from './components/ConvergencePanel.svelte';
  import { statusMessage } from './store';
</script>

<div class="app">
  <header class="topbar">
    <div class="brand">
      <span class="logo">△</span>
      <div>
        <h1>FEM2D 二维有限元分析 · 静力与自由振动</h1>
        <p>平面应力 / 平面应变 · 三角常应变单元（CST）· 静力 K u=F 与模态 (K−ω²M)φ=0 · 教学可核验</p>
      </div>
    </div>
  </header>

  <div class="main">
    <aside class="sidebar">
      <GeometryPanel />
      <MaterialPanel />
      <BcPanel />
      <SolvePanel />
      <VibrationPanel />
    </aside>

    <section class="center">
      <Toolbar />
      <div class="canvas-container">
        <FemCanvas />
        {#if $statusMessage}
          <div class="status {$statusMessage.kind}">{$statusMessage.text}</div>
        {/if}
      </div>
    </section>

    <aside class="sidebar right">
      <ModeViewPanel />
      <ResultPanel />
      <ConvergencePanel />
    </aside>
  </div>
</div>

<style>
  :global(body) {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC',
      'Microsoft YaHei', sans-serif;
    background: #f1f5f9;
    color: #0f172a;
  }
  :global(*) { box-sizing: border-box; }
  .app { display: flex; flex-direction: column; height: 100vh; }
  .topbar {
    background: linear-gradient(135deg, #1e3a8a, #1e40af);
    color: white; padding: 8px 18px; flex-shrink: 0;
  }
  .brand { display: flex; align-items: center; gap: 12px; }
  .logo {
    font-size: 26px; background: rgba(255,255,255,0.15);
    width: 40px; height: 40px; display: grid; place-items: center; border-radius: 8px;
  }
  h1 { font-size: 16px; margin: 0; font-weight: 600; }
  .topbar p { margin: 2px 0 0; font-size: 11.5px; opacity: 0.82; }
  .main { flex: 1; display: flex; min-height: 0; }
  .sidebar {
    width: 300px; flex-shrink: 0; background: white;
    overflow-y: auto; border-right: 1px solid #e2e8f0;
  }
  .sidebar.right { border-right: none; border-left: 1px solid #e2e8f0; }
  .center { flex: 1; display: flex; flex-direction: column; min-width: 0; }
  .canvas-container { flex: 1; position: relative; min-height: 0; }
  .status {
    position: absolute; top: 12px; left: 50%; transform: translateX(-50%);
    padding: 9px 18px; border-radius: 8px; font-size: 13px;
    background: rgba(30,41,59,0.92); color: white; max-width: 80%;
    box-shadow: 0 6px 20px rgba(0,0,0,0.18); z-index: 10;
  }
  .status.error { background: #b91c1c; }
  .status.ok { background: #15803d; }
</style>
