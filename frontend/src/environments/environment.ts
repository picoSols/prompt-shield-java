// API base is relative by default: in production nginx proxies /scan and
// /audit to the backend, so the browser stays on a single origin (no CORS,
// no hardcoded host). For `ng serve`, proxy.conf.json routes those paths
// to http://localhost:8080. Override at runtime via window.__API_BASE__
// if you ever need to point the SPA at a different origin.
declare global {
  interface Window { __API_BASE__?: string; }
}

export const environment = {
  production: true,
  apiBase: (typeof window !== 'undefined' && window.__API_BASE__) || ''
};
