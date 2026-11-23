import '@fontsource-variable/ibm-plex-sans';
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import { QueryClient } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createHashRouter, RouterProvider } from 'react-router';
import { routes } from './routes';
import { ToastProvider } from './toast';
import './style.css';

const queryClient = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: true, staleTime: 30_000, gcTime: 24 * 3600_000 } } });

// Cached data paints at once, then refetches. A new deploy changes the buster and drops the old cache.
declare const __BUILD__: string;
const persister = createSyncStoragePersister({ storage: window.localStorage });

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <PersistQueryClientProvider client={queryClient} persistOptions={{ persister, buster: __BUILD__, maxAge: 24 * 3600_000 }}>
            <ToastProvider>
                <RouterProvider router={createHashRouter(routes)} />
            </ToastProvider>
        </PersistQueryClientProvider>
    </StrictMode>,
);
