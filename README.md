# YT Watch Later Organizer

A Chrome extension that organizes your YouTube Watch Later playlist into topic-based playlists with one click.

## Features

- Fetches all videos from your Watch Later playlist automatically
- Smart categorization using channel grouping + TF-IDF keyword clustering
- Review, rename, merge, or delete categories before creating playlists
- Creates playlists directly on your YouTube account
- Runs entirely in your browser — no external servers, no API keys needed
- Handles 3000+ videos in under 3 minutes

## How It Works

1. Click the extension icon and press "Organize Watch Later"
2. The extension reads your Watch Later via YouTube's internal API
3. Videos are categorized by channel and content keywords
4. Review the suggested categories — rename or remove any you don't want
5. Click "Create Playlists" to create them on YouTube
6. Done! Your videos are now organized into topic playlists

## Installation

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions`
3. Enable "Developer mode" (toggle in top-right)
4. Click "Load unpacked" and select the `extension/` folder
5. The extension icon appears in your toolbar — you're ready to go

## Requirements

- Google Chrome (or any Chromium-based browser)
- Must be logged into YouTube in your browser

## How Categorization Works

The extension uses a two-phase local categorization approach:

**Phase 1 — Channel Grouping:** Videos from channels with 5+ videos in your Watch Later are grouped together. This captures the majority of content since people tend to watch multiple videos from the same channels.

**Phase 2 — Keyword Clustering:** Remaining videos are analyzed using TF-IDF (Term Frequency-Inverse Document Frequency) on their titles, descriptions, and tags. Similar videos are clustered together using k-means clustering with cosine similarity. Topic names are generated from the most distinctive keywords in each cluster.

## Privacy

- All processing happens locally in your browser
- No data is sent to external servers
- No API keys or accounts required (beyond your YouTube login)
- The extension only accesses youtube.com (required to manage playlists)
