// InnerTube API client for YouTube Watch Later operations
// Uses YouTube's internal API (same as the website) — no quota limits

const INNERTUBE_API_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';
const INNERTUBE_BASE = 'https://www.youtube.com/youtubei/v1';

function getInnerTubeContext() {
  return {
    client: {
      clientName: 'WEB',
      clientVersion: '2.20241126.01.00',
      hl: 'en',
      gl: 'US',
    },
  };
}

// --- Authentication ---

async function getYouTubeCookies() {
  const cookies = await chrome.cookies.getAll({ url: 'https://www.youtube.com' });
  return cookies;
}

async function generateSapisidHash(sapisidValue, origin = 'https://www.youtube.com') {
  const timestamp = Math.floor(Date.now() / 1000);
  const input = `${timestamp} ${sapisidValue} ${origin}`;
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-1', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return `SAPISIDHASH ${timestamp}_${hashHex}`;
}

function findCookie(cookies, ...names) {
  for (const name of names) {
    const cookie = cookies.find(c => c.name === name);
    if (cookie) return cookie;
  }
  return null;
}

async function getAuthHeaders() {
  const cookies = await getYouTubeCookies();

  // YouTube uses __Secure-3PAPISID / __Secure-1PAPISID in modern Chrome,
  // falling back to the legacy SAPISID cookie
  const sapisid = findCookie(cookies, 'SAPISID', '__Secure-3PAPISID', '__Secure-1PAPISID');
  const sid = findCookie(cookies, 'SID', '__Secure-1PSID', '__Secure-3PSID');

  if (!sapisid || !sid) {
    throw new Error('NOT_LOGGED_IN');
  }

  const authorization = await generateSapisidHash(sapisid.value);

  return {
    'Content-Type': 'application/json',
    'Authorization': authorization,
    'X-Origin': 'https://www.youtube.com',
    'X-Youtube-Client-Name': '1',
    'X-Youtube-Client-Version': '2.20241126.01.00',
  };
}

// --- Fetch Watch Later ---

function findContinuationToken(item) {
  const renderer = item.continuationItemRenderer;
  if (!renderer) return null;

  // Path 1: direct continuationCommand
  if (renderer.continuationEndpoint?.continuationCommand?.token) {
    return renderer.continuationEndpoint.continuationCommand.token;
  }

  // Path 2: nested inside commandExecutorCommand.commands[]
  const commands = renderer.continuationEndpoint?.commandExecutorCommand?.commands;
  if (commands) {
    for (const cmd of commands) {
      // Check for continuationCommand at various depths
      if (cmd.continuationCommand?.token) return cmd.continuationCommand.token;
      if (cmd.playlistVotingRefreshPopupCommand?.command?.continuationCommand?.token) {
        return cmd.playlistVotingRefreshPopupCommand.command.continuationCommand.token;
      }
    }
  }

  // Path 3: button path
  if (renderer.button?.buttonRenderer?.command?.continuationCommand?.token) {
    return renderer.button.buttonRenderer.command.continuationCommand.token;
  }

  // Path 4: use clickTrackingParams as the token itself (some YT versions)
  // This is actually the continuation param in some responses
  if (renderer.continuationEndpoint?.clickTrackingParams) {
    // Deep search for any "token" field in the renderer
    const tokenStr = JSON.stringify(renderer);
    const tokenMatch = tokenStr.match(/"token"\s*:\s*"([^"]+)"/);
    if (tokenMatch) return tokenMatch[1];
  }

  return null;
}

function extractPlaylistItems(data) {
  // Path 1: Initial browse response
  const tabs = data?.contents?.twoColumnBrowseResultsRenderer?.tabs;
  const sectionContents = tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents;
  const items = sectionContents?.[0]?.itemSectionRenderer?.contents?.[0]?.playlistVideoListRenderer?.contents;
  if (items) return items;

  // Path 2: Continuation response
  const actions = data?.onResponseReceivedActions;
  if (actions) {
    for (const action of actions) {
      const contItems = action?.appendContinuationItemsAction?.continuationItems;
      if (contItems) return contItems;
    }
  }

  console.log('[YT-WL] Could not find playlist items. Top-level keys:', Object.keys(data));
  return null;
}

function parsePlaylistVideos(data) {
  const videos = [];
  let continuationToken = null;

  const items = extractPlaylistItems(data);
  if (!items) return { videos, continuationToken };

  for (const item of items) {
    if (item.playlistVideoRenderer) {
      videos.push(parseVideoRenderer(item.playlistVideoRenderer));
    }
    if (item.continuationItemRenderer) {
      continuationToken = findContinuationToken(item);
    }
  }

  return { videos, continuationToken };
}

function parseVideoRenderer(renderer) {
  return {
    videoId: renderer.videoId,
    title: renderer.title?.runs?.map(r => r.text).join('') || '',
    channel: renderer.shortBylineText?.runs?.map(r => r.text).join('') || '',
    duration: renderer.lengthText?.simpleText || '',
    thumbnailUrl: renderer.thumbnail?.thumbnails?.[0]?.url || '',
  };
}

