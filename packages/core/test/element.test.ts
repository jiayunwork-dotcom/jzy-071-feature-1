import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  createCst,
  elementStiffness,
  triangleQuality,
} from '../src/element.js';
import { constitutiveMatrix } from '../src/material.js';
import type { Material } from '../src/types.js';

// 对称 3×3 矩阵 Jacobi 特征值分解（测试辅助）
function symmetricEigenvalues(A: Float64Array, n: number): number[] {
  const a = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => A[i * n + j]),
  );
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += a[p][q] * a[p][q];
    if (off < 1e-24) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(a[p][q]) < 1e-16) continue;
        const tau = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(tau || 1) / (Math.abs(tau) + Math.sqrt(1 + tau * tau));
        const c = 1 / Math.sqrt(1 + t * t);
        const s = t * c;
        const app = a[p][p], aqq = a[q][q], apq = a[p][q];
        a[p][p] = c * c * app - 2 * s * c * apq + s * s * aqq;
        a[q][q] = s * s * app + 2 * s * c * apq + c * c * aqq;
        a[p][q] = 0;
        a[q][p] = 0;
        for (let k = 0; k < n; k++) {
          if (k === p || k === q) continue;
          const akp = a[k][p], akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[p][k] = a[k][p];
          a[k][q] = s * akp + c * akq;
          a[q][k] = a[k][q];
        }
      }
    }
  }
  return Array.from({ length: n }, (_, i) => a[i][i]).sort((x, y) => x - y);
}

const mat: Material = { E: 210000, nu: 0.3, thickness: 5, model: 'planeStress' };

describe('CST 单元刚度', () => {
  const p0 = { x: 0, y: 0 };
  const p1 = { x: 10, y: 0 };
  const p2 = { x: 0, y: 8 };
  const elem = createCst(p0, p1, p2, [0, 1, 2]);

  test('面积与形函数梯度正确', () => {
    assert.ok(Math.abs(elem.area - 40) < 1e-9);
    // N0 = (a0 + b0 x + c0 y)/(2A)，b0 = y1-y2 = -8，c0 = x2-x1 = -10
    const twoA = 80;
    assert.ok(Math.abs(elem.gradN[0] - -8 / twoA) < 1e-12);
    assert.ok(Math.abs(elem.gradN[1] - -10 / twoA) < 1e-12);
  });

  test('单元刚度矩阵对称', () => {
    const D = constitutiveMatrix(mat);
    const Ke = elementStiffness(elem, D, mat.thickness);
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 6; j++) {
        assert.ok(
          Math.abs(Ke[i * 6 + j] - Ke[j * 6 + i]) < 1e-7,
          `Ke[${i},${j}] 不对称: ${Ke[i * 6 + j]} vs ${Ke[j * 6 + i]}`,
        );
      }
    }
  });

  test('存在 3 个零能刚体模式（2 平移 + 1 转动），其余 3 个特征值为正', () => {
    const D = constitutiveMatrix(mat);
    const Ke = elementStiffness(elem, D, mat.thickness);
    const eig = symmetricEigenvalues(Ke, 6);
    // 三个近零特征值
    for (let i = 0; i < 3; i++) assert.ok(Math.abs(eig[i]) < 1e-6, `第 ${i} 个特征值应为零，实际 ${eig[i]}`);
    // 三个正特征值（变形模态有刚度）
    for (let i = 3; i < 6; i++) assert.ok(eig[i] > 1e3, `第 ${i} 个特征值应为正，实际 ${eig[i]}`);
  });

  test('x 向刚体平移：节点力为零', () => {
    const D = constitutiveMatrix(mat);
    const Ke = elementStiffness(elem, D, mat.thickness);
    const ux = new Float64Array([1, 0, 1, 0, 1, 0]);
    const f = new Float64Array(6);
    for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) f[i] += Ke[i * 6 + j] * ux[j];
    assert.ok(Math.max(...f.map(Math.abs)) < 1e-6);
  });

  test('y 向刚体平移：节点力为零', () => {
    const D = constitutiveMatrix(mat);
    const Ke = elementStiffness(elem, D, mat.thickness);
    const uy = new Float64Array([0, 1, 0, 1, 0, 1]);
    const f = new Float64Array(6);
    for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) f[i] += Ke[i * 6 + j] * uy[j];
    assert.ok(Math.max(...f.map(Math.abs)) < 1e-6);
  });

  test('小转动 u=(-θy, θx) 为零能模式（一阶近似）', () => {
    const D = constitutiveMatrix(mat);
    const Ke = elementStiffness(elem, D, mat.thickness);
    const theta = 1e-6;
    const ur = new Float64Array([
      -theta * p0.y, theta * p0.x,
      -theta * p1.y, theta * p1.x,
      -theta * p2.y, theta * p2.x,
    ]);
    const f = new Float64Array(6);
    for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) f[i] += Ke[i * 6 + j] * ur[j];
    // 线性单元下刚体转动应当严格零能
    assert.ok(Math.max(...f.map(Math.abs)) < 1e-6 * 10);
  });

  test('平面应力 D 矩阵系数正确', () => {
    const D = constitutiveMatrix(mat);
    const f = mat.E / (1 - 0.3 * 0.3);
    assert.ok(Math.abs(D[0] - f) < 1e-6);
    assert.ok(Math.abs(D[1] - f * 0.3) < 1e-6);
    assert.ok(Math.abs(D[8] - f * 0.35) < 1e-6);
  });

  test('平面应变 D 矩阵与平面应力不同', () => {
    const Dps = constitutiveMatrix(mat);
    const Dpe = constitutiveMatrix({ ...mat, model: 'planeStrain' });
    assert.ok(Math.abs(Dpe[0] - Dps[0]) > 1);
    // E(1-ν)/((1+ν)(1-2ν))
    const expected = (mat.E * 0.7) / (1.3 * 0.4);
    assert.ok(Math.abs(Dpe[0] - expected) < 1e-6);
  });

  test('正三角形质量为 1，退化三角形质量为 0', () => {
    const q = triangleQuality({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0.5, y: Math.sqrt(3) / 2 });
    assert.ok(Math.abs(q - 1) < 1e-9);
    const qd = triangleQuality({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 1e-9 });
    assert.ok(qd < 0.01);
  });
});
