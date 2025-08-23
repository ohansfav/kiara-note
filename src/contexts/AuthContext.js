import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { Octokit } from '@octokit/rest';
import { withErrorHandling, getFriendlyErrorMessage } from '../utils/errorHandler';

const AuthContext = createContext();

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(() => {
    // Check if we're in a browser environment
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem('github_token');
    }
    return null;
  });
  const [loading, setLoading] = useState(true);
  const [octokit, setOctokit] = useState(null);

  const logout = useCallback(() => {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('github_token');
    }
    setToken(null);
    setUser(null);
    setOctokit(null);
  }, []);

  const fetchUser = useCallback(async (octokitInstance) => {
    try {
      const { data } = await withErrorHandling(
        async () => await octokitInstance.rest.users.getAuthenticated(),
        {
          operationName: 'fetchUser',
          maxRetries: 3,
          circuitBreakerThreshold: 5
        }
      );
      setUser(data);
      setLoading(false);
    } catch (error) {
      console.error('Error fetching user:', error);
      // Could dispatch this to a global error store or show a toast
      logout();
    }
  }, [logout]);

  const login = useCallback(async (githubToken) => {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('github_token', githubToken);
      }
      setToken(githubToken);
      const octokitInstance = new Octokit({ auth: githubToken });
      setOctokit(octokitInstance);
      await fetchUser(octokitInstance);
      return true; // Login successful
    } catch (error) {
      console.error('Login failed:', error);
      const friendlyMessage = getFriendlyErrorMessage(error);
      logout(); // Clean up on failure
      throw new Error(friendlyMessage); // Re-throw with user-friendly message
    }
  }, [fetchUser, logout]);

  const loginWithOAuthCode = useCallback(async (code) => {
    try {
      // Exchange the authorization code for an access token
      const clientId = process.env.REACT_APP_GITHUB_CLIENT_ID;
      const clientSecret = process.env.REACT_APP_GITHUB_CLIENT_SECRET;
      const redirectUri = process.env.REACT_APP_REDIRECT_URI;

      if (!clientId || !clientSecret) {
        throw new Error('GitHub OAuth credentials not configured. Please check your environment variables.');
      }

      // Create form data for the token exchange
      const tokenData = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code: code,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
      });

      // Exchange code for token with enhanced error handling
      const tokenResponse = await withErrorHandling(
        async () => await fetch('https://github.com/login/oauth/access_token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/json'
          },
          body: tokenData.toString()
        }),
        {
          operationName: 'oauth_token_exchange',
          maxRetries: 3,
          circuitBreakerThreshold: 3
        }
      );

      const tokenDataResponse = await tokenResponse.json();

      if (tokenDataResponse.error) {
        throw new Error(`OAuth error: ${tokenDataResponse.error_description || tokenDataResponse.error}`);
      }

      const accessToken = tokenDataResponse.access_token;
      
      if (!accessToken) {
        throw new Error('No access token received from GitHub');
      }

      // Use the access token to login
      await login(accessToken);
      return true;
    } catch (error) {
      console.error('OAuth login failed:', error);
      const friendlyMessage = getFriendlyErrorMessage(error);
      logout();
      throw new Error(friendlyMessage);
    }
  }, [login, logout]);

  useEffect(() => {
    if (token) {
      const octokitInstance = new Octokit({ auth: token });
      setOctokit(octokitInstance);
      fetchUser(octokitInstance);
    } else {
      setLoading(false);
    }
  }, [token, fetchUser]); // Include fetchUser in dependencies

  const value = {
    user,
    token,
    octokit,
    login,
    loginWithOAuthCode,
    logout,
    loading,
    isAuthenticated: !!token
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
