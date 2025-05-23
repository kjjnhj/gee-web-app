// 全局配置
const CONFIG = {
  DEFAULT_VIEW: [29.0, 116.3], // 鄱阳湖默认视角
  DEFAULT_ZOOM: 8,
  MAX_RETRIES: 3,
  RETRY_DELAY: 3000,
  GEE_CLIENT_ID: 'lkls031201' // 替换为你的GEE客户端ID
};

// 全局状态
const state = {
  map: null,
  mapInitialized: false,
  chart: null,
  eeInitialized: false,
  currentAnalysis: null,
  initializationAttempts: 0,
  layers: []
};

// DOM元素引用
const domElements = {
  yearRange: document.getElementById('year-range'),
  analyzeBtn: document.getElementById('analyze-btn'),
  status: document.getElementById('status'),
  mapContainer: document.getElementById('map'),
  chartCanvas: document.getElementById('water-chart')
};

// 初始化UI组件
function initUIComponents() {
  const currentYear = new Date().getFullYear();
  
  domElements.yearRange.innerHTML = '';
  for (let year = 2015; year <= currentYear; year++) {
    const option = document.createElement('option');
    option.value = `${year}-${year}`;
    option.textContent = `${year}年`;
    domElements.yearRange.appendChild(option);
  }
  
  domElements.yearRange.value = `${currentYear-2}-${currentYear}`;
  domElements.yearRange.disabled = false;
  
  // 分析按钮事件绑定
  domElements.analyzeBtn.addEventListener('click', analyzePoyangLake);
  domElements.analyzeBtn.disabled = false;
}

// 更新状态显示
function updateStatus(message, isError = false) {
  if (!domElements.status) return;
  
  domElements.status.textContent = message;
  domElements.status.className = isError ? 'status-error' : 'status-info';
  
  if (isError) {
    console.error(message);
  } else {
    console.log(message);
  }
  
  // 自动隐藏非错误消息
  if (!isError) {
    setTimeout(() => {
      if (domElements.status.textContent === message) {
        domElements.status.textContent = '准备就绪';
      }
    }, 3000);
  }
}

// 清理地图资源
function cleanupMap() {
  // 移除所有图层
  state.layers.forEach(layer => {
    try {
      state.map && state.map.removeLayer(layer);
    } catch (e) {
      console.warn('移除图层失败:', e);
    }
  });
  state.layers = [];
  
  // 移除地图实例
  if (state.map) {
    try {
      state.map.remove();
    } catch (e) {
      console.warn('移除地图实例失败:', e);
    }
    state.map = null;
  }
  
  // 清理DOM残留
  if (domElements.mapContainer && domElements.mapContainer._leaflet_id) {
    L.DomUtil.remove(domElements.mapContainer);
    domElements.mapContainer._leaflet_id = undefined;
  }
  
  state.mapInitialized = false;
}

// 安全初始化地图
function initMap() {
  // 检查是否已经成功初始化
  if (state.mapInitialized) {
    console.warn('地图已经初始化，跳过重复初始化');
    return true;
  }

  // 检查容器是否存在
  if (!domElements.mapContainer) {
    updateStatus('地图容器未找到', true);
    return false;
  }

  try {
    // 清除可能存在的旧实例
    cleanupMap();
    
    // 创建新地图实例
    state.map = L.map('map', {
      preferCanvas: true,
      renderer: L.canvas(),
      zoomControl: false
    }).setView(CONFIG.DEFAULT_VIEW, CONFIG.DEFAULT_ZOOM);
    
    // 添加控制组件
    L.control.zoom({ position: 'topright' }).addTo(state.map);
    
    // 添加底图图层
    const baseLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 18
    }).addTo(state.map);
    state.layers.push(baseLayer);
    
    // 添加Google卫星图层
    const satelliteLayer = L.tileLayer('https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
      attribution: 'Google Satellite',
      maxZoom: 20
    }).addTo(state.map);
    state.layers.push(satelliteLayer);

    state.mapInitialized = true;
    state.initializationAttempts = 0;
    updateStatus('地图初始化成功');
    return true;
  } catch (error) {
    updateStatus(`地图初始化失败: ${error.message}`, true);
    
    // 清理失败实例
    cleanupMap();
    
    // 延迟重试
    state.initializationAttempts++;
    if (state.initializationAttempts < CONFIG.MAX_RETRIES) {
      setTimeout(initMap, CONFIG.RETRY_DELAY);
    } else {
      updateStatus('已达到最大重试次数，初始化失败', true);
    }
    return false;
  }
}

