(function () {
  if (!DundbApi.isOnSite()) return;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || !message.type) return;

    (async () => {
      try {
        if (message.type === "LOOKUP_HP") {
          const data = await DundbApi.lookupByRegis(message.regNumber);
          sendResponse({ ok: true, data });
          return;
        }
        if (message.type === "PARSE_CURRENT_PAGE") {
          const data = await DundbApi.parseCurrentPage();
          sendResponse({ ok: true, data });
          return;
        }
        if (message.type === "PING") {
          const onLoginPage =
            !!document.querySelector('input[name="UserName"]') ||
            !!document.querySelector('input[name="AuthenticationCode"]');
          sendResponse({ ok: true, loggedIn: !onLoginPage });
          return;
        }
        sendResponse({ ok: false, error: "Unknown command" });
      } catch (error) {
        sendResponse({ ok: false, error: error.message || String(error) });
      }
    })();

    return true;
  });

  function ensureFab() {
    if (document.getElementById("dundb-supervisor-fab")) return;

    const fab = document.createElement("button");
    fab.id = "dundb-supervisor-fab";
    fab.type = "button";
    fab.title = "כרטיס לסופרוויזר — לחצו על אייקון התוסף בסרגל";
    fab.textContent = "סופרוויזר";
    document.body.appendChild(fab);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", ensureFab);
  } else {
    ensureFab();
  }
})();
