<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import {
    toolMode,
    polygon,
    mesh,
    supports,
    nodalLoads,
    tractionLoads,
    result,
    showDeformed,
    showStress,
    showOriginal,
    exaggeration,
    stressField,
    supportType,
    loadFx,
    loadFy,
    tractionTx,
    tractionTy,
    nextId,
    setStatus,
    selectedVertex,
  } from '../store';
  import { drawPolygon, drawMesh, drawVertexHandle } from '../lib/render-mesh';
  import { drawSupports, drawNodalLoads, drawTractionLoads } from '../lib/render-bc';
  import { drawStressContour, deformedPositions, drawDeformedWire } from '../lib/render-result';
  import { fitView, makeView, toScreen, toWorld, type View } from '../lib/view';
  import { bounds, dist } from '../lib/util';
  import type { Vec2 } from '../types';

  let canvas: HTMLCanvasElement;
  let ctx: CanvasRenderingContext2D;
  let view: View = makeView(900, 640);
  let raf = 0;
  let worldMouse: Vec2 = { x: 0, y: 0 };

  // 交互临时状态
  let dragVertex = -1;
  let panning = false;
  let panStart = { x: 0, y: 0, cx: 0, cy: 0 };
  let tractionFirst: Vec2 | null = null;
  let drawHoverFirst = false;

  function resize() {
    const parent = canvas.parentElement!;
    const dpr = window.devicePixelRatio || 1;
    const w = parent.clientWidth;
    const h = parent.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    view.width = w;
    view.height = h;
  }

  function autoFit(points: Vec2[]) {
    if (points.length >= 2) view = fitView(view, bounds(points));
  }

  function loop() {
    render();
    raf = requestAnimationFrame(loop);
  }

  function snapTol(): number {
    const m = $mesh;
    if (!m) return 1e9;
    let sum = 0;
    for (const [a, b] of m.boundaryEdges) {
      sum += dist(m.nodes[a], m.nodes[b]);
    }
    return Math.max((sum / Math.max(1, m.boundaryEdges.length)) * 0.8, 1e-6);
  }

  function render() {
    const w = view.width, h = view.height;
    ctx.clearRect(0, 0, w, h);
    drawGridPaper(ctx, view);

    const curMesh = $mesh;
    const curResult = $result;
    const $poly = $polygon;

    if (curResult && $showStress) {
      const def =
        $showDeformed
          ? deformedPositions(curMesh!, curResult.displacement, $exaggeration)
          : null;
      const vals = curResult.elementStresses.map((e) =>
        $stressField === 'vm' ? e.vonMises : e[$stressField],
      );
      const vmin = Math.min(...vals);
      const vmax = Math.max(...vals);
      drawStressContour(ctx, view, curMesh!, curResult, $stressField, def, vmin, vmax);
    } else if (curMesh) {
      drawMesh(ctx, view, curMesh, { showNodes: true, fill: true });
    }

    if (!$mesh && $poly.outer.length > 0) {
      const closed = $poly.outer.length >= 3;
      drawPolygon(ctx, view, $poly, closed);
    }

    // 变形图叠加
    if ($result && $mesh && $showDeformed && !$showStress) {
      const def = deformedPositions($mesh, $result.displacement, $exaggeration);
      if ($showOriginal) drawMesh(ctx, view, $mesh, { edgeColor: 'rgba(71,85,105,0.5)' });
      drawDeformedWire(ctx, view, $mesh, def);
    }

    // 原始轮廓（云图模式下叠加边界）
    if ($mesh && $showStress && $showOriginal) {
      drawBoundaryOnly(ctx, $mesh);
    }

    // 约束与载荷
    if ($mesh) {
      const tol = snapTol();
      drawSupports(ctx, view, $mesh, $supports, tol);
      const loadRef = Math.max(1, ...$nodalLoads.map((l) => Math.hypot(l.fx, l.fy)));
      drawNodalLoads(ctx, view, $mesh, $nodalLoads, tol, loadRef);
      const trRef = Math.max(1, ...$tractionLoads.map((l) => Math.hypot(l.tx, l.ty)));
      drawTractionLoads(ctx, view, $tractionLoads, trRef);
    }

    // 绘制模式下跟随鼠标的预览线
    if ($toolMode === 'draw' && !$mesh && $poly.outer.length > 0) {
      const last = $poly.outer[$poly.outer.length - 1];
      const [x0, y0] = toScreen(view, last.x, last.y);
      const [x1, y1] = toScreen(view, worldMouse.x, worldMouse.y);
      ctx.save();
      ctx.strokeStyle = 'rgba(37,99,235,0.5)';
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
      ctx.restore();
      // 悬停起点高亮
      drawHoverFirst = dist(worldMouse, $poly.outer[0]) < pickRadiusWorld();
      if (drawHoverFirst) drawVertexHandle(ctx, view, $poly.outer[0], true);
    }

    // 面力第一段的预览
    if (tractionFirst) {
      const [x0, y0] = toScreen(view, tractionFirst.x, tractionFirst.y);
      const [x1, y1] = toScreen(view, worldMouse.x, worldMouse.y);
      ctx.save();
      ctx.strokeStyle = '#f97316';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawBoundaryOnly(ctx: CanvasRenderingContext2D, m: NonNullable<typeof $mesh>) {
    ctx.save();
    ctx.strokeStyle = 'rgba(15,23,42,0.6)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (const [a, b] of m.boundaryEdges) {
      const [x0, y0] = toScreen(view, m.nodes[a].x, m.nodes[a].y);
      const [x1, y1] = toScreen(view, m.nodes[b].x, m.nodes[b].y);
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawGridPaper(ctx: CanvasRenderingContext2D, v: View) {
    ctx.save();
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, v.width, v.height);
    // 简化网格：固定屏幕间距
    const step = 40;
    ctx.strokeStyle = 'rgba(148,163,184,0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x < v.width; x += step) {
      ctx.moveTo(x, 0); ctx.lineTo(x, v.height);
    }
    for (let y = 0; y < v.height; y += step) {
      ctx.moveTo(0, y); ctx.lineTo(v.width, y);
    }
    ctx.stroke();
    // 坐标轴
    const [ax, ay] = toScreen(v, 0, 0);
    ctx.strokeStyle = 'rgba(100,116,139,0.5)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(0, ay); ctx.lineTo(v.width, ay);
    ctx.moveTo(ax, 0); ctx.lineTo(ax, v.height);
    ctx.stroke();
    ctx.restore();
  }

  function pickRadiusWorld(): number {
    return 12 / view.scale;
  }

  function getMouse(e: PointerEvent): Vec2 {
    const rect = canvas.getBoundingClientRect();
    const [wx, wy] = toWorld(view, e.clientX - rect.left, e.clientY - rect.top);
    return { x: wx, y: wy };
  }

  function findVertex(p: Vec2): number {
    const loop = $polygon.outer;
    const r = pickRadiusWorld();
    for (let i = 0; i < loop.length; i++) if (dist(p, loop[i]) < r) return i;
    return -1;
  }

  function onPointerDown(e: PointerEvent) {
    const p = getMouse(e);
    worldMouse = p;
    canvas.setPointerCapture(e.pointerId);

    if (e.button === 1 || e.shiftKey || $toolMode === 'pan') {
      panning = true;
      panStart = { x: e.clientX, y: e.clientY, cx: view.cx, cy: view.cy };
      return;
    }

    const $m = $mesh;

    if ($toolMode === 'draw' && !$m) {
      handleDrawClick(p, e);
    } else if ($toolMode === 'drag' && !$m) {
      dragVertex = findVertex(p);
      if (dragVertex >= 0) selectedVertex.set(dragVertex);
    } else if ($m && $toolMode === 'support') {
      addSupportAt(p, e.altKey);
    } else if ($m && $toolMode === 'load') {
      addLoadAt(p);
    } else if ($m && $toolMode === 'traction') {
      if (!tractionFirst) tractionFirst = p;
      else {
        addTractionLine(tractionFirst, p);
        tractionFirst = null;
      }
    }
  }

  function handleDrawClick(p: Vec2, e: PointerEvent) {
    const loop = $polygon.outer;
    // 点击起点闭合
    if (loop.length >= 3 && dist(p, loop[0]) < pickRadiusWorld()) {
      polygon.update((poly) => ({ ...poly, outer: [...poly.outer] }));
      setStatus('多边形已闭合，点击「生成网格」进行三角剖分', 'ok');
      return;
    }
    polygon.update((poly) => ({ ...poly, outer: [...poly.outer, p] }));
    autoFit([...loop, p]);
    if (e.detail === 2 && $polygon.outer.length >= 3) {
      setStatus('多边形已闭合，点击「生成网格」进行三角剖分', 'ok');
    }
  }

  function onPointerMove(e: PointerEvent) {
    const p = getMouse(e);
    worldMouse = p;
    if (panning) {
      const dx = e.clientX - panStart.x;
      const dy = e.clientY - panStart.y;
      view = { ...view, cx: panStart.cx - dx / view.scale, cy: panStart.cy + dy / view.scale };
      return;
    }
    if (dragVertex >= 0) {
      polygon.update((poly) => {
        const outer = poly.outer.slice();
        outer[dragVertex] = p;
        return { ...poly, outer };
      });
      // 拖动顶点后网格失效
      if ($mesh) {
        mesh.set(null);
        supports.set([]);
        nodalLoads.set([]);
        tractionLoads.set([]);
        result.set(null);
        setStatus('顶点已移动，需重新生成网格（原有边界条件已清空）', 'info');
      }
    }
    canvas.style.cursor = cursorFor(p);
  }

  function onPointerUp(e: PointerEvent) {
    panning = false;
    dragVertex = -1;
    try { canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  }

  function cursorFor(p: Vec2): string {
    if ($toolMode === 'pan' || panning) return 'grabbing';
    if (!$mesh) {
      if ($toolMode === 'drag' && findVertex(p) >= 0) return 'move';
      if ($toolMode === 'draw') return 'crosshair';
    }
    if (['support', 'load', 'traction'].includes($toolMode)) return 'crosshair';
    return 'default';
  }

  function onDblClick() {
    const loop = $polygon.outer;
    if (!$mesh && loop.length >= 3) {
      polygon.update((poly) => ({ ...poly, outer: [...poly.outer] }));
      setStatus('多边形已闭合（双击），点击「生成网格」进行三角剖分', 'ok');
    }
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const [wxBefore, wyBefore] = toWorld(view, e.clientX - rect.left, e.clientY - rect.top);
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    view = { ...view, scale: Math.max(1e-6, view.scale * factor) };
    const [sx, sy] = toScreen(view, wxBefore, wyBefore);
    // 保持鼠标下的世界点不动
    view = {
      ...view,
      cx: wxBefore - (sx - view.width / 2) / view.scale,
      cy: wyBefore + (sy - view.height / 2) / view.scale,
    };
  }

  function addSupportAt(p: Vec2, nodeOnly = false) {
    // 优先吸附到边界边 → 整边线性约束（悬臂梁固定端用法）；
    // 按住 Alt 或点在内部节点时退化为单节点约束。
    if (!nodeOnly) {
      const edge = nearestBoundaryEdge(p);
      if (edge) {
        const [a, b] = edge;
        const pa = $mesh!.nodes[a], pb = $mesh!.nodes[b];
        supports.update((list) => [
          ...list,
          {
            id: nextId('sup'),
            region: { kind: 'line', x1: pa.x, y1: pa.y, x2: pb.x, y2: pb.y },
            type: $supportType,
          },
        ]);
        setStatus('已对整条边界边施加约束（按 Alt 点击可只约束单个节点）', 'ok', 3500);
        return;
      }
    }
    const node = nearestNode(p);
    if (node < 0) {
      setStatus('请在边界边或节点附近点击施加约束（按 Alt 仅选节点）', 'error');
      return;
    }
    const np = $mesh!.nodes[node];
    supports.update((list) => [
      ...list,
      { id: nextId('sup'), region: { kind: 'point', x: np.x, y: np.y }, type: $supportType },
    ]);
  }

  /** 找到离点击位置最近、且点击点落在其线段上的边界边 */
  function nearestBoundaryEdge(p: Vec2): [number, number] | null {
    const $m = $mesh;
    if (!$m) return null;
    const tol = pickRadiusWorld();
    let best: [number, number] | null = null;
    let bestD = tol;
    for (const [n1, n2] of $m.boundaryEdges) {
      const a = $m.nodes[n1], b = $m.nodes[n2];
      const dx = b.x - a.x, dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
      if (d < bestD) {
        bestD = d;
        best = [n1, n2];
      }
    }
    return best;
  }

  function addLoadAt(p: Vec2) {
    const node = nearestNode(p);
    if (node < 0) {
      setStatus('请在节点附近点击施加集中力', 'error');
      return;
    }
    const np = $mesh!.nodes[node];
    nodalLoads.update((list) => [
      ...list,
      { id: nextId('load'), region: { kind: 'point', x: np.x, y: np.y }, fx: $loadFx, fy: $loadFy },
    ]);
  }

  function addTractionLine(a: Vec2, b: Vec2) {
    tractionLoads.update((list) => [
      ...list,
      {
        id: nextId('tr'),
        region: { kind: 'line', x1: a.x, y1: a.y, x2: b.x, y2: b.y },
        tx: $tractionTx,
        ty: $tractionTy,
      },
    ]);
    setStatus('已添加分布面力段（求解时自动匹配边界边）', 'ok');
  }

  function nearestNode(p: Vec2): number {
    const $m = $mesh;
    if (!$m) return -1;
    const tol = snapTol();
    let best = -1, bestD = tol;
    $m.nodes.forEach((n, i) => {
      const d = dist(n, p);
      if (d < bestD) { bestD = d; best = i; }
    });
    return best;
  }

  onMount(() => {
    ctx = canvas.getContext('2d')!;
    resize();
    window.addEventListener('resize', resize);
    loop();
    // 初始视图
    view = { ...view, scale: 8, cx: 50, cy: 0 };
  });

  onDestroy(() => {
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', resize);
  });

  // 网格或多边形载入后自动适配
  let lastFitKey = '';
  $: if ($mesh) {
    const key = `${$mesh.nodes.length}_${$mesh.elements.length}`;
    if (key !== lastFitKey) {
      lastFitKey = key;
      queueMicrotask(() => autoFit($mesh!.nodes));
    }
  }
</script>

<div class="canvas-wrap">
  <canvas
    bind:this={canvas}
    on:pointerdown={onPointerDown}
    on:pointermove={onPointerMove}
    on:pointerup={onPointerUp}
    on:dblclick={onDblClick}
    on:wheel={onWheel}
    on:contextmenu|preventDefault
  ></canvas>
  <div class="hint">
    {#if $toolMode === 'draw' && !$mesh}
      点击添加顶点 · 点击起点（或双击）闭合 · Shift+拖动平移 · 滚轮缩放
    {:else if $toolMode === 'drag'}
      拖动顶点微调形状 · Shift+拖动平移 · 滚轮缩放
    {:else if $toolMode === 'support'}
      点击边界边施加整边「{$supportType === 'fixed' ? '固定' : $supportType === 'slideX' ? '水平滑移(ux=0)' : '竖直滑移(uy=0)'}」（Alt+点击仅选单节点）
    {:else if $toolMode === 'load'}
      在节点上点击施加集中力 ({$loadFx}, {$loadFy})
    {:else if $toolMode === 'traction'}
      依次点击边界上两点定义面力段 ({$tractionTx}, {$tractionTy})
    {:else}
      Shift+拖动平移 · 滚轮缩放
    {/if}
  </div>
</div>

<style>
  .canvas-wrap {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
  }
  canvas {
    display: block;
    touch-action: none;
  }
  .hint {
    position: absolute;
    left: 12px;
    bottom: 10px;
    background: rgba(15, 23, 42, 0.78);
    color: #e2e8f0;
    font-size: 12px;
    padding: 6px 12px;
    border-radius: 6px;
    pointer-events: none;
  }
</style>
