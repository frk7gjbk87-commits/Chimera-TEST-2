const DEFAULT_SETTINGS = {
  dockPosition: "bottom",
  dockAutoHide: false,
  wallpaperMode: "default",
  wallpaperUrl: ""
};

const SETTINGS_KEY = "chimeraDesktopSettingsV1";
const ASSET_DB_NAME = "chimeraDesktopAssets";
const ASSET_STORE_NAME = "assets";
const ASSET_WALLPAPER_ID = "wallpaper";

const FALLBACK_BACKEND = window.location.hostname.includes("github.io")
  ? "https://chimera-test-2.onrender.com"
  : "http://localhost:4000";

if (!localStorage.getItem("chimeraBackendUrl")) {
  localStorage.setItem("chimeraBackendUrl", FALLBACK_BACKEND);
}

const desktop = document.getElementById("desktop");
const workspace = document.getElementById("workspace");
const dock = document.getElementById("dock");
const dockPeek = document.getElementById("dock-peek");
const activeAppLabel = document.getElementById("active-app-label");
const timeLabel = document.getElementById("time-label");
const networkLabel = document.getElementById("network-label");
const batteryLabel = document.getElementById("battery-label");
const deviceLabel = document.getElementById("device-label");
const wallpaperImage = document.getElementById("wallpaper-image");
const wallpaperVideo = document.getElementById("wallpaper-video");

const dockPositionSelect = document.getElementById("dock-position");
const dockAutoHideInput = document.getElementById("dock-autohide");
const wallpaperUrlInput = document.getElementById("wallpaper-url");
const wallpaperUploadInput = document.getElementById("wallpaper-upload");
const applyWallpaperUrlBtn = document.getElementById("apply-wallpaper-url");
const clearWallpaperUrlBtn = document.getElementById("clear-wallpaper-url");
const resetWallpaperBtn = document.getElementById("reset-wallpaper");

const windowsByApp = {
  notes: document.getElementById("window-notes"),
  ai: document.getElementById("window-ai"),
  settings: document.getElementById("window-settings")
};

let settings = loadSettings();
let topZIndex = 30;
let dockHideTimer = null;
let dockRevealTimer = null;
let dragState = null;
let wallpaperObjectUrl = "";

function clamp(value, min, max) {
  return Math.max(min, Math.min(value, max));
}

function loadSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    return { ...DEFAULT_SETTINGS, ...raw };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function setActiveAppLabel(appId) {
  const labelMap = {
    notes: "Chimera Notes",
    ai: "Chimera AI",
    settings: "Desktop Settings"
  };

  activeAppLabel.textContent = labelMap[appId] || "Desktop";
}

function bringWindowToFront(appWindow) {
  if (!appWindow) return;
  topZIndex += 1;
  appWindow.style.zIndex = String(topZIndex);
  const appId = appWindow.dataset.app;
  setActiveAppLabel(appId);
}

function openWindow(appId) {
  const appWindow = windowsByApp[appId];
  if (!appWindow) return;
  appWindow.classList.remove("hidden");
  bringWindowToFront(appWindow);
}

function hideWindow(appWindow) {
  if (!appWindow) return;
  appWindow.classList.add("hidden");
  const visible = Object.values(windowsByApp).find(
    (windowEl) => !windowEl.classList.contains("hidden")
  );
  if (!visible) {
    setActiveAppLabel("desktop");
    return;
  }
  setActiveAppLabel(visible.dataset.app);
}

function toggleWindowMaximize(appWindow) {
  if (!appWindow) return;

  if (appWindow.classList.contains("maximized")) {
    appWindow.classList.remove("maximized");
    if (appWindow.dataset.prevTop) appWindow.style.top = appWindow.dataset.prevTop;
    if (appWindow.dataset.prevLeft) appWindow.style.left = appWindow.dataset.prevLeft;
    if (appWindow.dataset.prevWidth) appWindow.style.width = appWindow.dataset.prevWidth;
    if (appWindow.dataset.prevHeight) appWindow.style.height = appWindow.dataset.prevHeight;
    return;
  }

  appWindow.dataset.prevTop = appWindow.style.top;
  appWindow.dataset.prevLeft = appWindow.style.left;
  appWindow.dataset.prevWidth = appWindow.style.width;
  appWindow.dataset.prevHeight = appWindow.style.height;
  appWindow.classList.add("maximized");
  bringWindowToFront(appWindow);
}

