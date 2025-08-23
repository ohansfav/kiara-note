import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import './Login.css';

const ThemeToggle = ({ theme, setTheme }) => {
  return (
    <button 
      onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
      className="theme-toggle"
      aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
    >
      {theme === 'light' ? '🌙' : '☀️'}
    </button>
  );
};

const Login = () => {
  const { login } = useAuth();
  const [token, setToken] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [theme, setTheme] = useState(() => {
    // Check if we're in a browser environment
    if (typeof window !== 'undefined') {
      const savedTheme = localStorage.getItem('kiara-theme');
      return savedTheme || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    }
    return 'light'; // Default theme for SSR
  });

  // Apply theme to document
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', theme);
    }
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('kiara-theme', theme);
    }
  }, [theme]);

  const handleLogin = async (e) => {
    e.preventDefault();
    if (token.trim()) {
      setIsLoading(true);
      try {
        await login(token.trim());
        // Login successful - the App component will handle the redirect
      } catch (error) {
        console.error('Login error:', error);
        alert('Login failed. Please check your token and try again.');
      } finally {
        setIsLoading(false);
      }
    }
  };

  const handleOAuthLogin = () => {
    if (typeof window === 'undefined') return; // Skip SSR
    
    const clientId = process.env.REACT_APP_GITHUB_CLIENT_ID;
    const redirectUri = process.env.REACT_APP_REDIRECT_URI;
    
    if (!clientId) {
      alert('GitHub OAuth is not properly configured. Please check your environment variables.');
      return;
    }
    
    // Construct the GitHub OAuth URL
    const authUrl = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=repo%20user&response_type=code`;
    
    // Redirect to GitHub for authentication
    window.location.href = authUrl;
  };

  return (
    <div className="login-container">
      <div className="login-background">
        <div className="geometric-shapes">
          <div className="shape shape-1"></div>
          <div className="shape shape-2"></div>
          <div className="shape shape-3"></div>
        </div>
      </div>
      
      <div className="login-card">
        <div className="login-header">
          <div className="logo">
            <h1>📝 Kiara Note</h1>
            <p>GitHub-Powered Note Management</p>
          </div>
          <ThemeToggle theme={theme} setTheme={setTheme} />
        </div>

        <div className="login-content">
          <div className="auth-options">
            <button 
              disabled
              className="oauth-btn disabled"
              title="OAuth login is currently disabled"
            >
              <span className="btn-icon">🔐</span>
              <div className="btn-text">
                <span className="btn-title">Login with GitHub</span>
                <span className="btn-subtitle">OAuth Authentication (Currently Unavailable)</span>
              </div>
            </button>

            <div className="auth-divider">
              <span>OR</span>
            </div>

            <button 
              onClick={() => setShowHelp(!showHelp)}
              className="token-btn"
            >
              <span className="btn-icon">🎫</span>
              <div className="btn-text">
                <span className="btn-title">Use Personal Access Token</span>
                <span className="btn-subtitle">Manual Authentication (Recommended)</span>
              </div>
            </button>
          </div>

          <div className="oauth-disabled-notice">
            <div className="notice-icon">⚠️</div>
            <div className="notice-content">
              <h4>OAuth Login Currently Unavailable</h4>
              <p>Due to configuration issues, OAuth login is temporarily disabled. Please use the Personal Access Token method below for authentication.</p>
            </div>
          </div>

          {showHelp && (
            <div className="token-section">
              <div className="help-section">
                <h3>📋 How to Create a GitHub Token</h3>
                <ol>
                  <li>Go to <strong>GitHub Settings</strong> → <strong>Developer Settings</strong> → <strong>Personal Access Tokens</strong></li>
                  <li>Click <strong>"Generate new token"</strong> → <strong>"Generate new token (classic)"</strong></li>
                  <li>Set <strong>Expiration</strong> (recommended: 90 days)</li>
                  <li>Give it a <strong>name</strong> like "Kiara Note App"</li>
                  <li>Check the boxes for <strong>repo</strong> and <strong>user</strong> scopes</li>
                  <li>Click <strong>"Generate token"</strong> and <strong>copy it immediately</strong></li>
                  <li>Paste the token in the field below</li>
                </ol>
                
                <div className="token-requirements">
                  <h4>Required Scopes:</h4>
                  <div className="scope-tags">
                    <span className="scope-tag">repo</span>
                    <span className="scope-tag">user</span>
                  </div>
                </div>
              </div>

              <form onSubmit={handleLogin} className="token-form">
                <div className="form-group">
                  <label htmlFor="token">GitHub Personal Access Token</label>
                  <input
                    id="token"
                    type="password"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder="ghp_xxxxxxxxxxxxxxxxxxxx..."
                    className="token-input"
                    required
                  />
                  <div className="input-hint">
                    Your token will be stored locally and never sent to any server except GitHub's API.
                  </div>
                </div>

                <div className="form-actions">
                  <button
                    type="submit"
                    disabled={isLoading || !token.trim()}
                    className="submit-btn"
                  >
                    {isLoading ? (
                      <>
                        <span className="spinner"></span>
                        Signing In...
                      </>
                    ) : (
                      <>
                        <span className="btn-icon">✅</span>
                        Sign In with Token
                      </>
                    )}
                  </button>
                  
                  <button
                    type="button"
                    onClick={() => {
                      setShowHelp(false);
                      setToken('');
                    }}
                    className="cancel-btn"
                  >
                    ❌ Cancel
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>

        <div className="login-footer">
          <div className="security-info">
            <span className="security-icon">🔒</span>
            <span>Your data is secure. We only access GitHub APIs to manage your notes.</span>
          </div>
          <div className="footer-links">
            <a 
              href="https://github.com/settings/tokens" 
              target="_blank" 
              rel="noopener noreferrer"
              className="footer-link"
            >
              Create Token →
            </a>
            <a 
              href="https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens" 
              target="_blank" 
              rel="noopener noreferrer"
              className="footer-link"
            >
              Learn More →
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
