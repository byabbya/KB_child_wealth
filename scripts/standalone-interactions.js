(() => {
  const scenario = window.__KB_STANDALONE_DATA__ || {};
  const currency = (value) => `${Number(value || 0).toLocaleString("ko-KR")}원`;
  const compactCurrency = (value) => {
    const amount = Number(value || 0);
    return amount >= 10000 ? `${Math.round(amount / 10000).toLocaleString("ko-KR")}만원` : currency(amount);
  };
  const escapeHtml = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
  const normalizedText = (element) => (element?.textContent || "").replace(/\s+/g, " ").trim();

  function closeModal(backdrop) {
    backdrop?.remove();
  }

  function openModal(title, body, options = {}) {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop standalone-backdrop";
    backdrop.innerHTML = `
      <section class="modal standalone-modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
        <button class="modal-close" type="button" aria-label="닫기">×</button>
        <span class="eyebrow">KB 우리 아이 자산관리</span>
        <h2>${escapeHtml(title)}</h2>
        <div class="standalone-modal-content">${body}</div>
        ${options.hideConfirm ? "" : '<button class="primary-button full-button standalone-confirm" type="button">확인</button>'}
      </section>`;
    document.body.appendChild(backdrop);
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) closeModal(backdrop);
    });
    backdrop.querySelector(".modal-close")?.addEventListener("click", () => closeModal(backdrop));
    backdrop.querySelector(".standalone-confirm")?.addEventListener("click", () => closeModal(backdrop));
    return backdrop;
  }

  function showToast(message) {
    document.querySelector(".standalone-toast")?.remove();
    const toast = document.createElement("div");
    toast.className = "standalone-toast";
    toast.textContent = message;
    document.body.appendChild(toast);
    window.setTimeout(() => toast.remove(), 2400);
  }

  const assetNames = {
    "KBSEC-KR-ETF-200": "RISE 200",
    "KBSEC-US-ETF-VT": "Vanguard Total World Stock ETF",
    "KBSEC-US-STOCK-AAPL": "Apple",
  };

  function openAssets() {
    const bankRows = (scenario.bankAccounts || []).map((item) => `
      <div class="standalone-asset-row">
        <div><span class="provider provider-bank">${escapeHtml(item.provider)}</span><strong>${escapeHtml(item.accountName)}</strong></div>
        <b>${currency(item.balance)}</b>
      </div>`).join("");
    const securitiesCash = (scenario.securitiesAccounts || []).map((item) => `
      <div class="standalone-asset-row">
        <div><span class="provider provider-securities">${escapeHtml(item.provider)}</span><strong>${escapeHtml(item.accountName)} 예수금</strong></div>
        <b>${currency(item.cashBalance)}</b>
      </div>`).join("");
    const holdingRows = (scenario.securitiesHoldings || []).map((item) => `
      <div class="standalone-asset-row">
        <div><span class="provider provider-securities">KB증권</span><strong>${escapeHtml(assetNames[item.assetId] || item.assetId)}</strong><small>${Number(item.quantity).toLocaleString("ko-KR")}주 보유</small></div>
        <b>${currency(item.marketValue)}</b>
      </div>`).join("");
    const total = [
      ...(scenario.bankAccounts || []).map((item) => item.balance),
      ...(scenario.securitiesAccounts || []).map((item) => item.cashBalance),
      ...(scenario.securitiesHoldings || []).map((item) => item.marketValue),
    ].reduce((sum, value) => sum + Number(value || 0), 0);
    openModal("우리 아이 전체 자산", `
      <div class="standalone-assets">${bankRows}${securitiesCash}${holdingRows}</div>
      <div class="asset-total"><span>전체 자산</span><strong>${currency(total)}</strong></div>`);
  }

  const assetLabels = { savings: "적금", deposit: "예금", stock: "주식", bond: "채권" };
  const strategyLabels = { etf: "ETF 중심", individual: "개별종목 중심", us: "미주 중심", domestic: "국내종목 중심" };
  const initialPreference = {
    horizonYears: 8,
    monthlyContribution: 500000,
    assetRanking: ["savings", "deposit", "stock", "bond"],
    strategyRanking: ["etf", "individual", "us", "domestic"],
  };

  function loadPreference() {
    try {
      return { ...initialPreference, ...JSON.parse(localStorage.getItem("kb-standalone-preference") || "{}") };
    } catch {
      return { ...initialPreference };
    }
  }

  function rankingMarkup(title, key, ranking, labels) {
    return `<div class="standalone-ranking" data-ranking="${key}">
      <strong>${title}</strong>
      <div class="standalone-ranking-list">${ranking.map((item, index) => `
        <div class="standalone-rank-item" data-value="${item}">
          <span class="rank-number">${index + 1}</span><b>${labels[item]}</b>
          <div class="rank-controls"><button type="button" data-move="up" ${index === 0 ? "disabled" : ""}>↑</button><button type="button" data-move="down" ${index === ranking.length - 1 ? "disabled" : ""}>↓</button></div>
        </div>`).join("")}</div>
    </div>`;
  }

  function refreshRanking(container) {
    const items = [...container.querySelectorAll(".standalone-rank-item")];
    items.forEach((item, index) => {
      item.querySelector(".rank-number").textContent = String(index + 1);
      item.querySelector('[data-move="up"]').disabled = index === 0;
      item.querySelector('[data-move="down"]').disabled = index === items.length - 1;
    });
  }

  function openGoalSettings() {
    const preference = loadPreference();
    const backdrop = openModal("목표·투자 성향 설정", `
      <form class="standalone-goal-form">
        <div class="standalone-form-grid">
          <label>투자기간<input name="horizonYears" type="number" min="1" max="18" value="${preference.horizonYears}"><small>년</small></label>
          <label>월 저축 계획<input name="monthlyContribution" type="number" min="0" step="10000" value="${preference.monthlyContribution}"><small>원</small></label>
        </div>
        ${rankingMarkup("자산 선호 순위", "assetRanking", preference.assetRanking, assetLabels)}
        ${rankingMarkup("투자 방식 순위", "strategyRanking", preference.strategyRanking, strategyLabels)}
        <button class="primary-button full-button" type="submit">설정 저장</button>
      </form>`, { hideConfirm: true });
    backdrop.querySelectorAll(".standalone-ranking").forEach((container) => {
      container.addEventListener("click", (event) => {
        const button = event.target.closest("button[data-move]");
        if (!button || button.disabled) return;
        const item = button.closest(".standalone-rank-item");
        const sibling = button.dataset.move === "up" ? item.previousElementSibling : item.nextElementSibling;
        if (!sibling) return;
        if (button.dataset.move === "up") item.parentElement.insertBefore(item, sibling);
        else item.parentElement.insertBefore(sibling, item);
        refreshRanking(container);
      });
    });
    backdrop.querySelector(".standalone-goal-form")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const saved = {
        horizonYears: Number(form.elements.horizonYears.value),
        monthlyContribution: Number(form.elements.monthlyContribution.value),
        assetRanking: [...form.querySelectorAll('[data-ranking="assetRanking"] .standalone-rank-item')].map((item) => item.dataset.value),
        strategyRanking: [...form.querySelectorAll('[data-ranking="strategyRanking"] .standalone-rank-item')].map((item) => item.dataset.value),
      };
      try {
        localStorage.setItem("kb-standalone-preference", JSON.stringify(saved));
      } catch {
        // 일부 브라우저는 file:// 문서의 저장소 사용을 제한합니다.
      }
      const monthlyMetric = [...document.querySelectorAll(".hero-metrics > div")].find((item) => normalizedText(item).includes("월 저축 계획"));
      if (monthlyMetric) monthlyMetric.querySelector("strong").textContent = compactCurrency(saved.monthlyContribution);
      const preferenceMetric = [...document.querySelectorAll(".hero-metrics > div")].find((item) => normalizedText(item).includes("선호 성향"));
      const label = `${assetLabels[saved.assetRanking[0]]}·${strategyLabels[saved.strategyRanking[0]]} 선호`;
      if (preferenceMetric) preferenceMetric.querySelector("strong").textContent = label;
      const pill = document.querySelector(".preference-pill");
      if (pill) pill.textContent = `${label} · ${saved.horizonYears}년`;
      closeModal(backdrop);
      showToast("목표와 선호 설정을 저장했습니다.");
    });
  }

  const tabs = [...document.querySelectorAll(".section-tabs button")];
  const portfolioTab = tabs.find((button) => normalizedText(button).includes("목표 포트폴리오"));
  const rebalanceTab = tabs.find((button) => normalizedText(button).includes("리밸런싱 제안"));
  const portfolioSections = [document.querySelector(".allocation-panel"), document.querySelector(".specification-section")].filter(Boolean);
  const rebalancePanel = document.createElement("section");
  rebalancePanel.className = "panel standalone-rebalance-panel";
  rebalancePanel.hidden = true;
  document.querySelector(".section-tabs")?.insertAdjacentElement("afterend", rebalancePanel);

  function renderRebalance() {
    const available = Number(scenario.cashFlows?.newBankDeposit || 0) + Number(scenario.cashFlows?.securitiesCashAndDividends || 0);
    const candidates = [...document.querySelectorAll(".portfolio-specification tbody tr:not(.specification-detail-row)")]
      .map((row) => ({ row, cells: [...row.querySelectorAll("td")], positive: row.querySelector("td.positive") }))
      .filter((item) => item.positive)
      .slice(0, 3);
    const amount = candidates.length ? Math.floor(available / candidates.length / 10000) * 10000 : 0;
    rebalancePanel.innerHTML = `
      <div class="section-heading"><div><span class="eyebrow">신규자금 우선 활용</span><h2>이번 달 리밸런싱 제안</h2></div><span class="available-pill">${compactCurrency(available)} 활용</span></div>
      <div class="standalone-rebalance-list">
        ${candidates.map((item, index) => `<div><span class="rank-number">${index + 1}</span><p><strong>${escapeHtml(normalizedText(item.cells[0]))}</strong><small>목표 부족 비중 보충</small></p><b>+${compactCurrency(amount)}</b></div>`).join("") || "<p>현재 추가 배분이 필요한 자산군이 없습니다.</p>"}
      </div>
      <div class="standalone-rebalance-note">기존 예·적금은 즉시 해지하지 않고 신규 입금액과 KB증권 예수금을 먼저 활용합니다.</div>`;
  }

  function showPortfolio() {
    portfolioSections.forEach((section) => { section.hidden = false; });
    rebalancePanel.hidden = true;
    portfolioTab?.classList.add("active");
    rebalanceTab?.classList.remove("active");
  }

  function showRebalance() {
    renderRebalance();
    portfolioSections.forEach((section) => { section.hidden = true; });
    rebalancePanel.hidden = false;
    portfolioTab?.classList.remove("active");
    rebalanceTab?.classList.add("active");
    document.querySelector(".section-tabs")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  portfolioTab?.addEventListener("click", showPortfolio);
  rebalanceTab?.addEventListener("click", showRebalance);

  const quickButtons = [...document.querySelectorAll(".quick-actions button")];
  quickButtons.find((button) => normalizedText(button).includes("전체 자산 보기"))?.addEventListener("click", openAssets);
  quickButtons.find((button) => normalizedText(button).includes("목표·성향"))?.addEventListener("click", openGoalSettings);
  quickButtons.find((button) => normalizedText(button).includes("리밸런싱"))?.addEventListener("click", showRebalance);

  document.querySelector(".icon-button")?.addEventListener("click", () => {
    try {
      localStorage.removeItem("kb-standalone-preference");
    } catch {
      // 저장소를 사용할 수 없어도 화면 초기화는 계속합니다.
    }
    window.location.reload();
  });

  document.querySelector(".ai-run-button")?.addEventListener("click", () => {
    openModal("AI 포트폴리오 분석", `
      <p class="standalone-copy">이 단일 HTML은 실제 LLM을 호출하지 않습니다.</p>
      <p class="standalone-copy">현재 화면에는 선호 순위와 투자기간을 반영한 기본 추천이 적용되어 있으며, Gemini·Ollama 분석은 웹앱에서 사용할 수 있습니다.</p>`);
  });

  document.querySelectorAll(".asset-toggle").forEach((button) => {
    button.addEventListener("click", () => {
      const row = button.closest("tr");
      const next = row.nextElementSibling;
      if (next?.classList.contains("standalone-detail-row")) {
        next.remove();
        button.setAttribute("aria-expanded", "false");
        button.querySelector("b").textContent = "+";
        return;
      }
      document.querySelectorAll(".standalone-detail-row").forEach((detail) => detail.remove());
      document.querySelectorAll(".asset-toggle").forEach((item) => {
        item.setAttribute("aria-expanded", "false");
        item.querySelector("b").textContent = "+";
      });
      const cells = [...row.querySelectorAll("td")];
      const detail = document.createElement("tr");
      detail.className = "specification-detail-row standalone-detail-row";
      detail.innerHTML = `<td colspan="7"><div class="specification-detail standalone-spec-detail">
        <div class="detail-reason"><span>자산군</span><strong>${escapeHtml(normalizedText(cells[0]))}</strong><p>현재 ${escapeHtml(normalizedText(cells[1]))}에서 추천 ${escapeHtml(normalizedText(cells[2]))}로 조정하는 예시입니다.</p></div>
        <dl><div><dt>증감</dt><dd>${escapeHtml(normalizedText(cells[3]))}</dd></div><div><dt>KB 상품</dt><dd>${escapeHtml(normalizedText(cells[4]))}</dd></div><div><dt>조치</dt><dd>${escapeHtml(normalizedText(cells[5]))}</dd></div><div><dt>위험</dt><dd>${escapeHtml(normalizedText(cells[6]))}</dd></div></dl>
        <div class="card-actions"><button class="secondary-button standalone-product-detail" type="button">상품 자세히 보기</button><button class="primary-button standalone-channel" type="button">가입·거래 채널 확인</button></div>
      </div></td>`;
      row.insertAdjacentElement("afterend", detail);
      button.setAttribute("aria-expanded", "true");
      button.querySelector("b").textContent = "−";
      detail.querySelector(".standalone-product-detail")?.addEventListener("click", () => openModal("상품 상세 안내", `<p class="standalone-copy">${escapeHtml(normalizedText(cells[4]))}의 금리·위험·보호 여부는 가입 전 최신 상품설명서와 약관을 확인해야 합니다.</p>`));
      detail.querySelector(".standalone-channel")?.addEventListener("click", () => openModal("Mock 이동", '<p class="standalone-copy">KB국민은행 상품은 KB스타뱅킹, 주식·ETF는 KB증권 M-able 거래 화면으로 연결되는 흐름입니다.</p>'));
    });
  });

  document.querySelectorAll(".donut-legend button").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".donut-legend button").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      const label = normalizedText(button).replace(/[\d.]+%$/, "").trim();
      document.querySelectorAll(".portfolio-specification tbody tr:not(.specification-detail-row)").forEach((row) => {
        row.classList.toggle("focused", normalizedText(row.querySelector("td")) === label);
      });
    });
  });

  document.querySelectorAll(".choice-row button").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".choice-row button").forEach((item) => item.classList.remove("standalone-selected"));
      button.classList.add("standalone-selected");
      showToast(`${normalizedText(button)}을 선택했습니다.`);
    });
  });

  const saved = loadPreference();
  let hasSavedPreference = false;
  try {
    hasSavedPreference = Boolean(localStorage.getItem("kb-standalone-preference"));
  } catch {
    hasSavedPreference = false;
  }
  if (hasSavedPreference) {
    const monthlyMetric = [...document.querySelectorAll(".hero-metrics > div")].find((item) => normalizedText(item).includes("월 저축 계획"));
    if (monthlyMetric) monthlyMetric.querySelector("strong").textContent = compactCurrency(saved.monthlyContribution);
    const label = `${assetLabels[saved.assetRanking[0]]}·${strategyLabels[saved.strategyRanking[0]]} 선호`;
    const preferenceMetric = [...document.querySelectorAll(".hero-metrics > div")].find((item) => normalizedText(item).includes("선호 성향"));
    if (preferenceMetric) preferenceMetric.querySelector("strong").textContent = label;
    const pill = document.querySelector(".preference-pill");
    if (pill) pill.textContent = `${label} · ${saved.horizonYears}년`;
  }
})();
