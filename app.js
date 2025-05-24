// 全局配置
const CONFIG = {
  MAP_ID: "8ad8db94521eb93e4adf16dc",
  DEFAULT_VIEW: { lat: 29.0, lng: 116.3 },
  DEFAULT_ZOOM: 8,
  GEE_CLIENT_ID: "43779976395-dm7nk4h1k9vdqpkpe7mmn4nr3k2easdq.apps.googleusercontent.com",
  ANALYSIS_YEARS: [2015, new Date().getFullYear()],
  WATER_THRESHOLDS: {
    mNDWI: 0.1,
    EVI: 0.2,
    NDVI: 0.3
  }
};

// 全局状态
const state = {
  eeInitialized: false,
  currentAnalysis: null,
  map: null
};

// DOM元素引用
const dom = {
  status: document.getElementById('status'),
  analyzeBtn: document.getElementById('analyze-btn'),
  visualizeBtn: document.getElementById('visualize-btn'),
  yearRange: document.getElementById('year-range')
};

// 水体指数计算
function calculateWaterIndices(image) {
  const ndwi = image.normalizedDifference(['B3', 'B8']).rename('NDWI');
  const mndwi = image.normalizedDifference(['B3', 'B11']).rename('mNDWI');
  const ndvi = image.normalizedDifference(['B8', 'B4']).rename('NDVI');
  
  const evi = image.expression(
    '2.5 * ((NIR - RED) / (NIR + 6 * RED - 7.5 * BLUE + 1))', {
      'NIR': image.select('B8'),
      'RED': image.select('B4'),
      'BLUE': image.select('B2')
    }).rename('EVI');

  const waterMask = image.expression(
    '(mNDWI > mNDWI_TH) && (EVI < EVI_TH) && (NDVI < NDVI_TH)', {
      'mNDWI': mndwi,
      'EVI': evi,
      'NDVI': ndvi,
      'mNDWI_TH': CONFIG.WATER_THRESHOLDS.mNDWI,
      'EVI_TH': CONFIG.WATER_THRESHOLDS.EVI,
      'NDVI_TH': CONFIG.WATER_THRESHOLDS.NDVI
    }).rename('water');

  return image
    .addBands(ndwi)
    .addBands(mndwi)
    .addBands(ndvi)
    .addBands(evi)
    .addBands(waterMask);
}

// 获取水体数据
async function getWaterData(geometry, startYear, endYear) {
  const years = ee.List.sequence(startYear, endYear);
  const months = ee.List.sequence(1, 12);

  return ee.FeatureCollection(years.map(year => {
    return months.map(month => {
      const startDate = ee.Date.fromYMD(year, month, 1);
      const endDate = startDate.advance(1, 'month');
      
      const image = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
        .filterBounds(geometry)
        .filterDate(startDate, endDate)
        .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 20))
        .map(calculateWaterIndices)
        .median();

      const waterArea = image.select('water')
        .multiply(ee.Image.pixelArea())
        .reduceRegion({
          reducer: ee.Reducer.sum(),
          geometry: geometry,
          scale: 100,
          maxPixels: 1e13
        }).get('water');

      return ee.Feature(null, {
        date: startDate.format('YYYY-MM'),
        waterArea: waterArea,
        year: year,
        month: month,
        indices: image.select(['NDWI', 'mNDWI', 'EVI']).reduceRegion({
          geometry: geometry.center(10),
          reducer: ee.Reducer.mean(),
          scale: 100
        })
      });
    });
  }).flatten());
}

// 可视化水体掩膜
async function visualizeWaterMask() {
  if (!state.eeInitialized) {
    updateStatus("GEE未初始化", "error");
    return;
  }

  try {
    updateStatus("生成水体掩膜...", "info");
    
    const lakeBoundary = ee.FeatureCollection("users/public/poyang_lake_boundary").first().geometry();
    const latestImage = await getLatestImage(lakeBoundary);
    const waterMask = latestImage.select('water');
    
    if (state.currentAnalysis) {
      state.map.overlayMapTypes.removeAt(0);
    }
    
    const visParams = {
      min: 0,
      max: 1,
      palette: ['00000000', '4186F0'],
      opacity: 0.7
    };
    
    const mapId = await getMapId(waterMask, visParams);
    const tileLayer = new google.maps.ImageMapType({
      getTileUrl: (coord, zoom) => `${mapId.url}&x=${coord.x}&y=${coord.y}&z=${zoom}`,
      tileSize: new google.maps.Size(256, 256),
      opacity: 0.7
    });
    
    state.map.overlayMapTypes.push(tileLayer);
    state.currentAnalysis = tileLayer;
    updateStatus("水体掩膜已显示", "success");

  } catch (error) {
    console.error(error);
    updateStatus("可视化失败: " + error.message, "error");
  }
}

