// 全局配置
const MAP_CONFIG = {
  MAX_RETRIES: 3,
  RETRY_DELAY: 1000,
  DEFAULT_VIEW: [29.0, 116.3], // 鄱阳湖默认视角
  DEFAULT_ZOOM: 8
};

// 全局状态
const mapState = {
  instance: null,
  isInitialized: false,
  initializationAttempts: 0,
  layers: []
};

/**
 * 彻底清理地图实例和资源
 */
function cleanupMap() {
  if (mapState.instance) {
    // 移除所有图层
    mapState.layers.forEach(layer => {
      try {
        mapState.instance.removeLayer(layer);
      } catch (e) {
        console.warn('移除图层失败:', e);
      }
    });
    mapState.layers = [];
    
    // 移除地图实例
    try {
      mapState.instance.remove();
    } catch (e) {
      console.warn('移除地图实例失败:', e);
    }
    
    // 清理DOM残留
    const container = document.getElementById('map');
    if (container && container._leaflet_id) {
      L.DomUtil.remove(container);
      container._leaflet_id = undefined;
    }
    
    mapState.instance = null;
  }
  mapState.isInitialized = false;
}

/**
 * 初始化基础地图图层
 */
function initBaseLayers() {
  try {
    const baseLayers = [
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 18
      }),
      L.tileLayer('https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
        attribution: 'Google Satellite',
        maxZoom: 20
      })
    ];
    
    baseLayers.forEach(layer => {
      layer.addTo(mapState.instance);
      mapState.layers.push(layer);
    });
    
    return true;
  } catch (error) {
    console.error('初始化图层失败:', error);
    return false;
  }
}

/**
 * 安全初始化地图
 */
async function initializeMap() {
  // 检查是否已经成功初始化
  if (mapState.isInitialized) {
    console.debug('地图已经初始化，跳过重复初始化');
    return true;
  }

  // 检查最大重试次数
  if (mapState.initializationAttempts >= MAP_CONFIG.MAX_RETRIES) {
    console.error(`已达到最大重试次数(${MAP_CONFIG.MAX_RETRIES})，停止尝试`);
    return false;
  }

  // 检查容器是否存在
  const mapContainer = document.getElementById('map');
  if (!mapContainer) {
    console.error('地图容器未找到');
    return false;
  }

  try {
    console.log(`尝试初始化地图(第${mapState.initializationAttempts + 1}次)`);
    
    // 清理可能的旧实例
    cleanupMap();
    
    // 创建新地图实例
    mapState.instance = L.map('map', {
      preferCanvas: true,
      renderer: L.canvas(),
      zoomControl: false, // 稍后手动添加以更好控制
      attributionControl: false // 稍后手动添加
    }).setView(MAP_CONFIG.DEFAULT_VIEW, MAP_CONFIG.DEFAULT_ZOOM);
    
    // 添加控制组件
    L.control.zoom({ position: 'topright' }).addTo(mapState.instance);
    L.control.attribution({ position: 'bottomright' }).addTo(mapState.instance);
    
    // 初始化基础图层
    if (!initBaseLayers()) {
      throw new Error('初始化基础图层失败');
    }
    
    // 标记初始化成功
    mapState.isInitialized = true;
    mapState.initializationAttempts = 0;
    console.log('地图初始化成功');
    return true;
    
  } catch (error) {
    console.error('地图初始化失败:', error);
    
    // 清理失败实例
    cleanupMap();
    
    // 增加尝试计数
    mapState.initializationAttempts++;
    
    // 延迟重试
    if (mapState.initializationAttempts < MAP_CONFIG.MAX_RETRIES) {
      console.log(`将在${MAP_CONFIG.RETRY_DELAY/1000}秒后重试...`);
      await new Promise(resolve => setTimeout(resolve, MAP_CONFIG.RETRY_DELAY));
      return initializeMap(); // 递归调用
    }
    
    return false;
  }
}

/**
 * 确保DOM就绪后初始化
 */
async function ensureMapInitialization() {
  // 等待DOM完全加载
  if (document.readyState !== 'complete') {
    await new Promise(resolve => {
      document.addEventListener('DOMContentLoaded', resolve);
    });
  }
  
  // 额外等待100ms确保所有元素就绪
  await new Promise(resolve => setTimeout(resolve, 100));
  
  // 尝试初始化
  return initializeMap();
}

/**
 * 重新加载地图
 */
async function reloadMap() {
  console.log('重新加载地图...');
  cleanupMap();
  return initializeMap();
}

// 将MapService暴露为全局变量
window.MapService = {
  initialize: ensureMapInitialization,
  reload: reloadMap,
  getMap: () => mapState.instance,
  isInitialized: () => mapState.isInitialized
};

// 页面加载完成后自动初始化
window.addEventListener('load', () => {
  MapService.initialize().then(success => {
    if (success) {
      console.log('地图自动初始化成功');
    } else {
      console.error('地图自动初始化失败');
    }
  });
});
