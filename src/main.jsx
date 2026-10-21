import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';
import { restoreSessions } from './lib/api';

// Restore signed-in sessions from the httpOnly refresh cookie before the first render
// (access tokens are kept in memory only, so a reload needs one refresh call per signed-in role).
const root = ReactDOM.createRoot(document.getElementById('root'));
const isAdmin = window.location.pathname.startsWith('/admin');
const ready = isAdmin ? Promise.resolve() : Promise.race([restoreSessions(), new Promise(r => setTimeout(r, 4000))]);
ready.finally(() => {
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
});
