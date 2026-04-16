import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ScanRequest, ScanResponse } from './scan.types';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class ScanService {
  private http = inject(HttpClient);

  scan(req: ScanRequest): Observable<ScanResponse> {
    return this.http.post<ScanResponse>(`${environment.apiBase}/scan`, req);
  }
}
