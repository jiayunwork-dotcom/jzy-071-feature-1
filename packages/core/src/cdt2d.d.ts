declare module 'cdt2d' {
  interface CDTOptions {
    /** 是否保留内部三角形（默认 true） */
    interior?: boolean;
    /** 是否保留外部三角形（默认 true；对带孔区域通常设 false） */
    exterior?: boolean;
    /** 是否加入无穷远面 */
    infinity?: boolean;
    /** 内部点是否允许被插入（默认 true） */
    interiorOnly?: boolean;
    /** 随机扰动次数 */
    randomization?: boolean | number;
  }
  function cdt2d(
    points: Array<[number, number] | number[]>,
    edges?: Array<[number, number] | number[]>,
    options?: CDTOptions,
  ): number[][];
  export default cdt2d;
}
