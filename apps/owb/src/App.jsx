import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { PORTAL_URL } from '@terranthro/shared/lib/urls.js';
import WVWAMapPage from './pages/WVWAMapPage';

// The grower portal, admin console and winery sites live in apps/portal.
// Old links to them on this domain (bookmarks, sent emails) are forwarded —
// vercel.json redirects in production; this covers dev and any miss.
function ForwardToPortal() {
  const { pathname, search, hash } = useLocation();
  useEffect(() => { window.location.replace(`${PORTAL_URL}${pathname}${search}${hash}`); }, [pathname, search, hash]);
  return null;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<WVWAMapPage />} />
        <Route path="/portal/*" element={<ForwardToPortal />} />
        <Route path="/admin/*" element={<ForwardToPortal />} />
        <Route path="/w/*" element={<ForwardToPortal />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
