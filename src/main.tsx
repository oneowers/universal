import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { ClerkProvider } from '@clerk/react';

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

const root = createRoot(document.getElementById('root')!);

if (!PUBLISHABLE_KEY) {
  root.render(
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 40,
        fontFamily: "'JetBrains Mono', ui-monospace, monospace",
        background: '#fff',
        color: '#000',
        textAlign: 'center',
      }}
    >
      <div style={{ maxWidth: 560 }}>
        <div
          style={{
            fontSize: 11,
            letterSpacing: '0.25em',
            textTransform: 'uppercase',
            marginBottom: 16,
          }}
        >
          ⚠ Konfiguratsiya xatosi
        </div>
        <h1
          style={{
            fontFamily: "'Fraunces', serif",
            fontStyle: 'italic',
            fontWeight: 300,
            fontSize: 28,
            lineHeight: 1.2,
            margin: '0 0 20px',
          }}
        >
          VITE_CLERK_PUBLISHABLE_KEY o‘rnatilmagan
        </h1>
        <p style={{ fontSize: 12, lineHeight: 1.7, color: '#555' }}>
          Vercel loyihasi sozlamalariga muhit o‘zgaruvchisini qo‘shing:
        </p>
        <pre
          style={{
            fontSize: 12,
            background: '#000',
            color: '#fff',
            padding: 14,
            margin: '12px 0',
            textAlign: 'left',
            borderRadius: 0,
          }}
        >
          VITE_CLERK_PUBLISHABLE_KEY=pk_…
        </pre>
        <p style={{ fontSize: 11, lineHeight: 1.6, color: '#888', marginTop: 20 }}>
          Vercel Dashboard → Project Settings → Environment Variables → Add → Redeploy.
        </p>
      </div>
    </div>
  );
} else {
  root.render(
    <StrictMode>
      <ClerkProvider publishableKey={PUBLISHABLE_KEY} afterSignOutUrl="/">
        <App />
      </ClerkProvider>
    </StrictMode>
  );
}
