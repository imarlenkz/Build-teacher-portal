import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource-variable/nunito';
import '@fontsource-variable/nunito-sans';
import '@fontsource-variable/jetbrains-mono';
import './styles/global.css';
import './i18n';
import { App } from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
