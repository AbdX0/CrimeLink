import { useState, useEffect, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import CrimeGraphLogo from '../components/CrimeGraphLogo';
import KineticGrid from '@/components/ui/kinetic-grid';
import { login, getToken, getCurrentUser } from '../api/client';
import { showToast } from '../utils/toast';
import toast from 'react-hot-toast';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();

  // If already authenticated, redirect to dashboard
  useEffect(() => {
    async function checkAuth() {
      if (getToken()) {
        try {
          await getCurrentUser();
          navigate('/dashboard');
        } catch {
          // invalid token, stay on login page
        }
      }
    }
    checkAuth();
  }, [navigate]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    if (!username || !password) {
      setError('Please fill in all fields.');
      setIsLoading(false);
      return;
    }

    try {
      const resp = await login(username.trim(), password);
      toast.dismiss();
      showToast.success('Authentication Verified', `Officer ${username.trim()} session initialized.`);
      if (resp.role === 'ADMIN') {
        navigate('/admin');
      } else {
        navigate('/dashboard');
      }
    } catch (err: any) {
      const msg = err?.message || 'Authentication failed. Please check your credentials.';
      setError(msg);
      showToast.error('Authentication Failed', msg);
    } finally {
      setIsLoading(false);
    }
  };

  const setDemoCredentials = (demoUser: string, demoPass: string) => {
    setUsername(demoUser);
    setPassword(demoPass);
  };

  return (
    <KineticGrid globalColor="crimelink">
      <div className="flex min-h-screen items-center justify-center px-4 py-8">
        {/* Left decorative panel */}
        <div className="hidden lg:flex lg:w-1/2 items-center justify-center pr-12">
          <div className="max-w-sm space-y-6">
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-zinc-900/80 border border-zinc-800 rounded-full backdrop-blur-md">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0"></span>
              <span className="text-[10px] font-mono font-semibold text-zinc-300 uppercase tracking-widest">Enterprise Platform</span>
            </div>
            <h1 className="text-3xl font-semibold text-white leading-tight tracking-tight">
              Crime Intelligence & Graph Analysis
            </h1>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Ingest structured and unstructured data, map hidden suspect networks, and track complex criminal relationships across intelligence envelopes.
            </p>
            <div className="grid grid-cols-3 gap-3 pt-2">
              {[
                { label: 'Intelligence', value: 'AI+NLP' },
                { label: 'Topology', value: 'Neo4j' },
                { label: 'Security', value: 'RBAC' },
              ].map((stat) => (
                <div key={stat.label} className="text-left p-3 bg-zinc-900/70 border border-zinc-800/80 rounded-md backdrop-blur-sm">
                  <p className="text-lg font-semibold text-white font-mono">{stat.value}</p>
                  <p className="text-[9px] font-mono font-semibold text-emerald-400 uppercase tracking-widest mt-0.5">{stat.label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Login card */}
        <div className="w-full max-w-sm bg-zinc-950/85 border border-zinc-800/90 rounded-xl p-6 sm:p-8 shadow-2xl backdrop-blur-xl relative z-10">
          {/* Brand mark */}
          <div className="mb-6">
            <CrimeGraphLogo size={24} textClassName="text-sm font-semibold text-white tracking-tight" />
          </div>

          <div className="mb-6">
            <h2 className="text-lg font-semibold text-white">Sign in</h2>
            <p className="text-xs text-zinc-400 mt-1">Enter your credentials to access your workspace</p>
          </div>

          {error && (
            <div className="bg-red-950/40 border border-red-800/50 text-red-300 p-2.5 rounded-md text-xs mb-5 flex items-start gap-2 backdrop-blur-sm">
              <svg className="w-4 h-4 text-red-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1" htmlFor="username">
                Username
              </label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="investigator"
                className="w-full min-h-[38px] px-3 py-2 bg-zinc-900/90 border border-zinc-800 rounded-md text-zinc-100 placeholder-zinc-500 text-xs focus:outline-hidden focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1" htmlFor="password">
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full min-h-[38px] px-3 py-2 pr-9 bg-zinc-900/90 border border-zinc-800 rounded-md text-zinc-100 placeholder-zinc-500 text-xs focus:outline-hidden focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-200 focus:outline-hidden p-1 flex items-center justify-center cursor-pointer transition-colors"
                  title={showPassword ? 'Hide password' : 'Show password'}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            <button
              type="submit"
              id="login-submit-btn"
              disabled={isLoading}
              className="w-full mt-1 justify-center py-2 text-xs font-medium bg-emerald-500 hover:bg-emerald-400 text-zinc-950 rounded-md transition-all flex items-center gap-2 cursor-pointer shadow-lg shadow-emerald-500/20 disabled:opacity-50"
            >
              {isLoading ? (
                <>
                  <CrimeGraphLogo size={14} showText={false} className="animate-crimegraph-pulse" />
                  <span>Authenticating…</span>
                </>
              ) : (
                <span>Sign In</span>
              )}
            </button>
          </form>

          {/* Demo access accounts */}
          <div className="mt-6 border-t border-zinc-800/80 pt-4">
            <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest mb-2.5">
              Click Demo Account to Pre-fill
            </p>
            <div className="grid grid-cols-3 gap-2">
              {[
                { role: 'ADMIN', label: 'ADMIN', user: 'admin', pass: 'admin123' },
                { role: 'INVESTIGATOR', label: 'OFFICER', user: 'investigator', pass: 'investigator123' },
                { role: 'ANALYST', label: 'ANALYST', user: 'analyst', pass: 'analyst123' },
              ].map((acc) => (
                <button
                  key={acc.role}
                  type="button"
                  onClick={() => setDemoCredentials(acc.user, acc.pass)}
                  className="bg-zinc-900/80 hover:bg-zinc-800 border border-zinc-800 p-2 rounded text-left cursor-pointer transition-colors"
                >
                  <span className="badge bg-zinc-800 text-emerald-400 font-mono mb-1">{acc.label}</span>
                  <span className="text-[10px] text-zinc-400 block truncate">{acc.user}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </KineticGrid>
  );
}
