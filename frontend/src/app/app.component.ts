import { Component } from '@angular/core';
import { ScanComponent } from './scan/scan.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [ScanComponent],
  template: `<app-scan></app-scan>`
})
export class AppComponent {}
