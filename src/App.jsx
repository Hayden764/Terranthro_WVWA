import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import WVWAMapPage from './pages/WVWAMapPage';
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

// Public winery vineyard site — lazy so embeds don't download the explorer/portal/admin code.
const WinerySitePage = lazy(() => import('./pages/site/WinerySitePage'));

// Admin pages
import AdminLogin from './pages/admin/AdminLogin';
import AdminDashboard from './pages/admin/AdminDashboard';
import AdminRequestDetail from './pages/admin/AdminRequestDetail';
import AdminVineyardBlocks from './pages/admin/AdminVineyardBlocks';
import AdminVineyardBlockDetail from './pages/admin/AdminVineyardBlockDetail';
import AdminBulkBlockImport from './pages/admin/AdminBulkBlockImport';
import AdminAccountIntel from './pages/admin/AdminAccountIntel';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Main map */}
        <Route path="/" element={<WVWAMapPage />} />

        {/* Winery portal */}
        <Route path="/portal" element={<PortalLogin />} />
        <Route path="/portal/verify" element={<PortalVerify />} />          <Route path="/portal/confirm-email-change" element={<PortalConfirmEmailChange />} />        <Route path="/portal/dashboard" element={<PortalDashboard />} />
        <Route path="/portal/profile" element={<PortalProfile />} />
        <Route path="/portal/settings" element={<PortalSettings />} />
        <Route path="/portal/vineyards/group" element={<PortalVineyardGroup />} />
        <Route path="/portal/vineyards/:id" element={<PortalVineyardDetail />} />
        <Route path="/portal/claim" element={<PortalClaim />} />
        <Route path="/portal/site" element={<PortalSite />} />

        {/* Public winery vineyard pages (embeddable with ?embed=1) */}
        <Route path="/w/:slug" element={<Suspense fallback={null}><WinerySitePage /></Suspense>} />
        <Route path="/w/:slug/:vineyardKey" element={<Suspense fallback={null}><WinerySitePage /></Suspense>} />

        {/* Admin console */}
        <Route path="/admin" element={<AdminLogin />} />
        <Route path="/admin/dashboard" element={<AdminDashboard />} />
        <Route path="/admin/intel" element={<AdminAccountIntel />} />
        <Route path="/admin/requests/:id" element={<AdminRequestDetail />} />
        {/* Parcel editor — admin-only, full-screen */}
        <Route path="/admin/editor" element={<EditorPage />} />
        {/* Block manager */}
        <Route path="/admin/blocks" element={<AdminVineyardBlocks />} />
        <Route path="/admin/blocks/:parcelId" element={<AdminVineyardBlockDetail />} />
        <Route path="/admin/wineries/:wineryId/bulk-blocks" element={<AdminBulkBlockImport />} />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
