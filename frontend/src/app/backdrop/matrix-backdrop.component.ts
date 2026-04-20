import {
  Component,
  ElementRef,
  ViewChild,
  AfterViewInit,
  OnDestroy,
  NgZone,
  inject,
} from '@angular/core';

/**
 * Matrix-style rain backdrop + rub-al-hizb-style sacred-geometry overlay.
 *
 * Two overlapping squares — one axis-aligned, one rotated 45° — enclosed
 * by a single large circle, with the composition's centre positioned off
 * the top-right of the viewport so only one corner is visible. Geometry
 * starts invisible; only where a matrix character has recently crossed a
 * line or the circle's arc does that tiny stretch light up, then fades
 * (~2s half-life). Characters paint the pattern in as they pass.
 */
@Component({
  selector: 'app-matrix-backdrop',
  standalone: true,
  template: `<canvas #c aria-hidden="true"></canvas>`,
  styles: [
    `
      :host {
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        z-index: 0;
        pointer-events: none;
        overflow: hidden;
      }
      canvas {
        display: block;
        width: 100%;
        height: 100%;
      }
    `,
  ],
})
export class MatrixBackdropComponent implements AfterViewInit, OnDestroy {
  @ViewChild('c', { static: true }) canvasRef!: ElementRef<HTMLCanvasElement>;

  private readonly zone = inject(NgZone);

  private readonly glyphs =
    'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ' +
    '0123456789ABCDEF' +
    '⊕⊗⊙◉◎⬡⬢△▽◇◈✦✧✺⎔';

  private readonly cellSize = 29;
  private readonly spacing = 33;
  private readonly introMs = 2000;
  private readonly decayMs = 1000;
  private readonly ambientMs = 25000;
  private readonly fadeMs = 4000;
  private readonly totalMs =
    this.introMs + this.decayMs + this.ambientMs + this.fadeMs;

  // Tight spread + small hit radius + low bump intensity so the painted
  // highlight stays roughly 1.5× the glyph size, not much larger.
  private readonly SUB_PX = 5;
  private readonly HEAT_DECAY = 0.99;
  private readonly HIT_RADIUS = 15;
  private readonly HEAT_SPREAD = 1;
  private readonly HEAT_INTENSITY = 0.35;
  // Circle slot count is computed at setupGeometry time so each slot is
  // roughly SUB_PX of arc length — same fragmentation as the straight
  // segments. Spread controls falloff width in slots.
  private readonly CIRCLE_SPREAD = 1;

  private readonly PALETTES = {
    dark:  { bg: '11,13,18',    drop: '242,152,72', hot: '255,200,140', line: '242,152,72' },
    light: { bg: '248,250,252', drop: '234,88,12',  hot: '240,125,40',  line: '234,88,12'  },
  } as const;
  private palette: { bg: string; drop: string; hot: string; line: string } = this.PALETTES.dark;

  private ctx!: CanvasRenderingContext2D;
  private drops: { x: number; y: number; speed: number; hot: boolean }[] = [];
  private geometry = {
    cx: 0,
    cy: 0,
    r: 0,
    circleR: 0,
    segments: [] as {
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      length: number;
      N: number;
      heats: Float32Array;
    }[],
    circle: null as null | {
      cx: number;
      cy: number;
      r: number;
      N: number;
      heats: Float32Array;
    },
  };

  private rafId = 0;
  private running = true;
  private finished = false;
  private t0 = 0;
  private dpr = 1;
  private dimensions = { w: 0, h: 0 };

  private visibilityHandler?: () => void;
  private resizeHandler?: () => void;
  private themeHandler?: () => void;
  private themeObserver?: MutationObserver;
  private themeMq?: MediaQueryList;

