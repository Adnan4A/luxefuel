import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import TestPage from './TestPage.tsx';
import Test2Page from './Test2Page.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {window.location.pathname.startsWith('/test2')
      ? <Test2Page />
      : window.location.pathname.startsWith('/test')
        ? <TestPage />
        : <App />}
  </StrictMode>,
);
