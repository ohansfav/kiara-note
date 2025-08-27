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
  const [previousUser, setPreviousUser] = useState(null);
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
    const savedTheme = localStorage.getItem('kiara-theme');
    return savedTheme || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  });
  const [, setShowRepoSelector] = useState(false);

  // Apply theme to document
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('kiara-theme', theme);
  }, [theme]);

  // Show message helper
  const showMessage = (text, type = 'success') => {
    setMessage({ text, type });
    setTimeout(() => setMessage({ text: '', type: '' }), 3000);
  };

  // Test GitHub API connection and permissions
  const testGitHubConnection = useCallback(async () => {
    if (!octokit || !user) {
      showMessage('No active GitHub connection', 'error');
      return;
    }

    setIsLoading(true);
    try {
      // Test basic authentication
      const { data: userData } = await octokit.rest.users.getAuthenticated();
      console.log('Authenticated user:', userData.login);
      
      // Test repository access
      const { data: repos } = await octokit.rest.repos.listForAuthenticatedUser({
        per_page: 1
      });
      console.log('Repository access: OK', `Found ${repos.length} repositories`);
      
      // Test if we can access the selected repository
      if (selectedRepo) {
        try {
          await octokit.rest.repos.get({
            owner: selectedRepo.owner.login,
            repo: selectedRepo.name
          });
          console.log('Selected repository access: OK');
        } catch (repoError) {
          console.error('Selected repository access failed:', repoError);
          showMessage(`Cannot access repository: ${selectedRepo.name}`, 'error');
        }
      }
      
      showMessage('GitHub connection test successful!', 'success');
    } catch (error) {
      console.error('GitHub connection test failed:', error);
      const friendlyMessage = getFriendlyErrorMessage(error);
      let detailedMessage = friendlyMessage;
      
      if (error.status === 401) {
        detailedMessage = 'Authentication failed. Your token may be invalid or expired.';
      } else if (error.status === 403) {
        detailedMessage = 'Permission denied. Your token may lack required scopes.';
      }
      
      showMessage(detailedMessage, 'error');
    } finally {
      setIsLoading(false);
    }
  }, [octokit, user, selectedRepo, showMessage]);

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
      // Ensure data is always an array
      setRepositories(Array.isArray(data) ? data : []);
      // Removed success message to prevent layout shaking
    } catch (error) {
      const friendlyMessage = getFriendlyErrorMessage(error);
      showMessage(friendlyMessage, 'error');
      console.error('Error fetching repositories:', error);
      // Set empty array on error to prevent map issues
      setRepositories([]);
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
        owner: selectedRepo.owner.login,
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
              owner: selectedRepo.owner.login,
              repo: selectedRepo.name,
              path: file.path
            });
            return {
              name: file.name,
              path: file.path,
              content: atob(content.content),
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
            owner: selectedRepo.owner.login,
            repo: selectedRepo.name,
            path: activeNote.path,
            message: `Update GitNote: ${fileName}`,
            content: btoa(unescape(encodeURIComponent(notes))),
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
            owner: selectedRepo.owner.login,
            repo: selectedRepo.name,
            path: fileName,
            message: `Create GitNote: ${fileName}`,
            content: btoa(unescape(encodeURIComponent(notes)))
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
      const friendlyMessage = getFriendlyErrorMessage(error);
      
      // Enhanced error logging for debugging
      console.error('Error saving note:', error);
      console.error('Error details:', {
        message: error.message,
        status: error.status,
        headers: error.headers,
        documentation_url: error.documentation_url,
        response: error.response
      });
      
      // Show more detailed error message to user
      let detailedMessage = friendlyMessage;
      if (error.status === 401) {
        detailedMessage = 'Authentication failed. Please check your token permissions and try logging in again.';
      } else if (error.status === 403) {
        detailedMessage = 'Permission denied. Your token may not have the required permissions (repo scope).';
      } else if (error.status === 404) {
        detailedMessage = 'Repository not found. Please check if you have access to this repository.';
      } else if (error.message?.includes('Bad credentials')) {
        detailedMessage = 'Invalid token. Please check your GitHub personal access token.';
      }
      
      showMessage(detailedMessage, 'error');
    } finally {
      setIsSaving(false);
    }
  }, [octokit, selectedRepo, notes, activeNote, user, showMessage, fetchNotes]);

  // Auto-save new notes when typing
  const autoSaveNewNote = useCallback(async () => {
    if (!octokit || !selectedRepo || !user || !notes.trim()) {
      return; // Don't auto-save if no content, no repo
    }

    // Only auto-save if this is truly a new note (not editing existing)
    if (activeNote) {
      return;
    }

    try {
      // Generate unique filename with timestamp to avoid conflicts
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const fileName = `gitnote-${timestamp}.md`;
      const content = btoa(unescape(encodeURIComponent(notes)));

      await octokit.rest.repos.createOrUpdateFileContents({
        owner: selectedRepo.owner.login,
        repo: selectedRepo.name,
        path: fileName,
        message: `Create GitNote: ${fileName}`,
        content: content
      });

      showMessage('Note created and saved to GitHub!');
      
      // Clear the editor to allow creating new notes
      setNotes('');
      // Keep activeNote as null so new notes can be created
      
      // Refresh the notes list
      await fetchNotes();
    } catch (error) {
      showMessage('Failed to auto-save note', 'error');
      console.error('Error auto-saving note:', error);
    }
  }, [octokit, selectedRepo, notes, activeNote, user, fetchNotes]);

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
                owner: selectedRepo.owner.login,
                repo: selectedRepo.name,
                path: fileName,
                message: `Import GitNote: ${fileName}`,
                content: btoa(unescape(encodeURIComponent(note.content)))
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
            owner: selectedRepo.owner.login,
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
    } else if (filters.sortBy === 'name') {
      filtered = [...filtered].sort((a, b) => 
        a.name.localeCompare(b.name)
      );
    } else if (filters.sortBy === 'size') {
      filtered = [...filtered].sort((a, b) => b.size - a.size);
    }

    return filtered;
  }, [savedNotes, searchTerm, filters]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleShortcuts = (e) => {
      // Only handle shortcuts when no modal inputs are focused
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
        return;
      }

      // Ctrl/Cmd + N: New note
      if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault();
        setNotes('');
        setActiveNote(null);
        showMessage('Created new note');
      }
      
      // Ctrl/Cmd + S: Save note
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (notes.trim() && !isSaving) {
          saveNotes();
        }
      }
      
      // Ctrl/Cmd + F: Focus search
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        const searchInput = document.querySelector('.search-input');
        if (searchInput) {
          searchInput.focus();
          searchInput.select();
        }
      }
      
      // Ctrl/Cmd + D: Delete active note
      if ((e.ctrlKey || e.metaKey) && e.key === 'd' && activeNote) {
        e.preventDefault();
        if (window.confirm('Are you sure you want to delete this note?')) {
          deleteNote(activeNote);
        }
      }
      
      // Escape: Clear search or cancel editing
      if (e.key === 'Escape') {
        if (searchTerm) {
          setSearchTerm('');
          showMessage('Search cleared');
        } else if (activeNote) {
          setNotes('');
          setActiveNote(null);
          showMessage('Editing cancelled');
        }
      }
    };

    window.addEventListener('keydown', handleShortcuts);
    return () => window.removeEventListener('keydown', handleShortcuts);
  }, [saveNotes, deleteNote, activeNote, notes, isSaving, searchTerm, showMessage]);

  // Auto-save when user types in a new note (with debounce) - DISABLED to prevent infinite loops
  // useEffect(() => {
  //   // Only trigger auto-save for new notes when there's content and no active note
  //   if (!activeNote && notes.trim() && notes.length > 5) {
  //     const timer = setTimeout(() => {
  //       autoSaveNewNote();
  //     }, 3000); // Wait 3 seconds after user stops typing

  //     return () => clearTimeout(timer);
  //   }
  // }, [notes, activeNote, autoSaveNewNote]);

  // Auto-save draft to localStorage for offline support
  useEffect(() => {
    if (notes.trim()) {
      const draftData = {
        content: notes,
        timestamp: new Date().toISOString(),
        activeNote: activeNote
      };
      localStorage.setItem('gitnote-draft', JSON.stringify(draftData));
    } else {
      localStorage.removeItem('gitnote-draft');
    }
  }, [notes, activeNote]);

  // Reset application state when user changes
  useEffect(() => {
    if (user && previousUser && user.id !== previousUser.id) {
      // User has changed, reset all application state
      setNotes('');
      setSelectedRepo(null);
      setRepositories([]);
      setSavedNotes([]);
      setActiveNote(null);
      setSearchTerm('');
      setFilters({ category: 'all', sortBy: 'newest' });
      setMessage({ text: '', type: '' });
      
      // Clear any cached drafts from previous user
      localStorage.removeItem('gitnote-draft');
      
      // Show success message for account switching
      const previousUserName = previousUser.login || previousUser.name;
      const currentUserName = user.login || user.name;
      showMessage(`Successfully switched from ${previousUserName} to ${currentUserName}`, 'success');
      
      console.log(`Account switched: ${previousUserName} → ${currentUserName}`);
    }
    
    // Update previous user reference
    if (user) {
      setPreviousUser(user);
    }
  }, [user, previousUser, showMessage]);

  // Load draft from localStorage on component mount
  useEffect(() => {
    const savedDraft = localStorage.getItem('gitnote-draft');
    if (savedDraft && !activeNote && !notes.trim()) {
      try {
        const draftData = JSON.parse(savedDraft);
        setNotes(draftData.content);
        setActiveNote(draftData.activeNote);
        showMessage('Draft restored from local storage');
      } catch (error) {
        console.error('Error loading draft:', error);
        localStorage.removeItem('gitnote-draft');
      }
    }
  }, [activeNote, notes, showMessage]);

  // Show loading state
  if (loading) {
    return (
      <div className="app-loading">
        <div className="loading-spinner"></div>
        <p>Loading Kiara Note...</p>
      </div>
    );
  }

  // Show login if not authenticated
  if (!isAuthenticated) {
    return <Login />;
  }

  return (
    <div className="app">
      {/* Stars Background */}
      <StarsBackground />
      
      {/* Header */}
      <header className="app-header">
        <div className="header-content">
          <div className="logo-section">
            <h1>📝 Kiara Note</h1>
            <p>GitHub-powered note management</p>
          </div>
          
          <div className="header-actions">
            <ThemeToggle theme={theme} setTheme={setTheme} />
            <div className="user-section">
              <div className="user-info">
                <img 
                  src={user?.avatar_url || 'https://via.placeholder.com/40'} 
                  alt={user?.login || 'User'} 
                  className="user-avatar"
                />
                <div className="user-details">
                  <span className="user-name">{user?.name || user?.login || 'User'}</span>
                  <span className="user-handle">@{user?.login || 'user'}</span>
                </div>
              </div>
              <button onClick={logout} className="logout-btn">
                🚪 Logout
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="app-main">
        {/* Messages */}
        {message.text && (
          <div className={`message ${message.type}`}>
            {message.text}
          </div>
        )}

        {/* Repository Selection */}
        <div className="repo-section">
          <div className="repo-header">
            <h2>📁 Repository</h2>
            <select 
              value={selectedRepo?.id || ''}
              onChange={(e) => {
                const repo = repositories.find(r => r.id === parseInt(e.target.value));
                if (repo) {
                  setSelectedRepo(repo);
                  showMessage(`Selected: ${repo.full_name}`);
                }
              }}
              className="repo-select"
              disabled={repositories.length === 0}
            >
              <option value="">{repositories.length === 0 ? 'Loading repositories...' : 'Select a repository'}</option>
              {repositories.map(repo => (
                <option key={repo.id} value={repo.id}>
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
        </div>

        {/* ML Commit Reminder Section */}
        {selectedRepo && (
          <MLCommitReminder 
            octokit={octokit}
            selectedRepo={selectedRepo}
            user={user}
            showMessage={showMessage}
          />
        )}

        {/* Notes Section */}
        {selectedRepo && (
          <div className="notes-section">
            <div className="notes-header">
              <div className="notes-header-container">
                <h2>📝 Notes</h2>
                <div className="notes-actions-group">
                  <button 
                    onClick={() => {
                      setNotes('');
                      setActiveNote(null);
                    }}
                    className="action-button primary-button"
                    title="Create a new note"
                  >
                    <span className="button-icon">➕</span>
                    <span className="button-text">New Note</span>
                  </button>
                  <button 
                    onClick={exportNotes}
                    disabled={savedNotes.length === 0}
                    className="action-button secondary-button"
                    title="Export all notes to JSON file"
                  >
                    <span className="button-icon">📤</span>
                    <span className="button-text">Export</span>
                  </button>
                  <label className="action-button secondary-button import-button">
                    <span className="button-icon">📥</span>
                    <span className="button-text">Import</span>
                    <input
                      type="file"
                      accept=".json"
                      onChange={importNotes}
                      style={{ display: 'none' }}
                    />
                  </label>
                </div>
              </div>
            </div>

            <div className="notes-content">
              {/* Note Editor */}
              <div className="note-editor">
                <div className="editor-header">
                  <h3>
                    {activeNote ? `Editing: ${activeNote.name}` : 'New Note'}
                  </h3>
                  {activeNote && (
                    <button 
                      onClick={() => {
                        setNotes('');
                        setActiveNote(null);
                      }}
                      className="cancel-edit-btn"
                    >
                      ❌ Cancel
                    </button>
                  )}
                </div>
                
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Start writing your note here..."
                  className="note-textarea"
                  disabled={isSaving}
                />
                
                <div className="editor-actions">
                  <button 
                    onClick={saveNotes}
                    disabled={isSaving || !notes.trim()}
                    className="save-btn"
                  >
                    {isSaving ? '💾 Saving...' : '💾 Save to GitHub'}
                  </button>
                  <button 
                    onClick={() => setNotes('')}
                    disabled={!notes.trim()}
                    className="clear-btn"
                  >
                    🗑️ Clear
                  </button>
                </div>
              </div>

              {/* Notes List */}
              <div className="notes-list">
                <div className="notes-list-header">
                  <h3>Saved Notes</h3>
                  <div className="notes-controls">
                    {/* Search Input */}
                    <div className="search-box">
                      <input
                        type="text"
                        placeholder="🔍 Search notes..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="search-input"
                      />
                    </div>
                    
                    {/* Sort Dropdown */}
                    <select
                      value={filters.sortBy}
                      onChange={(e) => setFilters(prev => ({ ...prev, sortBy: e.target.value }))}
                      className="sort-select"
                    >
                      <option value="newest">📅 Newest First</option>
                      <option value="oldest">📅 Oldest First</option>
                      <option value="name">📝 By Name</option>
                      <option value="size">📊 By Size</option>
                    </select>
                  </div>
                </div>
                
                {filteredNotes.length === 0 ? (
                  <div className="no-notes">
                    <p>{savedNotes.length === 0 ? 'No notes found in this repository' : 'No notes match your search criteria'}</p>
                  </div>
                ) : (
                  <div className="notes-grid">
                    {filteredNotes.map(note => (
                      <div
                        key={note.path}
                        className={`note-card ${activeNote?.path === note.path ? 'active' : ''}`}
                      >
                        <div className="note-card-header">
                          <h4>{note.name.replace('gitnote-', '').replace('.md', '')}</h4>
                          <div className="note-card-actions">
                            <button 
                              onClick={() => loadNote(note)}
                              className="note-action-btn edit"
                              title="Edit note"
                            >
                              ✏️
                            </button>
                            <button 
                              onClick={() => deleteNote(note)}
                              className="note-action-btn delete"
                              title="Delete note"
                            >
                              🗑️
                            </button>
                          </div>
                        </div>
                        <div className="note-card-content">
                          <p>{note.content.substring(0, 100)}...</p>
                        </div>
                        <div className="note-card-footer">
                          <span className="note-size">{Math.round(note.size / 1024)} KB</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* No Repository Selected */}
        {!selectedRepo && (
          <div className="no-repo-selected">
            <div className="no-repo-content">
              <h2>📁 Select a Repository</h2>
              <p>Choose a GitHub repository to start managing your notes</p>
              <button 
                onClick={() => setShowRepoSelector(true)}
                className="select-repo-btn"
              >
                Browse Repositories
              </button>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="app-footer">
        <p>📝 Kiara Note - Your GitHub-powered note manager</p>
        <p>Notes are saved as markdown files in your selected repository</p>
      </footer>
    </div>
  );
};

export default App;
/ /   F o r c e   V e r c e l   t o   u s e   l a t e s t   c o m m i t  
 