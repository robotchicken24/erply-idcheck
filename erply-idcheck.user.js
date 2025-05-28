// ==UserScript==
// @name         Erply Age Check with Modal
// @namespace    http://robotchicken24.dev/
// @version      3.1
// @description  Real-time ID check for age-restricted items in Erply POS using API and modal popup with transaction tracking.
// @author       robotchicken24
// @match        https://*.erply.com/*
// @grant        none
// ==/UserScript==

const CLIENT_CODE = '467400';
const AGE_RESTRICTED_GROUPS = ['Alcohol', 'Tobacco', 'Vape'];
const LEGAL_AGE = 21;
const API_BASE = `https://${467400}.erply.com/api/`;

let sessionKey = null;
let ageVerifiedThisTransaction = false;
let scannerBuffer = '';

(async function () {
  sessionKey = detectSessionKey() || await loginViaVerifyUser();
  if (!sessionKey) {
    alert('❌ Unable to obtain session key. Please log in.');
    return;
  }

  console.log('[Erply AgeCheck] SessionKey acquired.');

  document.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      const code = scannerBuffer.trim();
      scannerBuffer = '';
      if (!code) return;

      const item = await fetchItemByCode(code);
      if (!item) return;

      const groupName = item.groupName || '';
      console.log(`[AgeCheck] Scanned item "${code}" → group: "${groupName}"`);

      if (AGE_RESTRICTED_GROUPS.includes(groupName)) {
        promptForAgeVerification();
      }
    } else if (e.key.length === 1) {
      scannerBuffer += e.key;
    }
  });

  const observer = new MutationObserver(() => {
    const header = document.querySelector('.transaction-header, .sale-view');
    if (header) {
      console.log('[AgeCheck] Starting new transaction.');
      ageVerifiedThisTransaction = false;
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
})();

function detectSessionKey() {
  return (
    window.sessionKey ||
    (window.posModel && window.posModel.sessionKey) ||
    localStorage.getItem('sessionKey') ||
    sessionStorage.getItem('sessionKey')
  );
}

async function loginViaVerifyUser() {
  const username = prompt('Erply Username:');
  const password = prompt('Password:');
  if (!username || !password) return null;

  const body = new URLSearchParams({
    request: 'verifyUser',
    clientCode: CLIENT_CODE,
    username,
    password,
  });

  try {
    const res = await fetch(API_BASE, { method: 'POST', body });
    const json = await res.json();
    const key = json?.records?.[0]?.sessionKey;
    if (key) {
      sessionStorage.setItem('sessionKey', key);
      return key;
    }
  } catch (err) {
    console.error('[AgeCheck] verifyUser failed', err);
  }

  return null;
}

async function fetchItemByCode(code) {
  const body = new URLSearchParams({
    request: 'getItems',
    sessionKey: sessionKey,
    code: code,
    active: 1,
  });

  try {
    const res = await fetch(API_BASE, { method: 'POST', body });
    const json = await res.json();
    return json?.records?.[0] || null;
  } catch (err) {
    console.error('[AgeCheck] getItems failed:', err);
    return null;
  }
}

function promptForAgeVerification() {
  if (ageVerifiedThisTransaction) {
    console.log('[AgeCheck] Already verified this transaction.');
    return;
  }

  showIDModal((idScan) => {
    const dob = `${idScan.slice(0, 4)}-${idScan.slice(4, 6)}-${idScan.slice(6, 8)}`;
    const age = calculateAge(dob);

    if (age >= LEGAL_AGE) {
      alert(`✅ Age verified: ${age} years old.`);
      ageVerifiedThisTransaction = true;
    } else {
      alert(`🚫 Underage: ${age} years old. Sale blocked.`);
    }
  });
}

function calculateAge(dobStr) {
  const dob = new Date(dobStr);
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) {
    age--;
  }
  return age;
}

function showIDModal(callback) {
  const existing = document.getElementById('age-check-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'age-check-modal';
  modal.style = `
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center;
    z-index: 9999;
  `;

  const box = document.createElement('div');
  box.style = `
    background: white; padding: 20px; border-radius: 12px; box-shadow: 0 5px 20px rgba(0,0,0,0.3);
    font-family: sans-serif; text-align: center;
  `;
  box.innerHTML = `
    <h2>Scan Customer ID</h2>
    <p>Please scan the customer's ID (format: YYYYMMDD):</p>
    <input id="dob-input" type="text" maxlength="8" style="padding: 10px; font-size: 18px; width: 200px; text-align: center;" autofocus />
    <div style="margin-top: 10px;">
      <button id="dob-submit" style="padding: 10px 20px; font-size: 16px;">Submit</button>
    </div>
  `;

  modal.appendChild(box);
  document.body.appendChild(modal);

  const input = document.getElementById('dob-input');
  input.focus();

  document.getElementById('dob-submit').onclick = () => {
    const val = input.value.trim();
    if (/^\d{8}$/.test(val)) {
      document.getElementById('age-check-modal').remove();
      callback(val);
    } else {
      alert('❌ Invalid format. Use YYYYMMDD.');
    }
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('dob-submit').click();
  });
}
