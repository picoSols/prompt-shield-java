import { Component } from '@angular/core';
import { ScanComponent } from './scan/scan.component';
import { MatrixBackdropComponent } from './backdrop/matrix-backdrop.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [ScanComponent, MatrixBackdropComponent],
  template: `
    <app-matrix-backdrop></app-matrix-backdrop>
    <div class="app-surface"><app-scan></app-scan></div>
  `,
  styles: [
    `
      .app-surface {
        position: relative;
        z-index: 1;
      }
    `,
  ],
})
export class AppComponent {}