function initWindowInteractions(appWindow) {
  if (!appWindow) return;

  const dragHandle = appWindow.querySelector("[data-drag-handle]");
  const buttons = appWindow.querySelectorAll(".window-btn");

  buttons.forEach((button) => {
    const action = button.dataset.action;
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      if (action === "close" || action === "min") {
        hideWindow(appWindow);
      }
      if (action === "max") {
        toggleWindowMaximize(appWindow);
      }
    });
  });

  appWindow.addEventListener("mousedown", () => bringWindowToFront(appWindow));

  if (!dragHandle) {
    return;
  }

  dragHandle.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".window-btn")) {
      return;
    }

    if (appWindow.classList.contains("maximized")) {
      return;
    }

    bringWindowToFront(appWindow);
    const rect = appWindow.getBoundingClientRect();
    dragState = {
      appWindow,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top
    };
    dragHandle.setPointerCapture(event.pointerId);
  });

  dragHandle.addEventListener("pointerup", (event) => {
    if (dragState) {
      dragState = null;
    }
    try {
      dragHandle.releasePointerCapture(event.pointerId);
    } catch {
      // Ignore pointer release issues.
    }
  });
}

document.addEventListener("pointermove", (event) => {
  if (!dragState) {
    return;
  }

  const menuHeight = 56;
  const windowEl = dragState.appWindow;
  const width = windowEl.offsetWidth;
  const height = windowEl.offsetHeight;

  const maxLeft = window.innerWidth - width - 8;
  const maxTop = window.innerHeight - height - 8;

  const nextLeft = clamp(event.clientX - dragState.offsetX, 8, Math.max(8, maxLeft));
  const nextTop = clamp(event.clientY - dragState.offsetY, menuHeight, Math.max(menuHeight, maxTop));

  windowEl.style.left = `${nextLeft}px`;
  windowEl.style.top = `${nextTop}px`;
});

document.addEventListener("pointerup", () => {
  dragState = null;
});

function updateDockPositionClasses() {
  dock.classList.remove("bottom", "left", "right");
  dock.classList.add(settings.dockPosition);

  dockPeek.classList.remove("bottom", "left", "right", "hidden");
  dockPeek.classList.add(settings.dockPosition);

  if (!settings.dockAutoHide) {
    dockPeek.classList.add("hidden");
  }
}

function revealDock(duration = 1800) {
  if (!settings.dockAutoHide) {
    dock.classList.remove("autohide");
    dock.classList.add("revealed");
    return;
  }

  dock.classList.add("revealed");
  if (dockHideTimer) {
    clearTimeout(dockHideTimer);
    dockHideTimer = null;
  }

  if (duration > 0) {
    dockHideTimer = setTimeout(() => {
      dock.classList.remove("revealed");
      dockHideTimer = null;
    }, duration);
  }
}

function hideDockSoon(delay = 650) {
  if (!settings.dockAutoHide) {
    return;
  }

  if (dockHideTimer) {
    clearTimeout(dockHideTimer);
  }

  dockHideTimer = setTimeout(() => {
    dock.classList.remove("revealed");
    dockHideTimer = null;
  }, delay);
}

function applyDockSettings() {
  updateDockPositionClasses();

  if (settings.dockAutoHide) {
    dock.classList.add("autohide");
    dock.classList.remove("revealed");
    revealDock(1200);
  } else {
    dock.classList.remove("autohide");
    dock.classList.add("revealed");
  }
}

