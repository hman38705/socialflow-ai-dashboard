import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { configureApi } from './api/configure';
import './index.css';

configureApi({
  baseUrl: import.meta.env.VITE_API_URL,
  getToken: () => localStorage.getItem('sf_auth_token') ?? undefined,
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
