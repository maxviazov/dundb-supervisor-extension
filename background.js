const DUNDB_URL = "https://members.dundb.co.il/*";
const DUNDB_ORIGIN = "https://members.dundb.co.il";

let requestChain = Promise.resolve();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isLoggedInUrl(url) {
  if (!url) return false;
  return !/\/login/i.test(url) && !/ClientAuthentication/i.test(url);
}

async function getDundbTabs() {
  return chrome.tabs.query({ url: DUNDB_URL });
}

function pickBestTab(tabs) {
  const loggedIn = tabs.filter((t) => isLoggedInUrl(t.url));
  if (!loggedIn.length) return null;

  const companyTab = loggedIn.find((t) => /\/CompanyDetails\//i.test(t.url || ""));
  if (companyTab) return companyTab;

  const searchTab = loggedIn.find((t) => /\/Search/i.test(t.url || ""));
  if (searchTab) return searchTab;

  return loggedIn[0];
}

async function pingTab(tabId) {
  return chrome.tabs.sendMessage(tabId, { type: "PING" });
}

async function injectContentScripts(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["page-bridge.js"],
    world: "MAIN",
  });
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["lib/utils.js", "lib/parser.js", "lib/api.js", "content.js"],
  });
}

async function waitForContentScript(tabId, attempts = 20) {
  let injected = false;

  for (let i = 0; i < attempts; i++) {
    try {
      const response = await pingTab(tabId);
      if (response?.ok) return response;
    } catch {
      if (!injected && i >= 1) {
        try {
          await injectContentScripts(tabId);
          injected = true;
          await sleep(400);
          continue;
        } catch {
          // injection blocked — fall through to retry / final error
        }
      }
      await sleep(300);
    }
  }

  throw new Error(
    "לא ניתן להתחבר ללשונית D&B — רעננו אותה (F5) או פתחו members.dundb.co.il מחדש"
  );
}

async function wakeDundbTab(tab) {
  if (!tab?.id) return tab;

  try {
    await chrome.tabs.update(tab.id, { autoDiscardable: false });
  } catch {
    // optional — ignore if unsupported
  }

  if (tab.discarded) {
    await chrome.tabs.reload(tab.id, { bypassCache: true });
    await waitTabLoaded(tab.id);
    await sleep(800);
    const refreshed = await chrome.tabs.get(tab.id);
    return refreshed;
  }

  return tab;
}

async function isTabVisible(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.discarded) return false;

    const windows = await chrome.windows.getAll({ populate: true });
    for (const win of windows) {
      const activeTab = win.tabs?.find((t) => t.active);
      if (activeTab?.id === tabId) return true;
    }
    return false;
  } catch {
    return false;
  }
}

async function ensureDundbTab() {
  let tab = pickBestTab(await getDundbTabs());
  if (!tab?.id) {
    throw new Error(
      "פתחו members.dundb.co.il והתחברו פעם אחת. השאירו לשונית פתוחה (אפשר מזעור) — בלי זה הסשן יתאפס."
    );
  }

  tab = await wakeDundbTab(tab);

  if (!isLoggedInUrl(tab.url)) {
    throw new Error("התחברו ל-D&B בלשונית הפתוחה ואז נסו שוב");
  }

  await waitForContentScript(tab.id);
  return tab;
}

function queueRequest(fn) {
  const run = requestChain.then(fn);
  requestChain = run.catch(() => {});
  return run;
}

async function sendToDundb(message) {
  return queueRequest(async () => {
    const tab = await ensureDundbTab();
    const response = await chrome.tabs.sendMessage(tab.id, message);
    if (!response?.ok) {
      throw new Error(response?.error || "שגיאה לא ידועה");
    }
    return response;
  });
}

async function getStatus() {
  const tabs = await getDundbTabs();
  const tab = pickBestTab(tabs);

  if (!tab?.id) {
    return {
      ok: true,
      hasTab: false,
      loggedIn: false,
      message: "פתחו D&B פעם אחת והשאירו לשונית פתוחה",
    };
  }

  try {
    const ping = await waitForContentScript(tab.id, 3);
    return {
      ok: true,
      hasTab: true,
      loggedIn: !!ping.loggedIn,
      message: ping.loggedIn
        ? "מוכן — חיפוש מכל דף"
        : "התחברו בלשונית D&B הפתוחה",
    };
  } catch {
    return {
      ok: true,
      hasTab: true,
      loggedIn: false,
      message: "רעננו את לשונית D&B",
    };
  }
}

async function parseFromBestTab() {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (active?.id && active.url?.includes("members.dundb.co.il") && isLoggedInUrl(active.url)) {
    return sendToDundbOnTab(active.id, { type: "PARSE_CURRENT_PAGE" });
  }

  const tab = pickBestTab(await getDundbTabs());
  if (tab?.id && isLoggedInUrl(tab.url)) {
    return sendToDundbOnTab(tab.id, { type: "PARSE_CURRENT_PAGE" });
  }

  throw new Error("פתחו כרטיס חברה ב-members.dundb.co.il");
}

async function sendToDundbOnTab(tabId, message) {
  await waitForContentScript(tabId);
  const response = await chrome.tabs.sendMessage(tabId, message);
  if (!response?.ok) {
    throw new Error(response?.error || "שגיאה לא ידועה");
  }
  return response;
}

