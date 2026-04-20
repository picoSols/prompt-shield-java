import { Component, signal, afterNextRender, Injector, inject } from '@angular/core';

type Mode = 'auto' | 'light' | 'dark';
const STORAGE_KEY = 'theme';

/**
 * Three-state colour scheme toggle. Auto (default) follows the OS via
 * prefers-color-scheme; explicit light/dark override via a data-theme
 * attribute on <html> and localStorage persistence.
 *
 * Icons: half-circle for auto, sun for light, moon for dark. Clicking
 * cycles auto → light → dark → auto.
 */
@Component({
  selector: 'app-theme-toggle',
  standalone: true,
  template: `
    <button
      type="button"
      (click)="cycle()"
      class="inline-flex items-center justify-center h-7 w-7 rounded-md
             border border-brand-line text-brand-muted
             hover:text-brand-accent hover:border-brand-accent
             active:scale-95 transition-all"
      [attr.aria-label]="'Colour scheme: ' + mode() + ' (click to cycle auto → light → dark)'"
      [title]="'Colour scheme: ' + mode()">
      @switch (mode()) {
        @case ('auto') {
          <svg class="w-[0.95rem] h-[0.95rem]" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9"/>
            <path d="M12 3a9 9 0 0 0 0 18"/>
            <path d="M12 3v18"/>
          </svg>
        }
        @case ('light') {
          <svg class="w-[0.95rem] h-[0.95rem]" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="4"/>
            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>
          </svg>
        }
        @case ('dark') {
          <svg class="w-[0.95rem] h-[0.95rem]" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>
          </svg>
        }
      }
    </button>
  `,
  imports: [],
})
export class ThemeToggleComponent {
  readonly mode = signal<Mode>('auto');
  private readonly injector = inject(Injector);

  constructor() {
    afterNextRender(() => {
      const saved = this.read();
      this.mode.set(saved);
      this.apply(saved);
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      if (mq.addEventListener) {
        mq.addEventListener('change', () => {
          // No-op for attribute; system change is handled by the media
          // query in CSS. Just keep the icon in sync if we're in auto.
        });
      }
    });
  }

  cycle(): void {
    const next: Mode = this.mode() === 'auto' ? 'light' : this.mode() === 'light' ? 'dark' : 'auto';
    this.mode.set(next);
    this.persist(next);
    this.apply(next);
  }

  private apply(m: Mode): void {
    const root = document.documentElement;
    if (m === 'auto') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', m);

    const effective: 'light' | 'dark' =
      m === 'auto'
        ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
        : m;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', effective === 'dark' ? '#0b0d12' : '#f8fafc');
  }

  // Cookie scoped to .omayoglu.com is the cross-subdomain source of
  // truth; localStorage is a same-origin fallback (localhost dev, or if
  // cookies are blocked by the user).
  private read(): Mode {
    try {
      const match = document.cookie.match(/(?:^|;\s*)theme=(light|dark)(?:;|$)/);
      if (match) return match[1] as Mode;
      const v = localStorage.getItem(STORAGE_KEY);
      return v === 'light' || v === 'dark' ? v : 'auto';
    } catch {
      return 'auto';
    }
  }

  private persist(m: Mode): void {
    try {
      if (m === 'auto') {
        localStorage.removeItem(STORAGE_KEY);
        document.cookie = 'theme=; domain=.omayoglu.com; path=/; max-age=0; SameSite=Lax';
        document.cookie = 'theme=; path=/; max-age=0; SameSite=Lax';
      } else {
        localStorage.setItem(STORAGE_KEY, m);
        document.cookie =
          'theme=' + m + '; domain=.omayoglu.com; path=/; max-age=31536000; SameSite=Lax';
      }
    } catch {}
  }
}
