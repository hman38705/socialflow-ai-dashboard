import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { configureApi } from './api/configure';
import './index.css';

// AuthContext (mounted below, inside <App />) owns the entire token/refresh
// lifecycle: it keeps the access token in memory only and the refresh token
// in sessionStorage — explicitly never localStorage, by design — and its own
// effect overwrites OpenAPI.TOKEN on every mount. A `getToken` reading
// localStorage here would be dead on arrival (immediately overwritten), and
// `enableRefreshInterceptor`'s default-on 401 interceptor is backed by a
// second, independent token store (src/auth/refresh.ts's own localStorage
// keys) that AuthContext never writes to — so it can never actually find a
// refresh token to use. Disabled here to avoid two silently conflicting auth
// mechanisms; only baseUrl is this call's job.
configureApi({
  baseUrl: import.meta.env.VITE_API_URL,
  enableRefreshInterceptor: false,
});

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element #root not found');
}

ReactDOM.createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
