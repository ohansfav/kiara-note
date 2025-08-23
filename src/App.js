import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from './contexts/AuthContext';
import Login from './components/Login';
import StarsBackground from './components/StarsBackground';
import MLCommitReminder from './components/MLCommitReminder';
import { withErrorHandling, getFriendlyErrorMessage } from './utils/errorHandler';
import './App.css';

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

const App = () => {
  const { user, octokit, logout, isAuthenticated, loading, loginWithOAuthCode } = useAuth();
  const [notes, setNotes] = useState('');
  const [selectedRepo, setSelectedRepo] = useState(null);
  const [repositories, setRepositories] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState({ text: '', type: '' });
  const [savedNotes, setSavedNotes] = useState([]);
  const [activeNote, setActiveNote] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filters, setFilters] = useState({
    category: 'all',
    sortBy: 'newest'
  });
  const [theme, setTheme] = useState(() => {
    // Check if we're in a browser environment
    if (typeof window !== 'undefined') {
      const savedTheme = localStorage.getItem('kiara-theme');
      return savedTheme || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    }
    return 'light'; // Default theme for SSR
  });
  const [, setShowRepoSelector] = useState(false);

  // Apply theme to document
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', theme);
    }
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('kiara-theme', theme);
    }
  }, [theme]);

  // Show message helper
  const showMessage = useCallback((text, type = 'success') => {
    setMessage({ text, type });
    setTimeout(() => setMessage({ text: '', type: '' }), 3000);
  }, []);

  // Fetch user repositories
  const fetchRepositories = useCallback(async () => {
    if (!octokit) return;

    setIsLoading(true);
    try {
      const { data } = await withErrorHandling(
        async () => await octokit.rest.repos.listForAuthenticatedUser({
          sort: 'updated',
          direction: 'desc',
          per_page: 100
        }),
        {
          operationName: 'fetchRepositories',
          maxRetries: 3,
          circuitBreakerThreshold: 5
        }
      );
      setRepositories(data);
      // Removed success message to prevent layout shaking
    } catch (error) {
      const friendlyMessage = getFriendlyErrorMessage(error);
      showMessage(friendlyMessage, 'error');
      console.error('Error fetching repositories:', error);
    } finally {
      setIsLoading(false);
    }
  }, [octokit, showMessage]);

  // Fetch existing notes from selected repository
  const fetchNotes = useCallback(async () => {
    if (!octokit || !selectedRepo || !user) return;

    setIsLoading(true);
    try {
      const { data } = await octokit.rest.repos.getContent({
        owner: user.login,
        repo: selectedRepo.name,
        path: ''
      });

      const gitnotes = data.filter(item => 
        item.type === 'file' && item.name.startsWith('gitnote-') && item.name.endsWith('.md')
      );

      const notesData = await Promise.all(
        gitnotes.map(async (file) => {
          try {
            const { data: content } = await octokit.rest.repos.getContent({
              owner: user.login,
              repo: selectedRepo.name,
              path: file.path
            });
            return {
              name: file.name,
              path: file.path,
              content: Buffer.from(content.content, 'base64').toString('utf8'),
              sha: content.sha,
              size: file.size
            };
          } catch (error) {
            return null;
          }
        })
      );

      // Sort notes by creation date (newest first)
      const sortedNotes = notesData
        .filter(note => note !== null)
        .sort((a, b) => {
          // Extract timestamp from filename and sort by newest first
          const dateA = new Date(a.name.replace('gitnote-', '').replace('.md', '').replace(/_/g, 'T').replace(/-/g, ':'));
          const dateB = new Date(b.name.replace('gitnote-', '').replace('.md', '').replace(/_/g, 'T').replace(/-/g, ':'));
          return dateB - dateA;
        });

      setSavedNotes(sortedNotes);
    } catch (error) {
      console.error('Error fetching notes:', error);
    } finally {
      setIsLoading(false);
    }
  }, [octokit, selectedRepo, user]);

  // Save notes to GitHub
  const saveNotes = useCallback(async () => {
    if (!octokit || !selectedRepo || !user || !notes.trim()) {
      showMessage('Please select a repository and enter notes', 'error');
      return;
    }

    setIsSaving(true);
    try {
      let fileName;
      
      if (activeNote) {
        // Update existing note
        fileName = activeNote.name;
        await withErrorHandling(
          async () => await octokit.rest.repos.createOrUpdateFileContents({
            owner: user.login,
            repo: selectedRepo.name,
            path: activeNote.path,
            message: `Update GitNote: ${fileName}`,
            content: Buffer.from(notes, 'utf8').toString('base64'),
            sha: activeNote.sha
          }),
          {
            operationName: 'updateNote',
            maxRetries: 3,
            circuitBreakerThreshold: 5
          }
        );
        showMessage('Note updated successfully!');
      } else {
        // Create new note with unique timestamp
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_');
        fileName = `gitnote-${timestamp}.md`;
        await withErrorHandling(
          async () => await octokit.rest.repos.createOrUpdateFileContents({
            owner: user.login,
            repo: selectedRepo.name,
            path: fileName,
            message: `Create GitNote: ${fileName}`,
            content: Buffer.from(notes, 'utf8').toString('base64')
          }),
          {
            operationName: 'createNote',
            maxRetries: 3,
            circuitBreakerThreshold: 5
          }
        );
        showMessage('Note saved successfully!');
      }

      // Clear the editor for the next note
      setNotes('');
      setActiveNote(null);
      
      // Refresh the notes list to show the new note
      await fetchNotes();
    } catch (error) {
      let friendlyMessage = getFriendlyErrorMessage(error);
      
      // Add GitHub Pages specific error handling
      if (error.message?.includes('CORS') || error.message?.includes('Network Error')) {
        friendlyMessage = 'Network error: GitHub Pages may have restrictions. Please check your internet connection and try again.';
      } else if (error.status === 401) {
        friendlyMessage = 'Authentication failed: Your Personal Access Token may be expired or invalid. Please create a new token.';
      } else if (error.status === 403) {
        friendlyMessage = 'Permission denied: Your token may not have the required scopes (repo, user). Please check your token permissions.';
      } else if (error.status === 404) {
        friendlyMessage = 'Repository not found: Please check if the repository exists and you have access to it.';
      } else if (error.message?.includes('rate limit')) {
        friendlyMessage = 'GitHub API rate limit exceeded. Please wait a few minutes before trying again.';
      }
      
      showMessage(friendlyMessage, 'error');
      console.error('Error saving note:', error);
    } finally {
      setIsSaving(false);
    }
  }, [octokit, selectedRepo, notes, activeNote, user, showMessage, fetchNotes]);

  // Load note for editing
  const loadNote = useCallback((note) => {
    setNotes(note.content);
    setActiveNote(note);
    showMessage('Note loaded for editing');
  }, [showMessage]);

  // Enhanced error handling with retry logic
  const retryOperation = useCallback(async (operation, maxRetries = 3) => {
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await operation();
      } catch (error) {
        if (i === maxRetries - 1) throw error;
        await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
      }
    }
  }, []);

  // Export notes to JSON file
  const exportNotes = useCallback(() => {
    const exportData = {
      metadata: {
        exportDate: new Date().toISOString(),
        repository: selectedRepo?.full_name,
        totalNotes: savedNotes.length,
        version: '1.0'
      },
      notes: savedNotes.map(note => ({
        name: note.name,
        content: note.content,
        createdDate: new Date(note.name.replace('gitnote-', '').replace('.md', '').replace(/_/g, 'T').replace(/-/g, ':')).toISOString(),
        size: note.size
      }))
    };

    const dataStr = JSON.stringify(exportData, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `gitnote-export-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    showMessage(`Exported ${savedNotes.length} notes successfully`);
  }, [savedNotes, selectedRepo, showMessage]);

  // Import notes from JSON file
  const importNotes = useCallback((event) => {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const importData = JSON.parse(e.target.result);
        
        if (!importData.notes || !Array.isArray(importData.notes)) {
          throw new Error('Invalid import file format');
        }

        let importedCount = 0;
        for (const note of importData.notes) {
          if (note.content && note.name) {
            // Create a new note with imported content
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_');
            const fileName = `gitnote-${timestamp}.md`;
            
            try {
              await octokit.rest.repos.createOrUpdateFileContents({
                owner: user.login,
                repo: selectedRepo.name,
                path: fileName,
                message: `Import GitNote: ${fileName}`,
                content: Buffer.from(note.content, 'utf8').toString('base64')
              });
              importedCount++;
            } catch (error) {
              console.error('Error importing note:', error);
            }
          }
        }

        showMessage(`Successfully imported ${importedCount} notes`);
        await fetchNotes();
        
        // Reset file input
        event.target.value = '';
      } catch (error) {
        showMessage('Failed to import notes: Invalid file format', 'error');
        console.error('Import error:', error);
      }
    };
    reader.readAsText(file);
  }, [octokit, selectedRepo, user, showMessage, fetchNotes]);

  // Delete note
  const deleteNote = useCallback(async (note) => {
    if (!octokit || !selectedRepo || !user) return;

    if (window.confirm('Are you sure you want to delete this note?')) {
      setIsLoading(true);
      try {
        await retryOperation(async () => {
          await octokit.rest.repos.deleteFile({
            owner: user.login,
            repo: selectedRepo.name,
            path: note.path,
            message: `Delete GitNote: ${note.name}`,
            sha: note.sha
          });
        });
        
        showMessage('Note deleted successfully');
        await fetchNotes();
        if (activeNote?.path === note.path) {
          setNotes('');
          setActiveNote(null);
        }
      } catch (error) {
        showMessage('Failed to delete note after multiple attempts', 'error');
        console.error('Error deleting note:', error);
      } finally {
        setIsLoading(false);
      }
    }
  }, [octokit, selectedRepo, user, activeNote, showMessage, fetchNotes, retryOperation]);

  // Initialize repositories on mount
  useEffect(() => {
    if (isAuthenticated && octokit) {
      fetchRepositories();
    }
  }, [isAuthenticated, octokit, fetchRepositories]);

  // Handle OAuth callback on mount
  useEffect(() => {
    const handleOAuthCallback = async () => {
      if (typeof window === 'undefined') return; // Skip SSR
      
      const urlParams = new URLSearchParams(window.location.search);
      const code = urlParams.get('code');
      
      if (code && !isAuthenticated) {
        try {
          await loginWithOAuthCode(code);
          // Clear the code from URL
          window.history.replaceState({}, document.title, window.location.pathname);
        } catch (error) {
          console.error('OAuth callback error:', error);
          showMessage('OAuth authentication failed. Please use a personal access token instead.', 'error');
          // Clear the code from URL
          window.history.replaceState({}, document.title, window.location.pathname);
        }
      }
    };

    handleOAuthCallback();
  }, [isAuthenticated, showMessage, loginWithOAuthCode]);

  // Fetch notes when repository is selected
  useEffect(() => {
    if (selectedRepo) {
      fetchNotes();
    } else {
      setSavedNotes([]);
    }
  }, [selectedRepo, fetchNotes]);

  // Filter and search notes
  const filteredNotes = React.useMemo(() => {
    let filtered = savedNotes;

    // Apply search filter
    if (searchTerm.trim()) {
      const searchLower = searchTerm.toLowerCase();
      filtered = filtered.filter(note => 
        note.name.toLowerCase().includes(searchLower) ||
        note.content.toLowerCase().includes(searchLower)
      );
    }

    // Apply sorting
    if (filters.sortBy === 'newest') {
      filtered = [...filtered].sort((a, b) => {
        const dateA = new Date(a.name.replace('gitnote-', '').replace('.md', '').replace(/_/g, 'T').replace(/-/g, ':'));
        const dateB = new Date(b.name.replace('gitnote-', '').replace('.md', '').replace(/_/g, 'T').replace(/-/g, ':'));
        return dateB - dateA;
      });
    } else if (filters.sortBy === 'oldest') {
      filtered = [...filtered].sort((a, b) => {
        const dateA = new Date(a.name.replace('gitnote-', '').replace('.md', '').replace(/_/g, 'T').replace(/-/g, ':'));
        const dateB = new Date(b.name.replace('gitnote-', '').replace('.md', '').replace(/_/g, 'T').replace(/-/g, ':'));
        return dateA - dateB;
      });
    }

    return filtered;
  }, [savedNotes, searchTerm, filters]);

  // Main render
  if (loading) {
    return (
      <div className="app-loading">
        <div className="loading-spinner"></div>
        <p>Loading Kiara Note...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Login />;
  }

  return (
    <div className="app">
      <StarsBackground />
      
      <div className="app-header">
        <div className="header-left">
          <h1>📝 Kiara Note</h1>
          <div className="user-info">
            {user && (
              <>
                <img 
                  src={user.avatar_url} 
                  alt={user.login} 
                  className="user-avatar"
                />
                <span className="user-name">{user.login}</span>
              </>
            )}
          </div>
        </div>
        
        <div className="header-right">
          <ThemeToggle theme={theme} setTheme={setTheme} />
          <button onClick={logout} className="logout-btn">
            🚪 Logout
          </button>
        </div>
      </div>

      <div className="app-content">
        <div className="sidebar">
          <div className="repo-selector">
            <h3>📁 Repository</h3>
            <select 
              value={selectedRepo?.name || ''} 
              onChange={(e) => {
                const repo = repositories.find(r => r.name === e.target.value);
                setSelectedRepo(repo);
              }}
              disabled={isLoading}
            >
              <option value="">Select a repository...</option>
              {repositories.map(repo => (
                <option key={repo.id} value={repo.name}>
                  {repo.full_name}
                </option>
              ))}
            </select>
            
            <button 
              onClick={fetchRepositories}
              disabled={isLoading}
              className="refresh-btn"
            >
              🔄 Refresh
            </button>
          </div>

          <div className="notes-section">
            <div className="notes-header">
              <h3>📝 Notes ({savedNotes.length})</h3>
              <div className="notes-actions">
                <button onClick={exportNotes} className="action-btn">
                  📤 Export
                </button>
                <label className="action-btn">
                  📥 Import
                  <input 
                    type="file" 
                    accept=".json" 
                    onChange={importNotes} 
                    style={{ display: 'none' }}
                  />
                </label>
              </div>
            </div>

            <div className="search-filter">
              <input
                type="text"
                placeholder="Search notes..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="search-input"
              />
              
              <select 
                value={filters.sortBy}
                onChange={(e) => setFilters(prev => ({ ...prev, sortBy: e.target.value }))}
                className="filter-select"
              >
                <option value="newest">Newest First</option>
                <option value="oldest">Oldest First</option>
              </select>
            </div>

            <div className="notes-list">
              {isLoading ? (
                <div className="loading-notes">Loading notes...</div>
              ) : filteredNotes.length === 0 ? (
                <div className="no-notes">
                  {savedNotes.length === 0 ? 'No notes yet. Create your first note!' : 'No notes match your search.'}
                </div>
              ) : (
                filteredNotes.map(note => (
                  <div key={note.path} className="note-item">
                    <div className="note-header">
                      <h4 onClick={() => loadNote(note)}>{note.name}</h4>
                      <button 
                        onClick={() => deleteNote(note)}
                        className="delete-btn"
                        title="Delete note"
                      >
                        🗑️
                      </button>
                    </div>
                    <div className="note-preview">
                      {note.content.substring(0, 100)}
                      {note.content.length > 100 && '...'}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="main-content">
          <div className="editor-section">
            <div className="editor-header">
              <h3>
                {activeNote ? `✏️ Editing: ${activeNote.name}` : '📝 New Note'}
              </h3>
              <div className="editor-actions">
                <button 
                  onClick={() => {
                    setNotes('');
                    setActiveNote(null);
                  }}
                  className="clear-btn"
                >
                  🗑️ Clear
                </button>
                <button 
                  onClick={saveNotes}
                  disabled={isSaving || !notes.trim() || !selectedRepo}
                  className="save-btn"
                >
                  {isSaving ? '💾 Saving...' : '💾 Save Note'}
                </button>
              </div>
            </div>

            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Write your note here... Markdown supported!"
              className="note-editor"
              disabled={isSaving}
            />

            <div className="editor-footer">
              <div className="note-info">
                {selectedRepo && (
                  <span>📁 Repository: {selectedRepo.full_name}</span>
                )}
                {notes.length > 0 && (
                  <span>📊 Characters: {notes.length}</span>
                )}
              </div>
              
              {message.text && (
                <div className={`message ${message.type}`}>
                  {message.text}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <MLCommitReminder />
    </div>
  );
};

export default App;
