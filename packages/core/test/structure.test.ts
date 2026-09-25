/**
 * 结构级正确性测试：
 * 1) 常应力分片试验（patch test）；
 * 2) 悬臂梁端部位移对照材料力学梁理论；
 * 3) 无约束 → 奇异；部分约束（仅锁平移、不锁转动）→ 奇异；
 * 4) 载荷放大 k 倍 → 位移、应力严格放大 k 倍；
 * 5) 平面应力 vs 平面应变位移不同；
 * 6) 支反力与外载平衡。
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { triangulate } from '../src/mesh/triangulate.js';
import { structuredRectangle } from '../src/mesh/structured.js';
import { analyze } from '../src/analyze.js';
import { SingularMatrixError } from '../src/types.js';
import type { FemModel, Material } from '../src/types.js';

const steel: Material = { E: 210000, nu: 0.3, thickness: 10, model: 'planeStress' };

function fixedLeft(): FemModel['supports'] {
  return [{ id: 's1', region: { kind: 'line', x1: 0, y1: 0, x2: 0, y2: 10 }, type: 'fixed' }];
}

describe('分片试验（CST 必须精确再现常应力状态）', () => {
  test('单向拉伸 σx = 10 MPa：规则网格全场应力严格均匀、位移场线性', () => {
    const L = 60, H = 20;
    // 单向对角的仿射重复网格是严格分片试验的前提
    const mesh = structuredRectangle(0, 0, L, H, 12, 4, 'uniform');
    const sigma = 10;
    const model: FemModel = {
      polygon: { outer: [], holes: [] } as never,
      mesh,
      material: steel,
      // 恰当约束（消除 3 个刚体模态、不阻碍泊松收缩）：
      // 左边辊轴（ux=0，允许 uy）；左下角再锁 uy 防 y 平移；
      // 右下角锁 uy 防转动。这是单向拉伸的标准静定支撑方式。
      supports: [
        { id: 'left', region: { kind: 'line', x1: 0, y1: 0, x2: 0, y2: H }, type: 'slideX' },
        { id: 'piny', region: { kind: 'point', x: 0, y: 0 }, type: 'fixed' },
        { id: 'rgy', region: { kind: 'point', x: L, y: 0 }, type: 'slideY' },
      ],
      nodalLoads: [],
      tractionLoads: [
        { id: 't1', region: { kind: 'line', x1: L, y1: 0, x2: L, y2: H }, tx: sigma, ty: 0 },
      ],
    };
    const res = analyze(model);
    for (const es of res.elementStresses) {
      assert.ok(Math.abs(es.sx - sigma) < 1e-7, `σx=${es.sx} ≠ ${sigma}`);
      assert.ok(Math.abs(es.sy) < 1e-7, `σy=${es.sy} ≠ 0`);
      assert.ok(Math.abs(es.txy) < 1e-7, `τxy=${es.txy} ≠ 0`);
    }
    // 位移场线性：ux = σx/E·x，uy = −νσx/E·y
    let maxUxErr = 0, maxUyErr = 0;
    mesh.nodes.forEach((p, i) => {
      const ux = res.displacement[2 * i];
      const uy = res.displacement[2 * i + 1];
      maxUxErr = Math.max(maxUxErr, Math.abs(ux - (sigma / steel.E) * p.x));
      maxUyErr = Math.max(maxUyErr, Math.abs(uy - (-0.3 * (sigma / steel.E)) * p.y));
    });
    assert.ok(maxUxErr < 1e-12, `ux 偏离线性场，最大误差 ${maxUxErr}`);
    assert.ok(maxUyErr < 1e-12, `uy 偏离横向收缩场，最大误差 ${maxUyErr}`);
  });

  test('非规则 Delaunay 网格下分片试验近似成立（应力偏差 < 5%）', () => {
    const L = 60, H = 20;
    const mesh = triangulate(
      { outer: [{ x: 0, y: 0 }, { x: L, y: 0 }, { x: L, y: H }, { x: 0, y: H }], holes: [] },
      { globalSeed: 7 },
    );
    const sigma = 10;
    const res = analyze({
      polygon: { outer: [], holes: [] } as never,
      mesh,
      material: steel,
      supports: [
        { id: 'left', region: { kind: 'line', x1: 0, y1: 0, x2: 0, y2: H }, type: 'slideX' },
        { id: 'piny', region: { kind: 'point', x: 0, y: 0 }, type: 'fixed' },
        { id: 'rgy', region: { kind: 'point', x: L, y: 0 }, type: 'slideY' },
      ],
      nodalLoads: [],
      tractionLoads: [
        { id: 't1', region: { kind: 'line', x1: L, y1: 0, x2: L, y2: H }, tx: sigma, ty: 0 },
      ],
    });
    for (const es of res.elementStresses) {
      assert.ok(Math.abs(es.sx - sigma) / sigma < 0.05, `非规则网格 σx=${es.sx}`);
    }
  });
});

describe('悬臂梁（左端固定、自由端中部集中力）', () => {
  const L = 100, H = 10, t = 10;
  const E = steel.E, nu = steel.nu;
  const P = 100; // N
  const I = (t * H ** 3) / 12;
  // 梁理论端部位移（端部集中力，自由端中心）
  const beamTip = (P * L ** 3) / (3 * E * I);
  // 端部剪切修正（Timoshenko 量级，仅作参考不做断言）
  const kShear = (P * L) / (5 / 6 * t * H * (E / (2 * (1 + nu))));

  function build(nx: number, ny: number): FemModel {
    const mesh = structuredRectangle(0, -H / 2, L, H / 2, nx, ny);
    return {
      polygon: { outer: [], holes: [] } as never,
      mesh,
      material: steel,
      supports: [
        { id: 'fix', region: { kind: 'line', x1: 0, y1: -H / 2, x2: 0, y2: H / 2 }, type: 'fixed' },
      ],
      nodalLoads: [
        { id: 'p', region: { kind: 'point', x: L, y: 0 }, fx: 0, fy: -P },
      ],
      tractionLoads: [],
    };
  }

  test('细网格端部位移与梁理论偏差 < 12%，且随加密收敛', () => {
    const coarse = analyze(build(20, 2));
    const fine = analyze(build(60, 4));
    const vCoarse = Math.abs(coarse.maxDisplacement);
    const vFine = Math.abs(fine.maxDisplacement);
    // 加密后更接近梁理论（含剪切柔度，FEM 值应略大于纯弯曲理论值）
    assert.ok(vFine > vCoarse, '加密后位移应增大（趋于梁理论+剪切）');
    const err = Math.abs(vFine - beamTip) / beamTip;
    assert.ok(err < 0.12, `细网格端部位移 ${vFine.toFixed(4)} vs 梁理论 ${beamTip.toFixed(4)}，偏差 ${(err * 100).toFixed(1)}%`);
    // 残差应很小
    assert.ok(fine.diagnostics.residual < 1e-8);
  });

  test('固定端最大弯曲应力量级与梁理论 σ=Mc/I 一致（±25%）', () => {
    const m = build(80, 6);
    const res = analyze(m);
    const sigmaTheory = (P * L * (H / 2)) / I;
    // 固定端附近（x 最小的一列）单元的 |σx| 最大值
    let sigmaMax = 0;
    res.elementStresses.forEach((es, k) => {
      const tri = m.mesh.elements[k];
      const cx = (m.mesh.nodes[tri[0]].x + m.mesh.nodes[tri[1]].x + m.mesh.nodes[tri[2]].x) / 3;
      if (cx < L * 0.05) sigmaMax = Math.max(sigmaMax, Math.abs(es.sx));
    });
    const err = Math.abs(sigmaMax - sigmaTheory) / sigmaTheory;
    assert.ok(err < 0.25, `固定端 σx ${sigmaMax.toFixed(2)} vs 理论 ${sigmaTheory.toFixed(2)}，偏差 ${(err * 100).toFixed(1)}%`);
  });

  test('支反力与外载平衡（合力为零）', () => {
    const m = build(40, 4);
    const res = analyze(m);
    let rx = 0, ry = 0, rm = 0;
    m.mesh.nodes.forEach((p, i) => {
      rx += res.reactions[2 * i];
      ry += res.reactions[2 * i + 1];
      rm += p.x * res.reactions[2 * i + 1] - p.y * res.reactions[2 * i];
    });
    assert.ok(Math.abs(rx) < 1e-6);
    assert.ok(Math.abs(ry - P) < 1e-6, `竖向反力合力 ${ry} ≠ P=${P}`);
    // 对原点取矩：反力矩 ≈ P·L
    assert.ok(Math.abs(rm - P * L) / (P * L) < 1e-4, `反力矩 ${rm} ≠ P·L=${P * L}`);
  });
});

describe('奇异性与约束诊断', () => {
  const mesh = structuredRectangle(0, 0, 40, 10, 8, 2);
  const base: FemModel = {
    polygon: { outer: [], holes: [] } as never,
    mesh,
    material: steel,
    supports: [],
    nodalLoads: [{ id: 'p', region: { kind: 'point', x: 40, y: 5 }, fx: 0, fy: -50 }],
    tractionLoads: [],
  };

  test('完全无约束 → SingularMatrixError（不崩溃）', () => {
    assert.throws(() => analyze(base), (e: unknown) => e instanceof SingularMatrixError);
  });

  test('仅约束一点的 x 方向（仍有 y 平移与转动）→ 奇异并给出提示', () => {
    const m = { ...base, supports: [{ id: 's', region: { kind: 'point' as const, x: 0, y: 0 }, type: 'slideX' as const }] };
    assert.throws(() => analyze(m), (e: unknown) => e instanceof SingularMatrixError);
  });

  test('两个不同节点分别只约束 y（锁住 y 平移和转动，但 x 可平移）→ 奇异', () => {
    const m = {
      ...base,
      supports: [
        { id: 's1', region: { kind: 'point' as const, x: 0, y: 0 }, type: 'slideY' as const },
        { id: 's2', region: { kind: 'point' as const, x: 0, y: 10 }, type: 'slideY' as const },
      ],
    };
    assert.throws(() => analyze(m), (e: unknown) => e instanceof SingularMatrixError);
  });
});

describe('线弹性比例性与本构假设', () => {
  function build(P: number, model: 'planeStress' | 'planeStrain'): FemModel {
    const mesh = structuredRectangle(0, -5, 100, 5, 40, 4);
    return {
      polygon: { outer: [], holes: [] } as never,
      mesh,
      material: { ...steel, model },
      supports: [
        { id: 'fix', region: { kind: 'line', x1: 0, y1: -5, x2: 0, y2: 5 }, type: 'fixed' },
      ],
      nodalLoads: [
        { id: 'p', region: { kind: 'point', x: 100, y: 0 }, fx: 0, fy: -P },
      ],
      tractionLoads: [],
    };
  }

  test('载荷放大 k 倍：位移与应力严格等比例放大', () => {
    const r1 = analyze(build(100, 'planeStress'));
    const k = 3.7;
    const r2 = analyze(build(100 * k, 'planeStress'));
    for (let i = 0; i < r1.displacement.length; i++) {
      assert.ok(Math.abs(r2.displacement[i] - k * r1.displacement[i]) < 1e-10);
    }
    assert.ok(Math.abs(r2.maxVonMises - k * r1.maxVonMises) / (k * r1.maxVonMises) < 1e-10);
  });

  test('平面应力与平面应变的位移不同（平面应变约束 εz=0，更刚）', () => {
    const rps = analyze(build(100, 'planeStress'));
    const rpe = analyze(build(100, 'planeStrain'));
    assert.notEqual(rps.maxDisplacement, rpe.maxDisplacement);
    // 平面应变等效 E' = E/(1-ν²)、ν' = ν/(1-ν)，纯弯曲柔度为平面应力的 (1-ν²) 倍
    const ratio = rpe.maxDisplacement / rps.maxDisplacement;
    assert.ok(ratio < 1, '平面应变应更刚、位移更小');
    assert.ok(Math.abs(ratio - (1 - 0.3 * 0.3)) < 0.05, `位移比 ${ratio} 应≈1-ν²=${1 - 0.09}`);
  });

  test('体力（自重）可求解且合力等于 ρ·体积·t', () => {
    const mesh = structuredRectangle(0, 0, 50, 20, 20, 8);
    const model: FemModel = {
      polygon: { outer: [], holes: [] } as never,
      mesh,
      material: steel,
      supports: [
        { id: 'top', region: { kind: 'line', x1: 0, y1: 20, x2: 50, y2: 20 }, type: 'slideY' },
        { id: 'pin', region: { kind: 'point', x: 0, y: 20 }, type: 'fixed' },
      ],
      nodalLoads: [],
      tractionLoads: [],
      bodyLoad: { fx: 0, fy: -1e-3 }, // 单位体积力
    };
    const res = analyze(model);
    let ry = 0;
    mesh.nodes.forEach((_, i) => (ry += res.reactions[2 * i + 1]));
    const total = 1e-3 * 50 * 20 * steel.thickness;    assert.ok(Math.abs(ry - total) / total < 1e-8, `自重反力 ${ry} ≠ ${total}`);
  });
});
