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
 * Matrix-style rain backdrop.
 *
 * Timeline: 2s intro at full density → 1s decay to ambient → 25s ambient
 * → 4s fade to zero → stop. ~32 seconds end-to-end, after which the
 * canvas clears and the rAF loop exits. The effect is an *opening
 * moment*, not a permanent texture.
 *
 * Glyph palette combines half-width Katakana (classic Matrix register),
 * hex digits (dev-tool flavour) and a small set of sacred-geometry
 * symbols (⊕ ⊗ ⊙ ⬡ △ ▽ ✦) that drop through occasionally.
 *
 * Faint amber "leylines" spawn every ~3s during active phases: straight
 * segments that sine-fade in and out over 3–5s, at very low alpha — a
 * map-of-nodes feel that never becomes noisy.
 *
 * pointer-events: none so it never intercepts input, aria-hidden so
 * assistive tech ignores it, prefers-reduced-motion disables the effect
 * entirely. rAF runs outside Angular's zone to avoid change detection
 * on every frame; paused on visibilitychange when the tab is hidden.
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

  private readonly cellSize = 22;
  private readonly spacing = 26;

  private readonly introMs = 2000;
  private readonly decayMs = 1000;
  private readonly ambientMs = 25000;
  private readonly fadeMs = 4000;
  private readonly totalMs = this.introMs + this.decayMs + this.ambientMs + this.fadeMs;
  private readonly leylineIntervalMs = 2800;

  private ctx!: CanvasRenderingContext2D;
  private drops: { x: number; y: number; speed: number; hot: boolean }[] = [];
  private leylines: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    life: number;
    maxLife: number;
  }[] = [];
  private lastLeylineAt = -Infinity;
  private rafId = 0;
  private running = true;
  private finished = false;
  private t0 = 0;
  private lastFrame = 0;
  private dpr = 1;
  private visibilityHandler?: () => void;
  private resizeHandler?: () => void;
  private dimensions = { w: 0, h: 0 };

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

    this.resize();
    this.seedDrops();

    this.resizeHandler = () => this.resize(true);
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

    this.t0 = performance.now();
    this.zone.runOutsideAngular(() => this.tick());
  }

  ngOnDestroy(): void {
    cancelAnimationFrame(this.rafId);
    this.running = false;
    if (this.resizeHandler) window.removeEventListener('resize', this.resizeHandler);
    if (this.visibilityHandler) document.removeEventListener('visibilitychange', this.visibilityHandler);
  }

  private resize(reseed = false): void {
    const canvas = this.canvasRef.nativeElement;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    // Use window viewport dims explicitly — a canvas without resolved
    // layout otherwise falls back to its intrinsic 300x150 and only
    // paints a small corner.
    this.dimensions.w = window.innerWidth;
    this.dimensions.h = window.innerHeight;
    canvas.width = Math.floor(this.dimensions.w * this.dpr);
    canvas.height = Math.floor(this.dimensions.h * this.dpr);
    canvas.style.width = this.dimensions.w + 'px';
    canvas.style.height = this.dimensions.h + 'px';
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.ctx.font = `500 ${this.cellSize - 4}px "JetBrains Mono", ui-monospace, monospace`;
    this.ctx.textBaseline = 'top';
    if (reseed) this.seedDrops();
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

  private spawnLeyline(): void {
    const x1 = Math.random() * this.dimensions.w;
    const y1 = Math.random() * this.dimensions.h;
    const angle = Math.random() * Math.PI * 2;
    const length =
      (0.3 + Math.random() * 0.5) *
      Math.max(this.dimensions.w, this.dimensions.h);
    this.leylines.push({
      x1,
      y1,
      x2: x1 + Math.cos(angle) * length,
      y2: y1 + Math.sin(angle) * length,
      life: 0,
      maxLife: 3000 + Math.random() * 2000,
    });
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
    this.ctx.fillStyle = `rgba(11,13,18,${trailAlpha})`;
    this.ctx.fillRect(0, 0, this.dimensions.w, this.dimensions.h);

    if (
      elapsed < this.introMs + this.decayMs + this.ambientMs &&
      now - this.lastLeylineAt > this.leylineIntervalMs
    ) {
      this.spawnLeyline();
      this.lastLeylineAt = now;
    }

    for (let li = this.leylines.length - 1; li >= 0; li--) {
      const ll = this.leylines[li];
      ll.life += delta;
      const lp = ll.life / ll.maxLife;
      if (lp >= 1) {
        this.leylines.splice(li, 1);
        continue;
      }
      const llAlpha = Math.sin(lp * Math.PI) * 0.14 * layerAlpha;
      this.ctx.globalAlpha = llAlpha;
      this.ctx.strokeStyle = 'rgba(242,152,72,1)';
      this.ctx.lineWidth = 0.6;
      this.ctx.beginPath();
      this.ctx.moveTo(ll.x1, ll.y1);
      this.ctx.lineTo(ll.x2, ll.y2);
      this.ctx.stroke();
    }

    this.ctx.globalAlpha = dropAlpha;
    const active = Math.max(1, Math.floor(this.drops.length * densityScale));
    for (let i = 0; i < active; i++) {
      const d = this.drops[i];
      const glyph = this.glyphs[(Math.random() * this.glyphs.length) | 0];

      this.ctx.fillStyle = d.hot
        ? 'rgba(255, 200, 140, 0.95)'
        : 'rgba(242, 152, 72, 0.65)';
      this.ctx.fillText(glyph, d.x, d.y);

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