async function waitTabLoaded(tabId, timeoutMs = 20000) {
  const tab = await chrome.tabs.get(tabId);
  if (tab.status === "complete") return;

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      reject(new Error("תם הזמן בטעינת כרטיס החברה"));
    }, timeoutMs);

    function onUpdated(updatedTabId, info) {
      if (updatedTabId !== tabId || info.status !== "complete") return;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve();
    }

    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

function tabUrlHasDuns(url, duns) {
  if (!url || !duns) return false;
  const match = url.match(/[?&]duns=([^&]+)/i);
  return match && decodeURIComponent(match[1]) === String(duns);
}

async function tabDomReady(tabId, duns, regNumber) {
  try {
    const check = await chrome.tabs.sendMessage(tabId, {
      type: "CHECK_COMPANY_READY",
      regNumber,
      duns,
    });
    return !!(check?.ok && check.ready);
  } catch {
    return false;
  }
}

async function ensureCompanyTabReady(tabId, duns, regNumber, options = {}) {
  if (!duns) return null;

  let tab = await wakeDundbTab(await chrome.tabs.get(tabId));
  const urlOk = tabUrlHasDuns(tab.url, duns);
  const domOk = urlOk && (await tabDomReady(tab.id, duns, regNumber));

  if (domOk && !options.forceReload) return tab;

  if (urlOk && !options.forceReload) {
    await chrome.tabs.reload(tab.id, { bypassCache: true });
  } else {
    const targetUrl = `${DUNDB_ORIGIN}/CompanyDetails/Info?duns=${encodeURIComponent(duns)}&_=${Date.now()}`;
    await chrome.tabs.update(tab.id, { url: targetUrl });
  }

  await waitTabLoaded(tab.id);
  await sleep(400);
  await waitForContentScript(tab.id);

  if (await isTabVisible(tab.id)) {
    for (let attempt = 0; attempt < 10; attempt++) {
      if (await tabDomReady(tab.id, duns, regNumber)) break;
      await sleep(300);
    }
  }

  return tab;
}

function isCompanyDataComplete(data) {
  if (!data?.nameHe?.trim()) return false;
  const scoreDigits = String(data.score || "").replace(/[^\d]/g, "");
  return scoreDigits.length > 0 && Number(scoreDigits) >= 1;
}

async function loadCompanyDetailsOnTab(tab, company, regisNumber, options = {}) {
  await waitForContentScript(tab.id);
  const loadRes = await chrome.tabs.sendMessage(tab.id, {
    type: "LOAD_COMPANY_DETAILS",
    company: {
      ...company,
      regNumber: company.regNumber || regisNumber,
    },
    regisNumber,
    backgroundMode: !!options.backgroundMode,
    fastMode: !!options.fastMode,
  });
  if (!loadRes?.ok) {
    throw new Error(loadRes?.error || "שגיאה בטעינת פרטי חברה");
  }
  return loadRes;
}

async function lookupCompanyByRegis(regNumber) {
  let tab = await ensureDundbTab();
  const visible = await isTabVisible(tab.id);

  const searchRes = await chrome.tabs.sendMessage(tab.id, {
    type: "SEARCH_HP_ONLY",
    regNumber,
  });
  if (!searchRes?.ok) {
    throw new Error(searchRes?.error || "שגיאה בחיפוש");
  }

  const { company, regisNumber } = searchRes.data;
  if (!company?.duns) {
    throw new Error("לא נמצאה חברה עם מספר ח.פ. זה");
  }

  const wasReady =
    tabUrlHasDuns(tab.url, company.duns) &&
    (await tabDomReady(tab.id, company.duns, regisNumber));

  if (!wasReady) {
    tab = await ensureCompanyTabReady(tab.id, company.duns, regisNumber);
  }

  const backgroundMode = !visible;
  let response = await loadCompanyDetailsOnTab(tab, company, regisNumber, {
    backgroundMode,
    fastMode: wasReady && backgroundMode,
  });

  if (!isCompanyDataComplete(response.data)) {
    tab = await ensureCompanyTabReady(tab.id, company.duns, regisNumber, {
      forceReload: true,
    });
    response = await loadCompanyDetailsOnTab(tab, company, regisNumber, {
      backgroundMode: true,
      fastMode: false,
    });
  }

  return response;
}

async function openCompanyOnDundb(duns) {
  const url = duns
    ? `${DUNDB_ORIGIN}/CompanyDetails/Index?duns=${encodeURIComponent(duns)}`
    : `${DUNDB_ORIGIN}/Search`;

  const tab = pickBestTab(await getDundbTabs());
  if (tab?.id) {
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
    if (tab.url !== url) {
      await chrome.tabs.update(tab.id, { url });
    }
    return;
  }

  await chrome.tabs.create({ url, active: true });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message?.type) return;

  (async () => {
    try {
      if (message.type === "STATUS") {
        sendResponse(await getStatus());
        return;
      }
      if (message.type === "LOOKUP_HP") {
        const response = await queueRequest(() => lookupCompanyByRegis(message.regNumber));
        sendResponse(response);
        return;
      }
      if (message.type === "PARSE_CURRENT_PAGE") {
        const response = await parseFromBestTab();
        sendResponse(response);
        return;
      }
      if (message.type === "OPEN_COMPANY") {
        await openCompanyOnDundb(message.duns);
        sendResponse({ ok: true });
        return;
      }
      sendResponse({ ok: false, error: "Unknown command" });
    } catch (error) {
      sendResponse({ ok: false, error: error.message || String(error) });
    }
  })();

  return true;
});