// 加载GEE库
function loadEELibrary() {
  return new Promise((resolve, reject) => {
    if (typeof ee !== 'undefined') {
      resolve();
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://earthengine.googleapis.com/v1/projects/earthengine-legacy/static/js/ee_api_js.js';
    
    script.onload = () => {
      if (typeof ee !== 'undefined') {
        resolve();
      } else {
        reject(new Error('GEE对象未定义'));
      }
    };
    
    script.onerror = () => {
      reject(new Error('无法加载GEE库'));
    };
    
    document.head.appendChild(script);
  });
}

// GEE认证流程
function authenticateGEE() {
  return new Promise((resolve, reject) => {
    if (!window.google || !window.google.accounts) {
      reject(new Error('Google Identity Services未加载'));
      return;
    }

    const tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CONFIG.GEE_CLIENT_ID,
      scope: 'https://www.googleapis.com/auth/earthengine',
      callback: (tokenResponse) => {
        if (tokenResponse?.access_token) {
          ee.data.setAuthToken(
            'auth_token',
            'oauth2', 
            tokenResponse.access_token,
            3600,
            [],
            false
          );
          resolve();
        } else {
          reject(new Error('用户未授权或授权失败'));
        }
      },
      error_callback: (error) => {
        reject(new Error(`认证错误: ${error.message}`));
      }
    });
    
    tokenClient.requestAccessToken({ prompt: 'consent' });
  });
}

// 初始化GEE
async function initializeGEE() {
  try {
    await loadEELibrary();
    await authenticateGEE();
    
    return new Promise((resolve, reject) => {
      ee.initialize(
        null,
        null,
        () => {
          state.eeInitialized = true;
          resolve();
        },
        (error) => reject(error)
      );
    });
  } catch (error) {
    throw new Error(`GEE初始化失败: ${error.message}`);
  }
}

// 获取鄱阳湖边界
function getPoyangLakeBoundary() {
  return ee.FeatureCollection("users/public/poyang_lake_boundary").first().geometry();
}

// 计算水体指数
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
  
  return image.addBands(ndwi).addBands(mndwi).addBands(ndvi).addBands(evi);
}

// 创建水体掩膜
function createWaterMask(image) {
  return image.expression(
    '((mNDWI > EVI) && (mNDWI > NDVI) && (EVI < 0.1)) ? 1 : 0', {
      'mNDWI': image.select('mNDWI'),
      'NDVI': image.select('NDVI'),
      'EVI': image.select('EVI')
    }).rename('water');
}

// 从GEE获取数据
function getEEData(eeObject, property) {
  return new Promise((resolve, reject) => {
    eeObject.aggregate_array(property).evaluate((result, error) => {
      if (error) reject(error);
      else resolve(result);
    });
  });
}

// 获取最新水体影像
async function getLatestWaterImage(geometry) {
  const image = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
    .filterBounds(geometry)
    .filterDate(ee.Date(Date.now()).advance(-3, 'month'), ee.Date(Date.now()))
    .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 10))
    .map(calculateWaterIndices)
    .median();
  
  const waterMask = createWaterMask(image);
  
  const mapId = await new Promise((resolve, reject) => {
    waterMask.getMap({
      min: 0,
      max: 1,
      palette: ['white', 'blue']
    }, (mapId, error) => {
      if (error) reject(error);
      else resolve(mapId);
    });
  });
  
  return {
    layer: L.tileLayer(mapId.url, { attribution: 'Water Mask' }),
    image: waterMask
  };
}

// 时间序列分析
function analyzeTimeSeries(data) {
  const trend = calculateMovingAverage(data, 12);
  const seasonal = calculateSeasonalComponent(data, trend);
  const residual = calculateResidual(data, trend, seasonal);
  
  return { trend, seasonal, residual };
}

// 计算移动平均
function calculateMovingAverage(data, windowSize) {
  const halfWindow = Math.floor(windowSize / 2);
  return data.map((_, i) => {
    const start = Math.max(0, i - halfWindow);
    const end = Math.min(data.length - 1, i + halfWindow);
    const sum = data.slice(start, end + 1).reduce((a, b) => a + b, 0);
    return sum / (end - start + 1);
  });
}

// 计算季节性成分
function calculateSeasonalComponent(data, trend) {
  const monthlyAverages = Array(12).fill(0);
  const monthlyCounts = Array(12).fill(0);
  
  data.forEach((value, i) => {
    const month = i % 12;
    monthlyAverages[month] += (value - trend[i]);
    monthlyCounts[month]++;
  });
  
  for (let i = 0; i < 12; i++) {
    monthlyAverages[i] /= monthlyCounts[i] || 1;
  }
  
  return data.map((_, i) => monthlyAverages[i % 12]);
}

// 计算残差
function calculateResidual(data, trend, seasonal) {
  return data.map((value, i) => value - trend[i] - seasonal[i]);
}

