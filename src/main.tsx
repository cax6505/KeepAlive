import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './ui/App';
import './style.css';

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => { void navigator.serviceWorker.register('/sw.js').catch(() => {}); });
}

createRoot(document.getElementById('root')!).render(<App/>);