async function fetchWatchLater(onProgress) {
  const headers = await getAuthHeaders();
  const allVideos = [];

  // First request
  const response = await fetch(`${INNERTUBE_BASE}/browse?key=${INNERTUBE_API_KEY}`, {
    method: 'POST',
    headers,
    credentials: 'include',
    body: JSON.stringify({
      context: getInnerTubeContext(),
      browseId: 'VLWL',
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Watch Later: ${response.status}`);
  }

  let data = await response.json();
  let { videos, continuationToken } = parsePlaylistVideos(data);
  allVideos.push(...videos);
  onProgress?.(allVideos.length);

  // Pagination
  while (continuationToken) {
    const contResponse = await fetch(`${INNERTUBE_BASE}/browse?key=${INNERTUBE_API_KEY}`, {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify({
        context: getInnerTubeContext(),
        continuation: continuationToken,
      }),
    });

    if (!contResponse.ok) break;

    data = await contResponse.json();
    const parsed = parsePlaylistVideos(data);
    videos = parsed.videos;
    continuationToken = parsed.continuationToken;

    allVideos.push(...videos);
    onProgress?.(allVideos.length);
  }

  return allVideos;
}

// --- Fetch Video Details (descriptions, tags) ---

async function fetchSingleVideoDetail(videoId, headers) {
  try {
    const response = await fetch(`${INNERTUBE_BASE}/next?key=${INNERTUBE_API_KEY}`, {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify({
        context: getInnerTubeContext(),
        videoId,
      }),
    });

    if (!response.ok) return null;

    const data = await response.json();

    // Extract description
    const engagementPanels = data?.engagementPanels || [];
    let description = '';
    let tags = [];

    for (const panel of engagementPanels) {
      const structured = panel?.engagementPanelSectionListRenderer?.content
        ?.structuredDescriptionContentRenderer?.items;
      if (structured) {
        for (const item of structured) {
          if (item.expandableVideoDescriptionBodyRenderer) {
            const descRuns = item.expandableVideoDescriptionBodyRenderer
              ?.descriptionBodyText?.runs;
            if (descRuns) {
              description = descRuns.map(r => r.text).join('');
            }
          }
          if (item.videoDescriptionHeaderRenderer) {
            // Sometimes tags/keywords are here
          }
        }
      }
    }

    // Extract tags from video detail
    const microformat = data?.microformat?.playerMicroformatRenderer;
    if (microformat) {
      description = description || microformat.description?.simpleText || '';
    }

    // Try to get tags from the primary info renderer
    const results = data?.contents?.twoColumnWatchNextResults?.results?.results?.contents;
    if (results) {
      for (const content of results) {
        const videoInfo = content?.videoPrimaryInfoRenderer;
        if (videoInfo?.superTitleLink?.runs) {
          tags = videoInfo.superTitleLink.runs
            .filter(r => r.text && r.text !== '#' && r.text.trim())
            .map(r => r.text.trim().replace(/^#/, ''));
        }
      }
    }

    // Truncate description to first 300 chars for categorization
    return {
      videoId,
      description: description.slice(0, 300),
      tags,
    };
  } catch {
    return null;
  }
}

async function fetchVideoDetails(videos, onProgress, concurrency = 50) {
  const headers = await getAuthHeaders();
  const details = new Map();
  let completed = 0;

  // Process in batches with concurrency control
  for (let i = 0; i < videos.length; i += concurrency) {
    const batch = videos.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map(v => fetchSingleVideoDetail(v.videoId, headers))
    );

    for (const result of results) {
      if (result) {
        details.set(result.videoId, result);
      }
    }

    completed += batch.length;
    onProgress?.(completed, videos.length);
  }

  // Merge details into videos
  return videos.map(v => {
    const detail = details.get(v.videoId);
    return {
      ...v,
      description: detail?.description || '',
      tags: detail?.tags || [],
    };
  });
}

// --- Create Playlists ---

async function createPlaylist(title, videoIds, privacyStatus = 'PRIVATE') {
  const headers = await getAuthHeaders();

  const response = await fetch(`${INNERTUBE_BASE}/playlist/create?key=${INNERTUBE_API_KEY}`, {
    method: 'POST',
    headers,
    credentials: 'include',
    body: JSON.stringify({
      context: getInnerTubeContext(),
      title,
      privacyStatus,
      videoIds,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to create playlist "${title}": ${response.status}`);
  }

  const data = await response.json();
  return data.playlistId;
}

async function createPlaylists(categories, onProgress, concurrency = 3) {
  const results = [];
  const entries = Array.from(categories.entries());
  let completed = 0;

  for (let i = 0; i < entries.length; i += concurrency) {
    const batch = entries.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(async ([topicName, videos]) => {
        const videoIds = videos.map(v => v.videoId);
        try {
          const playlistId = await createPlaylist(topicName, videoIds);
          return { topicName, playlistId, videoCount: videos.length, error: null };
        } catch (err) {
          return { topicName, playlistId: null, videoCount: videos.length, error: err.message };
        }
      })
    );

    results.push(...batchResults);
    completed += batch.length;
    onProgress?.(completed, entries.length, batchResults);
  }

  return results;
}

// --- Auth Check ---

async function checkAuth() {
  try {
    const cookies = await getYouTubeCookies();
    const sapisid = findCookie(cookies, 'SAPISID', '__Secure-3PAPISID', '__Secure-1PAPISID');
    const sid = findCookie(cookies, 'SID', '__Secure-1PSID', '__Secure-3PSID');
    return !!(sapisid && sid);
  } catch {
    return false;
  }
}

export {
  fetchWatchLater,
  fetchVideoDetails,
  createPlaylist,
  createPlaylists,
  checkAuth,
  getAuthHeaders,
};
