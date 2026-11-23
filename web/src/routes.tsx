import { Navigate, useParams, useSearchParams } from 'react-router';
import { ErrorScreen } from './components/ErrorScreen';
import { AppShell } from './components/AppBar';
import { StatusPage } from './components/StatusPage';
import { MasterPage } from './components/MasterPage';
import { DocPreview, KitPage, KitsPage } from './components/Kits';
import { ApplicationsPage, CompaniesPage, CompanyPage, JobPage, JobsPage, NewPage, PassedPage, RunPage, RunsPage, DirectedPage } from './components/Pages';

// Old `#/<view>` links land on their new home.
function LegacyView() {
    const { view } = useParams();
    const [params] = useSearchParams();
    const status = { watching: 'Watching', toreview: 'To review', ruledout: 'Ruled out (company)' }[view ?? ''];
    const to = view === 'decide' ? '/new'
        : view === 'run' ? `/runs${params.get('run') ? `/${params.get('run')}` : ''}`
        : view === 'applied' ? '/applications'
        : status ? `/companies?status=${encodeURIComponent(status)}`
        : '/new';
    return <Navigate replace to={to} />;
}

// Hash routes: the site is static files, so the server never sees the path.
export const routes = [{
    element: <AppShell />,
    errorElement: <ErrorScreen />,
    children: [
        { path: '/', element: <Navigate replace to="/new" /> },
        { path: '/new', element: <NewPage /> },
        { path: '/passed', element: <PassedPage /> },
        { path: '/jobs', element: <JobsPage /> },
        { path: '/jobs/:id', element: <JobPage /> },
        { path: '/applications', element: <ApplicationsPage /> },
        { path: '/companies', element: <CompaniesPage /> },
        { path: '/companies/:key', element: <CompanyPage /> },
        { path: '/directed', element: <DirectedPage /> },
        { path: '/runs', element: <RunsPage /> },
        { path: '/runs/:run', element: <RunPage /> },
        { path: '/status', element: <StatusPage /> },
        { path: '/master', element: <MasterPage /> },
        { path: '/kits', element: <KitsPage /> },
        { path: '/kits/:name', element: <KitPage /> },
        { path: '/kits/:name/preview/:file', element: <DocPreview /> },
        { path: '/:view', element: <LegacyView /> },
    ],
}];
