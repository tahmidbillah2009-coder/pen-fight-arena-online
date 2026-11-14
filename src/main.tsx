import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {OnlineAuthProvider} from './online/OnlineAuthContext.tsx';
import {OnlineSessionProvider} from './online/OnlineSessionContext.tsx';
import './index.css';

// The online providers are mounted at the root so the whole app can read auth/session state, but
// they stay completely inert (and never load the Firebase SDK) until an online screen is opened.
createRoot(document.getElementById('root')!).render(
  <OnlineAuthProvider>
    <OnlineSessionProvider>
      <App />
    </OnlineSessionProvider>
  </OnlineAuthProvider>
);