// 渲染图表
function renderChart(labels, observed, trend, seasonal, residual) {
  if (state.chart) {
    state.chart.destroy();
  }
  
  state.chart = new Chart(domElements.chartCanvas, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {
          label: '观测值',
          data: observed,
          borderColor: '#4285F4',
          backgroundColor: 'rgba(66, 133, 244, 0.1)',
          fill: true,
          tension: 0.1
        },
        {
          label: '趋势',
          data: trend,
          borderColor: '#EA4335',
          borderWidth: 2,
          borderDash: [5, 5]
        },
        {
          label: '季节性',
          data: seasonal,
          borderColor: '#34A853',
          borderWidth: 1
        },
        {
          label: '残差',
          data: residual,
          borderColor: '#FBBC05',
          borderWidth: 1
        }
      ]
    },
    options: {
      responsive: true,
      plugins: {
        title: {
          display: true,
          text: '鄱阳湖水体频率时间序列分析'
        },
        tooltip: {
          mode: 'index',
          intersect: false
        }
      },
      scales: {
        x: {
          title: { display: true, text: '日期' },
          ticks: { maxRotation: 45, minRotation: 45 }
        },
        y: {
          title: { display: true, text: '水体面积(平方米)' }
        }
      },
      interaction: {
        mode: 'nearest',
        axis: 'x',
        intersect: false
      }
    }
  });
}

// 分析鄱阳湖水体
async function analyzePoyangLake() {
  if (!state.eeInitialized) {
    updateStatus("GEE未初始化", true);
    return;
  }

  try {
    const yearRange = domElements.yearRange.value.split('-');
    const startYear = parseInt(yearRange[0]);
    const endYear = parseInt(yearRange[1]);
    
    updateStatus(`正在分析${startYear}-${endYear}年鄱阳湖水体...`);
    domElements.analyzeBtn.disabled = true;
    
    // 清除之前的分析结果
    if (state.currentAnalysis) {
      state.map.removeLayer(state.currentAnalysis);
    }
    if (state.chart) {
      state.chart.destroy();
    }
    
    const poyang = getPoyangLakeBoundary();
    const years = ee.List.sequence(startYear, endYear);
    const months = ee.List.sequence(1, 12);
    
    // 获取时间序列数据
    const timeSeries = ee.FeatureCollection(years.map(function(year) {
      return months.map(function(month) {
        const startDate = ee.Date.fromYMD(year, month, 1);
        const endDate = startDate.advance(1, 'month');
        
        const monthlyImage = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
          .filterBounds(poyang)
          .filterDate(startDate, endDate)
          .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 20))
          .map(calculateWaterIndices)
          .median();
        
        const waterMask = createWaterMask(monthlyImage);
        const waterArea = waterMask.multiply(ee.Image.pixelArea()).reduceRegion({
          reducer: ee.Reducer.sum(),
          geometry: poyang,
          scale: 100,
          maxPixels: 1e13
        }).get('water');
        
        return ee.Feature(null, {
          'system:time_start': startDate.millis(),
          'date': startDate.format('YYYY-MM'),
          'FM': waterArea,
          'year': year,
          'month': month
        });
      });
    }).flatten());
    
    // 获取最新影像
    const latestImage = await getLatestWaterImage(poyang);
    state.currentAnalysis = latestImage.layer;
    state.map.addLayer(latestImage.layer);
    
    // 获取时间序列数据
    const dates = await getEEData(timeSeries, 'date');
    const fmValues = await getEEData(timeSeries, 'FM');
    
    // 分析时间序列
    const { trend, seasonal, residual } = analyzeTimeSeries(fmValues);
    
    // 渲染图表
    renderChart(dates, fmValues, trend, seasonal, residual);
    
    updateStatus(`分析完成 (${startYear}-${endYear})`);
  } catch (error) {
    updateStatus(`分析失败: ${error.message}`, true);
  } finally {
    domElements.analyzeBtn.disabled = false;
  }
}

// 主初始化函数
async function initApp() {
  try {
    updateStatus("正在初始化系统...");
    
    // 1. 初始化地图
    if (!initMap()) {
      throw new Error('地图初始化失败');
    }
    
    // 2. 初始化GEE
    let retries = CONFIG.MAX_RETRIES;
    while (retries > 0) {
      try {
        await initializeGEE();
        break;
      } catch (error) {
        retries--;
        if (retries === 0) throw error;
        updateStatus(`初始化失败，${retries}次重试中...`);
        await new Promise(resolve => setTimeout(resolve, CONFIG.RETRY_DELAY));
      }
    }
    
    // 3. 初始化UI组件
    initUIComponents();
    
    updateStatus("系统准备就绪，请选择年份后点击分析按钮");
  } catch (error) {
    updateStatus(`初始化失败: ${error.message}`, true);
  }
}

// 启动应用
window.addEventListener('load', initApp);
