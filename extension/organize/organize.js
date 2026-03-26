// Main orchestration logic for the organize page

let allVideos = [];
let categories = []; // Array of { name, videos, checked }

// --- Helpers ---

function $(id) { return document.getElementById(id); }

function setStepState(stepId, state) {
  const el = $(stepId);
  el.classList.remove('active', 'completed');
  if (state === 'active') el.classList.add('active');
  if (state === 'completed') el.classList.add('completed');
  if (state !== 'hidden') el.style.display = '';

  const badge = el.querySelector('.step-badge');
  if (badge) {
    if (state === 'active') badge.textContent = 'In Progress';
    else if (state === 'completed') badge.textContent = 'Done';
    else badge.textContent = 'Waiting';
  }
}

function sendMessage(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, response => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (response?.error) {
        reject(new Error(response.error));
      } else {
        resolve(response);
      }
    });
  });
}

// --- Step 1: Fetch Watch Later ---

async function fetchWatchLater() {
  setStepState('step-fetch', 'active');

  // Listen for progress updates from background
  chrome.runtime.onMessage.addListener(function fetchListener(msg) {
    if (msg.type === 'FETCH_PROGRESS') {
      $('fetch-count').textContent = `${msg.count} videos found...`;
      // Animate progress bar (we don't know total, so use log scale)
      const pct = Math.min(95, Math.log(msg.count + 1) / Math.log(5000) * 100);
      $('fetch-progress-bar').style.width = `${pct}%`;
    }
  });

  const response = await sendMessage({ type: 'FETCH_WATCH_LATER' });
  allVideos = response.videos;

  $('fetch-progress-bar').style.width = '100%';
  $('fetch-count').textContent = `${allVideos.length} videos found`;
  setStepState('step-fetch', 'completed');

  return allVideos;
}

// --- Step 2: Fetch Video Details ---

async function fetchDetails() {
  setStepState('step-details', 'active');

  chrome.runtime.onMessage.addListener(function detailListener(msg) {
    if (msg.type === 'DETAIL_PROGRESS') {
      const pct = Math.round((msg.completed / msg.total) * 100);
      $('details-progress-bar').style.width = `${pct}%`;
      $('details-count').textContent = `${msg.completed} / ${msg.total} videos`;
    }
  });

  const response = await sendMessage({ type: 'FETCH_VIDEO_DETAILS', videos: allVideos });
  allVideos = response.videos;

  $('details-progress-bar').style.width = '100%';
  $('details-count').textContent = `${allVideos.length} videos enriched`;
  setStepState('step-details', 'completed');

  return allVideos;
}

// --- Step 3: Categorize ---

async function categorize() {
  setStepState('step-categorize', 'active');
  $('categorize-status').textContent = 'Categorizing...';

  const response = await sendMessage({ type: 'CATEGORIZE', videos: allVideos });
  categories = response.categories.map(c => ({ ...c, checked: true }));

  renderCategories();
  $('categorize-status').textContent = `${categories.length} categories`;

  $('category-actions').style.display = 'flex';
  updateCategorySummary();
}

function renderCategories() {
  const container = $('categories-container');
  container.innerHTML = '';

  for (let i = 0; i < categories.length; i++) {
    const cat = categories[i];
    const row = document.createElement('div');
    row.className = 'category-row';
    row.dataset.index = i;

    row.innerHTML = `
      <input type="checkbox" class="category-check" ${cat.checked ? 'checked' : ''}>
      <input type="text" class="category-name" value="${escapeHtml(cat.name)}">
      <span class="category-count">${cat.videos.length}</span>
      <span class="category-toggle">&#9654;</span>
      <button class="category-delete" title="Remove category">&times;</button>
    `;

    // Video list (hidden by default)
    const videoList = document.createElement('div');
    videoList.className = 'category-videos';
    videoList.dataset.index = i;

    const maxShow = 10;
    const vidsToShow = cat.videos.slice(0, maxShow);

    videoList.innerHTML = vidsToShow.map(v => `
      <div class="video-item">
        <img class="video-thumb" src="${v.thumbnailUrl || ''}" alt="" loading="lazy">
        <span class="video-title" title="${escapeHtml(v.title)}">${escapeHtml(v.title)}</span>
        <span class="video-channel">${escapeHtml(v.channel)}</span>
      </div>
    `).join('');

    if (cat.videos.length > maxShow) {
      videoList.innerHTML += `<div class="video-list-more">
        ...and ${cat.videos.length - maxShow} more videos
      </div>`;
    }

    container.appendChild(row);
    container.appendChild(videoList);

    // Event listeners
    row.querySelector('.category-check').addEventListener('change', (e) => {
      categories[i].checked = e.target.checked;
      updateCategorySummary();
    });

    row.querySelector('.category-name').addEventListener('change', (e) => {
      categories[i].name = e.target.value;
    });

    row.querySelector('.category-toggle').addEventListener('click', () => {
      const toggle = row.querySelector('.category-toggle');
      toggle.classList.toggle('open');
      row.classList.toggle('expanded');
      videoList.classList.toggle('visible');
    });

    row.querySelector('.category-delete').addEventListener('click', (e) => {
      e.stopPropagation();
      categories.splice(i, 1);
      renderCategories();
      updateCategorySummary();
    });
  }
}

