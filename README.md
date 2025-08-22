# Kiara Note - Daily GitHub Notepad

A modern React web application that helps you maintain daily GitHub commits by providing a simple notepad interface. Write notes and automatically push them to your GitHub repository!

## Features

- 📝 **Clean Notepad Interface**: Modern, responsive design for writing daily notes
- 🔐 **GitHub OAuth Integration**: Secure login with GitHub authentication
- 💾 **Automatic GitHub Commits**: Notes are automatically committed to your GitHub repository
- ⚠️ **Daily Reminders**: Get notified when you haven't committed to GitHub in a while
- 📅 **Organized by Date**: Notes are organized by date in your repository
- 🎨 **Modern UI**: Beautiful gradient design with smooth animations
- 📱 **Responsive**: Works perfectly on desktop and mobile devices
- 📊 **Commit Activity Graph**: Visual representation of your GitHub commit activity
- 🤖 **ML-Powered Insights**: AI-powered commit analysis and productivity tracking
- 📈 **Productivity Score**: Get insights about your coding patterns and best commit times

## How It Works

1. **Login with GitHub**: Connect your GitHub account using OAuth
2. **Write Notes**: Use the clean notepad interface to write your daily thoughts, tasks, or progress
3. **Select Repository**: Choose which GitHub repository to save your notes to
4. **Save to GitHub**: Click "Save to GitHub" to commit your notes
5. **Automatic Repository**: The app can create repositories if they don't exist
6. **Daily Reminders**: The app checks your last commit activity and reminds you to write notes if you haven't committed recently
7. **ML Insights**: Get AI-powered analysis of your commit patterns and productivity metrics

## Setup Instructions

### Prerequisites

- Node.js (v14 or higher)
- npm or yarn
- GitHub OAuth Application

### Installation

1. **Clone or download this project**
2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **GitHub OAuth Setup**:
   - Go to your GitHub Settings → Developer Settings → OAuth Apps
   - Click "New OAuth App"
   - Fill in the details:
     - **Application name**: Kiara Note (or your preferred name)
     - **Homepage URL**: `http://localhost:3000`
     - **Authorization callback URL**: `http://localhost:3000`
   - Click "Register application"
   - Copy your **Client ID** and generate a **Client Secret**

4. **Configure Environment Variables**:
   - Copy the `.env` file in the project root
   - Add your GitHub OAuth credentials:
     ```
     REACT_APP_GITHUB_CLIENT_ID=your_actual_client_id
     REACT_APP_GITHUB_CLIENT_SECRET=your_actual_client_secret
     REACT_APP_REDIRECT_URI=http://localhost:3000
     ```

   **Important**: This application uses the implicit OAuth flow for client-side applications. The Client Secret is not required for the implicit flow but is kept for potential future backend implementation.

5. **Run the application**:
   ```bash
   npm start
   ```

6. **Open your browser** to `http://localhost:3000`

## Usage

### Getting Started

1. **Launch the application** and click "Login with GitHub"
2. **Authorize the application** with your GitHub account
3. **Select a repository** from your GitHub account to save notes to
4. **Write your daily notes** in the textarea
5. **Click "Save to GitHub"** to commit your notes

### Features in Action

- **Repository Selection**: Choose any of your existing repositories or let the app create a new one
- **Commit Activity Graph**: See your GitHub commit activity for the last 30 days
- **Daily Reminders**: Get notified when it's been more than a day since your last commit
- **ML-Powered Insights**: View your commit streaks, average commits per day, productivity scores, and optimal commit times
- **Real GitHub Integration**: All notes are actually saved to your GitHub account as markdown files

### ML Insights Feature

Kiara Note includes advanced machine learning insights to help you understand your coding patterns:

