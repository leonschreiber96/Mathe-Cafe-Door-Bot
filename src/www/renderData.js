const kpiNodes = {
   openToday: document.getElementById("kpi-open-today"),
   firstOpened: document.getElementById("kpi-first-opened"),
   currentShift: document.getElementById("kpi-current-shift"),
   openingStreak: document.getElementById("kpi-opening-streak"),
};

function renderKpis(kpis) {
   kpiNodes.openToday.innerText = kpis.openToday;
   kpiNodes.firstOpened.innerText = kpis.firstOpened;
   kpiNodes.currentShift.innerText = kpis.currentShift;
   kpiNodes.openingStreak.innerText = `${kpis.openingStreak} 🔥`;
}