// 辅助函数：获取地图ID
function getMapId(image, visParams) {
  return new Promise((resolve, reject) => {
    image.getMap(visParams, (mapId, error) => {
      if (error) reject(error);
      else resolve(mapId);
    });
  });
}

// 获取最新影像
async function getLatestImage(geometry) {
  return ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
    .filterBounds(geometry)
    .filterDate(ee.Date(Date.now()).advance(-3, 'month'), ee.Date(Date.now()))
    .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 10))
    .map(calculateWaterIndices)
    .median();
}

// 渲染图表
function renderChart(dates, areas) {
  const ctx = document.getElementById('water-chart').getContext('2d');
  
  // 如果已有图表实例则销毁
  if (window.waterChart) {
    window.waterChart.destroy();
  }
  
  window.waterChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: dates,
      datasets: [{
        label: '水体面积 (m²)',
        data: areas,
        borderColor: '#4186F0',
        backgroundColor: 'rgba(65, 134, 240, 0.1)',
        borderWidth: 2,
        fill: true
      }]
    },
    options: {
      responsive: true,
      scales: {
        y: {
          beginAtZero: true,
          title: {
            display: true,
            text: '面积 (m²)'
          }
        },
        x: {
          title: {
            display: true,
            text: '日期'
          }
        }
      }
    }
  });
}

// 分析主函数
async function analyze() {
  try {
    setLoading(true);
    updateStatus("分析中...", "info");
    
    const [startYear, endYear] = dom.yearRange.value.split('-').map(Number);
    const lakeBoundary = ee.FeatureCollection("users/public/poyang_lake_boundary").first().geometry();
    
    await visualizeWaterMask();
    
    const data = await getWaterData(lakeBoundary, startYear, endYear);
    const dates = await data.aggregate_array('date').evaluate();
    const areas = await data.aggregate_array('waterArea').evaluate();
    
    renderChart(dates, areas);
    updateStatus(`分析完成 (${startYear}-${endYear})`, "success");

  } catch (error) {
    console.error(error);
    updateStatus("分析失败: " + error.message, "error");
  } finally {
    setLoading(false);
  }
}

// 更新状态显示
function updateStatus(message, type = "info") {
  dom.status.textContent = message;
  dom.status.className = "status-" + type;
}

// 设置加载状态
function setLoading(isLoading) {
  dom.analyzeBtn.disabled = isLoading;
  dom.visualizeBtn.disabled = isLoading;
  dom.yearRange.disabled = isLoading;
}

// 初始化地图
async function initMap() {
  return new Promise((resolve) => {
    google.maps.importLibrary("maps").then(() => {
      state.map = new google.maps.Map(document.getElementById('map'), {
        center: CONFIG.DEFAULT_VIEW,
        zoom: CONFIG.DEFAULT_ZOOM,
        mapId: CONFIG.MAP_ID
      });
      state.eeInitialized = true;
      resolve();
    });
  });
}

// 初始化应用
async function initApp() {
  try {
    await initMap();
    
    // 初始化年份选择器
    const currentYear = new Date().getFullYear();
    dom.yearRange.innerHTML = '';
    for (let year = CONFIG.ANALYSIS_YEARS[0]; year <= currentYear; year++) {
      const option = document.createElement('option');
      option.value = year;
      option.textContent = year;
      dom.yearRange.appendChild(option);
    }
    
    // 设置默认选中最近一年
    dom.yearRange.value = `${currentYear-1}-${currentYear}`;
    
    // 启用控件
    dom.yearRange.disabled = false;
    dom.analyzeBtn.disabled = false;
    dom.visualizeBtn.disabled = false;
    
    // 绑定事件
    dom.analyzeBtn.addEventListener('click', analyze);
    dom.visualizeBtn.addEventListener('click', visualizeWaterMask);
    
    updateStatus("准备就绪", "success");

  } catch (error) {
    console.error(error);
    updateStatus("初始化失败: " + error.message, "error");
  }
}

// 暴露初始化函数供HTML调用
window.initApp = initApp;
