// 全局变量
let map;
let chart;
let eeInitialized = false;
const GEE_CLIENT_ID = '43779976395-dm7nk4h1k9vdqpkpe7mmn4nr3k2easdq.apps.googleusercontent.com';

// 初始化地图
function initMap() {
  try {
    map = L.map('map').setView([29.0, 116.3], 8);
    
    // 添加底图图层
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);
    
    // 添加Google卫星图层
    L.tileLayer('https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
      attribution: 'Google Satellite'
    }).addTo(map);
    
    return true;
  } catch (error) {
    updateStatus("地图初始化失败: " + error.message, true);
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

// 初始化GEE认证
async function initializeGEEAuth() {
  return new Promise((resolve, reject) => {
    if (typeof google === 'undefined' || !google.accounts) {
      reject(new Error('Google Identity Services库未加载'));
      return;
    }
    
    const tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: GEE_CLIENT_ID,
      scope: 'https://www.googleapis.com/auth/earthengine',
      callback: (tokenResponse) => {
        if (tokenResponse && tokenResponse.access_token) {
          // 设置GEE认证令牌
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
          reject(new Error('用户未完成授权或授权失败'));
        }
      },
      error_callback: (error) => {
        reject(new Error(`认证错误: ${error.message}`));
      }
    });
    
    // 请求访问令牌
    tokenClient.requestAccessToken({prompt: 'consent'});
  });
}

// 初始化GEE
async function initializeGEE() {
  try {
    await initializeGEEAuth();
    
    return new Promise((resolve, reject) => {
      ee.initialize(
        null,
        null,
        () => {
          eeInitialized = true;
          resolve();
        },
        (error) => reject(error)
      );
    });
  } catch (error) {
    throw new Error(`GEE初始化错误: ${error.message}`);
  }
}

// 更新状态显示
function updateStatus(message, isError = false) {
  const statusDiv = document.getElementById('status');
  if (!statusDiv) return;
  
  statusDiv.textContent = message;
  statusDiv.className = isError ? 'status-error' : 'status-info';
  
  if (isError) {
    console.error(message);
    
    // 添加重试按钮
    const retryBtn = document.createElement('button');
    retryBtn.className = 'retry-btn';
    retryBtn.textContent = '重试初始化';
    retryBtn.onclick = initApp;
    statusDiv.appendChild(retryBtn);
  } else {
    console.log(message);
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

// 分析鄱阳湖水体
async function analyzePoyangLake() {
  if (!eeInitialized) {
    updateStatus("GEE未初始化", true);
    return;
  }

  try {
    const yearRange = document.getElementById('year-range').value.split('-');
    const startYear = parseInt(yearRange[0]);
    const endYear = parseInt(yearRange[1]);
    
    updateStatus(`正在分析${startYear}-${endYear}年鄱阳湖水体...`);
    
    const poyang = getPoyangLakeBoundary();
    const years = ee.List.sequence(startYear, endYear);
    const months = ee.List.sequence(1, 12);
    
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
    
    // 获取数据用于图表
    const dates = await getEEData(timeSeries, 'date');
    const fmValues = await getEEData(timeSeries, 'FM');
    
    // 季节性分解
    const trend = calculateMovingAverage(fmValues, 12);
    const seasonal = calculateSeasonalComponent(fmValues, trend);
    const residual = calculateResidual(fmValues, trend, seasonal);
    
    // 渲染图表
    renderChart(dates, fmValues, trend, seasonal, residual);
    
    // 显示最新水体影像
    await displayLatestWaterMap();
    
    updateStatus(`分析完成 (${startYear}-${endYear})`);
  } catch (error) {
    updateStatus(`分析失败: ${error.message}`, true);
  }
}

// 时间序列分析方法
function calculateMovingAverage(data, windowSize) {
  const halfWindow = Math.floor(windowSize / 2);
  const trend = [];
  
  for (let i = 0; i < data.length; i++) {
    let sum = 0;
    let count = 0;
    
    for (let j = Math.max(0, i - halfWindow); j <= Math.min(data.length - 1, i + halfWindow); j++) {
      sum += data[j];
      count++;
    }
    
    trend.push(sum / count);
  }
  
  return trend;
}

function calculateSeasonalComponent(data, trend) {
  const seasonal = [];
  const monthlyAverages = Array(12).fill(0);
  const monthlyCounts = Array(12).fill(0);
  
  for (let i = 0; i < data.length; i++) {
    const month = i % 12;
    monthlyAverages[month] += (data[i] - trend[i]);
    monthlyCounts[month]++;
  }
  
  for (let i = 0; i < 12; i++) {
    monthlyAverages[i] /= monthlyCounts[i];
  }
  
  for (let i = 0; i < data.length; i++) {
    seasonal.push(monthlyAverages[i % 12]);
  }
  
  return seasonal;
}

function calculateResidual(data, trend, seasonal) {
  return data.map((value, i) => value - trend[i] - seasonal[i]);
}

// 显示最新水体影像
async function displayLatestWaterMap() {
  try {
    const poyang = getPoyangLakeBoundary();
    const latestImage = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
      .filterBounds(poyang)
      .filterDate(ee.Date(Date.now()).advance(-3, 'month'), ee.Date(Date.now()))
      .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 10))
      .map(calculateWaterIndices)
      .median();
    
    const waterMask = createWaterMask(latestImage);
    
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
    
    if (map && mapId) {
      map.eachLayer(layer => {
        if (layer.options && layer.options.attribution === 'Water Mask') {
          map.removeLayer(layer);
        }
      });
      
      const tileLayer = L.tileLayer(mapId.url, {
        attribution: 'Water Mask'
      }).addTo(map);
    }
  } catch (error) {
    console.error('显示水体影像失败:', error);
  }
}

// 渲染图表
function renderChart(labels, observed, trend, seasonal, residual) {
  const ctx = document.getElementById('water-chart').getContext('2d');
  
  if (chart) {
    chart.destroy();
  }
  
  chart = new Chart(ctx, {
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
          title: {
            display: true,
            text: '日期'
          },
          ticks: {
            maxRotation: 45,
            minRotation: 45
          }
        },
        y: {
          title: {
            display: true,
            text: '水体面积(平方米)'
          }
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

// 初始化年份选择器
function initYearSelector() {
  const yearSelect = document.getElementById('year-range');
  const currentYear = new Date().getFullYear();
  
  yearSelect.innerHTML = '';
  
  for (let year = 2015; year <= currentYear; year++) {
    const option = document.createElement('option');
    option.value = `${year}-${year}`;
    option.textContent = `${year}年`;
    yearSelect.appendChild(option);
  }
  
  yearSelect.value = `${currentYear-2}-${currentYear}`;
}

// 初始化应用
async function initApp() {
  try {
    updateStatus("正在初始化系统...");
    
    // 1. 初始化地图
    if (!initMap()) {
      throw new Error('地图初始化失败');
    }
    
    // 2. 加载GEE库
    await loadEELibrary();
    
    // 3. 初始化GEE认证
    let retries = 3;
    while (retries > 0) {
      try {
        await initializeGEE();
        break;
      } catch (error) {
        retries--;
        if (retries === 0) throw error;
        updateStatus(`初始化失败，${retries}次重试中...`);
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }
    
    // 4. 初始化其他组件
    initYearSelector();
    document.getElementById('analyze-btn').addEventListener('click', analyzePoyangLake);
    
    updateStatus("系统准备就绪，请选择年份后点击分析按钮");
  } catch (error) {
    updateStatus(`初始化失败: ${error.message}`, true);
  }
}

// 启动应用
window.addEventListener('load', initApp);
