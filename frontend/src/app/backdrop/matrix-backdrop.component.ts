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
 * An octagram ({8/3} — 8 vertices connected skip-3) sits behind the rain
 * with its centre positioned off the top-right of the viewport, so only
 * one corner of the star peeks into the frame. The octagram renders at a
 * very faint persistent tint; when a falling matrix character passes
 * near one of its segments, that segment's "heat" bumps to full and
 * decays slowly over several seconds, leaving a temporary bright streak
 * where the rain touched the geometry. Each crossing also spawns a
 * short-lived radial glow centred on the contact point — an AOE bloom.
 *
 * Timeline: 2s intro → 1s decay → 25s ambient → 4s fade to zero → stop.
 * Palette follows the effective theme.
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

  // heat decays ~halving per second; crossings stay visible several sec.
  private readonly HEAT_DECAY = 0.985;
  private readonly HIT_RADIUS = 22;

  private readonly PALETTES = {
    dark:  { bg: '11,13,18',    drop: '242,152,72', hot: '255,200,140', line: '242,152,72' },
    light: { bg: '248,250,252', drop: '234,88,12',  hot: '240,125,40',  line: '234,88,12'  },
  } as const;
  private palette: { bg: string; drop: string; hot: string; line: string } = this.PALETTES.dark;

  private ctx!: CanvasRenderingContext2D;
  private drops: { x: number; y: number; speed: number; hot: boolean }[] = [];
  private glows: { x: number; y: number; life: number; maxLife: number; maxAlpha: number }[] = [];
  private octagram = {
    cx: 0,
    cy: 0,
    r: 0,
    segments: [] as { x1: number; y1: number; x2: number; y2: number; heat: number }[],
  };

  private rafId = 0;
  private running = true;
  private finished = false;
  private t0 = 0;
  private lastFrame = 0;
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

    const verts = new Array(8);
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
      this.octagram.segments[k] = { x1: a.x, y1: a.y, x2: b.x, y2: b.y, heat: 0 };
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
      return { dist: Math.hypot(px - s.x1, py - s.y1), cx: s.x1, cy: s.y1 };
    }
    const t = Math.max(0, Math.min(1, ((px - s.x1) * dx + (py - s.y1) * dy) / len2));
    const cx = s.x1 + t * dx;
    const cy = s.y1 + t * dy;
    return { dist: Math.hypot(px - cx, py - cy), cx, cy };
  }

  private drawOctagram(layerAlpha: number): void {
    this.ctx.lineWidth = 1;
    for (const seg of this.octagram.segments) {
      const alpha = (0.06 + seg.heat * 0.55) * layerAlpha;
      if (alpha < 0.002) continue;
      this.ctx.globalAlpha = alpha;
      this.ctx.strokeStyle = `rgba(${this.palette.line},1)`;
      this.ctx.beginPath();
      this.ctx.moveTo(seg.x1, seg.y1);
      this.ctx.lineTo(seg.x2, seg.y2);
      this.ctx.stroke();
      seg.heat *= this.HEAT_DECAY;
    }
  }

  private drawGlows(delta: number, layerAlpha: number): void {
    for (let i = this.glows.length - 1; i >= 0; i--) {
      const g = this.glows[i];
      g.life += delta;
      const p = g.life / g.maxLife;
      if (p >= 1) {
        this.glows.splice(i, 1);
        continue;
      }
      const alpha = Math.sin(p * Math.PI) * g.maxAlpha * layerAlpha;
      if (alpha < 0.003) continue;
      const radius = 36 + g.life * 0.02;
      const grad = this.ctx.createRadialGradient(g.x, g.y, 0, g.x, g.y, radius);
      grad.addColorStop(0, `rgba(${this.palette.hot},${alpha})`);
      grad.addColorStop(1, `rgba(${this.palette.hot},0)`);
      this.ctx.globalAlpha = 1;
      this.ctx.fillStyle = grad;
      this.ctx.beginPath();
      this.ctx.arc(g.x, g.y, radius, 0, Math.PI * 2);
      this.ctx.fill();
    }
  }

  private tick = (): void => {
    if (!this.running) return;
    const now = performance.now();
    const elapsed = now - this.t0;
    const delta = this.lastFrame ? now - this.lastFrame : 16;
    this.lastFrame = now;

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

    this.drawGlows(delta, layerAlpha);
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
          seg.heat = Math.min(1, seg.heat + 0.3);
          if (Math.random() < 0.3) {
            this.glows.push({
              x: r.cx + (Math.random() - 0.5) * 10,
              y: r.cy + (Math.random() - 0.5) * 10,
              life: 0,
              maxLife: 1200 + Math.random() * 600,
              maxAlpha: 0.18 + Math.random() * 0.08,
            });
          }
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
