// Enhanced Error Handling and Rate Limiting Utility

class ErrorHandler {
  constructor() {
    this.errorCounts = new Map();
    this.rateLimits = new Map();
    this.lastErrors = new Map();
    this.retryStrategies = new Map();
  }

  // Track error occurrences for rate limiting
  trackError(operation, error) {
    const now = Date.now();
    const key = `${operation}_${error.type || 'general'}`;
    
    // Initialize error tracking
    if (!this.errorCounts.has(key)) {
      this.errorCounts.set(key, { count: 0, firstError: now, lastError: now });
    }
    
    const tracking = this.errorCounts.get(key);
    tracking.count++;
    tracking.lastError = now;
    
    // Store last error details
    this.lastErrors.set(key, {
      error,
      timestamp: now,
      count: tracking.count
    });
    
    return tracking;
  }

  // Check if operation should be rate limited
  isRateLimited(operation) {
    const key = operation;
    const now = Date.now();
    
    if (!this.rateLimits.has(key)) {
      return false;
    }
    
    const limit = this.rateLimits.get(key);
    return now < limit.resetTime;
  }

  // Apply rate limiting
  applyRateLimit(operation, windowMs = 60000, maxRequests = 10) {
    const key = operation;
    const now = Date.now();
    
    if (!this.rateLimits.has(key)) {
      this.rateLimits.set(key, {
        count: 1,
        resetTime: now + windowMs,
        windowMs,
        maxRequests
      });
      return false;
    }
    
    const limit = this.rateLimits.get(key);
    
    // Reset window if expired
    if (now >= limit.resetTime) {
      limit.count = 1;
      limit.resetTime = now + windowMs;
      return false;
    }
    
    // Check if limit exceeded
    if (limit.count >= limit.maxRequests) {
      return true;
    }
    
    limit.count++;
    return false;
  }

  // Get retry delay with exponential backoff
  getRetryDelay(operation, attempt, maxDelay = 30000) {
    const key = operation;
    const baseDelay = 1000; // 1 second
    
    // Get error tracking for this operation
    const tracking = this.errorCounts.get(key);
    const errorCount = tracking ? tracking.count : 0;
    
    // Exponential backoff with jitter
    const delay = Math.min(
      baseDelay * Math.pow(2, attempt) + Math.random() * 1000,
      maxDelay
    );
    
    // Add additional delay for repeated errors
    const errorMultiplier = Math.min(errorCount, 5);
    return delay * (1 + errorMultiplier * 0.1);
  }

  // Enhanced retry logic with circuit breaker pattern
  async retryOperation(operation, options = {}) {
    const {
      maxRetries = 3,
      baseDelay = 1000,
      maxDelay = 30000,
      circuitBreakerThreshold = 5,
      circuitBreakerTimeout = 60000,
      operationName = 'unknown'
    } = options;

    const key = operationName;
    
    // Check circuit breaker
    const tracking = this.errorCounts.get(key);
    if (tracking && tracking.count >= circuitBreakerThreshold) {
      const timeSinceLastError = Date.now() - tracking.lastError;
      if (timeSinceLastError < circuitBreakerTimeout) {
        throw new Error(`Circuit breaker open for ${operationName}. Too many failures.`);
      }
      // Reset circuit breaker after timeout
      this.errorCounts.delete(key);
    }

    // Check rate limiting
    if (this.isRateLimited(key)) {
      const limit = this.rateLimits.get(key);
      throw new Error(`Rate limit exceeded for ${operationName}. Try again after ${new Date(limit.resetTime).toLocaleTimeString()}.`);
    }

    let lastError;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await operation();
        
        // Success - reset error tracking
        this.errorCounts.delete(key);
        return result;
        
      } catch (error) {
        lastError = error;
        
        // Track the error
        this.trackError(key, {
          type: this.getErrorType(error),
          message: error.message,
          status: error.status
        });
        
        // Don't retry on certain errors
        if (this.shouldNotRetry(error)) {
          throw error;
        }
        
        // Don't retry on last attempt
        if (attempt === maxRetries) {
          break;
        }
        
        // Calculate delay
        const delay = this.getRetryDelay(key, attempt, maxDelay);
        
        console.warn(`Operation ${operationName} failed (attempt ${attempt + 1}/${maxRetries + 1}). Retrying in ${Math.round(delay)}ms...`, error.message);
        
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    throw lastError;
  }

