export { triangulate, MeshError } from './triangulate.js';
export { structuredRectangle, divisionsForSeed } from './structured.js';
export { buildTemplate, TEMPLATE_LABELS } from './templates.js';
export type { TemplateKind, TemplateParams } from './templates.js';
export {
  orientPolygon,
  pointInPolygon,
  pointInLoop,
  distanceToSegment,
  polygonBounds,
  signedArea,
} from './geometry.js';
export { findBoundaryEdges, validateMesh } from './topology.js';
export type { MeshValidity } from './topology.js';
