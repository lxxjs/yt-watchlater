// Background service worker — handles API calls from UI pages
import { fetchWatchLater, fetchVideoDetails, createPlaylist, createPlaylists, checkAuth } from './lib/innertube.js';
import { categorizeVideos } from './lib/categorizer.js';

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg, sender).then(sendResponse).catch(err => {
    sendResponse({ error: err.message });
  });
  return true; // keep message channel open for async response
});

async function handleMessage(msg) {
  switch (msg.type) {
    case 'CHECK_AUTH':
      return { loggedIn: await checkAuth() };

    case 'FETCH_WATCH_LATER':
      return await handleFetchWatchLater(msg);

    case 'FETCH_VIDEO_DETAILS':
      return await handleFetchDetails(msg);

    case 'CATEGORIZE':
      return handleCategorize(msg);

    case 'CREATE_PLAYLISTS':
      return await handleCreatePlaylists(msg);

    case 'CREATE_SINGLE_PLAYLIST':
      return await handleCreateSinglePlaylist(msg);

    default:
      throw new Error(`Unknown message type: ${msg.type}`);
  }
}

async function handleFetchWatchLater(msg) {
  const videos = await fetchWatchLater((count) => {
    // Send progress back to the organize page
    broadcastProgress('FETCH_PROGRESS', { count });
  });
  return { videos };
}

async function handleFetchDetails(msg) {
  const { videos } = msg;
  const enriched = await fetchVideoDetails(videos, (completed, total) => {
    broadcastProgress('DETAIL_PROGRESS', { completed, total });
  });
  return { videos: enriched };
}

function handleCategorize(msg) {
  const { videos } = msg;
  const categories = categorizeVideos(videos);
  // Convert Map to serializable format
  const result = [];
  for (const [name, vids] of categories) {
    result.push({ name, videos: vids });
  }
  return { categories: result };
}

async function handleCreatePlaylists(msg) {
  const { categories } = msg;
  const categoryMap = new Map(categories.map(c => [c.name, c.videos]));
  const results = await createPlaylists(categoryMap, (completed, total, batch) => {
    broadcastProgress('PLAYLIST_PROGRESS', { completed, total, batch });
  });
  return { results };
}

async function handleCreateSinglePlaylist(msg) {
  const { name, videoIds } = msg;
  const playlistId = await createPlaylist(name, videoIds);
  return { playlistId };
}

function broadcastProgress(type, data) {
  chrome.runtime.sendMessage({ type, ...data }).catch(() => {
    // No listener — that's fine
  });
}
