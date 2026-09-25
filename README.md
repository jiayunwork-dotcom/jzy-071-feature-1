# FEM2D · 二维有限元静力分析教学工具

一个在浏览器中运行的平面应力 / 平面应变线弹性有限元分析工具。学习者可以：

- 逐点点击勾勒封闭多边形，或选用参数化模板（矩形梁、L 形、带圆孔板），生成后顶点可拖动；
- 对封闭区域做约束 Delaunay 三角剖分，调节全局种子间距，查看节点/单元数、内角逐项、单元质量统计；
- 设置材料（E、ν、厚度，平面应力 / 平面应变切换）、约束（固定、水平 / 竖直单向滑移）、节点集中力、分布面力与全域体力；
- 后端内核完成 单元刚度 → 整体装配 → 边界条件 → 求解 Ku=F → 应力回代 的完整链路；
- 画布叠加变形图（可调放大系数、原始形状对照）与 σx / σy / τxy / von Mises 应力云图（连续色带 + 数值图例）；
- 对同一几何逐级加密网格，记录「单元数 — 最大应力 / 位移」收敛曲线，观察网格无关性。

## 架构（npm workspaces monorepo）

```
packages/
  core/      FEM 计算内核（TypeScript，无 DOM 依赖，可独立测试/复用）
    src/
      types.ts          数据类型、SingularMatrixError
      element.ts        CST 三节点单元：面积、形函数梯度、B、Ke、应力、质量
      material.ts       平面应力 / 平面应变本构矩阵 D
      mesh/             geometry / topology / triangulate(cdt2d) / structured / templates
      conditions.ts     几何 region → 自由度约束、节点载荷、边面力、体力装配
      assembly.ts       稀疏 CSR 整体刚度装配 + 位移边界条件
      solver.ts         稠密 LDLᵀ（含小主元奇异检测）+ Jacobi-PCG
      stress.ts         单元常应力、节点平均应力、支反力
      analyze.ts        完整静力分析流水线
      convergence.ts    网格无关性研究
      examples.ts       内置标准算例（含解析/参考解）
      serialize.ts      前后端 DTO
  server/    Express 服务（/api/mesh /api/analyze /api/convergence /api/examples）+ 静态托管前端
  frontend/  Svelte 4 + TypeScript + Vite
    src/
      components/        画布交互、工具栏、几何/材料/边界条件/求解/结果/收敛面板
      lib/               视图变换、网格/边界符号/结果渲染、色带
```

## 快速开始

```bash
npm install
npm run dev          # 前端 Vite (5173) + 后端 (3000)，前端代理 /api
# 或生产模式：
npm run build        # 依次构建 core / frontend / server
npm start            # http://localhost:3000 （单端口同时提供页面与 API）
```

### Docker

```bash
docker compose up --build
# 打开 http://localhost:3000
```

## 内核理论要点

- 单元：三节点常应变三角形（CST）。形函数梯度与面积由节点坐标直接得到，
  `B(3×6)`，`Ke = t·A·Bᵀ·D·B`。
- 平面应力 `D = E/(1−ν²)[1, ν, 0; ν, 1, 0; 0, 0, (1−ν)/2]`；
  平面应变 `D = E/((1+ν)(1−2ν))[1−ν, ν, 0; ν, 1−ν, 0; 0, 0, (1−2ν)/2]`。
- 整体刚度为稀疏 CSR；约束按自由度置 1 消行消列（保持对称）。
- 求解：≤500 自由度用稠密 LDLᵀ 并以小主元计数报告无约束机构数量；
  更大系统用 Jacobi 预处理共轭梯度，出现非正曲率 / 不收敛时给出约束不足提示，不崩溃。
- 应力：CST 单元内 σ 为常数；节点应力取相邻单元平均用于连续色带。

## 内置标准算例

1. **悬臂梁**（端部集中力）：梁理论端部挠度 δ=PL³/(3EI)、固定端 σ=Mc/I。
   默认网格下偏差约 8%，加密后趋于理论值（收敛曲线可见）。
2. **带圆孔板单向拉伸（四分之一对称模型）**：Kirsch 孔边应力集中系数 K=3。

## 自动化测试（覆盖内核正确性，可独立运行）

```bash
npm test -w @fem2d/core
# 或：cd packages/core && npm test
```

测试锁住以下结论（共 31 项）：

- 单个三角单元 Ke **对称**；恰好有 **3 个零能模式**（x、y 刚体平移 + 转动），其余特征值为正；
- 规则网格**严格分片试验**（σx 精确等于施加值、位移场严格线性），非规则 Delaunay 网格近似成立；
- 悬臂梁细网格最大位移与梁理论偏差 < 12%，且随加密收敛；固定端弯曲应力与 σ=Mc/I 一致；
- **无约束 / 约束不足 → 抛 SingularMatrixError**（不崩溃，给出机构自由度提示）；
- 载荷放大 k 倍，位移与应力**严格等比例**放大；
- **平面应力与平面应变结果不同**，纯弯曲位移比 ≈ 1−ν²；
- 支反力与外载满足合力、合力矩平衡；体力合力等于 γ·V·t；
- 网格剖分合法（无重叠、无悬挂节点、边界完整覆盖），孔内无单元；
- 网格无关性研究单调加密、孔板应力集中系数趋于 3。

## 单位制

界面不绑定单位，建议统一使用 **mm – N – MPa**（钢材 E=210000 MPa）。所有力、应力、位移量纲在该单位制下自洽。
