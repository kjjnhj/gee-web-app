// app.js 完整内容
let map;
const INIT_RETRIES = 3;
let currentRetry = 0;

function init() {
  if (typeof ee === 'undefined') {
    if (currentRetry < INIT_RETRIES) {
      currentRetry++;
      updateStatus(`正在加载Earth Engine API (尝试 ${currentRetry}/${INIT_RETRIES})...`);
      setTimeout(init, 2000);
      return;
    } else {
      showError("Earth Engine API加载失败，请刷新页面重试");
      return;
    }
  }

  ee.initialize(
    null,
    null,
    () => {
      updateStatus("正在加载地图...");
      initMap();
    },
    (err) => {
      handleInitError(err);
    },
    { 
      timeout: 10000,
      rerun: true
    }
  );
}

function initMap() {
  map = new google.maps.Map(document.getElementById("map"), {
    center: { lat: 28.6, lng: 115.8 }, // 鄱阳湖坐标
    zoom: 8,
    mapTypeId: "hybrid"
  });

  // 示例：加载Sentinel-2影像
  loadSentinel2Image();
}

function loadSentinel2Image() {
  const image = ee.ImageCollection('COPERNICUS/S2_SR')
    .filterDate('2023-01-01', '2023-12-31')
    .median();
  
  const visParams = { bands: ['B4', 'B3', 'B2'], min: 0, max: 3000 };
  
  image.getMap(visParams, ({ mapid, token }) => {
    const tileUrl = `https://earthengine.googleapis.com/map/${mapid}/{z}/{x}/{y}?token=${token}`;
    
    new google.maps.ImageMapType({
      getTileUrl: (coord, zoom) => tileUrl
        .replace('{x}', coord.x)
        .replace('{y}', coord.y)
        .replace('{z}', zoom),
      tileSize: new google.maps.Size(256, 256),
      name: 'Sentinel-2'
    });
  });
}

function updateStatus(message) {
  document.getElementById('status').textContent = message;
}

function showError(message, action) {
  const statusEl = document.getElementById('status');
  statusEl.textContent = message;
  statusEl.style.backgroundColor = '#ffebee';
  statusEl.style.color = '#c62828';
  
  if (action) {
    const btn = document.createElement('button');
    btn.textContent = '重试';
    btn.onclick = action;
    statusEl.appendChild(btn);
  }
}

function handleInitError(err) {
  if (err.message.includes('Not logged in')) {
    showError("请完成Earth Engine认证", () => {
      ee.authenticate(
        () => location.reload(),
        (authErr) => showError(`认证失败: ${authErr.message}`)
      );
    });
  } else {
    showError(`初始化失败: ${err.message}`);
  }
}

// 启动应用
window.onload = init;