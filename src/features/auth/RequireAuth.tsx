import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { isMirrorModeActive } from '../../stores/mirrorStore';

export function RequireAuth({ children }: { children: JSX.Element }) {
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const isTokenExpired = useAuthStore((state) => state.isTokenExpired);
  const location = useLocation();

  if (!user) return <Navigate to="/login" replace />;

  if (isTokenExpired()) {
    logout();
    return <Navigate to="/login" replace />;
  }

  if (isMirrorModeActive() && location.pathname !== '/mirror-pos') {
    return <Navigate to="/mirror-pos" replace />;
  }

  return children;
}
