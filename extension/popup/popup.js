const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const organizeBtn = document.getElementById('organize-btn');

async function checkLogin() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'CHECK_AUTH' });
    if (response?.loggedIn) {
      statusDot.classList.add('ok');
      statusText.textContent = 'Logged into YouTube';
      organizeBtn.disabled = false;
    } else {
      statusDot.classList.add('error');
      statusText.textContent = 'Not logged into YouTube';
      organizeBtn.disabled = true;
    }
  } catch (err) {
    statusDot.classList.add('error');
    statusText.textContent = 'Error checking login';
    organizeBtn.disabled = true;
  }
}

organizeBtn.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('organize/organize.html') });
  window.close();
});

checkLogin();
