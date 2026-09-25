/**
 * 网格无关性验证测试：
 * - 悬臂梁随网格加密，最大位移单调趋于梁理论值；
 * - runConvergence 返回逐级记录；
 * - 圆孔板（四分之一模型）孔边应力集中系数随加密趋于理论值 3。
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { runConvergence } from '../src/convergence.js';
import { rectangleTemplate, quarterPlateHoleTemplate } from '../src/mesh/templates.js';
import type { Material } from '../src/types.js';

const steel: Material = { E: 210000, nu: 0.3, thickness: 10, model: 'planeStress' };

describe('网格无关性 / 收敛研究', () => {
  test('悬臂梁：加密时最大位移单调变化并趋于平台值', () => {
    const L = 100, H = 10, t = 10, P = 100;
    const I = (t * H ** 3) / 12;
    const beamTip = (P * L ** 3) / (3 * steel.E * I);

    const study = runConvergence(
      rectangleTemplate(L, H),
      steel,
      [
        { id: 'fix', region: { kind: 'line', x1: 0, y1: 0, x2: 0, y2: H }, type: 'fixed' },
      ],
      [{ id: 'p', region: { kind: 'point', x: L, y: H / 2 }, fx: 0, fy: -P }],
      [],
      undefined,
      12,
      { levels: 6, refineFactor: 0.62, denseThreshold: 100000, maxElements: 20000 },
    );
    assert.equal(study.error, undefined, study.error);
    assert.ok(study.levels.length >= 4);
    // 单元数严格递增
    for (let i = 1; i < study.levels.length; i++) {
      assert.ok(study.levels[i].elementCount > study.levels[i - 1].elementCount);
    }
    // 位移整体上升并在最细两级接近（CST 弯曲问题收敛偏慢）
    const d = study.levels.map((l) => l.maxDisplacement);
    assert.ok(d[0] < d[d.length - 1]);
    const lastChange = Math.abs(d[d.length - 1] - d[d.length - 2]) / d[d.length - 1];
    assert.ok(lastChange < 0.12, `最细两级位移变化 ${(lastChange * 100).toFixed(2)}% 应收敛`);
    // 变化趋势应收窄
    const prevChange = Math.abs(d[d.length - 2] - d[d.length - 3]) / d[d.length - 2];
    assert.ok(lastChange < prevChange, '加密时位移增量应递减');
    // 最细网格结果与梁理论偏差 < 15%
    assert.ok(Math.abs(d[d.length - 1] - beamTip) / beamTip < 0.15);
  });

  test('带孔板单向拉伸：孔边应力集中系数随加密趋于 3（Kirsch 解）', () => {
    const r = 10;
    const poly = quarterPlateHoleTemplate(r, 50, 50, 20);
    const sigma0 = 10; // 远端 x 向拉应力
    // 四分之一模型：底边 uy=0（滑移），左边 ux=0；右边施加 x 向面力 σ0
    const study = runConvergence(
      poly,
      steel,
      [
        // 底边竖直滑移（uy=0）
        { id: 'bot', region: { kind: 'line', x1: r, y1: 0, x2: 50, y2: 0 }, type: 'slideY' },
        // 左边（孔边弧底端到 y 轴段）水平滑移 ux=0：该边是 x=0 的竖直线段 (0,r)-(0,H)
        { id: 'left', region: { kind: 'line', x1: 0, y1: r, x2: 0, y2: 50 }, type: 'slideX' },
        // 左下角 (0,50) 区域无交点；需要一个销接点防 y 平移：左上角顶点
        { id: 'pin', region: { kind: 'point', x: 0, y: 50 }, type: 'fixed' },
      ],
      [],
      [
        { id: 'pull', region: { kind: 'line', x1: 50, y1: 0, x2: 50, y2: 50 }, tx: sigma0, ty: 0 },
      ],
      undefined,
      9,
      { levels: 3, refineFactor: 0.62, denseThreshold: 100000, maxElements: 20000 },
    );
    assert.equal(study.error, undefined, study.error);
    assert.ok(study.levels.length >= 2);
    // 孔边 (r,0) 处 σx 理论值 = 3σ0。用节点平均应力 maxSx 近似
    const finest = study.levels[study.levels.length - 1];
    const ratio = finest.maxSx / sigma0;
    assert.ok(ratio > 2.4 && ratio < 3.6, `应力集中系数 ${ratio.toFixed(2)} 应接近 3`);
  });
});
