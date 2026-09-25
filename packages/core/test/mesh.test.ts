import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { triangulate } from '../src/mesh/triangulate.js';
import { structuredRectangle, divisionsForSeed } from '../src/mesh/structured.js';
import {
  rectangleTemplate,
  lShapeTemplate,
  plateWithHoleTemplate,
  quarterPlateHoleTemplate,
} from '../src/mesh/templates.js';
import { findBoundaryEdges, edgeKey } from '../src/mesh/topology.js';
import { pointInPolygon } from '../src/mesh/geometry.js';
import type { Polygon, Vec2 } from '../src/types.js';

function verifyTopology(nodes: Vec2[], elements: [number, number, number][]) {
  const count = new Map<string, number>();
  for (const tri of elements) {
    assert.equal(new Set(tri).size, 3, '单元含重复节点');
    for (const [a, b] of [[tri[0], tri[1]], [tri[1], tri[2]], [tri[2], tri[0]]] as [number, number][]) {
      const k = edgeKey(a, b);
      count.set(k, (count.get(k) ?? 0) + 1);
    }
    // 重心应位于凸包……对非凸区域用面积为正检查
    const pa = nodes[tri[0]], pb = nodes[tri[1]], pc = nodes[tri[2]];
    const a2 = (pb.x - pa.x) * (pc.y - pa.y) - (pb.y - pa.y) * (pc.x - pa.x);
    // 允许定向后都为正
    assert.ok(Math.abs(a2) > 1e-12, '退化单元');
  }
  for (const [k, c] of count) {
    assert.ok(c === 1 || c === 2, `边 ${k} 被 ${c} 个单元引用（重叠/悬挂）`);
  }
}

