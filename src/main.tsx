import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { configureApi } from './api/configure';

configureApi({
  baseUrl: import.meta.env.VITE_API_URL,
  getToken: () => localStorage.getItem('sf_auth_token') ?? undefined,
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
