/**
 * FEM2D HTTP 服务：
 * - POST /api/mesh          三角剖分
 * - POST /api/analyze       静力求解（位移+应力）
 * - POST /api/vibration     自由振动（固有频率+振型）
 * - POST /api/convergence   网格无关性研究
 * - GET  /api/examples      标准算例列表
 * - GET  /api/examples/:id  载入标准算例（含已剖分网格）
 * - 静态托管前端构建产物（dist/public）
 */
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  analyze,
  analyzeVibration,
  triangulate,
  runConvergence,
  meshToModel,
  resultToDTO,
  vibrationToDTO,
  EXAMPLE_CASES,
  getExample,
  SingularMatrixError,
  MeshError,
  type Polygon,
  type MeshParams,
  type Material,
  type Support,
  type NodalLoad,
  type TractionLoad,
  type BodyLoad,
  type MassMatrixType,
} from '@fem2d/core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'fem2d', time: new Date().toISOString() });
});

app.get('/api/examples', (_req, res) => {
  res.json({
    examples: EXAMPLE_CASES.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      seed: c.seed,
      reference: c.reference,
      vibration: c.vibration,
    })),
  });
});

app.get('/api/examples/:id', (req, res) => {
  const ex = getExample(req.params.id);
  if (!ex) {
    res.status(404).json({ error: `未找到算例 ${req.params.id}` });
    return;
  }
  const model = ex.buildModel(ex.seed);
  res.json({
    id: ex.id,
    name: ex.name,
    description: ex.description,
    seed: ex.seed,
    material: model.material,
    polygon: model.polygon,
    mesh: model.mesh,
    supports: model.supports,
    nodalLoads: model.nodalLoads,
    tractionLoads: model.tractionLoads,
    bodyLoad: model.bodyLoad,
    reference: ex.reference,
    vibration: ex.vibration,
  });
});

app.post('/api/mesh', (req, res) => {
  try {
    const { polygon, params } = req.body as { polygon: Polygon; params: MeshParams };
    if (!polygon || !Array.isArray(polygon.outer) || polygon.outer.length < 3) {
      res.status(400).json({ error: '需要至少 3 个顶点的封闭多边形' });
      return;
    }
    const mesh = triangulate(polygon, params ?? { globalSeed: 10 });
    res.json({ mesh });
  } catch (err) {
    respondError(res, err);
  }
});

app.post('/api/analyze', (req, res) => {
  try {
    const dto = req.body;
    const model = meshToModel(dto);
    const result = analyze(model, { denseThreshold: 2000 });
    res.json({ result: resultToDTO(result) });
  } catch (err) {
    respondError(res, err);
  }
});

app.post('/api/vibration', (req, res) => {
  try {
    const { modeCount, massMatrix } = req.body as {
      modeCount?: number;
      massMatrix?: MassMatrixType;
    };
    const model = meshToModel(req.body);
    const result = analyzeVibration(model, {
      modeCount: clampModeCount(modeCount),
      massMatrix: massMatrix === 'lumped' ? 'lumped' : 'consistent',
      denseThreshold: 2000,
    });
    res.json({ result: vibrationToDTO(result) });
  } catch (err) {
    respondError(res, err);
  }
});

function clampModeCount(n: unknown): number {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return 6;
  return Math.max(1, Math.min(30, Math.round(v)));
}

app.post('/api/convergence', (req, res) => {
  try {
    const {
      polygon,
      material,
      supports,
      nodalLoads,
      tractionLoads,
      bodyLoad,
      seed,
      levels,
      refineFactor,
    } = req.body as {
      polygon: Polygon;
      material: Material;
      supports: Support[];
      nodalLoads: NodalLoad[];
      tractionLoads: TractionLoad[];
      bodyLoad?: BodyLoad;
      seed: number;
      levels?: number;
      refineFactor?: number;
    };
    const study = runConvergence(
      polygon,
      material,
      supports ?? [],
      nodalLoads ?? [],
      tractionLoads ?? [],
      bodyLoad,
      seed,
      { levels: levels ?? 5, refineFactor: refineFactor ?? 0.65, denseThreshold: 100000, maxElements: 30000 },
    );
    res.json({ study });
  } catch (err) {
    respondError(res, err);
  }
});

function respondError(res: express.Response, err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  if (err instanceof SingularMatrixError) {
    res.status(422).json({ error: err.message, kind: 'singular', nullity: err.nullity });
    return;
  }
  if (err instanceof MeshError) {
    res.status(422).json({ error: err.message, kind: 'mesh' });
    return;
  }
  res.status(400).json({ error: message, kind: 'unknown' });
}

// 静态托管前端（dist/index.js 位于 packages/server/dist，前端在 packages/frontend/dist）
const publicDir = path.resolve(__dirname, '../../frontend/dist');
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
  app.get(/^\/(?!api).*/, (_req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });
} else {
  app.get('/', (_req, res) => {
    res.send('FEM2D API 已启动，但未找到前端构建产物。开发模式请访问 Vite (5173)。');
  });
}

const PORT = Number(process.env.PORT ?? 3000);
app.listen(PORT, () => {
  console.log(`FEM2D 服务已启动: http://localhost:${PORT}`);
});
