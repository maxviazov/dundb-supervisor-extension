(function (global) {
  const { cleanText, pickFirst, normalizeRegisNumber } = global.DundbUtils;

  const ACTIVE_STATUS_RE = /^(פעיל|פעילה|active)$/i;
  const INACTIVE_STATUS_RE = /^(לא\s*פעיל|לא\s*פעילה|inactive|not\s*active)$/i;

  function isInactiveStatusText(value) {
    const t = cleanText(value);
    return INACTIVE_STATUS_RE.test(t) || /^לא\s*פעיל/i.test(t);
  }

  function normalizeInactiveStatus(value) {
    const t = cleanText(value);
    if (/לא\s*פעילה/i.test(t)) return "לא פעילה";
    if (/לא\s*פעיל/i.test(t)) return "לא פעיל";
    return t;
  }

  const LABELS = {
    regNumber: ["מספר רישום", "ח.פ.", 'ח"פ', "מס' רישום"],
    legalStatus: ["מעמד משפטי"],
    sector: ["מגזר"],
    activity: ["אופי פעילות", "תחום פעילות"],
    mainIndustry: ["ענף ראשי"],
    subIndustry: ["ענף משני"],
    address: ["כתובת"],
    phone: ["טלפון"],
    email: ["אימייל", 'דוא"ל', "דואל"],
    website: ["אתר אינטרנט", "אתר"],
    score: ["סקור ענפי", "סקור", "ציון", "דירוג"],
    seniority: ["ותק עסק", "ותק"],
    employees: ["מספר מועסקים", "מועסקים"],
    status: ["סטטוס", "מצב פעילות"],
    founded: ["שנת יסוד", "שנת הקמה"],
  };

  function textOf(el) {
    if (!el) return "";
    return cleanText(el.textContent || el.innerText || "");
  }

  function unwrapSearchJson(json) {
    if (!json || typeof json !== "object") return json;
    if (json.d && typeof json.d === "object") return json.d;
    if (json.data && typeof json.data === "object") return json.data;
    return json;
  }

  function extractRegNumberFromHtml(html, preferredReg, preferredDuns, scoped = false) {
    if (!html) return "";

    const preferred = normalizeRegisNumber(preferredReg);
    const duns = cleanText(preferredDuns);

    if (!scoped && duns) {
      const dunsIdx = html.indexOf(duns);
      if (dunsIdx >= 0) {
        const slice = html.slice(Math.max(0, dunsIdx - 400), dunsIdx + 12000);
        const fromSlice = extractRegNumberFromHtml(slice, preferredReg, "", true);
        if (fromSlice) return fromSlice;
      }
    }

    const candidates = [];
    const patterns = [
      /מספר\s*רישום[^0-9]{0,40}(\d{5,9})/gi,
      /ח\.?\s*פ\.?[^0-9]{0,30}(\d{5,9})/gi,
      /Regis(?:Number|Num)["'\s:=]+(\d{5,9})/gi,
      /מספר\s*רישום[\s\S]{0,120}?(\d{5,9})/gi,
    ];

    for (const re of patterns) {
      let match;
      while ((match = re.exec(html)) !== null) {
        candidates.push(match[1]);
      }
    }

    if (preferred) {
      const exact = candidates.find((reg) => normalizeRegisNumber(reg) === preferred);
      if (exact) return exact;
    }

    return candidates[0] || "";
  }

  function extractDunsFromHtml(html, preferredDuns) {
    if (!html) return "";
    const preferred = cleanText(preferredDuns);
    if (preferred) {
      const inLinks = html.match(
        new RegExp(`CompanyDetails/[^"']*[?&]duns=${preferred}(?:&|["'])`, "i")
      );
      const inAttr = html.match(new RegExp(`\\bduns=["']${preferred}["']`, "i"));
      if (inLinks || inAttr) return preferred;
    }

    const fromCompanyLink =
      (html.match(/CompanyDetails\/[^"']*[?&]duns=(\d{6,12})/i) || [])[1] || "";
    if (fromCompanyLink) return fromCompanyLink;

    return (
      (html.match(/\bduns=["'](\d{6,12})["']/i) || [])[1] ||
      (html.match(/[?&]duns=(\d{6,12})/i) || [])[1] ||
      (html.match(/"Duns"\s*:\s*"?(\d{6,12})"?/i) || [])[1] ||
      (html.match(/\bduns\s*[:=]\s*['"]?(\d{6,12})/i) || [])[1] ||
      ""
    );
  }

  function parseSearchHtmlRows(html) {
    const rows = [];
    const wrapped = html.trim().startsWith("<") ? html : `<table><tbody>${html}</tbody></table>`;
    const doc = new DOMParser().parseFromString(wrapped, "text/html");

    doc.querySelectorAll("tr").forEach((tr) => {
      const row = extractRowFromElement(tr);
      if (row.duns || row.nameHe || row.regNumber) rows.push(row);
    });

    if (!rows.length) {
      doc.querySelectorAll("[duns], [data-duns]").forEach((el) => {
        const row = extractRowFromElement(el.closest("tr, div, li, a") || el);
        if (row.duns || row.nameHe || row.regNumber) rows.push(row);
      });
    }

    return rows;
  }

  function extractRowFromElement(el) {
    if (!el) return {};
    const html = el.outerHTML || "";
    const text = textOf(el);

    const link = el.querySelector(
      "a[href*='CompanyDetails'], a[href*='duns='], a[onclick*='duns']"
    );
    const hrefDuns = link
      ? (link.getAttribute("href") || link.getAttribute("onclick") || "").match(
          /[?&]duns=(\d{6,12})/i
        )?.[1] || ""
      : "";

    const duns =
      el.getAttribute("duns") ||
      el.getAttribute("data-duns") ||
      el.getAttribute("data-Duns") ||
      extractDunsFromHtml(html) ||
      hrefDuns;

    const regNumber =
      (text.match(/\b\d{5,9}\b/) || [])[0] ||
      (html.match(/Regis(?:Number|Num)?[=:"'\s]+(\d{5,9})/i) || [])[1] ||
      "";

    return {
      Duns: duns,
      CompanyName:
        textOf(el.querySelector("a, .company_name, td:nth-child(1)")) ||
        text.split("\n")[0],
      RegisNumber: regNumber,
    };
  }

  function extractSearchRows(json) {
    const data = unwrapSearchJson(json);
    if (!data) return [];

    let part = data.PartContent ?? data.partContent ?? data.Content ?? data.content;

    if (Array.isArray(part)) {
      if (part.length && typeof part[0] === "object") return part;
      return [];
    }

    if (typeof part === "string" && part.trim()) {
      const fromHtml = parseSearchHtmlRows(part);
      if (fromHtml.length) return fromHtml;
    }

    if (Array.isArray(data.rows)) return data.rows;
    if (Array.isArray(data.Results)) return data.Results;

    return [];
  }

  const BUSINESS_FIELD_LABELS = {
    regNumber: LABELS.regNumber,
    legalStatus: LABELS.legalStatus,
    sector: LABELS.sector,
    activity: ["אופי פעילות"],
    mainIndustry: LABELS.mainIndustry,
    subIndustry: LABELS.subIndustry,
    email: LABELS.email,
    website: LABELS.website,
  };

  const KNOWN_LABELS = new Set([
    ...Object.values(LABELS).flat(),
    ...Object.values(BUSINESS_FIELD_LABELS).flat(),
    "חברות אם",
    "חברות בת",
    "פקס",
    "מחזור הכנסות (באלפים)",
    "מחזור הכנסות",
    "סוג מניה",
    "D-U-N-S",
    "DUNS",
    "הציגו",
    "נתונים עסקיים",
    "תחום פעילות",
  ]);

  function isKnownLabel(text) {
    const t = cleanText(text);
    if (!t) return true;
    if (KNOWN_LABELS.has(t)) return true;
    return [...KNOWN_LABELS].some((label) => t === label || t.startsWith(label + " "));
  }

  function findSectionByHeading(root, headingText) {
    const candidates = Array.from(root.querySelectorAll("h2, h3, h4, div, span, strong"));
    const heading = candidates.find((el) => textOf(el) === headingText);
    if (!heading) return null;
    return (
      heading.closest("section, article, .tabContent, .tabContent_with_title, .innerinformation") ||
      heading.parentElement
    );
  }

  function extractValueForLabelEl(labelEl, labelText) {
    const parent = labelEl.parentElement;
    if (parent) {
      for (const child of parent.children) {
        if (child === labelEl) continue;
        const val = textOf(child);
        if (val && val !== labelText && !isKnownLabel(val)) return val;
      }
    }

    const sibling = labelEl.nextElementSibling;
    if (sibling) {
      const val = textOf(sibling);
      if (val && val !== labelText && !isKnownLabel(val)) return val;
    }

    const row = labelEl.closest("tr, li");
    if (row) {
      const cells = Array.from(row.querySelectorAll("td, th, div, span")).filter(
        (el) => textOf(el) !== labelText && !isKnownLabel(textOf(el))
      );
      if (cells.length) return textOf(cells[0]);
    }

    return "";
  }

  function findFieldValue(root, labels, options = {}) {
    const scope = options.section
      ? findSectionByHeading(root, options.section) || root
      : root;
    const exclude = options.excludeSection
      ? findSectionByHeading(root, options.excludeSection)
      : null;

    const nodes = Array.from(scope.querySelectorAll("td, th, label, span, div, li, p, strong, b"));
    for (const el of nodes) {
      if (exclude && exclude.contains(el)) continue;
      const own = textOf(el);
      if (!own || own.length > 80) continue;
      const matched = labels.some((label) => own === label || own.startsWith(label + ":"));
      if (!matched) continue;

      const val = extractValueForLabelEl(el, own);
      if (val && !isKnownLabel(val)) return val;
    }
    return "";
  }

  function parseBusinessDataSection(root) {
    const section = findSectionByHeading(root, "נתונים עסקיים");
    if (!section) return {};

    const result = {};
    for (const [field, labels] of Object.entries(BUSINESS_FIELD_LABELS)) {
      const val = findFieldValue(root, labels, { section: "נתונים עסקיים" });
      if (!val) continue;
      if (field === "regNumber" && !/^\d{5,9}$/.test(val.replace(/-/g, ""))) continue;
      if (field === "legalStatus" && (ACTIVE_STATUS_RE.test(val) || /מחזור|סוג מניה|^-/.test(val))) {
        continue;
      }
      if (field === "website" && !/^https?:\/\//i.test(val) && !/^www\./i.test(val)) continue;
      result[field] = val;
    }
    return result;
  }

  function findTitleElement(root, title) {
    return Array.from(
      root.querySelectorAll("div, span, td, th, label, p, b, strong, font")
    ).find((el) => {
      const t = textOf(el);
      return t === title || (t.includes(title) && t.length <= title.length + 8);
    });
  }

  function findLargeNumberInBox(box, minValue = 1) {
    for (const el of box.querySelectorAll("span, div, b, strong, font, p, td")) {
      const t = textOf(el);
      if (/^\d{1,3}$/.test(t)) {
        const parsed = parseScoreDigits(t);
        if (parsed && Number(parsed) >= minValue) return parsed;
      }
    }
    return "";
  }

  function findMetricColumn(titleEl, titleText) {
    const otherTitles = ["סקור ענפי", "ותק עסק", "מספר מועסקים"].filter((t) => t !== titleText);

    let node = titleEl;
    for (let depth = 0; depth < 10 && node; depth++) {
      const t = textOf(node);
      if (t.includes(titleText)) {
        const hasOther = otherTitles.some((o) => t.includes(o));
        if (!hasOther) return node;

        for (const child of node.children) {
          if (!child.contains(titleEl)) continue;
          const ct = textOf(child);
          if (ct.includes(titleText) && !otherTitles.some((o) => ct.includes(o))) {
            return child;
          }
        }
      }
      node = node.parentElement;
    }

    return titleEl.parentElement;
  }

  function extractScoreFromBlock(blockText, titleText) {
    const idx = blockText.indexOf(titleText);
    if (idx < 0) return "";
    const after = blockText.slice(idx + titleText.length).replace(/\([^)]*\)/g, " ");
    const nums = after.match(/\b(\d{1,3})\b/g) || [];
    for (const num of nums) {
      const parsed = parseScoreDigits(num);
      if (parsed && Number(parsed) >= 10) return parsed;
    }
    for (const num of nums) {
      const parsed = parseScoreDigits(num);
      if (parsed && Number(parsed) > 1) return parsed;
    }
    return "";
  }

  function extractMetricBoxes(root) {
    const metrics = {
      score: "",
      seniorityYears: "",
      senioritySince: "",
      employees: "",
    };

    const titleMap = {
      score: "סקור ענפי",
      seniority: "ותק עסק",
      employees: "מספר מועסקים",
    };

    for (const [key, title] of Object.entries(titleMap)) {
      const titleEl = findTitleElement(root, title);
      if (!titleEl) continue;

      const box = findMetricColumn(titleEl, title);
      if (!box) continue;
      const boxText = textOf(box);

      if (key === "score") {
        const scoreEl = box.querySelector(".scorenumber");
        const fromClass = parseScoreDigits(textOf(scoreEl));
        if (fromClass) {
          metrics.score = fromClass;
          continue;
        }
        const fromLarge = findLargeNumberInBox(box, 10);
        if (fromLarge) {
          metrics.score = fromLarge;
          continue;
        }
        metrics.score = extractScoreFromBlock(boxText, title);
        continue;
      }

      if (key === "seniority") {
        const yearMatch = boxText.match(/שנת\s+יסוד[^\d]*(\d{1,2})\/(\d{4})/);
        if (yearMatch) metrics.senioritySince = yearMatch[2];

        const afterTitle = boxText.slice(boxText.indexOf(title) + title.length);
        const withoutNotes = afterTitle.replace(/\([^)]*\)/g, " ");
        const numMatch = withoutNotes.match(/(\d{1,3})/);
        if (numMatch) metrics.seniorityYears = numMatch[1];
        continue;
      }

      if (key === "employees") {
        const afterTitle = boxText.slice(boxText.indexOf(title) + title.length);
        const withoutNotes = afterTitle.replace(/\([^)]*\)/g, " ");
        const numMatch = withoutNotes.match(/(\d{1,5})/);
        if (numMatch) metrics.employees = numMatch[1];
      }
    }

    if (!metrics.score) {
      const row = Array.from(root.querySelectorAll("tr, div, ul, table, section")).find((el) => {
        const t = textOf(el);
        return (
          t.includes("סקור ענפי") &&
          t.includes("ותק עסק") &&
          t.includes("מספר מועסקים") &&
          t.length < 600
        );
      });
      if (row) {
        for (const block of row.querySelectorAll("td, li, div")) {
          const t = textOf(block);
          if (!t.includes("סקור ענפי") || t.includes("ותק עסק") || t.includes("מספר מועסקים")) {
            continue;
          }
          metrics.score =
            parseScoreDigits(textOf(block.querySelector(".scorenumber"))) ||
            findLargeNumberInBox(block, 10) ||
            extractScoreFromBlock(t, "סקור ענפי");
          if (metrics.score) break;
        }
      }
    }

    return metrics;
  }

  function validateWebsiteValue(val) {
    const t = cleanText(val);
    if (!t || t === "-" || t === "–" || t === "—") return "";
    if (/^https?:\/\//i.test(t) || /^www\./i.test(t)) return t;
    return "";
  }

  function validateEmailValue(val) {
    const t = cleanText(val);
    if (!t || t === "-" || t === "–" || t === "—") return "";
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) return t;
    return "";
  }

  function findValueByLabels(root, labels) {
    return findFieldValue(root, labels, { excludeSection: "נתונים עסקיים" });
  }

  function parseScoreDigits(raw) {
    const digits = cleanText(raw).replace(/[^\d]/g, "");
    if (!digits) return "";
    const n = Number(digits);
    if (Number.isNaN(n) || n < 1 || n > 100) return "";
    return String(n);
  }

  function extractScoreFromSource(html) {
    if (!html) return "";

    const idx = html.indexOf("סקור ענפי");
    if (idx >= 0) {
      const slice = html.slice(idx, idx + 500);
      const nearClass = slice.match(/class=["'][^"']*scorenumber[^"']*["'][^>]*>\s*(\d{1,3})\s*</i);
      if (nearClass) {
        const parsed = parseScoreDigits(nearClass[1]);
        if (parsed) return parsed;
      }
      const nearText = slice.match(/סקור ענפי[\s\S]{0,160}?(\d{1,3})/);
      if (nearText) {
        const parsed = parseScoreDigits(nearText[1]);
        if (parsed && Number(parsed) >= 10) return parsed;
      }
    }

    const classMatch = html.match(
      /class=["'][^"']*scorenumber[^"']*["'][^>]*>\s*(\d{1,3})\s*</i
    );
    if (classMatch) {
      const parsed = parseScoreDigits(classMatch[1]);
      if (parsed) return parsed;
    }

    return "";
  }

  function findSectorScore(root, fallback, htmlSource = "") {
    const metrics = extractMetricBoxes(root);
    if (metrics.score) return metrics.score;

    const fromIndustry = findIndustryScoreNumber(root);
    if (fromIndustry) return fromIndustry;

    const selectors = [".score-metric .scorenumber"];

    for (const sel of selectors) {
      const el = root.querySelector(sel);
      if (!el) continue;
      if (el.closest("#Legend, .rating-scale, .scale-bar, [id*='ScoreGraph']")) continue;
      const parsed = parseScoreDigits(textOf(el));
      if (parsed) return parsed;
    }

    const fromSource = extractScoreFromSource(htmlSource);
    if (fromSource) return fromSource;

    return parseScoreDigits(fallback.score);
  }

  function findCompanyHeaderScope(root) {
    const nameEl = root.querySelector(".company_name, .company_name_print, #CompanyName");
    if (!nameEl) return root;
    return (
      nameEl.closest(".innerinformation, #content, table, .CompDetails, [class*='company']") ||
      nameEl.parentElement?.parentElement ||
      root
    );
  }

  function findAddress(root, fallback) {
    const fromLabel = findFieldValue(root, LABELS.address);
    if (fromLabel) return fromLabel;

    const scope = findCompanyHeaderScope(root);
    const text = textOf(scope);
    const match = text.match(
      /([\u0590-\u05FFA-Za-z0-9\s,'."\-]+\d{1,5},\s*[\u0590-\u05FF\s'"-]+,\s*\d{7})/
    );
    if (match) return cleanText(match[1]);

    return pickFirst(fallback.address);
  }

  function findActivityField(root, fallback) {
    return pickFirst(
      findFieldValue(root, ["תחום פעילות"]),
      findFieldValue(root, LABELS.activity),
      fallback.activity
    );
  }

  function findIndustryScoreNumber(root) {
    const titleEl = findTitleElement(root, "סקור ענפי");
    if (titleEl) {
      const box = findMetricColumn(titleEl, "סקור ענפי");
      const fromLarge = findLargeNumberInBox(box, 10);
      if (fromLarge) return fromLarge;
      const fromBlock = extractScoreFromBlock(textOf(box), "סקור ענפי");
      if (fromBlock) return fromBlock;
    }

    for (const el of root.querySelectorAll(".scorenumber")) {
      const box = el.closest("div, section, td, li, table");
      const boxText = textOf(box);
      if (/סקור עסק/.test(boxText) && !/סקור ענפי/.test(boxText)) continue;
      if (el.closest("#Legend, [id*='ScoreGraph'], #compDetailsDunsScore")) continue;
      const parsed = parseScoreDigits(textOf(el));
      if (parsed) return parsed;
    }
    return "";
  }

  function findInactiveInScope(scope) {
    if (!scope) return "";

    const inactiveSelectors = [
      ".statusNotActive",
      ".status-not-active",
      ".statusInactive",
      ".status-inactive",
      ".label-danger",
      "[class*='NotActive']",
      "[class*='notActive']",
      "[class*='inactive']",
    ];
    for (const sel of inactiveSelectors) {
      for (const el of scope.querySelectorAll(sel)) {
        const t = textOf(el);
        if (isInactiveStatusText(t)) return normalizeInactiveStatus(t);
      }
    }

    for (const el of scope.querySelectorAll("span, div, label, b, strong, td, p, font")) {
      const t = textOf(el);
      if (t === "לא פעילה" || t === "לא פעיל") return t;
      if (isInactiveStatusText(t) && t.length <= 24) return normalizeInactiveStatus(t);
    }

    return "";
  }

  function extractStatusFromSource(html) {
    if (!html) return "";

    const jsonPatterns = [
      /"ActivityStatusDescription"\s*:\s*"([^"]+)"/i,
      /"ActivityStatus"\s*:\s*"([^"]+)"/i,
      /ActivityStatusDescription\s*=\s*['"]([^'"]+)['"]/i,
    ];
    for (const re of jsonPatterns) {
      const match = html.match(re);
      if (!match?.[1]) continue;
      const t = cleanText(match[1]);
      if (isInactiveStatusText(t)) return normalizeInactiveStatus(t);
      if (ACTIVE_STATUS_RE.test(t)) return t;
    }

    const headerIdx = Math.max(
      html.indexOf("company_name"),
      html.indexOf("company_name_print"),
      html.indexOf("CompanyName")
    );
    const scope =
      headerIdx >= 0 ? html.slice(headerIdx, headerIdx + 4000) : html.slice(0, 8000);
    if (scope.includes("לא פעילה")) return "לא פעילה";
    if (/\bלא\s*פעיל\b/.test(scope)) return "לא פעיל";

    return "";
  }

  function findStatusBadge(root, fallback, htmlSource = "") {
    const headerScope = findCompanyHeaderScope(root);

    const inactive =
      findInactiveInScope(headerScope) ||
      findInactiveInScope(root) ||
      (() => {
        const statusVal = findValueByLabels(root, LABELS.status);
        if (isInactiveStatusText(statusVal)) return normalizeInactiveStatus(statusVal);
        return "";
      })() ||
      (() => {
        const fb = pickFirst(fallback.status);
        if (isInactiveStatusText(fb)) return normalizeInactiveStatus(fb);
        return "";
      })() ||
      extractStatusFromSource(htmlSource);
    if (inactive) return inactive;

    const selectors = [
      ".statusActive",
      ".status-active",
      ".company-status",
      ".badge-active",
      ".label-success",
    ];
    for (const sel of selectors) {
      const t = textOf(root.querySelector(sel));
      if (ACTIVE_STATUS_RE.test(t)) return t;
    }

    const statusVal = findValueByLabels(root, LABELS.status);
    if (ACTIVE_STATUS_RE.test(statusVal)) return statusVal;

    const fb = pickFirst(fallback.status);
    if (ACTIVE_STATUS_RE.test(fb)) return fb;
    return fb;
  }

  function findLegalStatus(root, fallback) {
    const fromBusiness = parseBusinessDataSection(root).legalStatus;
    let val = fromBusiness || findFieldValue(root, LABELS.legalStatus, {
      section: "נתונים עסקיים",
    });
    if (ACTIVE_STATUS_RE.test(val) || isInactiveStatusText(val)) val = "";
    if (/מחזור|סוג מניה|^-/.test(val)) val = "";
    return pickFirst(val, fallback.legalStatus);
  }

  function findEmail(root, fallback) {
    const fromBusiness = validateEmailValue(
      findFieldValue(root, LABELS.email, { section: "נתונים עסקיים" })
    );
    if (fromBusiness) return fromBusiness;

    const fromContact = validateEmailValue(findFieldValue(root, LABELS.email));
    if (fromContact) return fromContact;

    return validateEmailValue(fallback.email);
  }

  function findWebsite(root, fallback) {
    const fromBusiness = validateWebsiteValue(
      findFieldValue(root, LABELS.website, { section: "נתונים עסקיים" })
    );
    if (fromBusiness) return fromBusiness;

    const links = Array.from(root.querySelectorAll('a[href^="http"], a[href^="www."]'));
    for (const a of links) {
      const businessSection = findSectionByHeading(root, "נתונים עסקיים");
      if (businessSection && businessSection.contains(a)) continue;
      const href = validateWebsiteValue(a.getAttribute("href"));
      if (href && !/dundb|facebook|google|linkedin|youtube|instagram/i.test(href)) {
        return href;
      }
    }

    return validateWebsiteValue(fallback.website);
  }

  function normalizeEmployees(val) {
    const t = cleanText(val);
    if (!t || t === "-" || t === "–" || t === "—") return "";
    if (/\d+\s*-\s*\d+/.test(t)) return t.replace(/\s+/g, "");
    const digits = t.replace(/[^\d]/g, "");
    return digits || t;
  }

  function collectPhones(root) {
    const phones = new Set();
    root.querySelectorAll('a[href^="tel:"]').forEach((a) => {
      const p = cleanText(a.getAttribute("href").replace(/^tel:/, ""));
      if (p) phones.add(p);
    });

    const phoneBlock = findFieldValue(root, LABELS.phone);
    if (phoneBlock) {
      phoneBlock.split(/[,;|\n]/).forEach((part) => {
        const p = cleanText(part);
        if (p && /\d/.test(p)) phones.add(p);
      });
    }

    const headerScope = findCompanyHeaderScope(root);
    const headerMatches = textOf(headerScope).match(/0\d[\d\-]{7,12}/g);
    if (headerMatches) headerMatches.forEach((m) => phones.add(m));

    root.querySelectorAll(".phone, .phones, [class*='phone'], [id*='phone']").forEach((el) => {
      const matches = textOf(el).match(/0\d[\d\-]{7,12}/g);
      if (matches) matches.forEach((m) => phones.add(m));
    });

    return Array.from(phones);
  }

  function parseSeniority(root, fallback) {
    const metrics = extractMetricBoxes(root);
    const seniorityRaw = pickFirst(
      findFieldValue(root, LABELS.seniority),
      fallback.seniorityText
    );

    const founded = findFieldValue(root, LABELS.founded);
    const yearsFromText = metrics.seniorityYears || (seniorityRaw.match(/(\d{1,3})/) || [])[1] || "";
    const yearFromFounded =
      metrics.senioritySince ||
      (founded.match(/20\d{2}/) || [])[0] ||
      (founded.match(/(\d{1,2})\/(\d{4})/) || [])[2] ||
      (seniorityRaw.match(/(\d{1,2})\/(\d{4})/) || [])[2] ||
      "";

    return {
      seniorityText: seniorityRaw,
      seniorityYears: yearsFromText || fallback.seniorityYears || "",
      senioritySince: yearFromFounded || fallback.senioritySince || "",
    };
  }

  function pageMatchesCompany(root, fallback) {
    const wanted = cleanText(fallback.regNumber).replace(/-/g, "");
    if (!wanted) return true;
    const pageReg = pickFirst(
      parseBusinessDataSection(root).regNumber,
      findFieldValue(root, LABELS.regNumber, { section: "נתונים עסקיים" })
    );
    if (!pageReg) return false;
    return cleanText(pageReg).replace(/-/g, "") === wanted;
  }

  function parseCompanyHtml(html, fallback = {}, liveRoot = null) {
    const htmlSource =
      typeof html === "string"
        ? html
        : liveRoot
          ? liveRoot.documentElement?.outerHTML || ""
          : "";
    const doc = liveRoot || new DOMParser().parseFromString(htmlSource, "text/html");
    const root = liveRoot || doc;

    const nameHe = pickFirst(
      textOf(root.querySelector(".company_name")),
      textOf(root.querySelector(".company_name_print")),
      textOf(root.querySelector("#CompanyName")),
      textOf(root.querySelector("h1")),
      textOf(root.querySelector("[class*='company'][class*='name']")),
      fallback.nameHe
    );

    const nameEn = pickFirst(
      textOf(root.querySelector(".company_name_en")),
      textOf(root.querySelector(".company-name-en")),
      fallback.nameEn
    );

    const metrics = extractMetricBoxes(root);
    const business = parseBusinessDataSection(root);

    const score = pickFirst(metrics.score, findSectorScore(root, fallback, htmlSource));
    const employees = normalizeEmployees(
      pickFirst(
        metrics.employees,
        findFieldValue(root, LABELS.employees),
        fallback.employees
      )
    );
    const seniority = parseSeniority(root, fallback);
    const phones = collectPhones(root);
    if (!phones.length && fallback.phones) phones.push(...fallback.phones);

    const dunsFromPage =
      root.querySelector("[duns]")?.getAttribute?.("duns") ||
      root.querySelector("[data-duns]")?.getAttribute?.("data-duns") ||
      extractDunsFromHtml(htmlSource, fallback.duns) ||
      fallback.duns ||
      "";

    const regFromFields = pickFirst(
      business.regNumber,
      findFieldValue(root, LABELS.regNumber, { section: "נתונים עסקיים" }),
      extractRegNumberFromHtml(htmlSource, fallback.regNumber, dunsFromPage || fallback.duns)
    );
    const wantReg = normalizeRegisNumber(fallback.regNumber);
    const fieldReg = normalizeRegisNumber(regFromFields);
    let regNumber = regFromFields;
    if (
      wantReg &&
      fallback.duns &&
      dunsFromPage === fallback.duns &&
      fieldReg &&
      fieldReg !== wantReg
    ) {
      regNumber = fallback.regNumber;
    } else if (wantReg && fieldReg === wantReg) {
      regNumber = fallback.regNumber || regFromFields;
    }

    return DundbUtils.normalizeCompanyData({
      nameHe,
      nameEn,
      status: findStatusBadge(root, fallback, htmlSource),
      address: findAddress(root, fallback),
      phones,
      email: findEmail(root, fallback),
      website: findWebsite(root, fallback),
      score,
      seniorityText: seniority.seniorityText,
      seniorityYears: seniority.seniorityYears,
      senioritySince: seniority.senioritySince,
      employees,
      regNumber,
      legalStatus: findLegalStatus(root, { ...fallback, legalStatus: business.legalStatus }),
      sector: pickFirst(
        business.sector,
        findFieldValue(root, LABELS.sector, { section: "נתונים עסקיים" }),
        fallback.sector
      ),
      activity: pickFirst(findActivityField(root, fallback), business.activity),
      mainIndustry: pickFirst(
        business.mainIndustry,
        findFieldValue(root, LABELS.mainIndustry, { section: "נתונים עסקיים" }),
        fallback.mainIndustry
      ),
      subIndustry: pickFirst(
        business.subIndustry,
        findFieldValue(root, LABELS.subIndustry, { section: "נתונים עסקיים" }),
        fallback.subIndustry
      ),
      duns: dunsFromPage,
    });
  }

  function mapSearchRow(row) {
    if (!row || typeof row !== "object") return {};
    return DundbUtils.normalizeCompanyData({
      duns: pickFirst(
        row.Duns,
        row.duns,
        row.DUNS,
        row.DunsNumber,
        row.dunsNumber,
        row.CompanyDuns,
        row.EntityId,
        row.entityId
      ),
      nameHe: pickFirst(
        row.CompanyName,
        row.companyName,
        row.Name,
        row.name,
        row.CompanyNameHeb,
        row.CompanyNameHe
      ),
      nameEn: pickFirst(
        row.CompanyNameEng,
        row.CompanyNameEn,
        row.companyNameEn,
        row.EnglishName
      ),
      regNumber: pickFirst(
        row.RegisNumber,
        row.RegisNum,
        row.regisNumber,
        row.RegistrationNumber,
        row.Hp,
        row.Regis
      ),
      address: pickFirst(row.Address, row.FullAddress, row.address),
      city: pickFirst(row.City, row.city),
      status: pickFirst(row.ActivityStatus, row.Status, row.ActivityStatusDescription),
      legalStatus: pickFirst(row.LegalStatus, row.LegalStatusDescription),
      sector: pickFirst(row.Sector, row.SectorDescription),
      activity: pickFirst(
        row.ActivityType,
        row.ActivityTypeDescription,
        row.ActivityField
      ),
      mainIndustry: pickFirst(
        row.MainSic,
        row.MainIndustry,
        row.MainSicDescription,
        row.SicDescription
      ),
      subIndustry: pickFirst(row.SubSic, row.SubIndustry, row.SubSicDescription),
      score: pickFirst(row.DunsScore, row.Score, row.ScoreValue, row.SectorScore),
      employees: pickFirst(row.Employees, row.EmployeesCount, row.EmployeesRange),
      seniorityYears: pickFirst(row.Seniority, row.BusinessSeniority, row.YearsOfSeniority),
      senioritySince: pickFirst(row.EstablishYear, row.FoundationYear, row.YearEstablished),
      phones: row.Phones || row.Phone ? [row.Phone || row.Phones].flat() : [],
      email: pickFirst(row.Email, row.Mail),
      website: pickFirst(row.WebSite, row.Website, row.Site),
    });
  }

  function formatSupervisorText(data, risk) {
    const lines = [];
    lines.push(`*${data.nameHe || "—"}*`);
    if (data.nameEn) lines.push(data.nameEn);
    if (DundbUtils.isInactiveStatus(data.status)) {
      lines.push(`*סטטוס: ${DundbUtils.normalizeStatusLabel(data.status) || "לא פעילה"}*`);
    } else {
      lines.push(`סטטוס: ${data.status || "—"}`);
    }
    lines.push("");
    lines.push(`כתובת: ${data.address || "—"}`);
    lines.push(`טלפון: ${(data.phones || []).join(" | ") || "—"}`);
    lines.push(`אימייל: ${data.email || "—"}`);
    lines.push(`אתר: ${data.website || "—"}`);
    if (data.activity) lines.push(`תחום פעילות: ${data.activity}`);
    lines.push("");
    const scoreDisplay = DundbUtils.parseScore(data.score);
    lines.push(`סקור ענפי: ${scoreDisplay === null ? "—" : String(scoreDisplay)}`);
    if (scoreDisplay !== null && risk?.warning) lines.push(risk.warning);
    lines.push(
      `ותק עסק: ${data.seniorityYears || "—"} שנים${
        data.senioritySince ? ` (שנת יסוד ${data.senioritySince})` : ""
      }`
    );
    lines.push(`מספר מועסקים: ${data.employees || "—"}`);
    lines.push("");
    lines.push("נתונים עסקיים:");
    lines.push(`מספר רישום: ${data.regNumber || "—"}`);
    lines.push(`מעמד משפטי: ${data.legalStatus || "—"}`);
    if (data.sector) lines.push(`מגזר: ${data.sector}`);
    if (data.mainIndustry) lines.push(`ענף ראשי: ${data.mainIndustry}`);
    if (data.subIndustry) lines.push(`ענף משני: ${data.subIndustry}`);
    return lines.join("\n");
  }

  global.DundbParser = {
    parseCompanyHtml,
    mapSearchRow,
    extractSearchRows,
    formatSupervisorText,
    extractDunsFromHtml,
    extractRegNumberFromHtml,
    pageMatchesCompany,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