  private resolveTheme(): 'light' | 'dark' {
    const explicit = document.documentElement.getAttribute('data-theme');
    if (explicit === 'light' || explicit === 'dark') return explicit;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  private updatePalette = (): void => {
    this.palette = this.PALETTES[this.resolveTheme()];
  };

  ngAfterViewInit(): void {
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return;

    const canvas = this.canvasRef.nativeElement;
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) return;
    this.ctx = context;

    this.updatePalette();
    this.resize();

    this.resizeHandler = () => this.resize();
    this.visibilityHandler = () => {
      const hidden = document.visibilityState === 'hidden';
      if (hidden) {
        this.running = false;
        cancelAnimationFrame(this.rafId);
      } else if (!this.running && !this.finished) {
        this.running = true;
        this.tick();
      }
    };
    window.addEventListener('resize', this.resizeHandler, { passive: true });
    document.addEventListener('visibilitychange', this.visibilityHandler);

    try {
      this.themeObserver = new MutationObserver(this.updatePalette);
      this.themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-theme'],
      });
    } catch {}
    this.themeMq = window.matchMedia('(prefers-color-scheme: dark)');
    this.themeHandler = this.updatePalette;
    if (this.themeMq.addEventListener) {
      this.themeMq.addEventListener('change', this.themeHandler);
    }

    this.t0 = performance.now();
    this.zone.runOutsideAngular(() => this.tick());
  }

  ngOnDestroy(): void {
    cancelAnimationFrame(this.rafId);
    this.running = false;
    if (this.resizeHandler) window.removeEventListener('resize', this.resizeHandler);
    if (this.visibilityHandler) document.removeEventListener('visibilitychange', this.visibilityHandler);
    if (this.themeObserver) this.themeObserver.disconnect();
    if (this.themeMq && this.themeHandler && this.themeMq.removeEventListener) {
      this.themeMq.removeEventListener('change', this.themeHandler);
    }
  }

  private resize(): void {
    const canvas = this.canvasRef.nativeElement;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.dimensions.w = window.innerWidth;
    this.dimensions.h = window.innerHeight;
    canvas.width = Math.floor(this.dimensions.w * this.dpr);
    canvas.height = Math.floor(this.dimensions.h * this.dpr);
    canvas.style.width = this.dimensions.w + 'px';
    canvas.style.height = this.dimensions.h + 'px';
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.ctx.font = `500 ${this.cellSize - 4}px "JetBrains Mono", ui-monospace, monospace`;
    this.ctx.textBaseline = 'top';
    this.setupGeometry();
    this.seedDrops();
  }

  private setupGeometry(): void {
    this.geometry.cx = this.dimensions.w * 1.04;
    this.geometry.cy = -this.dimensions.h * 0.10;
    this.geometry.r = Math.max(this.dimensions.w, this.dimensions.h) * 0.70;
    this.geometry.circleR = this.geometry.r * 1.08;

    const verts = new Array<{ x: number; y: number }>(8);
    for (let i = 0; i < 8; i++) {
      const theta = (i * Math.PI) / 4;
      verts[i] = {
        x: this.geometry.cx + Math.cos(theta) * this.geometry.r,
        y: this.geometry.cy + Math.sin(theta) * this.geometry.r,
      };
    }

    // Layered 8-point geometry on the same 8 vertices:
    //   Square A (axis-aligned): 0,2,4,6 connected in sequence.
    //   Square B (rotated 45°):  1,3,5,7 connected in sequence.
    //   {8/3} pointy star:       each vertex connects to the one 3 steps away.
    // 16 straight segments total, all sharing the octagram's vertices and centre.
    const pairs: [number, number][] = [
      [0, 2], [2, 4], [4, 6], [6, 0],
      [1, 3], [3, 5], [5, 7], [7, 1],
      [0, 3], [3, 6], [6, 1], [1, 4], [4, 7], [7, 2], [2, 5], [5, 0],
    ];
    this.geometry.segments = new Array(pairs.length);
    for (let k = 0; k < pairs.length; k++) {
      const a = verts[pairs[k][0]];
      const b = verts[pairs[k][1]];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const N = Math.max(8, Math.ceil(len / this.SUB_PX));
      this.geometry.segments[k] = {
        x1: a.x, y1: a.y, x2: b.x, y2: b.y,
        length: len, N,
        heats: new Float32Array(N),
      };
    }

    const circleN = Math.max(
      180,
      Math.ceil((2 * Math.PI * this.geometry.circleR) / this.SUB_PX),
    );
    this.geometry.circle = {
      cx: this.geometry.cx,
      cy: this.geometry.cy,
      r: this.geometry.circleR,
      N: circleN,
      heats: new Float32Array(circleN),
    };
  }

  private seedDrops(): void {
    const cols = Math.max(1, Math.floor(this.dimensions.w / this.spacing));
    const count = Math.max(12, Math.floor(cols * 0.77));
    this.drops = new Array(count).fill(0).map(() => ({
      x: Math.random() * this.dimensions.w,
      y: Math.random() * this.dimensions.h - this.dimensions.h,
      speed: 1.08 + Math.random() * 2.25,
      hot: Math.random() < 0.15,
    }));
  }

  private distToSeg(px: number, py: number, s: { x1: number; y1: number; x2: number; y2: number }) {
    const dx = s.x2 - s.x1;
    const dy = s.y2 - s.y1;
    const len2 = dx * dx + dy * dy;
    if (len2 < 0.0001) return { dist: Math.hypot(px - s.x1, py - s.y1), t: 0 };
    const t = Math.max(0, Math.min(1, ((px - s.x1) * dx + (py - s.y1) * dy) / len2));
    const cx = s.x1 + t * dx;
    const cy = s.y1 + t * dy;
    return { dist: Math.hypot(px - cx, py - cy), t };
  }

  private bumpSegmentHeat(seg: { N: number; heats: Float32Array }, t: number, intensity: number): void {
    let center = Math.floor(t * seg.N);
    if (center < 0) center = 0;
    if (center >= seg.N) center = seg.N - 1;
    for (let k = center - this.HEAT_SPREAD; k <= center + this.HEAT_SPREAD; k++) {
      if (k < 0 || k >= seg.N) continue;
      const d = Math.abs(k - center);
      const falloff = 1 - d / (this.HEAT_SPREAD + 1);
      const add = intensity * falloff;
      if (add <= 0) continue;
      const next = seg.heats[k] + add;
      seg.heats[k] = next > 1 ? 1 : next;
    }
  }

  private bumpCircleHeat(c: { N: number; heats: Float32Array }, angle01: number, intensity: number): void {
    const center = Math.floor(angle01 * c.N);
    for (let k = -this.CIRCLE_SPREAD; k <= this.CIRCLE_SPREAD; k++) {
      const idx = ((center + k) % c.N + c.N) % c.N;
      const d = Math.abs(k);
      const falloff = 1 - d / (this.CIRCLE_SPREAD + 1);
      const add = intensity * falloff;
      if (add <= 0) continue;
      const next = c.heats[idx] + add;
      c.heats[idx] = next > 1 ? 1 : next;
    }
  }

  private drawGeometry(layerAlpha: number): void {
    this.ctx.lineCap = 'round';
    this.ctx.lineWidth = 1;
    this.ctx.strokeStyle = `rgba(${this.palette.line},1)`;

    for (const seg of this.geometry.segments) {
      const invN = 1 / seg.N;
      const dx = seg.x2 - seg.x1;
      const dy = seg.y2 - seg.y1;
      for (let i = 0; i < seg.N; i++) {
        const h = seg.heats[i];
        if (h > 0.004) {
          const a = i * invN;
          const b = (i + 1) * invN;
          this.ctx.globalAlpha = h * 0.75 * layerAlpha;
          this.ctx.beginPath();
          this.ctx.moveTo(seg.x1 + dx * a, seg.y1 + dy * a);
          this.ctx.lineTo(seg.x1 + dx * b, seg.y1 + dy * b);
          this.ctx.stroke();
        }
        seg.heats[i] *= this.HEAT_DECAY;
      }
    }

    const c = this.geometry.circle;
    if (c) {
      const step = (Math.PI * 2) / c.N;
      const base = -Math.PI;
      for (let j = 0; j < c.N; j++) {
        const hc = c.heats[j];
        if (hc > 0.004) {
          const a0 = base + j * step;
          const a1 = base + (j + 1) * step;
          this.ctx.globalAlpha = hc * 0.75 * layerAlpha;
          this.ctx.beginPath();
          this.ctx.arc(c.cx, c.cy, c.r, a0, a1);
          this.ctx.stroke();
        }
        c.heats[j] *= this.HEAT_DECAY;
      }
    }
  }

  private tick = (): void => {
    if (!this.running) return;
    const now = performance.now();
    const elapsed = now - this.t0;

    if (elapsed > this.totalMs) {
      this.ctx.clearRect(0, 0, this.dimensions.w, this.dimensions.h);
      this.finished = true;
      this.running = false;
      return;
    }

    let dropAlpha: number;
    let trailAlpha: number;
    let densityScale: number;
    let layerAlpha: number;

    if (elapsed < this.introMs) {
      dropAlpha = 0.9; trailAlpha = 0.08; densityScale = 1; layerAlpha = 1;
    } else if (elapsed < this.introMs + this.decayMs) {
      const p = (elapsed - this.introMs) / this.decayMs;
      const ease = 1 - (1 - p) * (1 - p);
      dropAlpha = 0.9 - ease * 0.75;
      trailAlpha = 0.08 + ease * 0.06;
      densityScale = 1 - ease * 0.85;
      layerAlpha = 1;
    } else if (elapsed < this.introMs + this.decayMs + this.ambientMs) {
      dropAlpha = 0.15; trailAlpha = 0.14; densityScale = 0.15; layerAlpha = 1;
    } else {
      const fp = (elapsed - this.introMs - this.decayMs - this.ambientMs) / this.fadeMs;
      const fEase = fp * fp;
      dropAlpha = 0.15 * (1 - fEase);
      trailAlpha = 0.14;
      densityScale = 0.15 * (1 - fEase);
      layerAlpha = 1 - fEase;
    }

    this.ctx.globalCompositeOperation = 'source-over';
    this.ctx.globalAlpha = 1;
    this.ctx.fillStyle = `rgba(${this.palette.bg},${trailAlpha})`;
    this.ctx.fillRect(0, 0, this.dimensions.w, this.dimensions.h);

    this.drawGeometry(layerAlpha);

    this.ctx.globalAlpha = dropAlpha;
    const active = Math.max(1, Math.floor(this.drops.length * densityScale));
    for (let i = 0; i < active; i++) {
      const d = this.drops[i];
      const glyph = this.glyphs[(Math.random() * this.glyphs.length) | 0];
      this.ctx.fillStyle = d.hot
        ? `rgba(${this.palette.hot},0.95)`
        : `rgba(${this.palette.drop},0.65)`;
      this.ctx.fillText(glyph, d.x, d.y);

      const gx = d.x + this.cellSize / 2;
      const gy = d.y + this.cellSize / 2;

      for (const seg of this.geometry.segments) {
        const r = this.distToSeg(gx, gy, seg);
        if (r.dist < this.HIT_RADIUS) this.bumpSegmentHeat(seg, r.t, this.HEAT_INTENSITY);
      }

      const c = this.geometry.circle;
      if (c) {
        const dxc = gx - c.cx;
        const dyc = gy - c.cy;
        const radial = Math.hypot(dxc, dyc);
        if (Math.abs(radial - c.r) < this.HIT_RADIUS) {
          const angle = Math.atan2(dyc, dxc);
          const angle01 = (angle + Math.PI) / (Math.PI * 2);
          this.bumpCircleHeat(c, angle01, this.HEAT_INTENSITY);
        }
      }

      d.y += d.speed;
      if (d.y > this.dimensions.h + this.cellSize) {
        d.y = -this.cellSize - Math.random() * 80;
        d.x = Math.random() * this.dimensions.w;
        d.speed = 1.08 + Math.random() * 2.25;
        d.hot = Math.random() < 0.15;
      }
    }

    this.rafId = requestAnimationFrame(this.tick);
  };
}
