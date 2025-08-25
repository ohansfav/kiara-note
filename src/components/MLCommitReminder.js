import React, { useState, useEffect, useCallback } from 'react';
import { format, isToday, isYesterday, subDays } from 'date-fns';
import './MLCommitReminder.css';

const MLCommitReminder = ({ octokit, selectedRepo, user, showMessage }) => {
  const [commitSchedule, setCommitSchedule] = useState({
    enabled: true,
    reminderTime: '20:00',
    autoGenerate: true,
    missedCommitThreshold: 2
  });
  
  const [missedDays, setMissedDays] = useState([]);
  const [showReminder, setShowReminder] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const [mlInsights, setMlInsights] = useState({
    commitStreak: 0,
    averageCommitsPerDay: 0,
    bestCommitTime: null,
    productivityScore: 0,
    predictions: []
  });
  const [errorState, setErrorState] = useState({
    hasError: false,
    errorType: null,
    lastErrorTime: null,
    retryCount: 0
  });

  // Add a flag to prevent recursive calls
  const isUpdatingRef = React.useRef(false);

  // Use refs to track the latest values without causing re-renders
  const octokitRef = React.useRef(octokit);
  const userRef = React.useRef(user);
  const selectedRepoRef = React.useRef(selectedRepo);
  const commitScheduleEnabledRef = React.useRef(commitSchedule.enabled);
  const commitScheduleThresholdRef = React.useRef(commitSchedule.missedCommitThreshold);
  const showMessageRef = React.useRef(showMessage);

  // Update refs when values change
  React.useEffect(() => {
    octokitRef.current = octokit;
    userRef.current = user;
    selectedRepoRef.current = selectedRepo;
    commitScheduleEnabledRef.current = commitSchedule.enabled;
    commitScheduleThresholdRef.current = commitSchedule.missedCommitThreshold;
    showMessageRef.current = showMessage;
  }, [octokit, user, selectedRepo, commitSchedule.enabled, commitSchedule.missedCommitThreshold, showMessage]);

  // Utility functions defined first to avoid initialization issues
  const processCommitData = (events, startDate) => {
    const commitEvents = events.filter(event => 
      event.type === 'PushEvent' && 
      new Date(event.created_at) >= startDate
    );

    const dailyCommits = {};
    
    commitEvents.forEach(event => {
      const date = format(new Date(event.created_at), 'yyyy-MM-dd');
      const hour = new Date(event.created_at).getHours();
      
      if (!dailyCommits[date]) {
        dailyCommits[date] = {
          date,
          commitCount: 0,
          hour: hour,
          dayOfWeek: new Date(date).getDay()
        };
      }
      
      dailyCommits[date].commitCount += event.payload.commits.length;
    });

    return Object.values(dailyCommits);
  };

  const calculateMLInsights = (commitData) => {
    if (commitData.length === 0) {
      return {
        commitStreak: 0,
        averageCommitsPerDay: 0,
        bestCommitTime: null,
        productivityScore: 0,
        predictions: []
      };
    }

    const sortedData = commitData.sort((a, b) => new Date(a.date) - new Date(b.date));
    
    let streak = 0;
    let currentStreak = 0;
    const today = format(new Date(), 'yyyy-MM-dd');
    const yesterday = format(subDays(new Date(), 1), 'yyyy-MM-dd');

    for (let i = sortedData.length - 1; i >= 0; i--) {
      const commitDate = sortedData[i].date;
      
      if (commitDate === today || commitDate === yesterday) {
        currentStreak++;
      } else if (currentStreak > 0) {
        streak = Math.max(streak, currentStreak);
        currentStreak = 0;
      }
    }
    streak = Math.max(streak, currentStreak);

    const totalCommits = sortedData.reduce((sum, day) => sum + day.commitCount, 0);
    const averageCommitsPerDay = totalCommits / commitData.length;

    const hourCommits = {};
    commitData.forEach(day => {
      const hour = day.hour;
      hourCommits[hour] = (hourCommits[hour] || 0) + day.commitCount;
    });

    let bestCommitTime = null;
    let maxCommits = 0;
    Object.entries(hourCommits).forEach(([hour, commits]) => {
      if (commits > maxCommits) {
        maxCommits = commits;
        bestCommitTime = parseInt(hour);
      }
    });

    const productivityScore = Math.min(100, Math.round((averageCommitsPerDay * 20) + (streak * 5)));

    const predictions = generatePredictions(commitData, streak, averageCommitsPerDay);

    return {
      commitStreak: streak,
      averageCommitsPerDay: Math.round(averageCommitsPerDay * 100) / 100,
      bestCommitTime,
      productivityScore,
      predictions
    };
  };

  const generatePredictions = (commitData, currentStreak, avgCommits) => {
    const predictions = [];
    
    if (currentStreak > 0) {
      predictions.push({
        type: 'streak',
        message: `You're on a ${currentStreak}-day streak! Keep it up!`,
        confidence: Math.min(95, 60 + (currentStreak * 5))
      });
    }

    if (avgCommits < 1) {
      predictions.push({
        type: 'activity',
        message: 'Consider increasing your commit frequency for better project momentum.',
        confidence: 75
      });
    }

    const recentActivity = commitData.slice(-7);
    const recentAvg = recentActivity.reduce((sum, day) => sum + day.commitCount, 0) / recentActivity.length;
    
    if (recentAvg > avgCommits * 1.5) {
      predictions.push({
        type: 'momentum',
        message: 'Your recent activity shows increased productivity!',
        confidence: 80
      });
    }

    return predictions;
  };

  // Define the functions without useCallback to avoid dependency issues
  const initializeMLModel = async (retryCount = 0) => {
    if (isUpdatingRef.current) return;
    if (!octokitRef.current || !userRef.current || !selectedRepoRef.current) {
      console.log('MLCommitReminder: Missing required data', { 
        octokit: !!octokitRef.current, 
        user: !!userRef.current, 
        selectedRepo: !!selectedRepoRef.current 
      });
      return;
    }

    // Get fresh error state to avoid stale closure issues
    const currentState = { ...errorState };
    const now = new Date();
    if (currentState.hasError && currentState.lastErrorTime) {
      const timeSinceLastError = now - new Date(currentState.lastErrorTime);
      const cooldownPeriod = currentState.retryCount > 3 ? 300000 : 60000;
      
      if (timeSinceLastError < cooldownPeriod) {
        console.log('MLCommitReminder: In cooldown period, skipping initialization');
        return;
      }
    }

    isUpdatingRef.current = true;
    setIsInitializing(true);
    console.log('MLCommitReminder: Starting ML model initialization...', { 
      retryCount, 
      user: userRef.current.login,
      repo: selectedRepoRef.current.full_name 
    });
    
    try {
      const ninetyDaysAgo = subDays(new Date(), 90);
      console.log('MLCommitReminder: Fetching events from', ninetyDaysAgo);
      
      let events = [];
      
      // Try to get repository commits first (most reliable)
      try {
        console.log('MLCommitReminder: Fetching repository commits...');
        const { data: commits } = await octokitRef.current.rest.repos.listCommits({
          owner: selectedRepoRef.current.owner.login || userRef.current.login,
          repo: selectedRepoRef.current.name,
          since: ninetyDaysAgo.toISOString(),
          per_page: 100
        });
        
        // Convert commits to event-like structure
        events = commits.map(commit => ({
          type: 'PushEvent',
          created_at: commit.commit.author.date,
          payload: {
            commits: [{
              sha: commit.sha,
              message: commit.commit.message
            }]
          },
          repo: {
            name: selectedRepoRef.current.full_name
          }
        }));
        
        console.log('MLCommitReminder: Fetched', commits.length, 'commits from repository');
      } catch (commitError) {
        console.log('MLCommitReminder: Could not fetch commits, trying user events:', commitError.message);
        
        // Fall back to user events
        try {
          const { data: userEvents } = await octokitRef.current.rest.activity.listEventsForAuthenticatedUser({
            per_page: 100,
            sort: 'created',
            direction: 'desc'
          });
          
          // Filter user events to only include PushEvents for the selected repository
          events = userEvents.filter(event => 
            event.type === 'PushEvent' && 
            event.repo && 
            event.repo.name === selectedRepoRef.current.full_name &&
            new Date(event.created_at) >= ninetyDaysAgo
          );
          
          console.log('MLCommitReminder: Fetched and filtered', events.length, 'user events for this repository');
        } catch (userEventsError) {
          console.log('MLCommitReminder: Could not fetch user events either:', userEventsError.message);
          throw new Error('Unable to fetch commit data from GitHub API');
        }
      }
      
      if (!events || !Array.isArray(events)) {
        throw new Error('Invalid data received from GitHub API');
      }
      
      console.log('MLCommitReminder: Total events to process:', events.length);
      
      const commitData = processCommitData(events, ninetyDaysAgo);
      console.log('MLCommitReminder: Processed', commitData.length, 'commit days');
      
      const insights = calculateMLInsights(commitData);
      console.log('MLCommitReminder: Calculated insights', insights);
      setMlInsights(insights);
      
      // Reset error state on success
      setErrorState({
        hasError: false,
        errorType: null,
        lastErrorTime: null,
        retryCount: 0
      });
      
      if (retryCount === 0) {
        showMessageRef.current('ML insights loaded successfully!', 'success');
      }
      
    } catch (error) {
      console.error('Error initializing ML model:', error);
      
      setErrorState(prev => ({
        hasError: true,
        errorType: error.message,
        lastErrorTime: new Date(),
        retryCount: prev.retryCount + 1
      }));
      
      if (retryCount < 2 && (error.message.includes('Network Error') || error.message.includes('fetch'))) {
        console.log('MLCommitReminder: Retrying due to network error...');
        setTimeout(() => {
          isUpdatingRef.current = false;
          initializeMLModel(retryCount + 1);
        }, 2000 * (retryCount + 1));
        return;
      }
      
      // Show error message only if we haven't shown one recently
      const currentStateAfterError = { ...errorState };
      if (!currentStateAfterError.lastErrorTime || (now - new Date(currentStateAfterError.lastErrorTime)) > 30000) {
        let errorMessage = 'Failed to load ML insights. Please check your GitHub connection.';
        
        if (error.message.includes('rate limit')) {
          errorMessage = 'GitHub API rate limit exceeded. Please wait a few minutes before trying again.';
        } else if (error.message.includes('Authentication')) {
          errorMessage = 'Authentication failed. Please log in again.';
        } else if (error.message.includes('Network Error')) {
          errorMessage = 'Network connection failed. Please check your internet connection.';
        } else if (error.message.includes('Invalid data')) {
          errorMessage = 'Received invalid data from GitHub. Please try again.';
        } else if (error.message.includes('Not Found')) {
          errorMessage = 'Repository not found. Please select a different repository.';
        }
        
        showMessageRef.current(errorMessage, 'error');
      }
      
      setMlInsights({
        commitStreak: 0,
        averageCommitsPerDay: 0,
        bestCommitTime: null,
        productivityScore: 0,
        predictions: []
      });
      
    } finally {
      setIsInitializing(false);
      setTimeout(() => {
        isUpdatingRef.current = false;
      }, 100);
    }
  };

  const checkMissedCommits = async () => {
    if (isUpdatingRef.current) return;
    if (!octokitRef.current || !userRef.current || !selectedRepoRef.current) return;

    console.log('MLCommitReminder: Starting commit check...');
    try {
      const sevenDaysAgo = subDays(new Date(), 7);
      console.log('MLCommitReminder: Checking for missed commits since', sevenDaysAgo);
      
      let events = [];
      
      // Try to get repository commits first (most reliable)
      try {
        console.log('MLCommitReminder: Fetching repository commits for missed commit check...');
        const { data: commits } = await octokitRef.current.rest.repos.listCommits({
          owner: selectedRepoRef.current.owner.login || userRef.current.login,
          repo: selectedRepoRef.current.name,
          since: sevenDaysAgo.toISOString(),
          per_page: 100
        });
        
        // Convert commits to event-like structure
        events = commits.map(commit => ({
          type: 'PushEvent',
          created_at: commit.commit.author.date,
          payload: {
            commits: [{
              sha: commit.sha,
              message: commit.commit.message
            }]
          },
          repo: {
            name: selectedRepoRef.current.full_name
          }
        }));
        
        console.log('MLCommitReminder: Fetched', commits.length, 'commits for missed commit check');
      } catch (commitError) {
        console.log('MLCommitReminder: Could not fetch commits for missed commit check, trying user events:', commitError.message);
        
        // Fall back to user events
        try {
          const { data: userEvents } = await octokitRef.current.rest.activity.listEventsForAuthenticatedUser({
            per_page: 100,
            sort: 'created',
            direction: 'desc'
          });
          
          // Filter user events to only include PushEvents for the selected repository
          events = userEvents.filter(event => 
            event.type === 'PushEvent' && 
            event.repo && 
            event.repo.name === selectedRepoRef.current.full_name &&
            new Date(event.created_at) >= sevenDaysAgo
          );
          
          console.log('MLCommitReminder: Fetched and filtered', events.length, 'user events for missed commit check');
        } catch (userEventsError) {
          console.log('MLCommitReminder: Could not fetch user events for missed commit check either:', userEventsError.message);
          // If we can't get any data, assume no recent commits
          events = [];
        }
      }

      const commitEvents = events.filter(event => 
        event.type === 'PushEvent' && 
        new Date(event.created_at) >= sevenDaysAgo
      );

      console.log('MLCommitReminder: Found', commitEvents.length, 'commit events in the last 7 days');

      const commitDays = new Set();
      commitEvents.forEach(event => {
        const date = format(new Date(event.created_at), 'yyyy-MM-dd');
        commitDays.add(date);
        console.log('MLCommitReminder: Found commit on', date);
      });

      const missed = [];
      for (let i = 1; i < 7; i++) {
        const date = format(subDays(new Date(), i), 'yyyy-MM-dd');
        if (!commitDays.has(date)) {
          missed.push(date);
          console.log('MLCommitReminder: Missed commit on', date);
        }
      }

      console.log('MLCommitReminder: Total missed days:', missed.length);
      setMissedDays(missed);
      setShowReminder(missed.length >= commitScheduleThresholdRef.current);

      // Note: Removed automatic refresh to prevent infinite loop
      // ML insights are refreshed periodically by the interval effect

    } catch (error) {
      console.error('Error checking missed commits:', error);
      showMessageRef.current('Failed to check commit history', 'error');
    }
  };

  const handleScheduleChange = (field, value) => {
    setCommitSchedule(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const generateCommitMessage = () => {
    const { commitStreak, averageCommitsPerDay, productivityScore, bestCommitTime } = mlInsights;
    
    const messages = [];
    
    // Add streak-based messages
    if (commitStreak > 0) {
      messages.push(`Maintain ${commitStreak}-day commit streak with code improvements`);
      messages.push(`Continue ${commitStreak}-day development momentum`);
    }
    
    // Add productivity-based messages
    if (productivityScore >= 80) {
      messages.push(`High productivity session: feature enhancements and optimizations`);
    } else if (productivityScore >= 60) {
      messages.push(`Productive development: code improvements and fixes`);
    } else {
      messages.push(`Boost productivity: implement new features and improvements`);
    }
    
    // Add average commits based messages
    if (averageCommitsPerDay >= 2) {
      messages.push(`Consistent development: multiple improvements and updates`);
    } else if (averageCommitsPerDay >= 1) {
      messages.push(`Daily progress: feature development and code quality`);
    } else {
      messages.push(`Increase development frequency: new features and fixes`);
    }
    
    // Add time-based messages if best commit time is available
    if (bestCommitTime !== null) {
      const timeCategory = bestCommitTime < 12 ? 'morning' : 
                          bestCommitTime < 17 ? 'afternoon' : 'evening';
      messages.push(`${timeCategory} development session: code improvements and optimizations`);
    }
    
    // Fallback messages if no specific insights are available
    if (messages.length === 0) {
      messages.push(
        'Development progress: code improvements and feature enhancements',
        'Code quality improvements and performance optimizations',
        'Feature development and code maintenance'
      );
    }
    
    return messages[Math.floor(Math.random() * messages.length)];
  };

  // Initial load effect
  useEffect(() => {
    if (octokit && user && selectedRepo) {
      initializeMLModel();
      checkMissedCommits();
    }
  }, [octokit, user, selectedRepo]); // Removed functions from dependencies

  // Add effect to refresh data when user returns to the app or makes commits
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && octokitRef.current && userRef.current && selectedRepoRef.current) {
        console.log('MLCommitReminder: Page became visible, refreshing insights...');
        initializeMLModel();
        checkMissedCommits();
      }
    };

    const handleFocus = () => {
      if (octokitRef.current && userRef.current && selectedRepoRef.current) {
        console.log('MLCommitReminder: Window focused, refreshing insights...');
        initializeMLModel();
        checkMissedCommits();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, []); // Empty dependencies - uses refs for current values

  useEffect(() => {
    const interval = setInterval(() => {
      if (commitScheduleEnabledRef.current && octokitRef.current && userRef.current && selectedRepoRef.current) {
        checkMissedCommits();
      }
    }, 30000); // Reduced from 60 seconds to 30 seconds for more responsive updates

    return () => clearInterval(interval);
  }, []); // Empty dependencies - uses refs for current values

  if (isInitializing) {
    return (
      <div className="ml-reminder-loading">
        <div className="loading-spinner"></div>
        <p>Analyzing your commit patterns...</p>
      </div>
    );
  }

  return (
    <div className="ml-commit-reminder">
      <div className="ml-insights-header">
        <h3>ML Commit Insights</h3>
        {errorState.hasError && (
          <div className="error-indicator" title={errorState.errorType}>
            ⚠️ Error loading insights
          </div>
        )}
      </div>

      <div className="ml-stats-grid">
        <div className="stat-card">
          <div className="stat-value">{mlInsights.commitStreak}</div>
          <div className="stat-label">Day Streak</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{mlInsights.averageCommitsPerDay}</div>
          <div className="stat-label">Avg Commits/Day</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{mlInsights.productivityScore}%</div>
          <div className="stat-label">Productivity</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">
            {mlInsights.bestCommitTime ? `${mlInsights.bestCommitTime}:00` : 'N/A'}
          </div>
          <div className="stat-label">Best Time</div>
        </div>
      </div>

      {mlInsights.predictions.length > 0 && (
        <div className="ml-predictions">
          <h4>ML Insights</h4>
          {mlInsights.predictions.map((prediction, index) => (
            <div key={index} className="prediction-item">
              <span className="prediction-confidence">{prediction.confidence}%</span>
              <span className="prediction-message">{prediction.message}</span>
            </div>
          ))}
        </div>
      )}

      <div className="ml-schedule-controls">
        <h4>Commit Schedule</h4>
        <div className="schedule-options">
          <label className="switch-label">
            <input
              type="checkbox"
              checked={commitSchedule.enabled}
              onChange={(e) => handleScheduleChange('enabled', e.target.checked)}
            />
            <span className="switch"></span>
            Enable Reminders
          </label>
          
          <label className="time-input">
            Reminder Time:
            <input
              type="time"
              value={commitSchedule.reminderTime}
              onChange={(e) => handleScheduleChange('reminderTime', e.target.value)}
              disabled={!commitSchedule.enabled}
            />
          </label>
          
          <label className="threshold-input">
            Missed threshold:
            <input
              type="number"
              min="1"
              max="7"
              value={commitSchedule.missedCommitThreshold}
              onChange={(e) => handleScheduleChange('missedCommitThreshold', parseInt(e.target.value))}
              disabled={!commitSchedule.enabled}
            />
          </label>
        </div>
      </div>

      {showReminder && missedDays.length > 0 && (
        <div className="ml-reminder-alert">
          <h4>⚠️ Commit Reminder</h4>
          <p>You've missed commits on {missedDays.length} day(s):</p>
          <ul>
            {missedDays.map(date => (
              <li key={date}>
                {isToday(new Date(date)) ? 'Today' : 
                 isYesterday(new Date(date)) ? 'Yesterday' : 
                 format(new Date(date), 'MMM dd')}
              </li>
            ))}
          </ul>
          <div className="reminder-actions">
            <button 
              className="btn-primary"
              onClick={() => {
                const message = generateCommitMessage();
                showMessage(`Suggested commit: "${message}"`, 'info');
              }}
            >
              Generate Commit Message
            </button>
            <button 
              className="btn-secondary"
              onClick={() => setShowReminder(false)}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      <div className="ml-actions">
        <button 
          className="btn-refresh"
          onClick={initializeMLModel}
          disabled={isInitializing}
        >
          {isInitializing ? 'Refreshing...' : 'Refresh Insights'}
        </button>
      </div>
    </div>
  );
};

export default MLCommitReminder;
