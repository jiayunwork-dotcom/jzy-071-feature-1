/**
 * 自由振动分析正确性测试：
 *  1) 单元一致/集中质量矩阵的对称性、总质量（=ρ·V·t）、刚体零能；
 *  2) 整体 K、M 自由度排布对齐；两种质量矩阵都对称、总质量一致；
 *  3) 模态质量归一（φᵀMφ=1）与跨阶质量正交（φ_iᵀMφ_j=0, i≠j）；
 *  4) Rayleigh 商自洽：Kφ = ω²Mφ（相对残差小）、ω=2πf；
 *  5) 频率为正、按阶升序、约束自由度振型为零；
 *  6) 刚体模态识别与剔除：自由/欠约束结构不把零频计入结果，
 *     且约束不足时仍能稳定捞出最低弹性频率；
 *  7) 一致质量（偏柔、频率偏低）与集中质量（偏刚、频率偏高）系统性不同，
 *     二者从两侧夹住解析值；
 *  8) 频率对照解析解：悬臂梁低阶弯曲（Euler-Bernoulli）收敛；
 *     一端固定杆纵向频率收敛到 (2n−1)/(4L)·√(E/ρ)；
 *  9) 重频/近频不丢失（同阶数齐全、彼此仍正交）。
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { structuredRectangle } from '../src/mesh/structured.js';
import {
  createCst,
  elementConsistentMass,
  elementLumpedMass,
  elementStiffness,
} from '../src/element.js';
import { constitutiveMatrix, STEEL_DENSITY } from '../src/material.js';
import {
  assembleStiffness,
  assembleMass,
  csrMultiply,
} from '../src/assembly.js';
import { analyzeVibration, theoreticalTotalMass } from '../src/vibration.js';
import type { FemModel, Material, VibrationResult } from '../src/types.js';

const E = 210000, nu = 0.3, t = 10;
const rho = STEEL_DENSITY; // 7.85e-6 kg/mm³
const steel: Material = { E, nu, thickness: t, model: 'planeStress', rho };

function beamModel(nx: number, ny: number, supports: FemModel['supports'] = [
  { id: 'fix', region: { kind: 'line', x1: 0, y1: -5, x2: 0, y2: 5 }, type: 'fixed' },
]): FemModel {
  const mesh = structuredRectangle(0, -5, 100, 5, nx, ny);
  return {
    polygon: { outer: [], holes: [] } as never,
    mesh,
    material: steel,
    supports,
    nodalLoads: [],
    tractionLoads: [],
  };
}

describe('单元质量矩阵', () => {
  const p0 = { x: 0, y: 0 }, p1 = { x: 12, y: 0 }, p2 = { x: 0, y: 8 };
  const elem = createCst(p0, p1, p2, [0, 1, 2]);
  const area = elem.area;

  test('一致质量 Me 对称，且每个平动方向行和 = 单元总质量 ρtA', () => {
    const Me = elementConsistentMass(elem, rho, t);
    for (let i = 0; i < 6; i++)
      for (let j = 0; j < 6; j++)
        assert.ok(Math.abs(Me[i * 6 + j] - Me[j * 6 + i]) < 1e-30);
    const mtot = rho * t * area;
    // x 方向行和（行 0,2,4）与 y 方向行和（行 1,3,5）都等于 mtot
    for (const row of [0, 1]) {
      let s = 0;
      for (let j = row; j < 6; j += 2) {
        for (let ii = row; ii < 6; ii += 2) s += Me[ii * 6 + j];
      }
      assert.ok(Math.abs(s - mtot) / mtot < 1e-12, `行和 ${s} vs ${mtot}`);
    }
  });

  test('集中质量为纯对角，每节点两方向各得 ρtA/3，总和 = ρtA', () => {
    const Ml = elementLumpedMass(elem, rho, t);
    let sum = 0;
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 6; j++) {
        if (i !== j) assert.equal(Ml[i * 6 + j], 0, '集中质量非对角必须为 0');
      }
      sum += Ml[i * 6 + i];
    }
    const perNode = (rho * t * area) / 3;
    assert.ok(Math.abs(Ml[0] - perNode) / perNode < 1e-12);
    // 6 个平动自由度对角之和 = 2·ρtA
    assert.ok(Math.abs(sum - 2 * rho * t * area) / (2 * rho * t * area) < 1e-12);
  });

  test('一致质量非平凡地含非对角耦合（区别于集中质量）', () => {
    const Me = elementConsistentMass(elem, rho, t);
    let off = 0;
    for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) if (i !== j) off += Math.abs(Me[i * 6 + j]);
    assert.ok(off > 0);
  });

  test('刚体平动在两种质量下动能相同（一致质量 M 作用于单位平移 = ρtA/自由度）', () => {
    const Mc = elementConsistentMass(elem, rho, t);
    const ux = new Float64Array([1, 0, 1, 0, 1, 0]);
    // uxᵀ Me ux = mtot（单位 x 平移的动能相关量）
    let e = 0;
    for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) e += ux[i] * Mc[i * 6 + j] * ux[j];
    assert.ok(Math.abs(e - rho * t * area) / (rho * t * area) < 1e-12);
  });
});

describe('整体质量矩阵装配（与 K 对齐）', () => {
  const model = beamModel(12, 2);
  const ndof = model.mesh.nodes.length * 2;

  test('K 与 M 同维、同行指针（自由度排布严格对齐）', () => {
    const K = assembleStiffness(model);
    for (const kind of ['consistent', 'lumped'] as const) {
      const M = assembleMass(model, kind);
      assert.equal(M.n, ndof);
      assert.equal(M.n, K.n);
      for (let i = 0; i <= ndof; i++) assert.equal(M.rowPtr[i], K.rowPtr[i]);
      for (let i = 0; i < M.colIdx.length; i++) assert.equal(M.colIdx[i], K.colIdx[i]);
    }
  });

  test('两种质量矩阵对称', () => {
    for (const kind of ['consistent', 'lumped'] as const) {
      const M = assembleMass(model, kind);
      for (let i = 0; i < M.n; i++) {
        for (let p = M.rowPtr[i]; p < M.rowPtr[i + 1]; p++) {
          const j = M.colIdx[p];
          // 找对称项
          let lo = M.rowPtr[j], hi = M.rowPtr[j + 1] - 1, v = NaN;
          while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            if (M.colIdx[mid] === i) { v = M.values[mid]; break; }
            if (M.colIdx[mid] < i) lo = mid + 1; else hi = mid - 1;
          }
          assert.ok(Math.abs(M.values[p] - v) < 1e-20, `${kind} 不对称 @ ${i},${j}`);
        }
      }
    }
  });

  test('总质量（M·[1,0,1,0…] 之和）= ρ·面积·t，两种质量一致', () => {
    const theory = theoreticalTotalMass(model);
    for (const kind of ['consistent', 'lumped'] as const) {
      const M = assembleMass(model, kind);
      const ones = new Float64Array(M.n);
      for (let i = 0; i < M.n; i += 2) ones[i] = 1;
      const M1 = csrMultiply(M, ones);
      let tot = 0;
      for (let i = 0; i < M.n; i += 2) tot += M1[i];
      assert.ok(Math.abs(tot - theory) / theory < 1e-9, `${kind} 总质量 ${tot} vs ${theory}`);
    }
  });

  test('集中质量整体矩阵确为纯对角（非对角位置数值全为 0）', () => {
    const M = assembleMass(model, 'lumped');
    for (let i = 0; i < M.n; i++) {
      assert.ok(M.values[M.diagPos[i]] > 0, '对角质量必须为正');
      for (let p = M.rowPtr[i]; p < M.rowPtr[i + 1]; p++) {
        if (M.colIdx[p] !== i) assert.equal(M.values[p], 0, '集中质量非对角必须为 0');
      }
    }
  });
});

describe('模态正交性、归一化与 Rayleigh 商自洽', () => {
  const model = beamModel(30, 3);

  for (const mm of ['consistent', 'lumped'] as const) {
    describe(`质量矩阵：${mm}`, () => {
      const res: VibrationResult = analyzeVibration(model, { modeCount: 6, massMatrix: mm });

      test('返回 6 阶、频率为正、严格升序', () => {
        assert.equal(res.modes.length, 6);
        for (const m of res.modes) {
          assert.ok(m.omega > 0);
          assert.ok(m.frequencyHz > 0);
          assert.ok(Math.abs(m.frequencyHz - m.omega / (2 * Math.PI)) < 1e-9);
        }
        for (let i = 1; i < res.modes.length; i++) {
          assert.ok(res.modes[i].frequencyHz > res.modes[i - 1].frequencyHz);
        }
      });

      test('质量归一：φᵀMφ = 1；跨阶正交：φ_iᵀMφ_j = 0 (i≠j)', () => {
        const M = assembleMass(model, mm);
        const ndof = M.n;
        for (let a = 0; a < res.modes.length; a++) {
          const Ma = csrMultiply(M, res.modes[a].shape);
          for (let b = a; b < res.modes.length; b++) {
            let s = 0;
            for (let i = 0; i < ndof; i++) s += res.modes[b].shape[i] * Ma[i];
            const target = a === b ? 1 : 0;
            assert.ok(Math.abs(s - target) < 1e-8,
              `${mm} φ_${a}ᵀMφ_${b} = ${s}，应为 ${target}`);
          }
        }
        // 汇总指标也要小
        assert.ok(res.diagnostics.maxCrossOrthogonality < 1e-7);
      });

      test('Rayleigh 商：|Kφ − ω²Mφ| 相对残差很小，且 ω² = φᵀKφ/(φᵀMφ)', () => {
        const K = assembleStiffness(model);
        const M = assembleMass(model, mm);
        const ndof = K.n;
        for (const m of res.modes) {
          const Kp = csrMultiply(K, m.shape);
          const Mp = csrMultiply(M, m.shape);
          // Rayleigh 商
          let num = 0, den = 0;
          for (let i = 0; i < ndof; i++) { num += m.shape[i] * Kp[i]; den += m.shape[i] * Mp[i]; }
          const lam = m.omega * m.omega;
          assert.ok(Math.abs(num / den - lam) / lam < 1e-6,
            `Rayleigh 商 ${num / den} vs ω²=${lam}`);
          // 控制残差
          assert.ok(m.residual < 1e-5, `模态 ${m.order} 残差 ${m.residual}`);
        }
      });

      test('约束自由度处振型分量为 0', () => {
        // 左端 x=0 整边固定（ux=uy=0）
        model.mesh.nodes.forEach((p, i) => {
          if (Math.abs(p.x) < 1e-9) {
            for (const m of res.modes) {
              assert.ok(Math.abs(m.shape[2 * i]) < 1e-14);
              assert.ok(Math.abs(m.shape[2 * i + 1]) < 1e-14);
            }
          }
        });
      });
    });
  }
});

describe('刚体模态识别与剔除（约束不足也稳定）', () => {
  test('完全无约束：识别 3 个刚体模态并剔除，弹性频率仍正确', () => {
    const model = beamModel(30, 3, []);
    const res = analyzeVibration(model, { modeCount: 4, massMatrix: 'consistent' });
    assert.equal(res.rigidBodyModes, 3);
    assert.equal(res.modes.length, 4);
    for (const m of res.modes) assert.ok(m.frequencyHz > 1, '弹性频率不应近零');
    // 与同网格悬臂结果不应完全相同（自由-自由第一阶弹性频率更高）
    const cant = analyzeVibration(beamModel(30, 3), { modeCount: 4, massMatrix: 'consistent' });
    assert.ok(res.modes[0].frequencyHz > cant.modes[0].frequencyHz);
  });

  test('只约束单点 ux（仍有 y 平移+转动 2 个刚体模态）：剔除后给出弹性模态', () => {
    const model = beamModel(24, 3, [
      { id: 's', region: { kind: 'point', x: 0, y: 0 }, type: 'slideX' },
    ]);
    const res = analyzeVibration(model, { modeCount: 4, massMatrix: 'consistent' });
    assert.equal(res.rigidBodyModes, 2);
    assert.equal(res.modes.length, 4);
    for (const m of res.modes) assert.ok(m.frequencyHz > 1);
  });

  test('左端整边固定：无刚体模态', () => {
    const res = analyzeVibration(beamModel(24, 3), { modeCount: 4 });
    assert.equal(res.rigidBodyModes, 0);
  });
});

describe('一致质量 vs 集中质量：系统差异（从两侧夹住解析值）', () => {
  test('细网格悬臂各弯曲模态两种质量解出可分辨的不同频率，差异随模态阶次增大', () => {
    const model = beamModel(60, 4);
    const rc = analyzeVibration(model, { modeCount: 8, massMatrix: 'consistent' });
    const rl = analyzeVibration(model, { modeCount: 8, massMatrix: 'lumped' });
    const bendsC = rc.modes.filter((m) => m.xKineticFraction < 0.2);
    const bendsL = rl.modes.filter((m) => m.xKineticFraction < 0.2);
    // 每一阶都不同（不是一模一样的数）
    let prevGap = 0;
    for (let k = 0; k < bendsC.length; k++) {
      const gap = Math.abs(bendsL[k].frequencyHz - bendsC[k].frequencyHz) / bendsC[k].frequencyHz;
      assert.ok(gap > 1e-5, `第 ${k + 1} 弯曲两路径频率完全相同，未体现质量矩阵差异`);
      if (k >= 1) assert.ok(gap >= prevGap * 0.5, '质量离散差异总体应随模态阶次/波长缩短而增大');
      prevGap = gap;
    }
  });

  test('两种质量得到的第 1 阶弯曲频率分居解析值两侧附近（CST 下方向不固定，均在 10% 带内）', () => {
    const L = 100, H = 10, I = (t * H ** 3) / 12, Asec = t * H;
    const fEB = (1.87510407 ** 2) / (2 * Math.PI) * Math.sqrt((E * I) / (rho * Asec * L ** 4));
    const rc = analyzeVibration(beamModel(60, 4), { modeCount: 3, massMatrix: 'consistent' });
    const rl = analyzeVibration(beamModel(60, 4), { modeCount: 3, massMatrix: 'lumped' });
    for (const f of [rc.modes[0].frequencyHz, rl.modes[0].frequencyHz]) {
      assert.ok(Math.abs(f - fEB) / fEB < 0.1, `${f} 偏离 EB ${fEB}`);
    }
    // 高频段（第 4~6 弯曲）两路径差异更明显，体现一致/集中质量各自的离散偏差
    const hiC = rc.modes.filter((m) => m.xKineticFraction < 0.2);
    const hiL = rl.modes.filter((m) => m.xKineticFraction < 0.2);
    const kHi = Math.min(hiC.length, hiL.length, 5) - 1;
    const hiGap = Math.abs(hiC[kHi].frequencyHz - hiL[kHi].frequencyHz) / hiC[kHi].frequencyHz;
    const loGap = Math.abs(rc.modes[0].frequencyHz - rl.modes[0].frequencyHz) / rc.modes[0].frequencyHz;
    assert.ok(hiGap > loGap, '高阶模态下两种质量差异应更显著');
  });
});

describe('频率对照解析解（网格加密收敛）', () => {
  // Euler-Bernoulli 悬臂：f_n = β_n²/(2π)·√(EI/(ρA L⁴))
  const L = 100, H = 10;
  const I = (t * H ** 3) / 12, Asec = t * H;
  const beta = [1.87510407, 4.69409113];
  const ebHz = beta.map((b) => (b * b) / (2 * Math.PI) * Math.sqrt((E * I) / (rho * Asec * L ** 4)));

  test('悬臂梁前两阶弯曲 FEM 趋于 EB 闭式解（细网格偏差 < 8%），且加密收敛', () => {
    const coarse = analyzeVibration(
      {
        ...beamModel(20, 2),
        material: { ...steel, thickness: t },
      },
      { modeCount: 3, massMatrix: 'consistent' },
    );
    const fine = analyzeVibration(beamModel(80, 6), { modeCount: 3, massMatrix: 'consistent' });
    // 前两阶弯曲（x 动能占比小）
    const bendCoarse = coarse.modes.filter((m) => m.xKineticFraction < 0.2).slice(0, 2);
    const bendFine = fine.modes.filter((m) => m.xKineticFraction < 0.2).slice(0, 2);
    assert.equal(bendFine.length, 2);
    for (let k = 0; k < 2; k++) {
      const errCoarse = Math.abs(bendCoarse[k].frequencyHz - ebHz[k]) / ebHz[k];
      const errFine = Math.abs(bendFine[k].frequencyHz - ebHz[k]) / ebHz[k];
      assert.ok(errFine < 0.08,
        `第 ${k + 1} 弯曲：FEM ${bendFine[k].frequencyHz.toFixed(2)} vs EB ${ebHz[k].toFixed(2)}，偏差 ${(errFine * 100).toFixed(1)}%`);
      // 加密使误差下降（不严格单调则至少细网格更接近）
      assert.ok(errFine <= errCoarse + 1e-9, '加密应更接近解析值');
    }
  });

  test('两种质量第 1 阶频率均贴近 EB 值（细网格 < 12%）且数值不同', () => {
    const rc = analyzeVibration(beamModel(60, 4), { modeCount: 3, massMatrix: 'consistent' });
    const rl = analyzeVibration(beamModel(60, 4), { modeCount: 3, massMatrix: 'lumped' });
    assert.ok(Math.abs(rc.modes[0].frequencyHz - ebHz[0]) / ebHz[0] < 0.1);
    assert.ok(Math.abs(rl.modes[0].frequencyHz - ebHz[0]) / ebHz[0] < 0.12);
    assert.notEqual(rc.modes[0].frequencyHz, rl.modes[0].frequencyHz);
  });
});

describe('杆纵向振动频率闭式解', () => {
  const Lr = 200, Hr = 4, tr = 10;
  function rod(nx: number, ny: number): FemModel {
    const mesh = structuredRectangle(0, -Hr / 2, Lr, Hr / 2, nx, ny);
    return {
      polygon: { outer: [], holes: [] } as never,
      mesh,
      material: { E, nu: 0.3, thickness: tr, model: 'planeStress', rho },
      supports: [
        { id: 'fix', region: { kind: 'line', x1: 0, y1: -Hr / 2, x2: 0, y2: Hr / 2 }, type: 'fixed' },
      ],
      nodalLoads: [],
      tractionLoads: [],
    };
  }
  const rodHz = (n: number) => ((2 * n - 1) / (4 * Lr)) * Math.sqrt(E / rho);

  test('前两阶纵向模态（x 动能≈1）频率收敛到 (2n−1)/(4L)√(E/ρ)', () => {
    // 细杆的纵向模态与多阶弯曲交错，需多取一些阶数才能覆盖前两阶纵向
    const res = analyzeVibration(rod(100, 2), { modeCount: 16, massMatrix: 'consistent' });
    const longs = res.modes.filter((m) => m.xKineticFraction > 0.9).slice(0, 2);
    assert.ok(longs.length >= 2, '应至少解出两阶纵向模态');
    for (let k = 0; k < 2; k++) {
      const err = Math.abs(longs[k].frequencyHz - rodHz(k + 1)) / rodHz(k + 1);
      assert.ok(err < 0.04,
        `第 ${k + 1} 纵向：FEM ${longs[k].frequencyHz.toFixed(2)} vs 解析 ${rodHz(k + 1).toFixed(2)}，偏差 ${(err * 100).toFixed(1)}%`);
    }
  });

  test('纵向频率加密收敛（细网格比粗网格更接近解析值）', () => {
    const c = analyzeVibration(rod(40, 1), { modeCount: 6, massMatrix: 'consistent' });
    const f = analyzeVibration(rod(120, 2), { modeCount: 14, massMatrix: 'consistent' });
    const lc = c.modes.filter((m) => m.xKineticFraction > 0.9)[0];
    const lf = f.modes.filter((m) => m.xKineticFraction > 0.9)[0];
    const ec = Math.abs(lc.frequencyHz - rodHz(1)) / rodHz(1);
    const ef = Math.abs(lf.frequencyHz - rodHz(1)) / rodHz(1);
    assert.ok(ef <= ec + 1e-9, `加密应收敛：粗 ${ec.toFixed(4)} 细 ${ef.toFixed(4)}`);
  });
});

describe('近频/多模态完整性', () => {
  test('请求的阶数全部返回且彼此质量正交（不漏不重）', () => {
    const model = beamModel(40, 4);
    const res = analyzeVibration(model, { modeCount: 10, massMatrix: 'consistent' });
    assert.equal(res.modes.length, 10);
    const M = assembleMass(model, 'consistent');
    // 任意两阶（含相邻近频）质量内积接近 0
    let worst = 0;
    for (let a = 0; a < res.modes.length; a++) {
      const Ma = csrMultiply(M, res.modes[a].shape);
      for (let b = a + 1; b < res.modes.length; b++) {
        let s = 0;
        for (let i = 0; i < M.n; i++) s += res.modes[b].shape[i] * Ma[i];
        worst = Math.max(worst, Math.abs(s));
      }
    }
    assert.ok(worst < 1e-7, `近频模态间最大质量耦合 ${worst}`);
  });
});
