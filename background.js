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

async function ensureDundbTab() {
  const tab = pickBestTab(await getDundbTabs());
  if (!tab?.id) {
    throw new Error(
      "פתחו members.dundb.co.il והתחברו פעם אחת. השאירו לשונית פתוחה (אפשר מזעור) — בלי זה הסשן יתאפס."
    );
  }

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
        const response = await sendToDundb({
          type: "LOOKUP_HP",
          regNumber: message.regNumber,
        });
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
