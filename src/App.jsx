import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import WVWAMapPage from './pages/WVWAMapPage';
import EditorPage from './pages/EditorPage';

// Portal pages
import PortalLogin from './pages/portal/PortalLogin';
import PortalVerify from './pages/portal/PortalVerify';
import PortalConfirmEmailChange from './pages/portal/PortalConfirmEmailChange';
import PortalDashboard from './pages/portal/PortalDashboard';
import PortalProfile from './pages/portal/PortalProfile';
import PortalVineyardDetail from './pages/portal/PortalVineyardDetail';
import PortalVineyardGroup from './pages/portal/PortalVineyardGroup';
import PortalClaim from './pages/portal/PortalClaim';

// Admin pages
import AdminLogin from './pages/admin/AdminLogin';
import AdminDashboard from './pages/admin/AdminDashboard';
import AdminRequestDetail from './pages/admin/AdminRequestDetail';
import AdminVineyardBlocks from './pages/admin/AdminVineyardBlocks';
import AdminVineyardBlockDetail from './pages/admin/AdminVineyardBlockDetail';
import AdminBulkBlockImport from './pages/admin/AdminBulkBlockImport';

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
        <Route path="/portal/vineyards/group" element={<PortalVineyardGroup />} />
        <Route path="/portal/vineyards/:id" element={<PortalVineyardDetail />} />
        <Route path="/portal/claim" element={<PortalClaim />} />

        {/* Admin console */}
        <Route path="/admin" element={<AdminLogin />} />
        <Route path="/admin/dashboard" element={<AdminDashboard />} />
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