function openAssetsDb() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error("IndexedDB unavailable"));
      return;
    }

    const request = indexedDB.open(ASSET_DB_NAME, 1);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(ASSET_STORE_NAME)) {
        database.createObjectStore(ASSET_STORE_NAME, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function writeWallpaperAsset(blob, mediaType) {
  const database = await openAssetsDb();

  await new Promise((resolve, reject) => {
    const transaction = database.transaction(ASSET_STORE_NAME, "readwrite");
    transaction.objectStore(ASSET_STORE_NAME).put({
      id: ASSET_WALLPAPER_ID,
      blob,
      mediaType,
      updatedAt: Date.now()
    });
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });

  database.close();
}

async function readWallpaperAsset() {
  const database = await openAssetsDb();

  const payload = await new Promise((resolve, reject) => {
    const transaction = database.transaction(ASSET_STORE_NAME, "readonly");
    const request = transaction.objectStore(ASSET_STORE_NAME).get(ASSET_WALLPAPER_ID);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });

  database.close();
  return payload;
}

async function clearWallpaperAsset() {
  const database = await openAssetsDb();

  await new Promise((resolve, reject) => {
    const transaction = database.transaction(ASSET_STORE_NAME, "readwrite");
    transaction.objectStore(ASSET_STORE_NAME).delete(ASSET_WALLPAPER_ID);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });

  database.close();
}

function clearWallpaperObjectUrl() {
  if (wallpaperObjectUrl) {
    URL.revokeObjectURL(wallpaperObjectUrl);
    wallpaperObjectUrl = "";
  }
}

function inferUrlMode(url) {
  const lowered = String(url || "").toLowerCase();
  const isVideo = /(\.mp4|\.webm|\.ogg|\.mov|\.m4v)(\?|#|$)/.test(lowered);
  return isVideo ? "video-url" : "image-url";
}

function applyImageWallpaper(url) {
  wallpaperVideo.pause();
  wallpaperVideo.removeAttribute("src");
  wallpaperVideo.load();
  wallpaperVideo.style.display = "none";

  wallpaperImage.style.backgroundImage = `url("${url}")`;
  wallpaperImage.style.backgroundSize = "cover";
  wallpaperImage.style.backgroundPosition = "center";
}

function applyVideoWallpaper(url) {
  wallpaperImage.style.backgroundImage = "";
  wallpaperVideo.style.display = "block";
  if (wallpaperVideo.src !== url) {
    wallpaperVideo.src = url;
  }
  wallpaperVideo.play().catch(() => {
    // Autoplay can be blocked; muted + playsinline is still set.
  });
}

function applyDefaultWallpaper() {
  wallpaperVideo.pause();
  wallpaperVideo.removeAttribute("src");
  wallpaperVideo.load();
  wallpaperVideo.style.display = "none";

  wallpaperImage.style.backgroundImage = "";
  wallpaperImage.style.backgroundSize = "";
  wallpaperImage.style.backgroundPosition = "";
}

async function applyWallpaperFromSettings() {
  clearWallpaperObjectUrl();

  try {
    if (settings.wallpaperMode === "default") {
      applyDefaultWallpaper();
      return;
    }

    if (settings.wallpaperMode === "image-url" && settings.wallpaperUrl) {
      applyImageWallpaper(settings.wallpaperUrl);
      return;
    }

    if (settings.wallpaperMode === "video-url" && settings.wallpaperUrl) {
      applyVideoWallpaper(settings.wallpaperUrl);
      return;
    }

    if (settings.wallpaperMode === "upload-image" || settings.wallpaperMode === "upload-video") {
      const payload = await readWallpaperAsset();
      if (!payload?.blob) {
        settings.wallpaperMode = "default";
        saveSettings();
        applyDefaultWallpaper();
        return;
      }

      wallpaperObjectUrl = URL.createObjectURL(payload.blob);
      if (settings.wallpaperMode === "upload-video") {
        applyVideoWallpaper(wallpaperObjectUrl);
      } else {
        applyImageWallpaper(wallpaperObjectUrl);
      }
      return;
    }

    applyDefaultWallpaper();
  } catch (error) {
    console.error("Failed to apply wallpaper:", error);
    applyDefaultWallpaper();
  }
}

function hydrateSettingsUi() {
  dockPositionSelect.value = settings.dockPosition;
  dockAutoHideInput.checked = Boolean(settings.dockAutoHide);
  wallpaperUrlInput.value = settings.wallpaperUrl || "";
}

function detectDeviceName() {
  const userAgent = navigator.userAgent;
  if (/CrOS/i.test(userAgent)) return "Chromebook";
  if (/Macintosh|Mac OS X/i.test(userAgent)) return "Mac";
  if (/Windows NT/i.test(userAgent)) return "Windows PC";
  if (/Android/i.test(userAgent)) return "Android";
  if (/iPhone|iPad|iPod/i.test(userAgent)) return "iPhone/iPad";
  if (/Linux/i.test(userAgent)) return "Linux";
  return "Web Device";
}

function updateDeviceInfo() {
  deviceLabel.textContent = `Device: ${detectDeviceName()}`;
}

function describeNetwork() {
  if (!navigator.onLine) {
    return "Offline";
  }

  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  const rawType = String(connection?.type || connection?.effectiveType || "Online").toLowerCase();

  if (rawType.includes("wifi")) return "Wi-Fi";
  if (rawType.includes("ethernet")) return "Ethernet";
  if (
    rawType.includes("cell") ||
    rawType.includes("2g") ||
    rawType.includes("3g") ||
    rawType.includes("4g") ||
    rawType.includes("5g")
  ) {
    return `Cellular ${rawType.toUpperCase()}`;
  }

  return "Online";
}

function updateNetworkInfo() {
  networkLabel.textContent = `Network: ${describeNetwork()}`;
}

function updateClock() {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat([], {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit"
  });
  timeLabel.textContent = formatter.format(now);
}

async function initBatteryInfo() {
  if (!navigator.getBattery) {
    batteryLabel.textContent = "Battery: n/a";
    return;
  }

  try {
    const battery = await navigator.getBattery();
    const render = () => {
      const percentage = Math.round((battery.level || 0) * 100);
      const chargeState = battery.charging ? "charging" : "battery";
      batteryLabel.textContent = `Battery: ${percentage}% (${chargeState})`;
    };

    render();
    battery.addEventListener("chargingchange", render);
    battery.addEventListener("levelchange", render);
  } catch {
    batteryLabel.textContent = "Battery: n/a";
  }
}

function initMenuBarInfo() {
  updateDeviceInfo();
  updateNetworkInfo();
  updateClock();
  initBatteryInfo();

  setInterval(updateClock, 1000);
  window.addEventListener("online", updateNetworkInfo);
  window.addEventListener("offline", updateNetworkInfo);

  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (connection && typeof connection.addEventListener === "function") {
    connection.addEventListener("change", updateNetworkInfo);
  }
}

function initDockBehavior() {
  dockPeek.addEventListener("click", () => revealDock(2400));

  dock.addEventListener("mouseenter", () => {
    if (!settings.dockAutoHide) return;
    revealDock(0);
  });

  dock.addEventListener("mouseleave", () => {
    hideDockSoon(650);
  });

  document.addEventListener("mousemove", (event) => {
    if (!settings.dockAutoHide) return;

    const edgeThreshold = 8;
    const x = event.clientX;
    const y = event.clientY;

    if (settings.dockPosition === "bottom" && y >= window.innerHeight - edgeThreshold) {
      revealDock(1400);
      return;
    }

    if (settings.dockPosition === "left" && x <= edgeThreshold) {
      revealDock(1400);
      return;
    }

    if (settings.dockPosition === "right" && x >= window.innerWidth - edgeThreshold) {
      revealDock(1400);
    }
  });

  document.querySelectorAll("[data-app-launch]").forEach((button) => {
    button.addEventListener("click", () => {
      const appId = button.dataset.appLaunch;
      openWindow(appId);
      revealDock(1200);
    });
  });
}

function initSettingsEvents() {
  dockPositionSelect.addEventListener("change", () => {
    settings.dockPosition = dockPositionSelect.value;
    saveSettings();
    applyDockSettings();
  });

  dockAutoHideInput.addEventListener("change", () => {
    settings.dockAutoHide = dockAutoHideInput.checked;
    saveSettings();
    applyDockSettings();
  });

  applyWallpaperUrlBtn.addEventListener("click", async () => {
    const value = wallpaperUrlInput.value.trim();
    if (!value) {
      return;
    }

    settings.wallpaperUrl = value;
    settings.wallpaperMode = inferUrlMode(value);
    saveSettings();
    await applyWallpaperFromSettings();
  });

  clearWallpaperUrlBtn.addEventListener("click", async () => {
    wallpaperUrlInput.value = "";
    settings.wallpaperUrl = "";

    if (settings.wallpaperMode === "image-url" || settings.wallpaperMode === "video-url") {
      settings.wallpaperMode = "default";
    }

    saveSettings();
    await applyWallpaperFromSettings();
  });

  wallpaperUploadInput.addEventListener("change", async () => {
    const file = wallpaperUploadInput.files && wallpaperUploadInput.files[0];
    if (!file) {
      return;
    }

    const isVideo = String(file.type).startsWith("video/");

    try {
      await writeWallpaperAsset(file, file.type || "application/octet-stream");
      settings.wallpaperMode = isVideo ? "upload-video" : "upload-image";
      settings.wallpaperUrl = "";
      wallpaperUrlInput.value = "";
      saveSettings();
      await applyWallpaperFromSettings();
    } catch (error) {
      console.error("Could not save uploaded wallpaper:", error);
    }
  });

  resetWallpaperBtn.addEventListener("click", async () => {
    settings.wallpaperMode = "default";
    settings.wallpaperUrl = "";
    wallpaperUrlInput.value = "";
    saveSettings();
    await clearWallpaperAsset().catch(() => {});
    await applyWallpaperFromSettings();
  });
}

function initWindowSystem() {
  Object.values(windowsByApp).forEach((windowEl) => initWindowInteractions(windowEl));

  Object.values(windowsByApp).forEach((windowEl) => {
    windowEl.addEventListener("mousedown", () => bringWindowToFront(windowEl));
    windowEl.addEventListener("focusin", () => bringWindowToFront(windowEl));
  });

  openWindow("notes");
}

function initDockRevealResetOnBlur() {
  window.addEventListener("blur", () => {
    if (!settings.dockAutoHide) {
      return;
    }

    if (dockRevealTimer) {
      clearTimeout(dockRevealTimer);
      dockRevealTimer = null;
    }

    hideDockSoon(200);
  });
}

async function init() {
  if (!desktop || !workspace || !dock) {
    return;
  }

  hydrateSettingsUi();
  applyDockSettings();
  await applyWallpaperFromSettings();
  initMenuBarInfo();
  initWindowSystem();
  initDockBehavior();
  initSettingsEvents();
  initDockRevealResetOnBlur();

  setActiveAppLabel("notes");
}

init();
