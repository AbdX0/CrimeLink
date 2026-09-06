import { useState, useEffect, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import CrimeGraphLogo from '../components/CrimeGraphLogo';
import { login, getToken, getCurrentUser } from '../api/client';

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
      if (resp.role === 'ADMIN') {
        navigate('/admin');
      } else {
        navigate('/dashboard');
      }
    } catch (err: any) {
      setError(err?.message || 'Authentication failed. Please check your credentials.');
    } finally {
      setIsLoading(false);
    }
  };

  const setDemoCredentials = (demoUser: string, demoPass: string) => {
    setUsername(demoUser);
    setPassword(demoPass);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--background)] px-4 py-8">
      {/* Left decorative panel */}
      <div className="hidden lg:flex lg:w-1/2 items-center justify-center pr-12">
        <div className="max-w-sm space-y-6">
          <div className="inline-flex items-center gap-2 px-2.5 py-1 bg-zinc-100 border border-zinc-200 rounded-full">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0"></span>
            <span className="text-[10px] font-mono font-semibold text-zinc-700 uppercase tracking-widest">Enterprise Platform</span>
          </div>
          <h1 className="text-3xl font-semibold text-[var(--text-primary)] leading-tight tracking-tight">
            Crime Intelligence & Graph Analysis
          </h1>
          <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
            Ingest structured and unstructured data, map hidden suspect networks, and track complex criminal relationships across intelligence envelopes.
          </p>
          <div className="grid grid-cols-3 gap-3 pt-2">
            {[
              { label: 'Intelligence', value: 'AI+NLP' },
              { label: 'Topology', value: 'Neo4j' },
              { label: 'Security', value: 'RBAC' },
            ].map((stat) => (
              <div key={stat.label} className="text-left p-3 bg-white border border-[var(--card-border)] rounded-md">
                <p className="text-lg font-semibold text-[var(--text-primary)] font-mono">{stat.value}</p>
                <p className="text-[9px] font-mono font-semibold text-zinc-400 uppercase tracking-widest mt-0.5">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Login card */}
      <div className="w-full max-w-sm bg-white border border-[var(--card-border)] rounded-xl p-6 sm:p-8 shadow-xs relative z-10">
        {/* Brand mark */}
        <div className="mb-6">
          <CrimeGraphLogo size={24} textClassName="text-sm font-semibold text-black tracking-tight" />
        </div>

        <div className="mb-6">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">Sign in</h2>
          <p className="text-xs text-[var(--text-secondary)] mt-1">Enter your credentials to access your workspace</p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 p-2.5 rounded-md text-xs mb-5 flex items-start gap-2">
            <svg className="w-4 h-4 text-red-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1" htmlFor="username">
              Username
            </label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="investigator"
              className="form-input"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1" htmlFor="password">
              Password
            </label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="form-input pr-9"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 focus:outline-hidden p-1 flex items-center justify-center cursor-pointer"
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
            className="btn-primary w-full mt-1 justify-center py-2 text-xs"
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
        <div className="mt-6 border-t border-[var(--border)] pt-4">
          <p className="text-[10px] font-mono text-zinc-400 uppercase tracking-widest mb-2.5">
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
                className="bg-zinc-50 hover:bg-zinc-100 p-2 rounded border border-[var(--card-border)] text-left cursor-pointer transition-colors"
              >
                <span className="badge bg-zinc-200 text-zinc-800 font-mono mb-1">{acc.label}</span>
                <span className="text-[10px] text-zinc-500 block truncate">{acc.user}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
