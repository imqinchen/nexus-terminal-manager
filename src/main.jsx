import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import '@xterm/xterm/css/xterm.css';

try {
  document.documentElement.dataset.theme = JSON.parse(window.localStorage.getItem('nexus.theme')) || 'dark';
} catch {
  document.documentElement.dataset.theme = 'dark';
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