function updateCategorySummary() {
  const checked = categories.filter(c => c.checked);
  const totalVideos = checked.reduce((sum, c) => sum + c.videos.length, 0);
  $('category-summary').textContent =
    `${checked.length} playlists selected (${totalVideos} videos)`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// --- Step 4: Create Playlists ---

async function createPlaylists() {
  const selectedCategories = categories.filter(c => c.checked);
  if (selectedCategories.length === 0) return;

  setStepState('step-categorize', 'completed');
  setStepState('step-create', 'active');
  $('category-actions').style.display = 'none';

  // Render initial create list
  const createList = $('create-list');
  createList.innerHTML = selectedCategories.map((cat, i) => `
    <div class="create-item" id="create-item-${i}">
      <span class="create-item-icon pending" id="create-icon-${i}">&#9675;</span>
      <span class="create-item-name">${escapeHtml(cat.name)}</span>
      <span class="create-item-count">${cat.videos.length} videos</span>
      <span id="create-link-${i}"></span>
    </div>
  `).join('');

  // Listen for progress
  let completedCount = 0;
  chrome.runtime.onMessage.addListener(function createListener(msg) {
    if (msg.type === 'PLAYLIST_PROGRESS' && msg.batch) {
      for (const result of msg.batch) {
        const idx = selectedCategories.findIndex(c => c.name === result.topicName);
        if (idx === -1) continue;

        const icon = $(`create-icon-${idx}`);
        const link = $(`create-link-${idx}`);

        if (result.error) {
          icon.className = 'create-item-icon error';
          icon.innerHTML = '&#10007;';
          link.textContent = result.error;
          link.className = '';
        } else {
          icon.className = 'create-item-icon done';
          icon.innerHTML = '&#10003;';
          link.innerHTML = `<a href="https://www.youtube.com/playlist?list=${result.playlistId}" target="_blank" class="create-item-link">Open</a>`;
        }
      }
    }
  });

  // Mark first batch as working
  const concurrency = 3;
  for (let i = 0; i < Math.min(concurrency, selectedCategories.length); i++) {
    const icon = $(`create-icon-${i}`);
    icon.className = 'create-item-icon working';
    icon.innerHTML = '&#9679;';
  }

  try {
    const response = await sendMessage({
      type: 'CREATE_PLAYLISTS',
      categories: selectedCategories,
    });

    // Final pass: update any remaining icons
    for (let i = 0; i < selectedCategories.length; i++) {
      const icon = $(`create-icon-${i}`);
      if (icon.classList.contains('pending') || icon.classList.contains('working')) {
        const result = response.results.find(r => r.topicName === selectedCategories[i].name);
        if (result && !result.error) {
          icon.className = 'create-item-icon done';
          icon.innerHTML = '&#10003;';
          const link = $(`create-link-${i}`);
          link.innerHTML = `<a href="https://www.youtube.com/playlist?list=${result.playlistId}" target="_blank" class="create-item-link">Open</a>`;
        }
      }
    }

    setStepState('step-create', 'completed');
    showDone(response.results);
  } catch (err) {
    showError(err.message);
  }
}

// --- Done / Error ---

function showDone(results) {
  const successful = results.filter(r => !r.error);
  const totalVideos = successful.reduce((sum, r) => sum + r.videoCount, 0);

  $('step-done').style.display = '';
  $('done-summary').textContent =
    `Created ${successful.length} playlists with ${totalVideos} videos total.`;
}

function showError(message) {
  $('step-error').style.display = '';

  if (message === 'NOT_LOGGED_IN') {
    $('error-message').textContent =
      'You are not logged into YouTube. Please log in on youtube.com and try again.';
  } else {
    $('error-message').textContent = message;
  }
}

// --- Init ---

$('create-btn').addEventListener('click', createPlaylists);
$('retry-btn')?.addEventListener('click', () => location.reload());

async function start() {
  try {
    await fetchWatchLater();

    if (allVideos.length === 0) {
      showError('Your Watch Later playlist is empty.');
      return;
    }

    await fetchDetails();
    await categorize();
  } catch (err) {
    showError(err.message);
  }
}

start();
