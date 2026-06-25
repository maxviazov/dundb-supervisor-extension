(function (global) {
  const W = 380;
  const PAD = 18;
  const LINE = 22;

  function clean(value, fallback = "—") {
    const t = global.DundbUtils.cleanText(value);
    return t || fallback;
  }

  function wrapText(ctx, text, maxWidth) {
    const words = String(text || "").split(/\s+/);
    const lines = [];
    let line = "";
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
    return lines.length ? lines : ["—"];
  }

  function drawRoundedRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function estimateHeight(data, risk) {
    let h = PAD * 2 + 50 + 120 + 100 + 50;
    const phones = (data.phones || []).join(" | ");
    h += Math.max(1, Math.ceil(phones.length / 34)) * LINE;
    h += 180;
    if (data.activity) h += LINE;
    return h + 40;
  }

  function renderCardToCanvas(data, risk) {
    const height = estimateHeight(data, risk);
    const canvas = document.createElement("canvas");
    canvas.width = W * 2;
    canvas.height = height * 2;
    const ctx = canvas.getContext("2d");
    ctx.scale(2, 2);

    ctx.fillStyle = "#f3f6fa";
    ctx.fillRect(0, 0, W, height);

    const cardX = 10;
    const cardY = 10;
    const cardW = W - 20;
    let y = cardY + PAD;

    drawRoundedRect(ctx, cardX, cardY, cardW, height - 20, 16);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.strokeStyle = "#e5e7eb";
    ctx.lineWidth = 1;
    ctx.stroke();

    const right = cardX + cardW - PAD;
    const left = cardX + PAD;
    const contentW = cardW - PAD * 2;

    ctx.fillStyle = "#1f2937";
    ctx.font = "bold 20px Arial";
    ctx.textAlign = "right";
    ctx.textBaseline = "top";
    ctx.fillText(clean(data.nameHe, "שם חברה"), right, y);

    if (data.nameEn) {
      ctx.fillStyle = "#6b7280";
      ctx.font = "12px Arial";
      ctx.fillText(clean(data.nameEn), right, y + 26);
    }

    const badge = clean(data.status, "פעילה");
    ctx.font = "bold 11px Arial";
    const badgeW = ctx.measureText(badge).width + 18;
    drawRoundedRect(ctx, left, y, badgeW, 22, 11);
    ctx.fillStyle = "#dcfce7";
    ctx.fill();
    ctx.fillStyle = "#166534";
    ctx.textAlign = "left";
    ctx.fillText(badge, left + 9, y + 5);
    y += 48;

    function row(label, value, valueColor) {
      ctx.textAlign = "right";
      ctx.fillStyle = "#6b7280";
      ctx.font = "12px Arial";
      ctx.fillText(label, right, y);
      ctx.fillStyle = valueColor || "#1f2937";
      ctx.font = "13px Arial";
      const lines = wrapText(ctx, value, contentW - 90);
      let vy = y;
      for (const ln of lines) {
        ctx.fillText(ln, right - 88, vy);
        vy += LINE - 2;
      }
      y = Math.max(y + LINE, vy) + 6;
      ctx.strokeStyle = "#f1f5f9";
      ctx.beginPath();
      ctx.moveTo(left, y - 3);
      ctx.lineTo(right, y - 3);
      ctx.stroke();
    }

    row("כתובת", clean(data.address));
    row("טלפון", (data.phones || []).join(" | ") || "—");
    row("אימייל", clean(data.email));
    row("אתר", clean(data.website));
    if (data.activity) row("תחום פעילות", clean(data.activity));
    y += 6;

    const metricW = (contentW - 16) / 3;
    const scoreNum = global.DundbUtils.parseScore(data.score);
    const metrics = [
      {
        title: "סקור ענפי",
        value: scoreNum === null ? "—" : String(scoreNum),
        note: scoreNum === null ? "" : risk.warning || "",
        color: scoreNum === null ? "#9ca3af" : risk.color || "#f59e0b",
        noteColor: scoreNum !== null && risk.warning ? "#ef4444" : "#6b7280",
      },
      {
        title: "ותק עסק",
        value: clean(data.seniorityYears),
        note: data.senioritySince
          ? `שנת יסוד ${data.senioritySince}`
          : clean(data.seniorityText, ""),
        color: "#1e5a8a",
        noteColor: "#6b7280",
      },
      {
        title: "מספר מועסקים",
        value: clean(data.employees),
        note: "על פי הערכה",
        color: "#1f2937",
        noteColor: "#6b7280",
      },
    ];

    metrics.forEach((m, i) => {
      const mx = right - (i + 1) * metricW - i * 8 + 8;
      drawRoundedRect(ctx, mx, y, metricW, 88, 10);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.strokeStyle = "#e5e7eb";
      ctx.stroke();
      ctx.textAlign = "center";
      ctx.fillStyle = "#6b7280";
      ctx.font = "10px Arial";
      ctx.fillText(m.title, mx + metricW / 2, y + 10);
      ctx.fillStyle = m.color;
      ctx.font = "bold 26px Arial";
      ctx.fillText(m.value, mx + metricW / 2, y + 30);
      ctx.fillStyle = m.noteColor;
      ctx.font = "9px Arial";
      const noteLines = wrapText(ctx, m.note, metricW - 8);
      let ny = y + 58;
      for (const ln of noteLines.slice(0, 2)) {
        ctx.fillText(ln, mx + metricW / 2, ny);
        ny += 12;
      }
    });
    y += 100;

    ctx.textAlign = "right";
    ctx.fillStyle = "#1f2937";
    ctx.font = "bold 15px Arial";
    ctx.fillText("נתונים עסקיים", right, y);
    y += 24;

    const fields = [
      ["מספר רישום", clean(data.regNumber)],
      ["מעמד משפטי", clean(data.legalStatus)],
      ["מגזר", clean(data.sector)],
      ["אופי פעילות", clean(data.activity)],
      ["ענף ראשי", clean(data.mainIndustry)],
      ["ענף משני", clean(data.subIndustry)],
    ].filter(([, v]) => v && v !== "—");

    for (const [label, value] of fields) {
      drawRoundedRect(ctx, left, y, contentW, 30, 8);
      ctx.fillStyle = "#f8fafc";
      ctx.fill();
      ctx.textAlign = "right";
      ctx.fillStyle = "#6b7280";
      ctx.font = "12px Arial";
      ctx.fillText(label, right - 10, y + 8);
      ctx.fillStyle = "#1f2937";
      ctx.font = "bold 12px Arial";
      ctx.textAlign = "left";
      ctx.fillText(value, left + 10, y + 8);
      y += 36;
    }

    y += 8;
    ctx.textAlign = "right";
    ctx.fillStyle = "#1f2937";
    ctx.font = "bold 15px Arial";
    ctx.fillText("סרגל הדירוג", right, y);
    y += 22;

    const grad = ctx.createLinearGradient(left, 0, right, 0);
    grad.addColorStop(0, "#22c55e");
    grad.addColorStop(0.5, "#f59e0b");
    grad.addColorStop(1, "#ef4444");
    drawRoundedRect(ctx, left, y, contentW, 10, 5);
    ctx.fillStyle = grad;
    ctx.fill();

    if (scoreNum !== null) {
      const pos = left + contentW * (1 - Math.max(0, Math.min(100, scoreNum)) / 100);
      ctx.fillStyle = "#111827";
      ctx.fillRect(pos - 3, y - 7, 6, 24);
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.strokeRect(pos - 3, y - 7, 6, 24);

      ctx.font = "bold 11px Arial";
      ctx.fillStyle = risk.color || "#111827";
      ctx.textAlign = "center";
      ctx.fillText(`דירוג ${risk.grade || ""} | ${scoreNum}`, left + contentW / 2, y + 32);
    }

    y += scoreNum !== null ? 40 : 18;
    ctx.font = "10px Arial";
    ctx.fillStyle = "#6b7280";
    ctx.textAlign = "center";
    [["85-53", "2"], ["52-16", "3"], ["15-0", "4"]].forEach(([range, grade], i) => {
      const cx = left + (contentW / 6) * (i * 2 + 1);
      ctx.fillText(range, cx, y);
      ctx.fillText(grade, cx, y + 14);
    });

    return canvas;
  }

  async function canvasToBlob(canvas) {
    return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  }

  async function copyCanvasToClipboard(canvas) {
    const blob = await canvasToBlob(canvas);
    if (!blob) throw new Error("לא ניתן ליצור תמונה");
    await navigator.clipboard.write([
      new ClipboardItem({
        "image/png": Promise.resolve(blob),
      }),
    ]);
  }

  function downloadCanvas(canvas, filename) {
    const link = document.createElement("a");
    link.download = filename;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }

  function safeFilename(name) {
    return String(name || "company")
      .replace(/[<>:"/\\|?*]/g, "")
      .trim()
      .slice(0, 40) || "company";
  }

  global.CardImage = {
    renderCardToCanvas,
    copyCanvasToClipboard,
    downloadCanvas,
    safeFilename,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