- **Commit Streak Tracking**: See your current and longest commit streaks
- **Productivity Analysis**: Get a productivity score based on your commit frequency and consistency
- **Optimal Commit Times**: Discover what time of day you're most productive
- **Predictive Insights**: AI-powered predictions about your coding momentum and activity patterns
- **Commit Reminders**: Intelligent reminders based on your personal coding patterns

### File Organization

Notes are saved in your selected repository as:
```
notes/YYYY-MM-DD.md
```

Each file contains:
- A title with the date
- Your note content
- A timestamp of when the note was created

## Project Structure

```
kiara-note/
├── public/
│   ├── index.html
│   └── ...
├── src/
│   ├── components/
│   │   ├── MLCommitReminder.js  # ML-powered insights component
│   │   ├── ContributionGraph.js  # Commit activity visualization
│   │   ├── Login.js              # GitHub OAuth login
│   │   └── Dashboard.js          # Main dashboard
│   ├── contexts/
│   │   └── AuthContext.js        # Authentication context
│   ├── utils/
│   │   └── errorHandler.js       # Error handling utilities
│   ├── App.js                   # Main application component
│   ├── App.css                  # Application styles
│   ├── index.js                 # Application entry point
│   └── index.css                # Base styles
├── package.json
└── README.md
```

## Technical Details

### Dependencies

- **React**: Frontend framework
- **@octokit/rest**: GitHub API client
- **date-fns**: Date manipulation utilities
- **Tailwind CSS**: Utility-first CSS framework
- **React Router**: Navigation and routing

### GitHub Integration

The application:
- Creates a repository named `kiara-note-daily-notes` in your GitHub account
- Saves notes as markdown files organized by date (`notes/YYYY-MM-DD.md`)
- Uses your GitHub credentials to commit changes
- Tracks your last commit activity for reminders
- Analyzes commit patterns using machine learning algorithms

### ML Insights Implementation

The ML Commit Reminder feature:
- Fetches your last 90 days of commit activity
- Analyzes commit frequency, timing patterns, and streaks
- Calculates productivity scores based on multiple factors
- Provides predictive insights about your coding habits
- Offers personalized commit reminders based on your patterns

### Security Considerations

⚠️ **Important**: For enhanced security in production:

1. **Backend Service**: Implement a backend service to handle OAuth token exchange securely instead of client-side token exchange
2. **Token Storage**: Consider using more secure token storage methods instead of localStorage
3. **Environment Variables**: Always use environment variables for sensitive configuration
4. **Error Handling**: Implement proper error handling and rate limiting
5. **Token Scopes**: Request only the necessary GitHub scopes (currently using `repo` and `user`)

### OAuth Flow

This application uses the **Implicit OAuth Flow** for client-side applications:

- The user is redirected to GitHub for authorization
- GitHub redirects back with the access token in the URL fragment
- The application parses the token from the URL and stores it
- This avoids CORS issues that occur with client-side token exchange

**Note**: If you encounter authentication issues, ensure:
1. Your GitHub OAuth App callback URL exactly matches `http://localhost:3000`
2. You're using the correct Client ID
3. Your application has the necessary permissions (`repo` and `user` scopes)

## Troubleshooting ML Insights

If the ML Commit Insights feature is not working:

1. **Check GitHub API Access**: Ensure your GitHub token has the necessary permissions to read repository events
2. **Verify Repository Selection**: Make sure you have selected a repository with commit activity
3. **Check Rate Limits**: GitHub API has rate limits - if you exceed them, insights may not load
4. **Network Connection**: Ensure you have a stable internet connection to fetch GitHub data
5. **Browser Console**: Check the browser console for any error messages related to the ML insights

## Contributing

Feel free to submit issues and enhancement requests!

## License

This project is open source and available under the [MIT License](LICENSE).

## Support

If you encounter any issues or have questions:
1. Check the GitHub OAuth setup instructions
2. Ensure your GitHub token has the necessary permissions (repo scope)
3. Verify your network connection and GitHub API access
4. Check the troubleshooting section for ML insights issues
