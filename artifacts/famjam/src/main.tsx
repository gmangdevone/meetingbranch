import { createRoot } from 'react-dom/client';

import App from './App';
import { installUnsavedChangesProtection } from './lib/unsavedChanges';

import './index.css';

installUnsavedChangesProtection();
createRoot(document.getElementById('root')!).render(<App />);