describe('Delaunay 三角剖分', () => {
  test('矩形：网格合法、边计数 1 或 2、统计量合理', () => {
    const poly = rectangleTemplate(100, 40);
    const mesh = triangulate(poly, { globalSeed: 12 });
    assert.ok(mesh.elements.length > 20);
    assert.ok(mesh.stats.nodeCount > 15);
    // 最小角 > 15°，最大角 < 150°（Delaunay 的合理范围）
    assert.ok(mesh.stats.minAngle > (15 * Math.PI) / 180, `minAngle=${(mesh.stats.minAngle * 180) / Math.PI}°`);
    assert.ok(mesh.stats.maxAngle < (150 * Math.PI) / 180);
    assert.ok(mesh.stats.meanQuality > 0.6);
    assert.ok(mesh.stats.minQuality > 0.2);
    verifyTopology(mesh.nodes, mesh.elements);
    // 所有重心落在区域内
    for (const [a, b, c] of mesh.elements) {
      const g = {
        x: (mesh.nodes[a].x + mesh.nodes[b].x + mesh.nodes[c].x) / 3,
        y: (mesh.nodes[a].y + mesh.nodes[b].y + mesh.nodes[c].y) / 3,
      };
      assert.ok(pointInPolygon(g, poly), '单元重心落在区域外');
    }
  });

  test('网格密度随种子间距变化', () => {
    const poly = rectangleTemplate(100, 40);
    const coarse = triangulate(poly, { globalSeed: 25 });
    const fine = triangulate(poly, { globalSeed: 8 });
    assert.ok(fine.elements.length > coarse.elements.length * 2);
  });

  test('L 形（非凸）：重心全部在多边形内，边界边形成单一闭合环', () => {
    const poly = lShapeTemplate(60, 60, 20);
    const mesh = triangulate(poly, { globalSeed: 8 });
    for (const [a, b, c] of mesh.elements) {
      const g = {
        x: (mesh.nodes[a].x + mesh.nodes[b].x + mesh.nodes[c].x) / 3,
        y: (mesh.nodes[a].y + mesh.nodes[b].y + mesh.nodes[c].y) / 3,
      };
      assert.ok(pointInPolygon(g, poly), 'L 形单元重心落在区域外（可能填进了凹口）');
    }
    verifyTopology(mesh.nodes, mesh.elements);
    // 边界边数 = 外轮廓细分后的顶点数
    const bnd = mesh.boundaryEdges;
    const degree = new Map<number, number>();
    for (const [a, b] of bnd) {
      degree.set(a, (degree.get(a) ?? 0) + 1);
      degree.set(b, (degree.get(b) ?? 0) + 1);
    }
    for (const [, d] of degree) assert.equal(d, 2, '边界边未形成闭合环');
  });

  test('带圆孔板：孔内无单元，孔边界存在闭合内环', () => {
    const poly = plateWithHoleTemplate(100, 60, 10, 24);
    const mesh = triangulate(poly, { globalSeed: 8 });
    verifyTopology(mesh.nodes, mesh.elements);
    for (const [a, b, c] of mesh.elements) {
      const g = {
        x: (mesh.nodes[a].x + mesh.nodes[b].x + mesh.nodes[c].x) / 3,
        y: (mesh.nodes[a].y + mesh.nodes[b].y + mesh.nodes[c].y) / 3,
      };
      assert.ok(pointInPolygon(g, poly), '单元落入圆孔内');
    }
    // 应有两组边界环（外边界 + 孔边界）
    const adj = new Map<number, number[]>();
    for (const [a, b] of mesh.boundaryEdges) {
      if (!adj.has(a)) adj.set(a, []);
      if (!adj.has(b)) adj.set(b, []);
      adj.get(a)!.push(b);
      adj.get(b)!.push(a);
    }
    const visited = new Set<number>();
    let loops = 0;
    for (const start of adj.keys()) {
      if (visited.has(start)) continue;
      loops++;
      let cur = start;
      let prev = -1;
      do {
        visited.add(cur);
        const nxt = adj.get(cur)!.find((n) => n !== prev) ?? -1;
        prev = cur;
        cur = nxt;
      } while (cur !== -1 && !visited.has(cur));
    }
    assert.equal(loops, 2, `期望 2 个边界环（外边界+孔），实际 ${loops}`);
  });

  test('四分之一带孔板模板：凹圆弧重心检查通过', () => {
    const poly = quarterPlateHoleTemplate(10, 50, 50, 16);
    const mesh = triangulate(poly, { globalSeed: 6 });
    verifyTopology(mesh.nodes, mesh.elements);
    for (const [a, b, c] of mesh.elements) {
      const g = {
        x: (mesh.nodes[a].x + mesh.nodes[b].x + mesh.nodes[c].x) / 3,
        y: (mesh.nodes[a].y + mesh.nodes[b].y + mesh.nodes[c].y) / 3,
      };
      assert.ok(pointInPolygon(g, poly));
    }
  });

  test('边界完整覆盖：每条输入边界段都有单元相邻', () => {
    const poly = rectangleTemplate(100, 40);
    const mesh = triangulate(poly, { globalSeed: 10 });
    // 边界边中点构成的总长度 ≈ 周长 280
    let bndLen = 0;
    for (const [a, b] of mesh.boundaryEdges) {
      bndLen += Math.hypot(mesh.nodes[a].x - mesh.nodes[b].x, mesh.nodes[a].y - mesh.nodes[b].y);
    }
    assert.ok(Math.abs(bndLen - 280) < 1e-6, `边界长度 ${bndLen} ≠ 周长 280`);
  });

  test('顶点太少时抛出友好错误', () => {
    assert.throws(() => triangulate({ outer: [{ x: 0, y: 0 }, { x: 1, y: 0 }], holes: [] }, { globalSeed: 1 }));
  });
});

describe('结构化矩形网格', () => {
  test('节点与单元数量正确（nx×ny 矩形 → 2nxny 三角形）', () => {
    const m = structuredRectangle(0, 0, 10, 4, 10, 4);
    assert.equal(m.nodes.length, 11 * 5);
    assert.equal(m.elements.length, 2 * 10 * 4);
    assert.equal(findBoundaryEdges(m.elements).length, 2 * (10 + 4));
  });

  test('divisionsForSeed 随种子变化', () => {
    const a = divisionsForSeed(100, 20, 10);
    const b = divisionsForSeed(100, 20, 5);
    assert.equal(a.nx, 10);
    assert.equal(b.nx, 20);
  });
});
