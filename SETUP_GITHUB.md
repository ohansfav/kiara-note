# GitHub Repository Setup Guide for Kiara Note

## Step 1: Create GitHub Repository

1. Go to [GitHub.com](https://github.com) and log in to your account
2. Click the "+" icon in the top right corner and select "New repository"
3. Fill in the repository details:
   - **Repository name**: `kiara-note` (must match exactly)
   - **Description**: "A modern React web application for daily GitHub notes"
   - **Public** (required for GitHub Pages)
   - **Initialize this repository with a README**: Uncheck (we already have one)
4. Click "Create repository"

## Step 2: Add Remote to Your Local Repository

After creating the repository on GitHub, copy the repository URL (it should look like `https://github.com/kiara/kiara-note.git`)

Then run these commands in your terminal:

```bash
git remote add origin https://github.com/kiara/kiara-note.git
git branch -M main
git push -u origin main
```

## Step 3: Enable GitHub Pages

1. Go to your repository on GitHub
2. Click on "Settings" tab
3. Scroll down to "Pages" section on the left sidebar
4. Under "Source", select "GitHub Actions" from the dropdown
5. Save the settings

## Step 4: Deploy to GitHub Pages

Run the deployment command:

```bash
npm run deploy
```

This will:
1. Build your React app
2. Create a `gh-pages` branch
3. Deploy the built files to GitHub Pages

## Step 5: Access Your App

Your app will be available at: `https://kiara.github.io/kiara-note`

## Important Notes

- The repository name must be exactly `kiara-note` to match the homepage URL in package.json
- GitHub Pages may take a few minutes to deploy after running `npm run deploy`
- If you encounter issues, check the GitHub Actions tab in your repository for deployment logs
