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
 * Plays a 2-second intro with ~30 columns of falling code glyphs, decays
 * density + opacity over the next second, then settles into an ambient
 * state with ~6 slow columns at low alpha — present but not distracting.
 *
 * Everything runs on a fixed-position full-viewport canvas, pointer-events
 * none, z-index 0 so the scan UI sits on top. Animation is rAF-driven and
 * paused when the tab is hidden. `prefers-reduced-motion` disables the
 * effect entirely — the canvas mounts but never draws.
 */
@Component({
  selector: 'app-matrix-backdrop',
  standalone: true,
  template: `<canvas #c aria-hidden="true"></canvas>`,
  styles: [
    `
      :host {
        position: fixed;
        inset: 0;
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

  // Glyph palette: half-width Katakana + hex digits + a sprinkle of symbols.
  // Katakana is the classic Matrix register; hex digits keep the dev-tool
  // flavour consistent with the rest of the UI.
  private readonly glyphs =
    'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789ABCDEF/<>{}[];:=';

  // Column metrics — cellSize is px height of a glyph cell; spacing is
  // horizontal stride between columns. Tuned for 14px JetBrains Mono.
  private readonly cellSize = 18;
  private readonly spacing = 22;

  // Timing in ms. intro → decay → ambient is a one-way transition.
  private readonly introMs = 2000;
  private readonly decayMs = 1000;

  private ctx!: CanvasRenderingContext2D;
  private drops: { x: number; y: number; speed: number; hot: boolean }[] = [];
  private rafId = 0;
  private running = true;
  private t0 = 0;
  private dpr = 1;
  private visibilityHandler?: () => void;
  private resizeHandler?: () => void;
  private dimensions = { w: 0, h: 0 };

  ngAfterViewInit(): void {
    // Respect the user's motion preferences. Safest default: if they've
    // opted out of animations, show nothing.
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
    this.seedDrops(/*columnDensity*/ 1);

    this.resizeHandler = () => this.resize(true);
    this.visibilityHandler = () => {
      const hidden = document.visibilityState === 'hidden';
      if (hidden) {
        this.running = false;
        cancelAnimationFrame(this.rafId);
      } else if (!this.running) {
        this.running = true;
        this.t0 = performance.now() - this.introMs - this.decayMs; // resume in ambient
        this.tick();
      }
    };
    window.addEventListener('resize', this.resizeHandler, { passive: true });
    document.addEventListener('visibilitychange', this.visibilityHandler);

    this.t0 = performance.now();

    // Run the animation outside Angular's zone so it doesn't trigger
    // change detection on every frame.
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
    const rect = canvas.getBoundingClientRect();
    this.dimensions.w = rect.width;
    this.dimensions.h = rect.height;
    canvas.width = Math.floor(rect.width * this.dpr);
    canvas.height = Math.floor(rect.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.ctx.font = `500 ${this.cellSize - 4}px "JetBrains Mono", ui-monospace, monospace`;
    this.ctx.textBaseline = 'top';
    if (reseed) this.seedDrops(1);
  }

  private seedDrops(densityMultiplier: number): void {
    const cols = Math.max(1, Math.floor(this.dimensions.w / this.spacing));
    const count = Math.max(6, Math.floor(cols * 0.6 * densityMultiplier));
    this.drops = new Array(count).fill(0).map(() => ({
      x: Math.random() * this.dimensions.w,
      y: Math.random() * this.dimensions.h - this.dimensions.h, // start above viewport
      speed: 1.2 + Math.random() * 2.2, // px per frame
      hot: Math.random() < 0.15,
    }));
  }

  private tick = (): void => {
    if (!this.running) return;
    const now = performance.now();
    const elapsed = now - this.t0;

    // Intro curve: [0, introMs] at full density, decays over decayMs to ambient.
    let globalAlpha: number;
    let trailAlpha: number;
    let densityScale: number;

    if (elapsed < this.introMs) {
      // Full intro.
      globalAlpha = 0.9;
      trailAlpha = 0.08;
      densityScale = 1;
    } else if (elapsed < this.introMs + this.decayMs) {
      // Decay phase — ease opacity and trail down to ambient levels.
      const p = (elapsed - this.introMs) / this.decayMs;
      const ease = 1 - (1 - p) * (1 - p); // easeOutQuad
      globalAlpha = 0.9 - ease * 0.75; // → 0.15
      trailAlpha = 0.08 + ease * 0.06; // → 0.14 (wipes previous frames faster)
      densityScale = 1 - ease * 0.85;
    } else {
      // Ambient.
      globalAlpha = 0.15;
      trailAlpha = 0.14;
      densityScale = 0.15;
    }

    // Trail: translucent black overlay pulls previous frame toward bg colour.
    // We don't know the exact page bg in a paletteable way, so we use a
    // near-black rgba that reads well on both the light and dark themes the
    // parent stylesheet exposes. The blend is multiplicative-ish because
    // alpha is low.
    this.ctx.globalCompositeOperation = 'source-over';
    this.ctx.fillStyle = `rgba(11, 13, 18, ${trailAlpha})`;
    this.ctx.fillRect(0, 0, this.dimensions.w, this.dimensions.h);

    this.ctx.globalAlpha = globalAlpha;

    // Draw heads + trails for the proportion of drops active this frame.
    const active = Math.max(1, Math.floor(this.drops.length * densityScale));
    for (let i = 0; i < active; i++) {
      const d = this.drops[i];
      const glyph = this.glyphs[(Math.random() * this.glyphs.length) | 0];

      // Trail char — amber at half brightness.
      this.ctx.fillStyle = d.hot
        ? 'rgba(255, 200, 140, 0.95)'
        : 'rgba(242, 152, 72, 0.6)';
      this.ctx.fillText(glyph, d.x, d.y);

      d.y += d.speed;

      // Recycle drops that run past the bottom. Intro uses shorter recycles
      // for higher density; ambient lets them drift.
      if (d.y > this.dimensions.h + this.cellSize) {
        d.y = -this.cellSize - Math.random() * 80;
        d.x = Math.random() * this.dimensions.w;
        d.speed = 1.2 + Math.random() * 2.2;
        d.hot = Math.random() < 0.15;
      }
    }

    this.rafId = requestAnimationFrame(this.tick);
  };
}
