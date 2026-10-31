/* Orbit - 矢量导出后端（canvas 2D 录制 → 真矢量 SVG / PDF，零依赖）
 *
 * 思路：把每个轨道的绘制函数原样跑一遍，但把 CanvasRenderingContext2D 换成
 * 这里的 Rec 记录器（同一套 API），得到的是一串与分辨率无关的绘图指令，
 * 再分别序列化成 SVG 和 PDF。所以导出的是线和字，不是一张位图。
 *
 *   const rec = new VEX.Rec();
 *   rec.setTransform(1, 0, 0, 1, dx, dy);   // 指到这一块画布的左上角
 *   drawXxx(rec, ...);                       // 原绘制函数
 *   const svg = VEX.toSVG(rec.ops, w, h);    // 真矢量
 *   const pdf = await VEX.toPDF(rec.ops, w, h, font);
 */
(() => {
  'use strict';

  const IDENT = [1, 0, 0, 1, 0, 0];
  const PT = 0.75;               // CSS px(96dpi) → PDF pt

  /* ------------------------------------------------------------------ 颜色 */
  const colorCache = new Map();
  const NAMED = {
    white: [255, 255, 255], black: [0, 0, 0], red: [255, 0, 0],
    gray: [128, 128, 128], grey: [128, 128, 128], transparent: [0, 0, 0, 0],
  };

  function col(s) {
    const key = typeof s === 'string' ? s : '#000';
    const hit = colorCache.get(key);
    if (hit) return hit;
    let out = [0, 0, 0, 1];
    const t = key.trim().toLowerCase();
    if (t[0] === '#') {
      let h = t.slice(1);
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      if (h.length === 8) { out = [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), parseInt(h.slice(6, 8), 16) / 255]; }
      else out = [parseInt(h.slice(0, 2), 16) || 0, parseInt(h.slice(2, 4), 16) || 0, parseInt(h.slice(4, 6), 16) || 0, 1];
    } else if (t.startsWith('rgb')) {
      const m = /rgba?\(([^)]+)\)/.exec(t);
      if (m) {
        const p = m[1].split(/[,/\s]+/).filter(Boolean).map(parseFloat);
        out = [p[0] | 0, p[1] | 0, p[2] | 0, p.length > 3 ? p[3] : 1];
      }
    } else if (NAMED[t]) {
      out = NAMED[t].length === 4 ? NAMED[t].slice() : [...NAMED[t], 1];
    } else {
      // 解析不了的颜色（比如 currentColor）交给浏览器算一遍
      out = probeColor(key);
    }
    colorCache.set(key, out);
    return out;
  }

  let probe = null;
  function probeColor(s) {
    if (!probe) {
      const c = document.createElement('canvas');
      c.width = c.height = 1;
      probe = c.getContext('2d');
    }
    probe.fillStyle = '#000';
    probe.fillStyle = s;
    const v = probe.fillStyle;
    if (typeof v === 'string' && v !== s) return col(v);
    return [0, 0, 0, 1];
  }

  const hex = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  function cssColor(c) {
    return `#${hex(c[0])}${hex(c[1])}${hex(c[2])}`;
  }
  const num = (v) => (Math.round(v * 100) / 100).toString();

  /* ---------------------------------------------------------------- 几何 */
  function mul(m, n) {
    return [
      m[0] * n[0] + m[2] * n[1],
      m[1] * n[0] + m[3] * n[1],
      m[0] * n[2] + m[2] * n[3],
      m[1] * n[2] + m[3] * n[3],
      m[0] * n[4] + m[2] * n[5] + m[4],
      m[1] * n[4] + m[3] * n[5] + m[5],
    ];
  }
  function xy(m, x, y) { return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]; }
  function scaleOf(m) { return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1; }

  /* --------------------------------------------------------------- 字体解析 */
  function tagAt(dv, o) {
    return String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));
  }

  /* 读 TTF/OTF（纯 JS，只用 sfnt 的 head/hhea/maxp/hmtx/cmap + glyf/loca） */
  function parseFont(input) {
    const buf = input instanceof Uint8Array
      ? (input.byteOffset === 0 && input.byteLength === input.buffer.byteLength ? input : input.slice())
      : new Uint8Array(input);
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    let base = 0;
    if (tagAt(dv, 0) === 'ttcf') base = dv.getUint32(12);
    const n = dv.getUint16(base + 4);
    const T = {};
    for (let i = 0; i < n; i++) {
      const o = base + 12 + i * 16;
      T[tagAt(dv, o)] = { off: dv.getUint32(o + 8), len: dv.getUint32(o + 12) };
    }
    if (!T.head || !T.maxp || !T.hhea || !T.hmtx || !T.cmap) throw new Error('字体缺少必要表');

    const unitsPerEm = dv.getUint16(T.head.off + 18);
    const indexToLoc = dv.getInt16(T.head.off + 50);
    const bbox = [
      dv.getInt16(T.head.off + 36), dv.getInt16(T.head.off + 38),
      dv.getInt16(T.head.off + 40), dv.getInt16(T.head.off + 42),
    ];
    const numGlyphs = dv.getUint16(T.maxp.off + 4);
    const nHmtx = dv.getUint16(T.hhea.off + 34);
    const ascent = dv.getInt16(T.hhea.off + 4);
    const descent = dv.getInt16(T.hhea.off + 6);

    const advance = (gid) => {
      const g = Math.min(gid, nHmtx - 1);
      return dv.getUint16(T.hmtx.off + g * 4);
    };

    // ---- cmap：优先 (3,10) 格式 12，其次 (3,1) 格式 4
    const cm = T.cmap;
    const nSub = dv.getUint16(cm.off + 2);
    let sub12 = 0, sub4 = 0;
    for (let i = 0; i < nSub; i++) {
      const o = cm.off + 4 + i * 8;
      const pid = dv.getUint16(o), eid = dv.getUint16(o + 2), off = dv.getUint32(o + 4);
      const fmt = dv.getUint16(cm.off + off);
      if (pid === 3 && eid === 10 && fmt === 12) sub12 = cm.off + off;
      if (pid === 3 && eid === 1 && fmt === 4) sub4 = cm.off + off;
      if (!sub12 && !sub4 && pid === 0 && fmt === 4) sub4 = cm.off + off;
    }

    function gidOf(code) {
      if (sub12) {
        const nGroups = dv.getUint32(sub12 + 12);
        let lo = 0, hi = nGroups - 1;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          const o = sub12 + 16 + mid * 12;
          const s = dv.getUint32(o), e = dv.getUint32(o + 4), g = dv.getUint32(o + 8);
          if (code < s) hi = mid - 1;
          else if (code > e) lo = mid + 1;
          else return g + (code - s);
        }
        return 0;
      }
      if (sub4 && code <= 0xffff) {
        const segX2 = dv.getUint16(sub4 + 6);
        const seg = segX2 / 2;
        const endO = sub4 + 14;
        const startO = endO + segX2 + 2;
        const deltaO = startO + segX2;
        const rangeO = deltaO + segX2;
        for (let i = 0; i < seg; i++) {
          const end = dv.getUint16(endO + i * 2);
          if (code > end) continue;
          const start = dv.getUint16(startO + i * 2);
          if (code < start) return 0;
          const delta = dv.getInt16(deltaO + i * 2);
          const ro = dv.getUint16(rangeO + i * 2);
          if (!ro) return (code + delta) & 0xffff;
          const g = dv.getUint16(rangeO + i * 2 + ro + (code - start) * 2);
          return g ? (g + delta) & 0xffff : 0;
        }
      }
      return 0;
    }

    // ---- glyf / loca
    const loca = new Uint32Array(numGlyphs + 1);
    for (let i = 0; i <= numGlyphs; i++) {
      loca[i] = indexToLoc
        ? dv.getUint32(T.loca.off + i * 4)
        : dv.getUint16(T.loca.off + i * 2) * 2;
    }

    return {
      buf, dv, T, unitsPerEm, numGlyphs, ascent, descent, bbox, gidOf, advance, loca,
      name: 'CJK',
    };
  }

  /* 只保留用到的字形（gid 保持不变，未用到的置空）——这样 cmap/hmtx 都还成立，
     不需要重新编号，出错面最小。 */
  function subsetFont(f) {
    const { dv, T, numGlyphs, loca } = f;
    const glyfOff = T.glyf.off;
    const used = new Set([0, ...f.usedGids]);
    // 复合字形引用的子字形也要留下
    const queue = [...used];
    const isComposite = (g) => loca[g] < loca[g + 1] && dv.getInt16(glyfOff + loca[g]) < 0;
    while (queue.length) {
      const g = queue.pop();
      if (!isComposite(g)) continue;
      let p = glyfOff + loca[g] + 10;
      for (;;) {
        const flags = dv.getUint16(p);
        const comp = dv.getUint16(p + 2);
        if (!used.has(comp)) { used.add(comp); queue.push(comp); }
        p += 4 + (flags & 0x0001 ? 4 : 2) + (flags & 0x0008 ? 2 : 0)
          + (flags & 0x0040 ? 4 : (flags & 0x0080 ? 8 : 0));
        if (!(flags & 0x0020)) break;
      }
    }

    // 新 glyf + loca（loca 一律用 long 格式）
    const parts = [];
    let total = 0;
    const newLoca = new Uint32Array(numGlyphs + 1);
    for (let g = 0; g < numGlyphs; g++) {
      newLoca[g] = total;
      if (!used.has(g)) continue;
      const s = loca[g], e = loca[g + 1];
      if (e <= s) continue;
      let bytes = f.buf.subarray(glyfOff + s, glyfOff + e);
      const pad = (4 - (bytes.length % 4)) % 4;
      if (pad) { const b = new Uint8Array(bytes.length + pad); b.set(bytes); bytes = b; }
      parts.push(bytes);
      total += bytes.length;
    }
    newLoca[numGlyphs] = total;

    const glyf = new Uint8Array(total);
    let at = 0;
    for (const p of parts) { glyf.set(p, at); at += p.length; }
    const locaBytes = new Uint8Array((numGlyphs + 1) * 4);
    const ldv = new DataView(locaBytes.buffer);
    for (let i = 0; i <= numGlyphs; i++) ldv.setUint32(i * 4, newLoca[i]);

    // 其余表原样复制，head 改成 long loca
    const out = [];
    for (const [tag, rec] of Object.entries(T)) {
      if (tag === 'glyf' || tag === 'loca' || tag === 'DSIG' || tag === 'LTSH' || tag === 'hdmx') continue;
      // 注意：f.buf 是 Uint8Array，必须用 slice(off, end) —— 写成 new Uint8Array(buf, off, len)
      // 会被当成「从类数组复制」，把整份字体复制一遍（14 张表 = 175 MB 的教训）
      const data = f.buf.slice(rec.off, rec.off + rec.len);
      if (tag === 'head') {
        const d = new DataView(data.buffer, data.byteOffset, data.byteLength);
        d.setInt16(50, 1);
        d.setUint32(8, 0);                 // checkSumAdjustment 稍后重算
      }
      out.push([tag, data]);
    }
    out.push(['glyf', glyf], ['loca', locaBytes]);
    out.sort((a, b) => (a[0] < b[0] ? -1 : 1));
    return buildSfnt(out);
  }

  function buildSfnt(tables) {
    const n = tables.length;
    const header = new Uint8Array(12 + n * 16);
    const hdv = new DataView(header.buffer);
    hdv.setUint32(0, 0x00010000);
    hdv.setUint16(4, n);
    const pot = 2 ** Math.floor(Math.log2(n));
    hdv.setUint16(6, pot * 16);
    hdv.setUint16(8, Math.log2(pot));
    hdv.setUint16(10, n * 16 - pot * 16);
    let off = 12 + n * 16;
    const chunks = [];
    tables.forEach(([tag, data], i) => {
      const pad = (4 - (off % 4)) % 4;
      if (pad) { chunks.push(new Uint8Array(pad)); off += pad; }
      const o = 12 + i * 16;
      for (let k = 0; k < 4; k++) header[o + k] = tag.charCodeAt(k);
      hdv.setUint32(o + 4, checksum(data));
      hdv.setUint32(o + 8, off);
      hdv.setUint32(o + 12, data.length);
      chunks.push(data);
      off += data.length;
    });
    const total = new Uint8Array(off);
    total.set(header, 0);
    let at = 12 + n * 16;
    for (const c of chunks) { total.set(c, at); at += c.length; }
    // head.checkSumAdjustment = 0xB1B0AFBA - checksum(整个文件)
    const headOff = (() => {
      for (let i = 0; i < n; i++) if (tagAt(new DataView(total.buffer), 12 + i * 16) === 'head') return new DataView(total.buffer).getUint32(12 + i * 16 + 8);
      return 0;
    })();
    if (headOff) {
      const adj = (0xB1B0AFBA - checksum(total)) >>> 0;
      new DataView(total.buffer).setUint32(headOff + 8, adj);
    }
    return total;
  }

  function checksum(u8) {
    let sum = 0;
    const n = u8.length;
    const dv = new DataView(u8.buffer, u8.byteOffset, n);
    const full = n - (n % 4);
    for (let i = 0; i < full; i += 4) sum = (sum + dv.getUint32(i)) >>> 0;
    if (full < n) {
      let v = 0;
      for (let i = 0; i < 4; i++) v = (v << 8) | (full + i < n ? u8[full + i] : 0);
      sum = (sum + (v >>> 0)) >>> 0;
    }
    return sum >>> 0;
  }

  /* ------------------------------------------------------------ 记录器 */
  const measureCv = document.createElement('canvas');
  const measureCtx = measureCv.getContext('2d');

  function fontPx(font) {
    const m = /(\d+(?:\.\d+)?)px/.exec(font);
    return m ? parseFloat(m[1]) : 10;
  }
  function fontWeight(font) {
    const m = /^(normal|bold|\d{3})/.exec(font.trim());
    if (!m) return 400;
    if (m[1] === 'bold') return 700;
    if (m[1] === 'normal') return 400;
    return parseInt(m[1], 10);
  }
  function isMono(font) {
    return /mono|menlo|consolas|courier/i.test(font);
  }

  class Rec {
    constructor() {
      this.ops = [];
      this.m = IDENT.slice();
      this.path = [];
      this.cur = [0, 0];
      this.clips = 0;
      this.st = {
        fillStyle: '#000000', strokeStyle: '#000000', lineWidth: 1, globalAlpha: 1,
        font: '10px sans-serif', textAlign: 'left', textBaseline: 'alphabetic',
        _dash: null, lineCap: 'butt', lineJoin: 'miter',
      };
      this._stack = [];
      this.canvas = { width: 0, height: 0 };
    }

    // ---- 状态
    save() {
      this._stack.push({ st: { ...this.st }, m: this.m.slice(), clips: this.clips, cur: this.cur.slice() });
    }
    restore() {
      const s = this._stack.pop();
      if (!s) return;
      while (this.clips > s.clips) { this.ops.push({ k: 'clipEnd' }); this.clips--; }
      this.st = s.st;
      this.m = s.m;
      this.cur = s.cur;
    }
    setTransform(a, b, c, d, e, f) { this.m = [a, b, c, d, e, f]; }
    translate(x, y) { this.m = mul(this.m, [1, 0, 0, 1, x, y]); }
    scale(x, y) { this.m = mul(this.m, [x, 0, 0, y, 0, 0]); }
    rotate(a) { const c = Math.cos(a), s = Math.sin(a); this.m = mul(this.m, [c, s, -s, c, 0, 0]); }
    setLineDash(d) { this.st._dash = d && d.length ? d.slice() : null; }
    getLineDash() { return this.st._dash || []; }

    // ---- 路径
    // 注意：this.cur 记的是**用户坐标**（未乘 this.m），不是变换后的设备坐标。
    // arcTo()/arc() 要用「当前点 → 拐角」的向量算切线/圆心，如果 cur 是设备坐标，
    // 就会把 canvas 的平移量当成几何量带进圆弧里（每块 canvas 都有 setTransform
    // 平移），圆角条会画成一头尖一头粗的楔形。所以这里存 seg 里的原始坐标。
    _seg(seg) {
      const out = [seg[0]];
      for (let i = 1; i < seg.length; i += 2) {
        const p = xy(this.m, seg[i], seg[i + 1]);
        out.push(p[0], p[1]);
      }
      this.path.push(out);
      if (out.length >= 3) this.cur = [seg[seg.length - 2], seg[seg.length - 1]];
    }
    beginPath() { this.path = []; }
    moveTo(x, y) { this._seg(['M', x, y]); }
    lineTo(x, y) { this._seg(['L', x, y]); }
    // 剪接弧（junction）用 bezierCurveTo 画，缺了这两个方法整份 SVG/PDF 会直接导出失败
    bezierCurveTo(x1, y1, x2, y2, x, y) { this._seg(['C', x1, y1, x2, y2, x, y]); }
    quadraticCurveTo(x1, y1, x, y) {
      // 二次贝塞尔转三次，SVG/PDF 只需要 C
      const p0 = this.cur;
      this._seg(['C',
        p0[0] + (2 / 3) * (x1 - p0[0]), p0[1] + (2 / 3) * (y1 - p0[1]),
        x + (2 / 3) * (x1 - x), y + (2 / 3) * (y1 - y), x, y]);
    }
    closePath() { this.path.push(['Z']); }
    rect(x, y, w, h) {
      this._seg(['M', x, y]); this._seg(['L', x + w, y]);
      this._seg(['L', x + w, y + h]); this._seg(['L', x, y + h]); this.path.push(['Z']);
    }
    arcTo(x1, y1, x2, y2, r) {
      // 空路径时没有「当前点→拐角」的方向，退化成从 (x1,y1) 到 (x2,y2) 的两点弧
      if (!this.path.length) {
        this.moveTo(x1, y1);
        this._twoPointArc(x1, y1, x2, y2, Math.abs(r));
        return;
      }
      const p0 = this.cur;
      const v0 = [p0[0] - x1, p0[1] - y1];
      const v1 = [x2 - x1, y2 - y1];
      const l0 = Math.hypot(v0[0], v0[1]), l1 = Math.hypot(v1[0], v1[1]);
      if (l0 < 1e-6 || l1 < 1e-6 || r <= 0) { this.lineTo(x1, y1); return; }
      const u0 = [v0[0] / l0, v0[1] / l0], u1 = [v1[0] / l1, v1[1] / l1];
      const dot = Math.max(-1, Math.min(1, u0[0] * u1[0] + u0[1] * u1[1]));
      const ang = Math.acos(dot);
      if (ang < 1e-6) { this.lineTo(x1, y1); return; }
      const tl = r / Math.tan(ang / 2);
      const t1 = [x1 + u0[0] * tl, y1 + u0[1] * tl];
      const t2 = [x1 + u1[0] * tl, y1 + u1[1] * tl];
      const bx = u0[0] + u1[0], by = u0[1] + u1[1];
      const bl = Math.hypot(bx, by) || 1;
      const dist = r / Math.sin(ang / 2);
      const cx = x1 + (bx / bl) * dist, cy = y1 + (by / bl) * dist;
      if (Math.hypot(p0[0] - t1[0], p0[1] - t1[1]) > 1e-6) this.lineTo(t1[0], t1[1]);
      const a1 = Math.atan2(t1[1] - cy, t1[0] - cx);
      const a2 = Math.atan2(t2[1] - cy, t2[0] - cx);
      let d = a2 - a1;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this._arc(cx, cy, r, a1, a1 + d);
    }
    // 两点定半径的圆弧（arcTo 在空路径时的语义）
    _twoPointArc(x0, y0, x1, y1, r) {
      const dx = x1 - x0, dy = y1 - y0;
      const d = Math.hypot(dx, dy);
      if (d < 1e-9 || r <= 0) { this.lineTo(x1, y1); return; }
      const h = Math.sqrt(Math.max(0, r * r - (d / 2) * (d / 2)));
      const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
      const cx = mx + (dy / d) * h, cy = my - (dx / d) * h;
      const a0 = Math.atan2(y0 - cy, x0 - cx);
      const a1 = Math.atan2(y1 - cy, x1 - cx);
      let da = a1 - a0;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      this._arc(cx, cy, r, a0, a0 + da);
    }
    _arc(cx, cy, r, a0, a1) {
      const n = Math.max(1, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 2)));
      const da = (a1 - a0) / n;
      const k = (4 / 3) * Math.tan(da / 4);
      let a = a0;
      let p = [cx + r * Math.cos(a), cy + r * Math.sin(a)];
      for (let i = 0; i < n; i++) {
        const b = a + da;
        const q = [cx + r * Math.cos(b), cy + r * Math.sin(b)];
        const c1 = [p[0] - k * r * Math.sin(a), p[1] + k * r * Math.cos(a)];
        const c2 = [q[0] + k * r * Math.sin(b), q[1] - k * r * Math.cos(b)];
        this._seg(['C', c1[0], c1[1], c2[0], c2[1], q[0], q[1]]);
        p = q; a = b;
      }
    }
    arc(cx, cy, r, a0, a1, ccw) {
      let s = a0, e = a1;
      if (ccw) { while (e > s) e -= Math.PI * 2; }
      else { while (e < s) e += Math.PI * 2; }
      const st = [cx + r * Math.cos(s), cy + r * Math.sin(s)];
      if (!this.path.length) this._seg(['M', st[0], st[1]]);
      else this._seg(['L', st[0], st[1]]);
      this._arc(cx, cy, r, s, e);
    }

    // ---- 上色
    _paint() {
      const a = this.st.globalAlpha;
      return {
        fill: cssColor(col(this.st.fillStyle)),
        fillA: col(this.st.fillStyle)[3] * a,
        stroke: cssColor(col(this.st.strokeStyle)),
        strokeA: col(this.st.strokeStyle)[3] * a,
        lw: this.st.lineWidth * scaleOf(this.m),
        dash: this.st._dash ? this.st._dash.map((v) => v * scaleOf(this.m)) : null,
      };
    }
    fill() {
      if (!this.path.length) return;
      const p = this._paint();
      this.ops.push({ k: 'path', d: this.path.slice(), fill: p.fill, fillA: p.fillA });
    }
    stroke() {
      if (!this.path.length) return;
      const p = this._paint();
      this.ops.push({ k: 'path', d: this.path.slice(), stroke: p.stroke, strokeA: p.strokeA, lw: p.lw, dash: p.dash });
    }
    clip() {
      if (!this.path.length) return;
      this.ops.push({ k: 'clip', d: this.path.slice() });
      this.clips++;
    }
    fillRect(x, y, w, h) {
      const p = this._paint();
      const a = xy(this.m, x, y);
      const b = xy(this.m, x + w, y + h);
      this.ops.push({ k: 'rect', x: a[0], y: a[1], w: b[0] - a[0], h: b[1] - a[1], fill: p.fill, fillA: p.fillA });
    }
    strokeRect(x, y, w, h) {
      const p = this._paint();
      const a = xy(this.m, x, y);
      const b = xy(this.m, x + w, y + h);
      this.ops.push({ k: 'rect', x: a[0], y: a[1], w: b[0] - a[0], h: b[1] - a[1], stroke: p.stroke, strokeA: p.strokeA, lw: p.lw, dash: p.dash });
    }
    clearRect() { /* 导出时不产生任何东西 */ }

    // ---- 文本
    measureText(s) {
      measureCtx.font = this.st.font;
      return measureCtx.measureText(s);
    }
    fillText(text, x, y, maxWidth) {
      const s = String(text);
      if (!s) return;
      const m = this.measureText(s);
      const size = fontPx(this.st.font);
      const w0 = m.width;
      // canvas 的第 4 个参数是「最宽多少」：超了就把字横向压扁，这里记下压缩比
      const squeeze = maxWidth > 0 && w0 > maxWidth ? maxWidth / w0 : 1;
      const w = w0 * squeeze;
      let x0 = x;
      if (this.st.textAlign === 'center') x0 = x - w / 2;
      else if (this.st.textAlign === 'right' || this.st.textAlign === 'end') x0 = x - w;
      const asc = m.fontBoundingBoxAscent || size * 0.8;
      const desc = m.fontBoundingBoxDescent || size * 0.2;
      let dy = 0;
      if (this.st.textBaseline === 'middle') dy = (asc - desc) / 2;
      else if (this.st.textBaseline === 'top' || this.st.textBaseline === 'hanging') dy = asc;
      else if (this.st.textBaseline === 'bottom') dy = -desc;
      const p = this._paint();
      const at = xy(this.m, x0, y + dy);
      const sc = scaleOf(this.m);
      this.ops.push({
        k: 'text', x: at[0], y: at[1], s, size: size * sc, w: w * sc, sx: squeeze,
        weight: fontWeight(this.st.font), mono: isMono(this.st.font),
        fill: p.fill, fillA: p.fillA,
      });
    }
    strokeText() { /* 未使用 */ }
    drawImage() { /* 矢量导出不支持位图，忽略 */ }

    // 属性代理（fillStyle 之类直接存 st 上）
    get fillStyle() { return this.st.fillStyle; }
    set fillStyle(v) { this.st.fillStyle = v; }
    get strokeStyle() { return this.st.strokeStyle; }
    set strokeStyle(v) { this.st.strokeStyle = v; }
    get lineWidth() { return this.st.lineWidth; }
    set lineWidth(v) { this.st.lineWidth = v; }
    get globalAlpha() { return this.st.globalAlpha; }
    set globalAlpha(v) { this.st.globalAlpha = v; }
    get font() { return this.st.font; }
    set font(v) { this.st.font = v; }
    get textAlign() { return this.st.textAlign; }
    set textAlign(v) { this.st.textAlign = v; }
    get textBaseline() { return this.st.textBaseline; }
    set textBaseline(v) { this.st.textBaseline = v; }
  }

  /* ----------------------------------------------------------------- SVG */
  function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function dAttr(segs) {
    const out = [];
    for (const s of segs) {
      if (s[0] === 'Z') { out.push('Z'); continue; }
      const pts = [];
      for (let i = 1; i < s.length; i += 2) pts.push(num(s[i]) + ' ' + num(s[i + 1]));
      out.push(s[0] + pts.join(' '));
    }
    return out.join(' ');
  }
  function alphaAttr(base, k) {
    const a = Math.max(0, Math.min(1, k));
    if (a >= 0.999) return '';
    return base === 'fill' ? ` fill-opacity="${num(a)}"` : ` stroke-opacity="${num(a)}"`;
  }

  function toSVG(ops, w, h, opt = {}) {
    const out = [];
    const defs = [];
    const family = opt.fontFamily || "SimHei, 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif";
    let cid = 0;
    const open = [];
    for (const op of ops) {
      if (op.k === 'clip') {
        const id = 'c' + (++cid);
        defs.push(`<clipPath id="${id}"><path d="${dAttr(op.d)}"/></clipPath>`);
        out.push(`<g clip-path="url(#${id})">`);
        open.push(1);
        continue;
      }
      if (op.k === 'clipEnd') {
        if (open.pop()) out.push('</g>');
        continue;
      }
      if (op.k === 'rect') {
        const common = `x="${num(op.x)}" y="${num(op.y)}" width="${num(Math.max(0, op.w))}" height="${num(Math.max(0, op.h))}"`;
        if (op.fill) out.push(`<rect ${common} fill="${op.fill}"${alphaAttr('fill', op.fillA)}/>`);
        if (op.stroke) out.push(`<rect ${common} fill="none" stroke="${op.stroke}" stroke-width="${num(op.lw)}"${alphaAttr('stroke', op.strokeA)}${op.dash ? ` stroke-dasharray="${op.dash.map(num).join(',')}"` : ''}/>`);
        continue;
      }
      if (op.k === 'path') {
        const d = dAttr(op.d);
        if (op.fill) out.push(`<path d="${d}" fill="${op.fill}"${alphaAttr('fill', op.fillA)} stroke="none"/>`);
        if (op.stroke) out.push(`<path d="${d}" fill="none" stroke="${op.stroke}" stroke-width="${num(op.lw)}"${alphaAttr('stroke', op.strokeA)}${op.dash ? ` stroke-dasharray="${op.dash.map(num).join(',')}"` : ''}/>`);
        continue;
      }
      if (op.k === 'text') {
        const squeeze = op.sx && op.sx < 0.999
          ? ` textLength="${num(op.w)}" lengthAdjust="spacingAndGlyphs"` : '';
        out.push(`<text x="${num(op.x)}" y="${num(op.y)}" font-family="${family}" font-size="${num(op.size)}"`
          + ` font-weight="${op.weight}" fill="${op.fill}"${alphaAttr('fill', op.fillA)}${squeeze}`
          + ` xml:space="preserve">${esc(op.s)}</text>`);
      }
    }
    while (open.pop()) out.push('</g>');
    return `<?xml version="1.0" encoding="UTF-8"?>\n`
      + `<svg xmlns="http://www.w3.org/2000/svg" width="${num(w)}" height="${num(h)}" viewBox="0 0 ${num(w)} ${num(h)}">\n`
      + `<title>${esc(opt.title || 'Orbit')}</title>\n`
      + (defs.length ? `<defs>${defs.join('')}</defs>\n` : '')
      + out.join('\n') + '\n</svg>\n';
  }

  /* ----------------------------------------------------------------- PDF */
  async function deflate(u8) {
    if (typeof CompressionStream === 'undefined') return null;
    try {
      const s = new Blob([u8]).stream().pipeThrough(new CompressionStream('deflate'));
      return new Uint8Array(await new Response(s).arrayBuffer());
    } catch { return null; }
  }

  function pdfTextRun(op, font) {
    // 逐字取 gid；宽度对上屏幕：未压缩时用 Tc 调字距，被 maxWidth 压过就用 Tz 横向缩放
    const gids = [];
    let adv = 0;
    for (const ch of op.s) {
      const g = font.gidOf(ch.codePointAt(0));
      gids.push(g);
      adv += font.advance(g) / font.unitsPerEm;
    }
    const pdfW = adv * op.size;
    const n = gids.length;
    const squeezed = op.sx && op.sx < 0.999;
    // 短词（比如「GC」两个字）如果完全按画布宽度拉字距，会散得很难看，限制在 ±0.3em 内
    const cap = 0.3 * op.size;
    let tc = squeezed || n <= 1 ? 0 : (op.w - pdfW) / (n - 1);
    if (tc > cap) tc = cap;
    if (tc < -cap) tc = -cap;
    const tz = pdfW > 0.01 ? Math.max(10, Math.min(400, (op.w / pdfW) * 100)) : 100;
    let hexs = '';
    for (const g of gids) hexs += g.toString(16).padStart(4, '0');
    return { hexs, tc, tz, size: op.size, n, squeezed };
  }

  async function toPDF(ops, w, h, font, opt = {}) {
    const X = (v) => v * PT;
    const Yv = (v) => (h - v) * PT;      // 顶左原点 → PDF 左下原点
    const s = (v) => num(X(v));

    // 用到的字形 → 字体子集；顺便记下 gid→字符，供 ToUnicode 用
    const rev = new Map();
    if (font) {
      font.usedGids = new Set();
      for (const op of ops) {
        if (op.k !== 'text') continue;
        for (const ch of op.s) {
          const cp = ch.codePointAt(0);
          const g = font.gidOf(cp);
          font.usedGids.add(g);
          if (!rev.has(g)) rev.set(g, cp);
        }
      }
    }
    const fontBytes = font ? subsetFont(font) : null;
    const fontPacked = fontBytes ? await deflate(fontBytes) : null;

    // 透明度分组
    const alphas = new Map();
    const gsName = (a) => {
      const k = Math.round(Math.max(0, Math.min(1, a)) * 100) / 100;
      if (k >= 0.999) return null;
      if (!alphas.has(k)) alphas.set(k, 'GS' + (alphas.size + 1));
      return alphas.get(k);
    };

    const cs = [];
    const used = new Set();            // 用到的 gid（收 /W）
    // 透明度必须自己包一层 q/Q：gs 属于图形状态，会一直生效，
    // 只写「小于 1 时设置」会让后面的黑字继承到上一个半透明的 ca 而变灰
    const paint = (alpha, body) => {
      const gs = gsName(alpha);
      if (gs) { cs.push('q'); cs.push(`/${gs} gs`); body(); cs.push('Q'); }
      else body();
    };
    for (const op of ops) {
      if (op.k === 'clip') {
        cs.push('q');
        cs.push(pathOps(op.d, X, Yv, 'W n'));
        continue;
      }
      if (op.k === 'clipEnd') { cs.push('Q'); continue; }
      if (op.k === 'rect') {
        const px = X(op.x), py = Yv(op.y + op.h);
        const pw = X(op.w), ph = X(op.h);
        if (op.fill) {
          paint(op.fillA ?? 1, () => {
            const c = col(op.fill);
            cs.push(`${num(c[0] / 255)} ${num(c[1] / 255)} ${num(c[2] / 255)} rg`);
            cs.push(`${num(px)} ${num(py)} ${num(pw)} ${num(ph)} re f`);
          });
        }
        if (op.stroke) {
          paint(op.strokeA ?? 1, () => {
            const c = col(op.stroke);
            cs.push(`${num(c[0] / 255)} ${num(c[1] / 255)} ${num(c[2] / 255)} RG`);
            cs.push(`${num(Math.max(0.05, X(op.lw)))} w`);
            if (op.dash) cs.push(`[${op.dash.map((v) => num(X(v))).join(' ')}] 0 d`);
            else cs.push('[] 0 d');
            cs.push(`${num(px)} ${num(py)} ${num(pw)} ${num(ph)} re S`);
          });
        }
        continue;
      }
      if (op.k === 'path') {
        if (op.fill) {
          paint(op.fillA ?? 1, () => {
            const c = col(op.fill);
            cs.push(`${num(c[0] / 255)} ${num(c[1] / 255)} ${num(c[2] / 255)} rg`);
            cs.push(pathOps(op.d, X, Yv, 'f'));
          });
        }
        if (op.stroke) {
          paint(op.strokeA ?? 1, () => {
            const c = col(op.stroke);
            cs.push(`${num(c[0] / 255)} ${num(c[1] / 255)} ${num(c[2] / 255)} RG`);
            cs.push(`${num(Math.max(0.05, X(op.lw)))} w 1 J 1 j`);
            if (op.dash) cs.push(`[${op.dash.map((v) => num(X(v))).join(' ')}] 0 d`);
            else cs.push('[] 0 d');
            cs.push(pathOps(op.d, X, Yv, 'S'));
          });
        }
        continue;
      }
      if (op.k === 'text') {
        if (!font) continue;
        const run = pdfTextRun(op, font);
        for (const ch of op.s) used.add(font.gidOf(ch.codePointAt(0)));
        paint(op.fillA ?? 1, () => {
        const c = col(op.fill);
        const size = num(X(run.size));
        cs.push('BT');
        cs.push(`/F1 ${size} Tf`);
        // Tz 是文本状态，会跨 BT/ET 保留，所以每段都显式写一遍
        cs.push(`${num(run.squeezed ? run.tz : 100)} Tz`);
        cs.push(`${num(X(run.tc))} Tc`);
        cs.push(`${num(c[0] / 255)} ${num(c[1] / 255)} ${num(c[2] / 255)} rg`);
        cs.push(`${num(c[0] / 255)} ${num(c[1] / 255)} ${num(c[2] / 255)} RG`);
        if (op.weight >= 600) cs.push(`${num(X(run.size * 0.035))} w 2 Tr`);  // 伪粗体：描边+填充
        else cs.push('0 Tr');
        cs.push(`1 0 0 1 ${num(X(op.x))} ${num(Yv(op.y))} Tm`);
        cs.push(`<${run.hexs}> Tj`);
        cs.push('ET');
        });
      }
    }

    const content = new TextEncoder().encode(cs.join('\n') + '\n');
    const packed = (await deflate(content)) || null;

    /* --- 组装对象 --- */
    const enc = new TextEncoder();
    const chunks = [];
    let len = 0;
    const push = (x) => {
      const u8 = typeof x === 'string' ? enc.encode(x) : x;
      chunks.push(u8);
      len += u8.length;
    };
    const offsets = [];
    const obj = (n, dict, stream) => {
      offsets[n] = len;
      push(`${n} 0 obj\n${dict}\n`);
      if (stream) { push('stream\n'); push(stream); push('\nendstream\n'); }
      push('endobj\n');
    };

    const pw = X(w), phh = Yv(0);
    const baseTag = (font && font.name) || 'CJK';
    const gsDict = [...alphas.entries()]
      .map(([k, name]) => `/${name}<</Type/ExtGState/ca ${num(k)}/CA ${num(k)}>>`).join('');

    let n = 1;
    const idCatalog = n++;     // 1
    const idPages = n++;       // 2
    const idPage = n++;        // 3
    const idContent = n++;     // 4
    const idFont = font ? n++ : 0;
    const idCid = font ? n++ : 0;
    const idDesc = font ? n++ : 0;
    const idFile = font ? n++ : 0;
    const idToU = font ? n++ : 0;
    const resDict = `/Resources<<${font ? `/Font<</F1 ${idFont} 0 R>>` : ''}`
      + `${gsDict ? `/ExtGState<<${gsDict}>>` : ''}>>`;

    push('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n');
    obj(idCatalog, `<</Type/Catalog/Pages ${idPages} 0 R>>`);
    obj(idPages, `<</Type/Pages/Kids[${idPage} 0 R]/Count 1>>`);
    obj(idPage, `<</Type/Page/Parent ${idPages} 0 R/MediaBox[0 0 ${num(pw)} ${num(phh)}]`
      + `${resDict}/Contents ${idContent} 0 R>>`);
    obj(idContent, `<</Length ${packed ? packed.length : content.length}${packed ? '/Filter/FlateDecode' : ''}>>`,
      packed || content);

    if (font) {
      const subsetTag = 'ABCDEF+' + baseTag;
      const uscale = 1000 / font.unitsPerEm;
      const bbox = font.bbox.map((v) => num(v * uscale)).join(' ');
      obj(idFont, '<</Type/Font/Subtype/Type0/BaseFont/' + subsetTag + '/Encoding/Identity-H'
        + `/DescendantFonts[${idCid} 0 R]/ToUnicode ${idToU} 0 R>>`);
      const wArr = [];
      for (const g of [...used].sort((a, b) => a - b)) {
        wArr.push(`${g}[${Math.round(font.advance(g) * uscale)}]`);
      }
      obj(idCid, '<</Type/Font/Subtype/CIDFontType2/BaseFont/' + subsetTag
        + '/CIDSystemInfo<</Registry(Adobe)/Ordering(Identity)/Supplement 0>>'
        + `/FontDescriptor ${idDesc} 0 R/DW 1000/CIDToGIDMap/Identity`
        + `/W[${wArr.join('')}]>>`);
      obj(idDesc, '<</Type/FontDescriptor/FontName/' + subsetTag + '/Flags 4'
        + `/FontBBox[${bbox}]/ItalicAngle 0/Ascent ${num(Math.round(font.ascent * uscale))}`
        + `/Descent ${num(Math.round(font.descent * uscale))}/CapHeight 700/StemV 80`
        + `/FontFile2 ${idFile} 0 R>>`);
      obj(idFile, `<</Length ${fontPacked ? fontPacked.length : fontBytes.length}${fontPacked ? '/Filter/FlateDecode' : ''}>>`,
        fontPacked || fontBytes);
      const tou = toUnicode(used, rev);
      obj(idToU, `<</Length ${enc.encode(tou).length}>>`, enc.encode(tou));
    }

    const size = n;
    const xref = len;
    push(`xref\n0 ${size}\n0000000000 65535 f \n`);
    for (let i = 1; i < size; i++) push(`${String(offsets[i] || 0).padStart(10, '0')} 00000 n \n`);
    push(`trailer\n<</Size ${size}/Root ${idCatalog} 0 R>>\nstartxref\n${xref}\n%%EOF\n`);
    void opt;
    return new Blob(chunks, { type: 'application/pdf' });
  }

  function pathOps(segs, X, Yv, tail) {
    const out = [];
    for (const sg of segs) {
      if (sg[0] === 'M') out.push(`${num(X(sg[1]))} ${num(Yv(sg[2]))} m`);
      else if (sg[0] === 'L') out.push(`${num(X(sg[1]))} ${num(Yv(sg[2]))} l`);
      else if (sg[0] === 'C') {
        out.push(`${num(X(sg[1]))} ${num(Yv(sg[2]))} ${num(X(sg[3]))} ${num(Yv(sg[4]))} `
          + `${num(X(sg[5]))} ${num(Yv(sg[6]))} c`);
      } else if (sg[0] === 'Z') out.push('h');
    }
    return out.join('\n') + '\n' + tail;
  }

  /* gid → unicode，让 PDF 里的文字能复制 */
  function toUnicode(used, rev) {
    const pairs = [];
    for (const [gid, code] of rev) if (used.has(gid)) pairs.push([gid, code]);
    pairs.sort((a, b) => a[0] - b[0]);
    const body = [];
    for (let i = 0; i < pairs.length; i += 100) {
      const part = pairs.slice(i, i + 100);
      body.push(`${part.length} beginbfchar`);
      for (const [g, code] of part) {
        body.push(`<${g.toString(16).padStart(4, '0')}> <${code.toString(16).padStart(4, '0')}>`);
      }
      body.push('endbfchar');
    }
    return `/CIDInit /ProcSet findresource begin
12 dict begin
begincmap
/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def
/CMapName /Adobe-Identity-UCS def
/CMapType 2 def
1 begincodespacerange
<0000> <FFFF>
endcodespacerange
${body.join('\n')}
endcmap
CMapName currentdict /CMap defineresource pop
end
end
`;
  }

  window.VEX = { Rec, toSVG, toPDF, parseFont, subsetFont, col, cssColor };
})();