  // Determine error type for better handling
  getErrorType(error) {
    if (error.message?.includes('rate limit')) return 'rate_limit';
    if (error.message?.includes('network')) return 'network';
    if (error.message?.includes('authentication')) return 'auth';
    if (error.message?.includes('permission')) return 'permission';
    if (error.status === 401) return 'auth';
    if (error.status === 403) return 'permission';
    if (error.status === 404) return 'not_found';
    if (error.status === 429) return 'rate_limit';
    if (error.status >= 500) return 'server';
    return 'general';
  }

  // Determine if error should not be retried
  shouldNotRetry(error) {
    const noRetryErrors = [
      'authentication',
      'permission',
      'not_found'
    ];
    
    const errorType = this.getErrorType(error);
    return noRetryErrors.includes(errorType);
  }

  // Get user-friendly error message
  getUserFriendlyMessage(error) {
    const errorType = this.getErrorType(error);
    
    const messages = {
      rate_limit: 'GitHub API rate limit exceeded. Please wait a few minutes before trying again.',
      network: 'Network connection failed. Please check your internet connection.',
      auth: 'Authentication failed. Please log in again.',
      permission: 'Permission denied. You don\'t have access to this resource.',
      not_found: 'Resource not found. Please check the repository or file path.',
      server: 'GitHub server error. Please try again later.',
      general: 'An unexpected error occurred. Please try again.'
    };
    
    return messages[errorType] || messages.general;
  }

  // Get error statistics
  getErrorStats() {
    const stats = {
      totalErrors: 0,
      errorsByType: {},
      errorsByOperation: {},
      recentErrors: []
    };

    // Process error counts
    for (const [key, tracking] of this.errorCounts) {
      const [operation, type] = key.split('_');
      stats.totalErrors += tracking.count;
      
      // By type
      stats.errorsByType[type] = (stats.errorsByType[type] || 0) + tracking.count;
      
      // By operation
      stats.errorsByOperation[operation] = (stats.errorsByOperation[operation] || 0) + tracking.count;
    }

    // Get recent errors (last hour)
    const oneHourAgo = Date.now() - 3600000;
    for (const [key, errorInfo] of this.lastErrors) {
      if (errorInfo.timestamp > oneHourAgo) {
        stats.recentErrors.push({
          operation: key.split('_')[0],
          type: key.split('_')[1],
          message: errorInfo.error.message,
          timestamp: errorInfo.timestamp,
          count: errorInfo.count
        });
      }
    }

    return stats;
  }

  // Clear error tracking
  clearErrors(operation = null) {
    if (operation) {
      // Clear errors for specific operation
      for (const key of this.errorCounts.keys()) {
        if (key.startsWith(operation)) {
          this.errorCounts.delete(key);
          this.lastErrors.delete(key);
        }
      }
    } else {
      // Clear all errors
      this.errorCounts.clear();
      this.lastErrors.clear();
    }
  }

  // Get rate limit status
  getRateLimitStatus() {
    const status = {};
    const now = Date.now();
    
    for (const [operation, limit] of this.rateLimits) {
      status[operation] = {
        count: limit.count,
        maxRequests: limit.maxRequests,
        resetTime: limit.resetTime,
        timeUntilReset: Math.max(0, limit.resetTime - now),
        isLimited: now < limit.resetTime && limit.count >= limit.maxRequests
      };
    }
    
    return status;
  }
}

// Create singleton instance
const errorHandler = new ErrorHandler();

// Export utility functions
export const withErrorHandling = (operation, options = {}) => {
  return errorHandler.retryOperation(operation, options);
};

export const trackError = (operation, error) => {
  return errorHandler.trackError(operation, error);
};

export const checkRateLimit = (operation) => {
  return errorHandler.isRateLimited(operation);
};

export const applyRateLimit = (operation, windowMs, maxRequests) => {
  return errorHandler.applyRateLimit(operation, windowMs, maxRequests);
};

export const getFriendlyErrorMessage = (error) => {
  return errorHandler.getUserFriendlyMessage(error);
};

export const getErrorStats = () => {
  return errorHandler.getErrorStats();
};

export const getRateLimitStatus = () => {
  return errorHandler.getRateLimitStatus();
};

export const clearErrors = (operation) => {
  return errorHandler.clearErrors(operation);
};

// Export the instance for advanced usage
export default errorHandler;
