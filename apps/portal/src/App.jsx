import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import EditorPage from './pages/EditorPage';

// Portal pages
import PortalLogin from './pages/portal/PortalLogin';
import PortalVerify from './pages/portal/PortalVerify';
import PortalConfirmEmailChange from './pages/portal/PortalConfirmEmailChange';
import PortalDashboard from './pages/portal/PortalDashboard';
import PortalProfile from './pages/portal/PortalProfile';
import PortalSettings from './pages/portal/PortalSettings';
import PortalVineyardDetail from './pages/portal/PortalVineyardDetail';
import PortalVineyardGroup from './pages/portal/PortalVineyardGroup';
import PortalClaim from './pages/portal/PortalClaim';
import PortalSite from './pages/portal/PortalSite';

// Public winery vineyard site — lazy so embeds don't download the portal/admin code.
const WinerySitePage = lazy(() => import('./pages/site/WinerySitePage'));

// Admin pages
import AdminLogin from './pages/admin/AdminLogin';
import AdminDashboard from './pages/admin/AdminDashboard';
import AdminRequestDetail from './pages/admin/AdminRequestDetail';
import AdminVineyardBlocks from './pages/admin/AdminVineyardBlocks';
import AdminVineyardBlockDetail from './pages/admin/AdminVineyardBlockDetail';
import AdminBulkBlockImport from './pages/admin/AdminBulkBlockImport';
import AdminAccountIntel from './pages/admin/AdminAccountIntel';
import AdminContract from './pages/admin/AdminContract';

// OWB Portal — the Oregon Wine Board's shared login for contract progress + data
import OwbLogin from './pages/owb/OwbLogin';
import OwbPortal from './pages/owb/OwbPortal';

// The single sign-in point for every grower, whichever explorer (WVWA, OWB, …)
// sent them here. Paths keep their /portal and /admin prefixes so links issued
// before the split (magic-link emails, bookmarks) keep working.
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/portal" replace />} />

        {/* Winery portal */}
        <Route path="/portal" element={<PortalLogin />} />
        <Route path="/portal/verify" element={<PortalVerify />} />
        <Route path="/portal/confirm-email-change" element={<PortalConfirmEmailChange />} />
        <Route path="/portal/dashboard" element={<PortalDashboard />} />
        <Route path="/portal/profile" element={<PortalProfile />} />
        <Route path="/portal/settings" element={<PortalSettings />} />
        <Route path="/portal/vineyards/group" element={<PortalVineyardGroup />} />
        <Route path="/portal/vineyards/:id" element={<PortalVineyardDetail />} />
        <Route path="/portal/claim" element={<PortalClaim />} />
        <Route path="/portal/site" element={<PortalSite />} />

        {/* OWB Portal */}
        <Route path="/owb" element={<OwbLogin />} />
        <Route path="/owb/:tab" element={<OwbPortal />} />

        {/* Public winery vineyard pages (embeddable with ?embed=1) */}
        <Route path="/w/:slug" element={<Suspense fallback={null}><WinerySitePage /></Suspense>} />
        <Route path="/w/:slug/:vineyardKey" element={<Suspense fallback={null}><WinerySitePage /></Suspense>} />

        {/* Admin console */}
        <Route path="/admin" element={<AdminLogin />} />
        <Route path="/admin/dashboard" element={<AdminDashboard />} />
        <Route path="/admin/intel" element={<AdminAccountIntel />} />
        <Route path="/admin/contracts" element={<AdminContract />} />
        <Route path="/admin/requests/:id" element={<AdminRequestDetail />} />
        {/* Parcel editor — admin-only, full-screen */}
        <Route path="/admin/editor" element={<EditorPage />} />
        {/* Block manager */}
        <Route path="/admin/blocks" element={<AdminVineyardBlocks />} />
        <Route path="/admin/blocks/:parcelId" element={<AdminVineyardBlockDetail />} />
        <Route path="/admin/wineries/:wineryId/bulk-blocks" element={<AdminBulkBlockImport />} />

        <Route path="*" element={<Navigate to="/portal" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
