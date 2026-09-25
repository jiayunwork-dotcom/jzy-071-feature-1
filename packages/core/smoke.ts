import { structuredRectangle } from './src/mesh/structured.js';
import { analyzeModes } from './src/modal.js';
import type { FemModel } from './src/types.js';
import { cantileverBeamFrequencies } from './src/analytic.js';

// 细长悬臂梁 L=100, H=4, 细网格
const L = 100, H = 4, t = 1;
const E = 210000, nu = 0.3, rho = 7.85e-9;
const mesh = structuredRectangle(0, -H / 2, L, H / 2, 50, 2);
const model: FemModel = {
  polygon: { outer: [], holes: [] } as never,
  mesh,
  material: { E, nu, thickness: t, model: 'planeStress', density: rho },
  supports: [
    { id: 'fix', region: { kind: 'line', x1: 0, y1: -H / 2, x2: 0, y2: H / 2 }, type: 'fixed' },
  ],
  nodalLoads: [],
  tractionLoads: [],
};

const ref = cantileverBeamFrequencies(E, nu, rho, t, L, H);
for (const form of ['consistent', 'lumped'] as const) {
  const res = analyzeModes(model, { modes: 8, massFormulation: form });
  console.log(`\n== ${form} == rigid=${res.rigidBodyModes} solver=${res.diagnostics.solver} iters=${res.diagnostics.iterations}`);
  res.modes.forEach((m) => {
    const r = ref.find((x) => x.kind === 'bend' && x.order === m.order);
    const rq = Math.abs(m.rayleighQuotient - m.lambda) / m.lambda;
    console.log(
      `mode ${m.order}: f=${m.hz.toFixed(2)} Hz  omega=${m.omega.toFixed(2)}  ` +
      `res=${m.residual.toExponential(1)}  RQerr=${rq.toExponential(1)}` +
      (r ? `  ref=${r.hz.toFixed(2)} (${(100 * (m.hz - r.hz) / r.hz).toFixed(1)}%)` : ''),
    );
  });
}
