import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/base.css';
import App from './App';

// Inside the claude.ai viewer the page is framed under the host's bar; the head tightens (Screen.module.css).
try {
  if (window.self !== window.top) document.documentElement.classList.add('framed');
} catch {
  document.documentElement.classList.add('framed');
}

const boot = () =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );

// `/#inbox` on the dev server boots against a connector-shaped fixture (src/dev/stub.ts).
if (import.meta.env.DEV && location.hash.startsWith('#inbox')) {
  import('./dev/stub').then((m) => {
    m.installInboxStub();
    boot();
  });
} else {
  boot();
}
