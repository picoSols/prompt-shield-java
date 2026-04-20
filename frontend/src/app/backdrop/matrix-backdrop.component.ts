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
 * Matrix-style rain backdrop + sacred-geometry overlay.
 *
 * An octagram ({8/3}) sits behind the rain with its centre off the
 * top-right of the viewport so only one corner peeks in. The star is
 * drawn as a faint persistent outline; crossings by matrix characters
 * heat up a short sub-section of the nearest segment and briefly
 * brighten only that small stretch. Heat decays ~halving per 2 seconds,
 * so recently crossed pieces linger before returning to the base. No
 * wider glow — the effect stays on the line itself.
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

  private readonly cellSize = 26;
  private readonly spacing = 30;
  private readonly introMs = 2000;
  private readonly decayMs = 1000;
  private readonly ambientMs = 25000;
  private readonly fadeMs = 4000;
  private readonly totalMs =
    this.introMs + this.decayMs + this.ambientMs + this.fadeMs;

  // ~5px sub-segments, half-life ~2s, small local highlight on crossing.
  private readonly SUB_PX = 5;
  private readonly HEAT_DECAY = 0.99;
  private readonly HIT_RADIUS = 20;
  private readonly HEAT_SPREAD = 2;

  private readonly PALETTES = {
    dark:  { bg: '11,13,18',    drop: '242,152,72', hot: '255,200,140', line: '242,152,72' },
    light: { bg: '248,250,252', drop: '234,88,12',  hot: '240,125,40',  line: '234,88,12'  },
  } as const;
  private palette: { bg: string; drop: string; hot: string; line: string } = this.PALETTES.dark;

  private ctx!: CanvasRenderingContext2D;
  private drops: { x: number; y: number; speed: number; hot: boolean }[] = [];
  private octagram = {
    cx: 0,
    cy: 0,
    r: 0,
    segments: [] as {
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      length: number;
      N: number;
      heats: Float32Array;
    }[],
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
    this.setupOctagram();
    this.seedDrops();
  }

  private setupOctagram(): void {
    this.octagram.cx = this.dimensions.w * 1.02;
    this.octagram.cy = -this.dimensions.h * 0.08;
    this.octagram.r = Math.max(this.dimensions.w, this.dimensions.h) * 0.68;

    const verts = new Array<{ x: number; y: number }>(8);
    for (let i = 0; i < 8; i++) {
      const theta = (i * Math.PI) / 4;
      verts[i] = {
        x: this.octagram.cx + Math.cos(theta) * this.octagram.r,
        y: this.octagram.cy + Math.sin(theta) * this.octagram.r,
      };
    }
    this.octagram.segments = new Array(8);
    for (let k = 0; k < 8; k++) {
      const a = verts[k];
      const b = verts[(k + 3) % 8];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const N = Math.max(8, Math.ceil(len / this.SUB_PX));
      this.octagram.segments[k] = {
        x1: a.x,
        y1: a.y,
        x2: b.x,
        y2: b.y,
        length: len,
        N,
        heats: new Float32Array(N),
      };
    }
  }

  private seedDrops(): void {
    const cols = Math.max(1, Math.floor(this.dimensions.w / this.spacing));
    const count = Math.max(12, Math.floor(cols * 0.7));
    this.drops = new Array(count).fill(0).map(() => ({
      x: Math.random() * this.dimensions.w,
      y: Math.random() * this.dimensions.h - this.dimensions.h,
      speed: 1.2 + Math.random() * 2.5,
      hot: Math.random() < 0.15,
    }));
  }

  private distToSeg(px: number, py: number, s: { x1: number; y1: number; x2: number; y2: number }) {
    const dx = s.x2 - s.x1;
    const dy = s.y2 - s.y1;
    const len2 = dx * dx + dy * dy;
    if (len2 < 0.0001) {
      return { dist: Math.hypot(px - s.x1, py - s.y1), t: 0 };
    }
    const t = Math.max(0, Math.min(1, ((px - s.x1) * dx + (py - s.y1) * dy) / len2));
    const cx = s.x1 + t * dx;
    const cy = s.y1 + t * dy;
    return { dist: Math.hypot(px - cx, py - cy), t };
  }

  private bumpHeat(seg: { N: number; heats: Float32Array }, t: number, intensity: number): void {
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

  private drawOctagram(layerAlpha: number): void {
    this.ctx.lineCap = 'round';
    this.ctx.lineWidth = 1;
    this.ctx.strokeStyle = `rgba(${this.palette.line},1)`;

    for (const seg of this.octagram.segments) {
      this.ctx.globalAlpha = 0.025 * layerAlpha;
      this.ctx.beginPath();
      this.ctx.moveTo(seg.x1, seg.y1);
      this.ctx.lineTo(seg.x2, seg.y2);
      this.ctx.stroke();

      const invN = 1 / seg.N;
      const dx = seg.x2 - seg.x1;
      const dy = seg.y2 - seg.y1;
      for (let i = 0; i < seg.N; i++) {
        const h = seg.heats[i];
        if (h > 0.004) {
          const a = i * invN;
          const b = (i + 1) * invN;
          this.ctx.globalAlpha = h * 0.7 * layerAlpha;
          this.ctx.beginPath();
          this.ctx.moveTo(seg.x1 + dx * a, seg.y1 + dy * a);
          this.ctx.lineTo(seg.x1 + dx * b, seg.y1 + dy * b);
          this.ctx.stroke();
        }
        seg.heats[i] *= this.HEAT_DECAY;
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
      dropAlpha = 0.9;
      trailAlpha = 0.08;
      densityScale = 1;
      layerAlpha = 1;
    } else if (elapsed < this.introMs + this.decayMs) {
      const p = (elapsed - this.introMs) / this.decayMs;
      const ease = 1 - (1 - p) * (1 - p);
      dropAlpha = 0.9 - ease * 0.75;
      trailAlpha = 0.08 + ease * 0.06;
      densityScale = 1 - ease * 0.85;
      layerAlpha = 1;
    } else if (elapsed < this.introMs + this.decayMs + this.ambientMs) {
      dropAlpha = 0.15;
      trailAlpha = 0.14;
      densityScale = 0.15;
      layerAlpha = 1;
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

    this.drawOctagram(layerAlpha);

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
      for (const seg of this.octagram.segments) {
        const r = this.distToSeg(gx, gy, seg);
        if (r.dist < this.HIT_RADIUS) {
          this.bumpHeat(seg, r.t, 0.7);
        }
      }

      d.y += d.speed;
      if (d.y > this.dimensions.h + this.cellSize) {
        d.y = -this.cellSize - Math.random() * 80;
        d.x = Math.random() * this.dimensions.w;
        d.speed = 1.2 + Math.random() * 2.5;
        d.hot = Math.random() < 0.15;
      }
    }

    this.rafId = requestAnimationFrame(this.tick);
  };
}
