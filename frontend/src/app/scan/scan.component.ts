import { Component, inject, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { ScanService } from './scan.service';
import { ScanResponse, RiskLevel } from './scan.types';
import { FIXTURES, Fixture } from './scan.fixtures';

@Component({
  selector: 'app-scan',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './scan.component.html'
})
export class ScanComponent {
  private scanService = inject(ScanService);

  // Pre-load the textbox with the "Resume excerpt (safe)" fixture so the
  // page is never empty on first paint — the user can hit Scan immediately
  // without having to type or pick a chip.
  readonly input = signal(FIXTURES[0].text);
  readonly scanning = signal(false);
  readonly error = signal<string | null>(null);
  readonly result = signal<ScanResponse | null>(null);
  readonly history = signal<ScanResponse[]>([]);
  readonly fixtures = FIXTURES;

  readonly riskColor = computed(() => this.colorFor(this.result()?.risk));
  readonly verdictBorderClass = computed(() => {
    switch (this.result()?.risk) {
      case 'HIGH':   return 'border-brand-high/60';
      case 'MEDIUM': return 'border-brand-medium/60';
      case 'LOW':    return 'border-brand-low/60';
      default:       return 'border-brand-line';
    }
  });
  readonly riskDotBg = computed(() => {
    switch (this.result()?.risk) {
      case 'HIGH':   return 'bg-brand-high';
      case 'MEDIUM': return 'bg-brand-medium';
      case 'LOW':    return 'bg-brand-low';
      default:       return 'bg-brand-muted';
    }
  });

  colorFor(risk: RiskLevel | undefined): string {
    switch (risk) {
      case 'HIGH':   return 'text-brand-high';
      case 'MEDIUM': return 'text-brand-medium';
      case 'LOW':    return 'text-brand-low';
      default:       return 'text-brand-muted';
    }
  }

  loadFixture(f: Fixture): void {
    this.input.set(f.text);
    this.result.set(null);
    this.error.set(null);
  }

  scan(): void {
    const text = this.input().trim();
    if (!text) { this.error.set('Type something first.'); return; }
    this.scanning.set(true);
    this.error.set(null);
    this.result.set(null);
    this.scanService.scan({ input: text }).subscribe({
      next: (res) => {
        this.result.set(res);
        this.history.update(h => [res, ...h].slice(0, 10));
        this.scanning.set(false);
        queueMicrotask(() => this.animateResult());
      },
      error: (err) => {
        this.error.set(err?.message ?? 'Scan failed');
        this.scanning.set(false);
      }
    });
  }

  private animateResult(): void {
    const el = document.querySelector<HTMLElement>('#result-panel');
    if (!el) return;
    el.animate(
      [
        { opacity: 0, transform: 'translateY(8px)' },
        { opacity: 1, transform: 'translateY(0)' }
      ],
      { duration: 320, easing: 'ease-out', fill: 'forwards' }
    );
  }
}
