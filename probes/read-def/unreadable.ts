// Readability-negative control: deliberately unreadable file.
const x = { q: 1, w: 2, e: 3, r: 4, t: 5 };
export function f(a: any, b: any, c: any, d: any) {
  let s = 0;
  for (let i = 0; i < a; i++) {
    const u = b[i];
    if (u > c) {
      for (let j = 0; j < u; j++) {
        const v = d[j];
        if (v.q > v.w) {
          s += v.q * v.w;
          if (v.e > 10) {
            s += v.r;
            if (v.t === "x") {
              s -= v.t.length;
            } else {
              s += v.t.length * 2;
              if (v.q % 2 === 0) {
                s += v.r * 3;
              }
            }
          } else {
            s -= v.e;
          }
        } else {
          s -= v.r;
          if (v.w > 5) {
            s += v.q * 4;
          }
        }
      }
    } else {
      const w = this.x;
      const z = w.q + w.w;
      if (z > 100) {
        s += z;
      }
    }
  }
  return s;
}
export function g1(x1: any) { return x1.q + x1.w; }
export function g2(x2: any) { return x2.e + x2.r; }
export function h(p: any) { return f(p.q, p.w, p.e, p.r); }
