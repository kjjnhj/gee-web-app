// 全局配置
const CONFIG = {
  MAP_ID: "8ad8db94521eb93e4adf16dc",
  DEFAULT_VIEW: { lat: 29.0, lng: 116.3 },
  DEFAULT_ZOOM: 8,
  GEE_CLIENT_ID: "43779976395-dm7nk4h1k9vdqpkpe7mmn4nr3k2easdq.apps.googleusercontent.com",
  ANALYSIS_YEARS: [2015, new Date().getFullYear()],
  // 新增水体检测阈值配置
  WATER_THRESHOLDS: {
    mNDWI: 0.1,
    EVI: 0.2,
    NDVI: 0.3
  }
};

// 水体指数计算（改进版，包含EVI）
function calculateWaterIndices(image) {
  // 基础指数计算
  const ndwi = image.normalizedDifference(['B3', 'B8']).rename('NDWI');
  const mndwi = image.normalizedDifference(['B3', 'B11']).rename('mNDWI');
  const ndvi = image.normalizedDifference(['B8', 'B4']).rename('NDVI');
  
  // EVI计算（增强型植被指数）
  const evi = image.expression(
    '2.5 * ((NIR - RED) / (NIR + 6 * RED - 7.5 * BLUE + 1))', {
      'NIR': image.select('B8'),
      'RED': image.select('B4'),
      'BLUE': image.select('B2')
    }).rename('EVI');

  // 组合水体掩膜（结合EVI优化）
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

// 获取水体数据（改进版）
async function getWaterData(geometry, startYear, endYear) {
  const years = ee.List.sequence(startYear, endYear);
  const months = ee.List.sequence(1, 12);

  return ee.FeatureCollection(years.map(year => {
    return months.map(month => {
      const startDate = ee.Date.fromYMD(year, month, 1);
      const endDate = startDate.advance(1, 'month');
      
      // 获取并处理影像
      const image = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
        .filterBounds(geometry)
        .filterDate(startDate, endDate)
        .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 20))
        .map(calculateWaterIndices)
        .median();

      // 使用EVI优化的水体掩膜
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
        // 添加指数均值用于调试
        indices: image.select(['NDWI', 'mNDWI', 'EVI']).reduceRegion({
          geometry: geometry.center(10), // 使用中心点附近区域
          reducer: ee.Reducer.mean(),
          scale: 100
        })
      });
    });
  }).flatten());
}

// 新增可视化函数
async function visualizeWaterMask() {
  if (!state.eeInitialized) {
    dom.status.textContent = "GEE未初始化";
    return;
  }

  try {
    dom.status.textContent = "生成水体掩膜...";
    const lakeBoundary = ee.FeatureCollection("users/public/poyang_lake_boundary").first().geometry();
    const latestImage = await getLatestImage(lakeBoundary);
    
    // 获取带EVI的水体掩膜
    const waterMask = latestImage.select('water');
    
    // 移除旧的水体图层
    if (state.currentAnalysis) {
      state.map.overlayMapTypes.removeAt(0);
    }
    
    // 可视化参数
    const visParams = {
      min: 0,
      max: 1,
      palette: ['00000000', '4186F0'], // 透明背景+蓝色水体
      opacity: 0.7
    };
    
    // 创建地图图层
    const mapId = await getMapId(waterMask, visParams);
    const tileLayer = new google.maps.ImageMapType({
      getTileUrl: (coord, zoom) => {
        return `${mapId.url}&x=${coord.x}&y=${coord.y}&z=${zoom}`;
      },
      tileSize: new google.maps.Size(256, 256),
      opacity: 0.7
    });
    
    // 添加到地图
    state.map.overlayMapTypes.push(tileLayer);
    state.currentAnalysis = tileLayer;
    dom.status.textContent = "水体掩膜已显示";

  } catch (error) {
    console.error(error);
    dom.status.textContent = "可视化失败: " + error.message;
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

// 修改后的分析主函数
async function analyze() {
  try {
    dom.analyzeBtn.disabled = true;
    dom.status.textContent = "分析中...";

    const [startYear, endYear] = dom.yearRange.value.split('-').map(Number);
    const lakeBoundary = ee.FeatureCollection("users/public/poyang_lake_boundary").first().geometry();
    
    // 可视化当前水体
    await visualizeWaterMask();
    
    // 获取时间序列数据
    const data = await getWaterData(lakeBoundary, startYear, endYear);
    const dates = await data.aggregate_array('date').evaluate();
    const areas = await data.aggregate_array('waterArea').evaluate();
    
    // 调试输出指数平均值
    const sampleStats = await data.first().get('indices').evaluate();
    console.log('指数平均值:', sampleStats);

    // 渲染结果
    renderChart(dates, areas);
    dom.status.textContent = `分析完成 (${startYear}-${endYear})`;

  } catch (error) {
    console.error(error);
    dom.status.textContent = "分析失败: " + error.message;
  } finally {
    dom.analyzeBtn.disabled = false;
  }
}

// 在initApp中初始化按钮事件
async function initApp() {
  try {
    // ...其他初始化代码不变...
    
    // 修改按钮事件绑定
    dom.analyzeBtn.addEventListener('click', analyze);
    // 新增可视化按钮
    const visualizeBtn = document.createElement('button');
    visualizeBtn.textContent = '显示当前水体';
    visualizeBtn.addEventListener('click', visualizeWaterMask);
    document.querySelector('.controls').appendChild(visualizeBtn);
    
    dom.status.textContent = "准备就绪";
  } catch (error) {
    // ...错误处理不变...
  }
}
