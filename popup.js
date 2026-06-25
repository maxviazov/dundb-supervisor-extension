const hpInput = document.getElementById("hpInput");
const searchBtn = document.getElementById("searchBtn");
const parsePageBtn = document.getElementById("parsePageBtn");
const statusEl = document.getElementById("status");
const cardEl = document.getElementById("card");
const cardTemplate = document.getElementById("cardTemplate");

let lastData = null;

function setStatus(text, isError = false) {
  statusEl.textContent = text || "";
  statusEl.classList.toggle("error", !!isError);
}

function setLoading(loading) {
  searchBtn.disabled = loading;
  parsePageBtn.disabled = loading;
  searchBtn.textContent = loading ? "מחפש..." : "חפש";
}

async function sendToBackground(type, payload = {}) {
  return chrome.runtime.sendMessage({ type, ...payload });
}

function displayValue(value, fallback = "—") {
  const text = DundbUtils.cleanText(value);
  return text || fallback;
}

function getRisk(data) {
  return DundbUtils.getRiskMeta(data.score);
}

async function deliverWhatsAppImage(data) {
  const risk = getRisk(data);
  const canvas = CardImage.renderCardToCanvas(data, risk);
  const filename = `dundb-${CardImage.safeFilename(data.nameHe)}.png`;

  try {
    await CardImage.copyCanvasToClipboard(canvas);
    setStatus("התמונה הועתקה — פתחו וואטסאפ ולחצו Ctrl+V");
  } catch {
    try {
      CardImage.downloadCanvas(canvas, filename);
      setStatus("העתקה נכשלה — הקובץ הורד, גררו אותו לוואטסאפ");
    } catch (error) {
      setStatus(error.message || "לא ניתן להעתיק תמונה", true);
    }
  }
}

function renderCard(data) {
  lastData = data;
  cardEl.innerHTML = "";
  const node = cardTemplate.content.cloneNode(true);
  const risk = getRisk(data);

  node.querySelector(".company-name-he").textContent = displayValue(data.nameHe, "שם חברה לא זמין");
  node.querySelector(".company-name-en").textContent = displayValue(data.nameEn, "");
  node.querySelector(".status-badge").textContent = displayValue(data.status, "פעילה");

  node.querySelector(".address").textContent = displayValue(data.address);
  node.querySelector(".phones").textContent = (data.phones || []).join(" | ") || "—";
  node.querySelector(".email").textContent = displayValue(data.email);

  const websiteEl = node.querySelector(".website");
  const website = displayValue(data.website, "");
  if (website && website !== "—") {
    websiteEl.href = website.startsWith("http") ? website : `https://${website}`;
    websiteEl.textContent = website;
  } else {
    websiteEl.textContent = "—";
    websiteEl.removeAttribute("href");
  }

  const scoreEl = node.querySelector(".score-value");
  const scoreDisplay = DundbUtils.parseScore(data.score);
  scoreEl.textContent = scoreDisplay === null ? "—" : String(scoreDisplay);
  scoreEl.style.color = risk.color;
  node.querySelector(".score-warning").textContent =
    scoreDisplay === null ? "" : risk.warning || "";

  node.querySelector(".seniority-value").textContent = displayValue(data.seniorityYears);
  node.querySelector(".seniority-note").textContent = data.senioritySince
    ? `שנות ותק (מ-${data.senioritySince})`
    : displayValue(data.seniorityText, "—");

  node.querySelector(".employees-value").textContent = displayValue(data.employees);

  node.querySelector(".reg-number").textContent = displayValue(data.regNumber);
  node.querySelector(".legal-status").textContent = displayValue(data.legalStatus);
  node.querySelector(".sector").textContent = displayValue(data.sector);
  node.querySelector(".activity").textContent = displayValue(data.activity);
  node.querySelector(".main-industry").textContent = displayValue(data.mainIndustry);
  node.querySelector(".sub-industry").textContent = displayValue(data.subIndustry);

  const marker = node.querySelector(".scale-marker");
  const gradeLabel = node.querySelector(".scale-grade-label");
  node.querySelectorAll(".scale-zone").forEach((el) => el.classList.remove("active"));

  if (scoreDisplay !== null) {
    const pos = Math.max(0, Math.min(100, scoreDisplay));
    marker.classList.remove("hidden");
    marker.style.right = `${pos}%`;
    if (risk.grade) {
      node.querySelector(`.zone-${risk.grade}`)?.classList.add("active");
      gradeLabel.classList.remove("hidden");
      gradeLabel.textContent = `דירוג ${risk.grade} | סקור ${scoreDisplay}`;
      gradeLabel.style.color = risk.color;
    }
  } else {
    marker.classList.add("hidden");
    gradeLabel.classList.add("hidden");
    gradeLabel.textContent = "";
  }

  node.querySelector(".image-btn").addEventListener("click", () => deliverWhatsAppImage(data));

  node.querySelector(".copy-btn").addEventListener("click", async () => {
    const text = DundbParser.formatSupervisorText(data, risk);
    await navigator.clipboard.writeText(text);
    setStatus("הועתק טקסט (לא תמונה!) — לתמונה לחצו הכפתור הירוק");
  });

  node.querySelector(".download-btn").addEventListener("click", () => {
    const canvas = CardImage.renderCardToCanvas(data, risk);
    CardImage.downloadCanvas(canvas, `dundb-${CardImage.safeFilename(data.nameHe)}.png`);
    setStatus("קובץ PNG הורד");
  });

  node.querySelector(".open-btn").addEventListener("click", async () => {
    const response = await sendToBackground("OPEN_COMPANY", { duns: data.duns });
    if (!response?.ok) {
      setStatus(response?.error || "לא ניתן לפתוח את האתר", true);
    }
  });

  cardEl.appendChild(node);
  cardEl.classList.remove("hidden");
}

async function runLookup() {
  const regNumber = hpInput.value.trim();
  if (!regNumber) {
    setStatus("הזינו מספר ח.פ.", true);
    return;
  }

  setLoading(true);
  setStatus("מחפש חברה...");
  try {
    const response = await sendToBackground("LOOKUP_HP", { regNumber });
    if (!response?.ok) throw new Error(response?.error || "שגיאה לא ידועה");
    renderCard(response.data);
    await deliverWhatsAppImage(response.data);
  } catch (error) {
    setStatus(error.message, true);
    cardEl.classList.add("hidden");
  } finally {
    setLoading(false);
  }
}

async function runParseCurrentPage() {
  setLoading(true);
  setStatus("קורא מכרטיס חברה...");
  try {
    const response = await sendToBackground("PARSE_CURRENT_PAGE");
    if (!response?.ok) throw new Error(response?.error || "שגיאה לא ידועה");
    renderCard(response.data);
    await deliverWhatsAppImage(response.data);
  } catch (error) {
    setStatus(error.message, true);
    cardEl.classList.add("hidden");
  } finally {
    setLoading(false);
  }
}

searchBtn.addEventListener("click", runLookup);
parsePageBtn.addEventListener("click", runParseCurrentPage);
hpInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") runLookup();
});

(async function init() {
  try {
    const status = await sendToBackground("STATUS");
    if (status?.message) {
      setStatus(status.message, !status.loggedIn && status.hasTab);
    } else {
      setStatus("מוכן לחיפוש מכל דף");
    }
  } catch {
    setStatus("מוכן לחיפוש — ודאו שאתם מחוברים ל-D&B", true);
  }
})();
