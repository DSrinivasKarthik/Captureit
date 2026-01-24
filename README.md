# storeitnow

A web application for collecting and organizing links and images with automatic metadata extraction.
Save your links from various sites into specific buckets and use for decision making.

## Overview

storeitnow helps you save interesting links and images from around the web. When you add a link, the app automatically pulls in the page title and preview image. Images can be saved with custom titles. Everything is organized visually with color-coded thumbnails, making it easy to browse your collection at a glance.

## Features

- **Quick capture**: Add links or upload images directly
- **Automatic metadata**: Page titles and preview images are fetched automatically for links
- **Custom organization**: Add descriptions or rename items as needed
- **Multiple views**: Switch between grid and list layouts depending on your preference
- **Search and filter**: Find items quickly from your collection
- **Bulk actions**: Archive or delete multiple items at once
- **Data persistence**: Your collection is saved locally in your browser

## Getting Started

### Prerequisites

- Node.js (v16 or higher)
- npm or yarn

### Installation

```bash
git clone <repository-url>
cd storeitnow
npm install
```

### Running Locally

Start the development server:

```bash
npm run dev
```

The app will be available at `http://localhost:5173`

### Optional: Metadata Proxy

For faster metadata fetching on links, you can run a local proxy server:

```bash
npm run proxy
```

This server runs on port 3000 and speeds up the metadata retrieval process.

## Building for Production

```bash
npm run build
```

The optimized build will be in the `dist` folder. Preview it with:

```bash
npm run preview
```

## Development

### Project Structure

- `src/App.jsx` - Main application component with core logic
- `src/App.css` - Application styling
- `public/` - Static assets
- `server/metadata-proxy.js` - Optional proxy server for metadata fetching
- `vite.config.js` - Build configuration

### Tech Stack

- React 19
- Tailwind CSS for styling
- Vite for building and development
- Lucide React for icons

### Code Quality

Run the linter to check for issues:

```bash
npm run lint
```

## How It Works

When you add a link, the app attempts to fetch metadata in this order:

1. Local metadata proxy (if running)
2. Direct HTML fetch from the target page
3. Fallback proxy service for reliability

The app extracts the page title, removes common boilerplate text, and validates that any images meet minimum size requirements before displaying them.

## Browser Storage

All your saved items are stored in your browser's local storage. They persist between sessions but are not synced across devices. Clearing your browser data will remove your collection.

## License

Private project
