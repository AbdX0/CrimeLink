import { useState, useEffect } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import CrimeGraphLogo from './CrimeGraphLogo';
import CrimeGraphLoader from './CrimeGraphLoader';
import NotificationBell from './NotificationBell';
import { getCurrentUser, getStoredUser, getToken, logout, login } from '../api/client';
import type { AuthUser } from '../api/types';

function maskEmail(val: string): string {
  if (!val) return '';
  if (val.includes('@')) {
    const [local, domain] = val.split('@');
    const visible = local.length > 3 ? local.slice(0, 3) : local.slice(0, 1);
    return `${visible}***@${domain}`;
  }
  return val.length > 3 ? `${val.slice(0, 3)}***` : val;
}

export default function Layout() {
  const [user, setUser] = useState<AuthUser | null>(getStoredUser());
  const [loading, setLoading] = useState(!getStoredUser() && !getToken());
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    async function initUser() {
      const token = getToken();
      if (!token) {
        // Auto-login fallback for investigator demo credentials if needed
        try {
          await login('investigator123', 'investigator123');
          const me = await getCurrentUser();
          setUser(me);
        } catch {
          navigate('/login');
          return;
        } finally {
          setLoading(false);
        }
        return;
      }

      try {
        const me = await getCurrentUser();
        setUser(me);
      } catch {
        navigate('/login');
      } finally {
        setLoading(false);
      }
    }
    initUser();
  }, [navigate]);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  const handleLogout = () => {
    logout();
    setUser(null);
    navigate('/login');
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--background)] p-4">
        <CrimeGraphLoader size={36} text="Authenticating credentials…" />
      </div>
    );
  }

  if (!user) return null;

  const menuItems = [
    { name: 'Overview', path: '/dashboard', icon: 'M4 6a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2H6a2 2 0 01-2-2v-4zM14 16a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2h-2a2 2 0 01-2-2v-4z', roles: ['ADMIN', 'INVESTIGATOR', 'ANALYST'] },
    { name: 'Cases', path: '/cases', icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z', roles: ['ADMIN', 'INVESTIGATOR', 'ANALYST'] },
    { name: 'Data Center', path: '/datacenter', icon: 'M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12', roles: ['ADMIN', 'INVESTIGATOR'] },
    { name: 'Processing', path: '/processing', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z', roles: ['ADMIN', 'INVESTIGATOR'] },
    { name: 'Entities Database', path: '/entities', icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z', roles: ['ADMIN', 'INVESTIGATOR', 'ANALYST'] },
    { name: 'Network Analysis', path: '/network', icon: 'M7 12l3-3 3 3 4-4M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z', roles: ['ADMIN', 'INVESTIGATOR', 'ANALYST'] },
    { name: 'Alerts Queue', path: '/alerts', icon: 'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9', roles: ['ADMIN', 'INVESTIGATOR', 'ANALYST'] },
    { name: 'AI Assistant', path: '/ai', icon: 'M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z', roles: ['ADMIN', 'INVESTIGATOR', 'ANALYST'] },
    { name: 'Documents', path: '/documents', icon: 'M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2', roles: ['ADMIN', 'INVESTIGATOR', 'ANALYST'] },
    { name: 'Intelligence Reports', path: '/reports', icon: 'M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z', roles: ['ADMIN', 'INVESTIGATOR', 'ANALYST'] },
    { name: 'Audit Logs', path: '/logs', icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z', roles: ['ADMIN'] },
    { name: 'Admin Panel', path: '/admin', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z', roles: ['ADMIN'] },
  ];

  const visibleMenuItems = menuItems.filter((item) => item.roles.includes(user.role));

  const renderNavContent = () => (
    <>
      {/* Brand Header */}
      <div className="h-14 flex items-center justify-between px-4 border-b border-[var(--border)] shrink-0">
        <CrimeGraphLogo size={22} textClassName="text-xs font-semibold text-white tracking-tight" />
        <button
          onClick={() => setMobileMenuOpen(false)}
          className="lg:hidden p-1.5 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded cursor-pointer"
        >
          ✕
        </button>
      </div>

      {/* Navigation links */}
      <nav className="flex-1 px-3 py-4 space-y-5 overflow-y-auto touch-scroll">
        <div className="space-y-1">
          <span className="px-2.5 text-[10px] font-mono text-zinc-500 tracking-widest uppercase block mb-1.5">Intelligence</span>
          {visibleMenuItems
            .filter((item) => !['Admin Panel', 'Audit Logs'].includes(item.name))
            .map((item) => {
              const isActive = location.pathname === item.path || (item.path !== '/' && item.path !== '/dashboard' && location.pathname.startsWith(item.path));
              return (
                <NavLink
                  key={item.path}
                  to={item.path}
                  onClick={() => setMobileMenuOpen(false)}
                  className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-all ${
                    isActive
                      ? 'bg-zinc-900 border border-zinc-800 text-emerald-400 font-semibold shadow-xs'
                      : 'text-zinc-400 hover:bg-zinc-900/60 hover:text-zinc-100'
                  }`}
                >
                  <svg className="w-3.5 h-3.5 shrink-0 opacity-80" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.75">
                    <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
                  </svg>
                  <span className="truncate">{item.name}</span>
                </NavLink>
              );
            })}
        </div>

        {/* Administration Section */}
        {visibleMenuItems.some((item) => ['Admin Panel', 'Audit Logs'].includes(item.name)) && (
          <div className="space-y-1 pt-2 border-t border-[var(--border-subtle)]">
            <span className="px-2.5 text-[10px] font-mono text-zinc-500 tracking-widest uppercase block mb-1.5">System</span>
            {visibleMenuItems
              .filter((item) => ['Admin Panel', 'Audit Logs'].includes(item.name))
              .map((item) => {
                const isActive = location.pathname === item.path || location.pathname.startsWith(item.path);
                const displayName = item.name === 'Admin Panel' ? 'Admin Control' : item.name;

                return (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    onClick={() => setMobileMenuOpen(false)}
                    className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-all ${
                      isActive
                        ? 'bg-zinc-900 border border-zinc-800 text-emerald-400 font-semibold shadow-xs'
                        : 'text-zinc-400 hover:bg-zinc-900/60 hover:text-zinc-100'
                    }`}
                  >
                    <svg className="w-3.5 h-3.5 shrink-0 opacity-80" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.75">
                      <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
                    </svg>
                    <span className="truncate">{displayName}</span>
                  </NavLink>
                );
              })}
          </div>
        )}
      </nav>

      {/* User Info Footer */}
      <div className="p-3 border-t border-[var(--border)] bg-[#09090b] flex items-center justify-between shrink-0">
        <div className="min-w-0 pr-2">
          <p className="text-xs font-semibold text-white truncate">{user.username}</p>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="badge bg-zinc-900 border border-zinc-800 text-emerald-400 font-mono">
              {user.role === 'INVESTIGATOR' ? 'OFFICER' : user.role}
            </span>
            <span className="text-[10px] text-zinc-500 truncate">{maskEmail(user.username)}</span>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="p-1.5 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded transition-colors cursor-pointer"
          title="Log Out"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
        </button>
      </div>
    </>
  );

  const currentPageTitle = visibleMenuItems.find(
    (item) => location.pathname === item.path || (item.path !== '/' && item.path !== '/dashboard' && location.pathname.startsWith(item.path))
  )?.name || 'System';

  const portalLabel =
    user.role === 'ADMIN'
      ? 'ADMIN PORTAL'
      : user.role === 'ANALYST'
      ? 'ANALYST PORTAL'
      : 'OFFICER PORTAL';

  return (
    <div className="flex h-screen bg-background overflow-hidden relative">
      {/* Mobile Drawer Backdrop */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-xs z-40 lg:hidden transition-opacity"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Mobile Drawer */}
      <aside
        className={`fixed inset-y-0 left-0 w-72 max-w-[85vw] bg-[var(--sidebar-bg)] border-r border-border flex flex-col z-50 lg:hidden transition-transform duration-300 ease-in-out ${
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {renderNavContent()}
      </aside>

      {/* Desktop Sidebar */}
      <aside
        className={`hidden lg:flex ${
          sidebarOpen ? 'w-64' : 'w-0 -translate-x-full border-r-0'
        } transition-all duration-300 ease-in-out bg-[var(--sidebar-bg)] border-r border-border flex-col z-20 shrink-0 overflow-hidden`}
      >
        {renderNavContent()}
      </aside>

      {/* Main Content Wrapper */}
      <div className="flex-1 flex flex-col overflow-hidden relative w-full">
        <header className="h-14 bg-[#0c0c0e] border-b border-[var(--border)] flex items-center justify-between px-4 sm:px-6 z-10 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 -ml-1 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-lg cursor-pointer transition-all"
              aria-label="Open mobile menu"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>

            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="hidden lg:flex p-1.5 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-md cursor-pointer transition-all"
              aria-label="Toggle sidebar"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>

            <span className="text-xs font-semibold text-white tracking-tight truncate">
              {currentPageTitle}
            </span>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <NotificationBell />
            <span className="badge bg-zinc-900 border border-zinc-800 text-emerald-400 font-mono">
              {portalLabel}
            </span>
          </div>
        </header>

        {/* Main Content */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 bg-background touch-scroll">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
