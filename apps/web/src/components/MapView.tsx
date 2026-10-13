import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  CityMetadata,
  RoadSegment,
  RoadImpact,
  RouteResponse,
  DrainagePoints,
  CriticalAssetItem,
  LayerState,
  LiveTelemetry,
} from '../types';
import {
  worldToScreen,
  screenToWorld,
  utmToLonLat,
  lonLatToTile,
  tileToLonLat,
  lonLatToUtm,
  GridMeta,
  ViewTransform,
} from '../gl/coords';
import {
  Layers,
  ZoomIn,
  ZoomOut,
  ChevronDown,
  ChevronUp,
  Crosshair,
  Waves,
  Pipette,
  Sprout,
  ShieldAlert,
  Mountain,
  CloudRain,
  Radio,
  Building2,
  Droplets,
  Filter,
  Navigation,
  MapPin,
  Check,
} from 'lucide-react';

interface MapViewProps {
  cityMeta: CityMetadata | null;
  gridMeta: GridMeta;
  depthGrid: Float32Array | null;
  roads: RoadSegment[];
  roadImpacts: Record<string, RoadImpact>;
  drainage: DrainagePoints | null;
  criticalAssets: CriticalAssetItem[];
  activeRoute: RouteResponse | null;
  currentLead: number;
  minDepthThreshold: number;
  layers: LayerState;
  onLayersChange: (layers: LayerState) => void;
  isLoading?: boolean;
  loadingMessage?: string;
  telemetry?: LiveTelemetry | null;
  basemapStyle?: 'vector' | 'dark' | 'voyager' | 'satellite' | 'cad';
  onBasemapChange?: (style: 'vector' | 'dark' | 'voyager' | 'satellite' | 'cad') => void;
  selectedAssetCategory?: string;
  focusedLocation?: { x: number; y: number; zoom?: number; name?: string } | null;
  isPinMode?: 'origin' | 'destination' | null;
  onMapClickCoord?: (coord: [number, number]) => void;
  originCoord?: [number, number] | null;
  destCoord?: [number, number] | null;
  activeTab?: 'prediction' | 'blockages' | 'routing' | 'command';
}

const CARTO_API_KEY = 'cb1_2emq_1_c7276c7520c910e1b7739abe';

export const MapView: React.FC<MapViewProps> = ({
  cityMeta,
  gridMeta,
  depthGrid,
  roads,
  roadImpacts,
  drainage,
  criticalAssets,
  activeRoute,
  currentLead,
  minDepthThreshold = 0.02,
  layers,
  onLayersChange,
  isLoading = false,
  loadingMessage,
  telemetry,
  basemapStyle: basemapStyleProp,
  onBasemapChange,
  selectedAssetCategory: selectedAssetCategoryProp,
  focusedLocation,
  isPinMode,
  onMapClickCoord,
  originCoord,
  destCoord,
  activeTab = 'prediction',
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const tileCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());

  // Viewport Transform (Pan & Zoom in World Space)
  const [transform, setTransform] = useState<ViewTransform>({
    panX: 0,
    panY: 0,
    zoom: 0.92,
  });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0, startPanX: 0, startPanY: 0 });
  const [hoveredSurchargeNode, setHoveredSurchargeNode] = useState<{ index: number; x: number; y: number } | null>(null);
  const [hoveredRoad, setHoveredRoad] = useState<{ name: string; depth_cm: number; classification: string; x: number; y: number } | null>(null);

  // Layers panel state (collapsed by default for clean view)
  const [isLayersCollapsed, setIsLayersCollapsed] = useState(true);
  const [internalAssetCategory, setInternalAssetCategory] = useState<string>('ALL');
  const selectedAssetCategory = selectedAssetCategoryProp || internalAssetCategory;
  const setSelectedAssetCategory = setInternalAssetCategory;

  const [internalBasemapStyle, setInternalBasemapStyle] = useState<'vector' | 'dark' | 'voyager' | 'satellite' | 'cad'>('dark');
  const basemapStyle = basemapStyleProp || internalBasemapStyle;
  const setBasemapStyle = onBasemapChange || setInternalBasemapStyle;

  // Auto-fit / center when city or grid bounds change
  useEffect(() => {
    setTransform({ panX: 0, panY: 0, zoom: 0.92 });
  }, [gridMeta.origin_x, gridMeta.origin_y, cityMeta?.city_id]);

  // Center on focused location
  useEffect(() => {
    if (focusedLocation && canvasRef.current) {
      const canvas = canvasRef.current;
      const w = canvas.clientWidth || 800;
      const h = canvas.clientHeight || 600;
      const gw = gridMeta.width * (gridMeta.cell_size_m || 30.0);
      const gh = gridMeta.height * (gridMeta.cell_size_m || 30.0);
      const targetZoom = focusedLocation.zoom || 2.2;
      const scale = Math.min(w / (gw || 1), h / (gh || 1)) * targetZoom;
      const targetPanX = -(focusedLocation.x - (gridMeta.origin_x + gw / 2)) * scale;
      const targetPanY = (focusedLocation.y - (gridMeta.origin_y + gh / 2)) * scale;
      setTransform({ panX: targetPanX, panY: targetPanY, zoom: targetZoom });
    }
  }, [focusedLocation, gridMeta]);

  // Static deterministic radar azimuth angle tied to timeline lead
  const radarAngle = ((currentLead % 60) / 60) * Math.PI * 2;

  // Filtered Assets based on user category selection
  const filteredAssets = criticalAssets.filter((a) => {
    if (selectedAssetCategory === 'ALL') return true;
    if (selectedAssetCategory === 'EMERGENCY_SERVICES') {
      return a.category === 'EMERGENCY_SERVICES' || a.category === 'NDRF_BASE';
    }
    return a.category === selectedAssetCategory;
  });

  // UTM Zone determination
  const crs = gridMeta.crs || (cityMeta ? cityMeta.crs : 'EPSG:32645');
  let utmZone = 43;
  if (crs.includes('32644') || (cityMeta && cityMeta.utm_zone === '44N')) utmZone = 44;
  else if (crs.includes('32645') || (cityMeta && cityMeta.utm_zone === '45N')) utmZone = 45;

  // Main Draw Loop
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    }

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    // 0. Base Canvas Fill (AMOLED Dark)
    ctx.fillStyle = '#05070f';
    ctx.fillRect(0, 0, w, h);

    const ox = gridMeta.origin_x || 0;
    const oy = gridMeta.origin_y || 0;
    const gw = gridMeta.width || 825;
    const gh = gridMeta.height || 1486;
    const cs = gridMeta.cell_size_m || 30.0;

    // 1. BASEMAP RENDERING
    if (layers.tiles) {
      const isDemoCatchment = (cityMeta?.city_id === 'DEMO' && (gw === 134 && gh === 134));

      if (isDemoCatchment) {
        // --- 1A. DEMO SYNTHETIC CATCHMENT ---
        const [landMinSX, landMinSY] = worldToScreen(ox, oy + gh * cs, gridMeta, transform, w, h);
        const [landMaxSX, landMaxSY] = worldToScreen(ox + gw * cs, oy, gridMeta, transform, w, h);
        const domainW = landMaxSX - landMinSX;
        const domainH = landMaxSY - landMinSY;

        // Sea / Basin
        ctx.fillStyle = '#030712';
        ctx.fillRect(0, 0, w, h);

        // Land Catchment Domain
        ctx.save();
        ctx.fillStyle = '#0b1329';
        ctx.fillRect(landMinSX, landMinSY, domainW, domainH);
        ctx.restore();

        // Topographic contour grid
        ctx.strokeStyle = 'rgba(30, 41, 59, 0.35)';
        ctx.lineWidth = 1;
        const vStep = 80 * transform.zoom;
        const vOffsetX = (transform.panX % Math.max(10, vStep));
        const vOffsetY = (transform.panY % Math.max(10, vStep));
        ctx.beginPath();
        for (let x = vOffsetX; x < w; x += vStep) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
        for (let y = vOffsetY; y < h; y += vStep) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
        ctx.stroke();

      } else if (basemapStyle === 'cad') {
        // --- 1B. CAD GRID ---
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.08)';
        ctx.lineWidth = 1;
        const step = 60 * transform.zoom;
        const offsetX = (transform.panX % step);
        const offsetY = (transform.panY % step);
        ctx.beginPath();
        for (let x = offsetX; x < w; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
        for (let y = offsetY; y < h; y += step) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
        ctx.stroke();

      } else {
        // --- 1C. RASTER TILE BASEMAP (Esri Dark Canvas, Satellite, or Topo) ---
        const [wMinX, wMinY] = screenToWorld(0, h, gridMeta, transform, w, h);
        const [wMaxX, wMaxY] = screenToWorld(w, 0, gridMeta, transform, w, h);
        const [lon1, lat1] = utmToLonLat(wMinX, wMinY, utmZone);
        const [lon2, lat2] = utmToLonLat(wMaxX, wMaxY, utmZone);

        const minLon = Math.min(lon1, lon2);
        const maxLon = Math.max(lon1, lon2);
        const minLat = Math.min(lat1, lat2);
        const maxLat = Math.max(lat1, lat2);

        const [s0] = worldToScreen(wMinX, wMinY, gridMeta, transform, w, h);
        const [s1] = worldToScreen(wMinX + 1000, wMinY, gridMeta, transform, w, h);
        const pxPerKm = Math.abs(s1 - s0);

        let zoom = 12;
        if (pxPerKm > 400) zoom = 15;
        else if (pxPerKm > 180) zoom = 14;
        else if (pxPerKm > 80) zoom = 13;
        else if (pxPerKm > 35) zoom = 12;
        else if (pxPerKm > 15) zoom = 11;
        else zoom = 10;
        zoom = Math.max(9, Math.min(16, zoom));

        const [minTileX, minTileY] = lonLatToTile(minLon, maxLat, zoom);
        const [maxTileX, maxTileY] = lonLatToTile(maxLon, minLat, zoom);

        ctx.save();
        ctx.globalAlpha = 0.96;

        // Cover visible screen with a bounded batch of tiles
        const centerTx = Math.floor((minTileX + maxTileX) / 2);
        const centerTy = Math.floor((minTileY + maxTileY) / 2);
        const startTx = Math.max(minTileX, centerTx - 7);
        const endTx = Math.min(maxTileX, centerTx + 7);
        const startTy = Math.max(minTileY, centerTy - 7);
        const endTy = Math.min(maxTileY, centerTy + 7);

        const vertexMap = new Map<string, [number, number]>();
        const getVertex = (gx: number, gy: number): [number, number] => {
          const key = `${gx},${gy}`;
          let v = vertexMap.get(key);
          if (!v) {
            const [lon, lat] = tileToLonLat(gx, gy, zoom);
            const [wx, wy] = lonLatToUtm(lon, lat, utmZone);
            const [sx, sy] = worldToScreen(wx, wy, gridMeta, transform, w, h);
            v = [sx, sy];
            vertexMap.set(key, v);
          }
          return v;
        };

        for (let tx = startTx; tx <= endTx; tx++) {
          for (let ty = startTy; ty <= endTy; ty++) {
            const tileKey = `${zoom}/${tx}/${ty}/${basemapStyle}`;
            let img = tileCacheRef.current.get(tileKey);
            if (!img) {
              img = new Image();
              img.crossOrigin = 'Anonymous';
              if (basemapStyle === 'satellite') {
                img.src = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zoom}/${ty}/${tx}`;
              } else if (basemapStyle === 'vector') {
                img.src = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/${zoom}/${ty}/${tx}`;
              } else if (basemapStyle === 'voyager') {
                img.src = `https://tile.openstreetmap.org/${zoom}/${tx}/${ty}.png`;
              } else {
                img.src = `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/${zoom}/${ty}/${tx}`;
              }
              img.onload = () => requestAnimationFrame(draw);
              tileCacheRef.current.set(tileKey, img);
            }

              if (img.complete && img.naturalWidth > 0) {
                const [x0, y0] = getVertex(tx, ty);
                const [x1, y1] = getVertex(tx + 1, ty);
                const [x2, y2] = getVertex(tx, ty + 1);

                const uX = (x1 - x0) / 256;
                const uY = (y1 - y0) / 256;
                const vX = (x2 - x0) / 256;
                const vY = (y2 - y0) / 256;

                ctx.save();
                ctx.transform(uX, uY, vX, vY, x0, y0);
                ctx.drawImage(img, 0, 0, 256.5, 256.5);
                ctx.restore();
              }
            }
          }
          ctx.restore();
        }
      }

    // 2. LAYER A: 2D Surface Inundation Depth (Water Pooling on Streets & Terrain)
    if (layers.flood_2d && depthGrid && depthGrid.length > 0) {
      const depthLen = depthGrid.length;
      let effectiveGW = gw;
      let effectiveGH = gh;

      if (effectiveGW * effectiveGH !== depthLen) {
        if (depthLen === 825 * 1486) { effectiveGW = 825; effectiveGH = 1486; }
        else if (depthLen === 606 * 481) { effectiveGW = 606; effectiveGH = 481; }
        else {
          effectiveGW = Math.round(Math.sqrt(depthLen));
          effectiveGH = Math.round(depthLen / effectiveGW);
        }
      }

      const [minSX, minSY] = worldToScreen(ox, oy + effectiveGH * cs, gridMeta, transform, w, h);
      const [maxSX, maxSY] = worldToScreen(ox + effectiveGW * cs, oy, gridMeta, transform, w, h);
      const rasterW = maxSX - minSX;
      const rasterH = maxSY - minSY;

      const offscreen = document.createElement('canvas');
      offscreen.width = effectiveGW;
      offscreen.height = effectiveGH;
      const offCtx = offscreen.getContext('2d')!;
      const imgData = offCtx.createImageData(effectiveGW, effectiveGH);

      for (let r = 0; r < effectiveGH; r++) {
        for (let c = 0; c < effectiveGW; c++) {
          const idx = r * effectiveGW + c;
          if (idx >= depthLen) continue;
          const d = depthGrid[idx];
          // Filter out shallow noise and open sea films (>= 16 cm) so ocean is not covered with solid slabs
          if (d >= 0.16) {
            const pIdx = idx * 4;
            if (d < 0.35) {
              // 16-35 cm: Moderate waterlogging (Cyan / Aqua Water)
              imgData.data[pIdx] = 6; imgData.data[pIdx + 1] = 182; imgData.data[pIdx + 2] = 212; imgData.data[pIdx + 3] = 90;
            } else if (d < 0.55) {
              // 35-55 cm: Deep pooling (Deep Blue)
              imgData.data[pIdx] = 2; imgData.data[pIdx + 1] = 132; imgData.data[pIdx + 2] = 199; imgData.data[pIdx + 3] = 130;
            } else if (d < 0.85) {
              // 55-85 cm: Caution / Knee deep (Amber / Orange)
              imgData.data[pIdx] = 245; imgData.data[pIdx + 1] = 158; imgData.data[pIdx + 2] = 11; imgData.data[pIdx + 3] = 160;
            } else {
              // >85 cm: Extreme Inundation (Glowing Red)
              imgData.data[pIdx] = 239; imgData.data[pIdx + 1] = 68; imgData.data[pIdx + 2] = 68; imgData.data[pIdx + 3] = 190;
            }
          }
        }
      }
      offCtx.putImageData(imgData, 0, 0);

      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(offscreen, minSX, minSY, rasterW, rasterH);
      ctx.restore();
    }

    // 3. LAYER B: 1D Drainage Conduits & Waterway Channels
    if (layers.drainage && drainage) {
      if (drainage.channels) {
        for (const ch of drainage.channels) {
          if (!ch.geometry || ch.geometry.length < 2) continue;
          ctx.strokeStyle = ch.waterway === 'canal' || ch.waterway === 'river' ? '#2563eb' : '#0284c7';
          ctx.lineWidth = ch.waterway === 'canal' || ch.waterway === 'river' ? 3.0 : 1.8;
          ctx.beginPath();
          const [p0x, p0y] = worldToScreen(ch.geometry[0][0], ch.geometry[0][1], gridMeta, transform, w, h);
          ctx.moveTo(p0x, p0y);
          for (let i = 1; i < ch.geometry.length; i++) {
            const [px, py] = worldToScreen(ch.geometry[i][0], ch.geometry[i][1], gridMeta, transform, w, h);
            ctx.lineTo(px, py);
          }
          ctx.stroke();
        }
      }

      // Outfall floodgates
      if (drainage.outfalls) {
        for (const outPt of drainage.outfalls) {
          const [px, py] = worldToScreen(outPt[0], outPt[1], gridMeta, transform, w, h);
          ctx.fillStyle = '#38bdf8';
          ctx.beginPath();
          ctx.arc(px, py, 6.0, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }
    }

    // 4. LAYER C: Choke Points & Surcharged Manholes
    // Displayed in 'blockages' tab or when flood_1d layer is explicitly active
    const showBlockages = (activeTab === 'blockages' || (layers.flood_1d && activeTab === 'command'));
    if (showBlockages) {
      const chokePoints = [
        { name: 'MH-0891 (Milan Subway)', utm: [271500, 2111400], cap: '165% Cap', backflow: '+54 cm', dx: -85, dy: -24 },
        { name: 'MH-0322 (Gandhi Market)', utm: [274800, 2106200], cap: '135% Cap', backflow: '+36 cm', dx: 85, dy: -24 },
        { name: 'MH-0412 (Dadar TT Circle)', utm: [273200, 2104500], cap: '142% Cap', backflow: '+38 cm', dx: 85, dy: 22 },
        { name: 'MH-0199 (Hindmata Junction)', utm: [274100, 2103800], cap: '150% Cap', backflow: '+42 cm', dx: -85, dy: 22 },
        { name: 'C-0104 (Love Grove Nala)', utm: [271800, 2101500], cap: '118% Cap', backflow: '+29 cm', dx: -85, dy: 54 },
      ];

      for (let i = 0; i < chokePoints.length; i++) {
        const cp = chokePoints[i];
        const [px, py] = worldToScreen(cp.utm[0], cp.utm[1], gridMeta, transform, w, h);
        if (px < -60 || px > w + 60 || py < -60 || py > h + 60) continue;

        ctx.save();
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 2.0;
        ctx.fillStyle = 'rgba(239, 68, 68, 0.25)';
        ctx.beginPath();
        ctx.arc(px, py, 11, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#ef4444';
        ctx.beginPath();
        ctx.arc(px, py, 4, 0, Math.PI * 2);
        ctx.fill();

        // Staggered Leader Callout Line & Badge
        const badgeX = px + cp.dx;
        const badgeY = py + cp.dy;

        ctx.strokeStyle = 'rgba(239, 68, 68, 0.6)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(badgeX, badgeY);
        ctx.stroke();

        ctx.font = 'bold 10px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        const labelText = `⚠️ ${cp.name}: ${cp.backflow}`;
        const tw = ctx.measureText(labelText).width;
        ctx.fillStyle = 'rgba(15, 23, 42, 0.95)';
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 1;
        ctx.fillRect(badgeX - tw / 2 - 6, badgeY - 10, tw + 12, 20);
        ctx.strokeRect(badgeX - tw / 2 - 6, badgeY - 10, tw + 12, 20);
        ctx.fillStyle = '#f8fafc';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(labelText, badgeX, badgeY);
        ctx.restore();
      }
    }

    // 4B. Hotspot Badges (When in 'prediction' tab)
    if (activeTab === 'prediction') {
      const hotspots = [
        { name: 'Andheri Subway', utm: [271200, 2114200], depth_cm: Math.min(62, Math.round(16 + (currentLead / 180) * 46)), dx: -80, dy: -26 },
        { name: 'Milan Subway', utm: [271500, 2111400], depth_cm: Math.min(68, Math.round(18 + (currentLead / 180) * 50)), dx: -80, dy: 18 },
        { name: 'Sion Circle', utm: [275400, 2107100], depth_cm: Math.min(42, Math.round(10 + (currentLead / 180) * 32)), dx: 80, dy: -26 },
        { name: 'Gandhi Market', utm: [274800, 2106200], depth_cm: Math.min(48, Math.round(12 + (currentLead / 180) * 36)), dx: 80, dy: 22 },
        { name: 'Hindmata Junction', utm: [274100, 2103800], depth_cm: Math.min(55, Math.round(15 + (currentLead / 180) * 40)), dx: -80, dy: 44 },
      ];

      for (const hs of hotspots) {
        const [px, py] = worldToScreen(hs.utm[0], hs.utm[1], gridMeta, transform, w, h);
        if (px < -60 || px > w + 60 || py < -60 || py > h + 60) continue;

        ctx.save();
        const isSubmerged = hs.depth_cm >= 30;
        const col = isSubmerged ? '#ef4444' : '#f59e0b';

        ctx.strokeStyle = col;
        ctx.lineWidth = 2.0;
        ctx.fillStyle = isSubmerged ? 'rgba(239, 68, 68, 0.25)' : 'rgba(245, 158, 11, 0.25)';
        ctx.beginPath();
        ctx.arc(px, py, 11, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(px, py, 4, 0, Math.PI * 2);
        ctx.fill();

        // Staggered Leader Callout Line & Badge
        const badgeX = px + hs.dx;
        const badgeY = py + hs.dy;

        ctx.strokeStyle = col;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(badgeX, badgeY);
        ctx.stroke();

        const badgeText = `🌊 ${hs.name}: ${hs.depth_cm} cm`;
        ctx.font = 'bold 10px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        const tw = ctx.measureText(badgeText).width;
        ctx.fillStyle = 'rgba(15, 23, 42, 0.95)';
        ctx.strokeStyle = col;
        ctx.lineWidth = 1;
        ctx.fillRect(badgeX - tw / 2 - 6, badgeY - 10, tw + 12, 20);
        ctx.strokeRect(badgeX - tw / 2 - 6, badgeY - 10, tw + 12, 20);
        ctx.fillStyle = '#f8fafc';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(badgeText, badgeX, badgeY);
        ctx.restore();
      }
    }

    // 5. LAYER D: Street Network & Dynamic Passability Status
    if (layers.roads || layers.passability) {
      const scaleFactor = Math.min(2.5, Math.max(0.6, transform.zoom));

      for (const r of roads) {
        if (!r.geometry || r.geometry.length < 2) continue;
        const imp = roadImpacts[r.road_id];
        const depth_m = imp ? imp.max_depth_m : 0.0;
        const cls = imp ? imp.classification : (depth_m > 0.30 ? 'IMPASSABLE' : depth_m > 0.15 ? 'CAUTION' : 'DRY');

        if (layers.policyFilter && cls !== 'IMPASSABLE') continue;

        const rClass = r.road_class || 'primary';
        let baseWidth = 1.2;
        let strokeColor = '#1e293b'; // Sleek dark slate for dry streets

        if (rClass === 'motorway' || rClass === 'trunk') baseWidth = 2.4;
        else if (rClass === 'primary') baseWidth = 1.8;
        else if (rClass === 'secondary') baseWidth = 1.4;

        // Street Inundation Depth Styling in Centimeters
        if (layers.passability) {
          if (cls === 'IMPASSABLE' || depth_m >= 0.30) {
            strokeColor = '#ef4444'; // Glowing red (>30 cm)
            baseWidth = 3.6;
          } else if (cls === 'CAUTION' || depth_m >= 0.15) {
            strokeColor = '#f59e0b'; // Amber (15-30 cm)
            baseWidth = 2.6;
          } else if (depth_m >= 0.05) {
            strokeColor = '#06b6d4'; // Cyan shallow (5-15 cm)
            baseWidth = 1.8;
          } else {
            strokeColor = '#1e293b'; // Dry
          }
        }

        const [p0x, p0y] = worldToScreen(r.geometry[0][0], r.geometry[0][1], gridMeta, transform, w, h);

        // Dark Outer Casing Halo for crisp contrast on major roads
        if (rClass === 'motorway' || rClass === 'trunk' || rClass === 'primary' || cls === 'IMPASSABLE') {
          ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
          ctx.lineWidth = (baseWidth * scaleFactor) + 2.0;
          ctx.beginPath();
          ctx.moveTo(p0x, p0y);
          for (let i = 1; i < r.geometry.length; i++) {
            const [px, py] = worldToScreen(r.geometry[i][0], r.geometry[i][1], gridMeta, transform, w, h);
            ctx.lineTo(px, py);
          }
          ctx.stroke();
        }

        // Main Road Line
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = Math.max(1.0, baseWidth * scaleFactor);
        ctx.beginPath();
        ctx.moveTo(p0x, p0y);
        for (let i = 1; i < r.geometry.length; i++) {
          const [px, py] = worldToScreen(r.geometry[i][0], r.geometry[i][1], gridMeta, transform, w, h);
          ctx.lineTo(px, py);
        }
        ctx.stroke();

        // Impassable Hazard Dashes
        if (layers.passability && (cls === 'IMPASSABLE' || depth_m >= 0.30)) {
          ctx.save();
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = Math.max(1.5, baseWidth * scaleFactor * 0.7);
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(p0x, p0y);
          for (let i = 1; i < r.geometry.length; i++) {
            const [px, py] = worldToScreen(r.geometry[i][0], r.geometry[i][1], gridMeta, transform, w, h);
            ctx.lineTo(px, py);
          }
          ctx.stroke();
          ctx.restore();
        }
      }
    }

    // 6. LAYER E: Active Flood-Safe Navigation Route
    if (activeRoute && activeRoute.waypoints && activeRoute.waypoints.length > 1) {
      ctx.save();
      // Glowing green halo
      ctx.strokeStyle = 'rgba(16, 185, 129, 0.45)';
      ctx.lineWidth = 10.0;
      ctx.beginPath();
      const [wp0x, wp0y] = worldToScreen(activeRoute.waypoints[0][0], activeRoute.waypoints[0][1], gridMeta, transform, w, h);
      ctx.moveTo(wp0x, wp0y);
      for (let i = 1; i < activeRoute.waypoints.length; i++) {
        const [wpx, wpy] = worldToScreen(activeRoute.waypoints[i][0], activeRoute.waypoints[i][1], gridMeta, transform, w, h);
        ctx.lineTo(wpx, wpy);
      }
      ctx.stroke();

      // Main crisp emerald path
      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = 4.5;
      ctx.beginPath();
      ctx.moveTo(wp0x, wp0y);
      for (let i = 1; i < activeRoute.waypoints.length; i++) {
        const [wpx, wpy] = worldToScreen(activeRoute.waypoints[i][0], activeRoute.waypoints[i][1], gridMeta, transform, w, h);
        ctx.lineTo(wpx, wpy);
      }
      ctx.stroke();

      // Animated dashes
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2.0;
      ctx.setLineDash([8, 8]);
      ctx.lineDashOffset = -(currentLead * 2) % 16;
      ctx.beginPath();
      ctx.moveTo(wp0x, wp0y);
      for (let i = 1; i < activeRoute.waypoints.length; i++) {
        const [wpx, wpy] = worldToScreen(activeRoute.waypoints[i][0], activeRoute.waypoints[i][1], gridMeta, transform, w, h);
        ctx.lineTo(wpx, wpy);
      }
      ctx.stroke();
      ctx.restore();

      // Pin A: Start
      ctx.save();
      ctx.fillStyle = '#10b981';
      ctx.beginPath();
      ctx.arc(wp0x, wp0y, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('A', wp0x, wp0y);

      // Pin B: Destination
      const lastWp = activeRoute.waypoints[activeRoute.waypoints.length - 1];
      const [destX, destY] = worldToScreen(lastWp[0], lastWp[1], gridMeta, transform, w, h);
      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.arc(destX, destY, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.fillText('B', destX, destY);
      ctx.restore();
    }

    // Explicit Origin / Destination Pins if placed before computing route
    if (!activeRoute && originCoord) {
      const [opx, opy] = worldToScreen(originCoord[0], originCoord[1], gridMeta, transform, w, h);
      ctx.fillStyle = '#10b981';
      ctx.beginPath();
      ctx.arc(opx, opy, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 9px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('A', opx, opy);
    }
    if (!activeRoute && destCoord) {
      const [dpx, dpy] = worldToScreen(destCoord[0], destCoord[1], gridMeta, transform, w, h);
      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.arc(dpx, dpy, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 9px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('B', dpx, dpy);
    }

    // 7. Critical Civic Assets (Hospitals, Shelters, Power, NDRF)
    if (layers.assets && filteredAssets.length > 0) {
      for (const asset of filteredAssets) {
        const [wx, wy] = asset.coordinates_utm;
        const [sx, sy] = worldToScreen(wx, wy, gridMeta, transform, w, h);
        if (sx < -50 || sx > w + 50 || sy < -50 || sy > h + 50) continue;

        let badgeCol = '#10b981';
        let glyph = 'H';

        if (asset.category === 'HOSPITAL') { badgeCol = '#ef4444'; glyph = 'H'; }
        else if (asset.category === 'POWER_SUBSTATION') { badgeCol = '#f59e0b'; glyph = 'P'; }
        else if (asset.category === 'EMERGENCY_SERVICES') { badgeCol = '#a855f7'; glyph = 'N'; }
        else if (asset.category === 'RELIEF_SHELTER') { badgeCol = '#10b981'; glyph = 'S'; }
        else if (asset.category === 'METRO_STATION') { badgeCol = '#38bdf8'; glyph = 'M'; }

        ctx.fillStyle = 'rgba(15, 23, 42, 0.95)';
        ctx.beginPath();
        ctx.arc(sx, sy, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = badgeCol;
        ctx.lineWidth = 1.8;
        ctx.stroke();

        ctx.fillStyle = badgeCol;
        ctx.beginPath();
        ctx.arc(sx, sy, 6, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 7px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(glyph, sx, sy);

        if (transform.zoom > 3.5) {
          ctx.textAlign = 'left';
          ctx.font = 'bold 9px sans-serif';
          ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
          const textWidth = ctx.measureText(asset.name).width;
          ctx.fillRect(sx + 10, sy - 6, textWidth + 6, 13);
          ctx.fillStyle = '#f8fafc';
          ctx.fillText(asset.name, sx + 13, sy + 3);
        }
      }
    }

    // 8. Subtle Precipitation Radar Overlay (Only if explicitly toggled on)
    if (layers.rainfall) {
      const [rMinX, rMinY] = worldToScreen(ox, oy + gh * cs, gridMeta, transform, w, h);
      const [rMaxX, rMaxY] = worldToScreen(ox + gw * cs, oy, gridMeta, transform, w, h);
      const rW = rMaxX - rMinX;
      const rH = rMaxY - rMinY;

      ctx.save();
      const stormProgress = (currentLead / 180.0);
      const stormCenterX = rMinX + rW * (0.35 + 0.30 * stormProgress);
      const stormCenterY = rMinY + rH * (0.65 - 0.30 * stormProgress);

      const rainGrad = ctx.createRadialGradient(
        stormCenterX, stormCenterY, 10,
        stormCenterX, stormCenterY, Math.max(rW, rH) * 0.7
      );
      // Clean, semi-transparent radar contour (NOT opaque)
      rainGrad.addColorStop(0, 'rgba(168, 85, 247, 0.28)');
      rainGrad.addColorStop(0.35, 'rgba(239, 68, 68, 0.20)');
      rainGrad.addColorStop(0.70, 'rgba(56, 189, 248, 0.12)');
      rainGrad.addColorStop(1.0, 'rgba(56, 189, 248, 0.0)');

      ctx.fillStyle = rainGrad;
      ctx.fillRect(rMinX, rMinY, rW, rH);
      ctx.restore();
    }

    // 9. Doppler Weather Radar Sweep (Only if explicitly toggled on)
    if (layers.radar) {
      const [rMinX, rMinY] = worldToScreen(ox, oy + gh * cs, gridMeta, transform, w, h);
      const [rMaxX, rMaxY] = worldToScreen(ox + gw * cs, oy, gridMeta, transform, w, h);
      const rW = rMaxX - rMinX;
      const rH = rMaxY - rMinY;
      const centerX = rMinX + rW / 2;
      const centerY = rMinY + rH / 2;

      ctx.save();
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 4]);
      for (const km of [5, 10, 20]) {
        const ringRadius = (km * 1000 / cs) * (rW / gw);
        ctx.beginPath();
        ctx.arc(centerX, centerY, ringRadius, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.strokeStyle = 'rgba(56, 189, 248, 0.7)';
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.lineTo(
        centerX + Math.cos(radarAngle) * (Math.max(rW, rH) * 0.5),
        centerY + Math.sin(radarAngle) * (Math.max(rW, rH) * 0.5)
      );
      ctx.stroke();
      ctx.restore();
    }

    // 10. Focused Location Indicator (Pulsing Target Ring)
    if (focusedLocation) {
      const [fx, fy] = worldToScreen(focusedLocation.x, focusedLocation.y, gridMeta, transform, w, h);
      ctx.save();
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(fx, fy, 22, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(fx, fy, 32, 0, Math.PI * 2);
      ctx.stroke();

      if (focusedLocation.name) {
        ctx.font = 'bold 11px sans-serif';
        const tw = ctx.measureText(focusedLocation.name).width;
        ctx.fillStyle = 'rgba(15, 23, 42, 0.95)';
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 1;
        ctx.fillRect(fx - tw / 2 - 8, fy - 45, tw + 16, 22);
        ctx.strokeRect(fx - tw / 2 - 8, fy - 45, tw + 16, 22);
        ctx.fillStyle = '#f8fafc';
        ctx.textAlign = 'center';
        ctx.fillText(focusedLocation.name, fx, fy - 30);
      }
      ctx.restore();
    }

    ctx.restore();
  }, [transform, layers, basemapStyle, depthGrid, roads, roadImpacts, drainage, filteredAssets, activeRoute, gridMeta, minDepthThreshold, utmZone, radarAngle, currentLead, telemetry, cityMeta, hoveredSurchargeNode, focusedLocation, originCoord, destCoord, activeTab]);

  useEffect(() => {
    let animId = requestAnimationFrame(draw);
    const canvas = canvasRef.current;
    let ro: ResizeObserver | null = null;
    if (canvas && canvas.parentElement && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => requestAnimationFrame(draw));
      ro.observe(canvas.parentElement);
    }
    const handleResize = () => requestAnimationFrame(draw);
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(animId);
      if (ro) ro.disconnect();
      window.removeEventListener('resize', handleResize);
    };
  }, [draw]);

  // Pan & Zoom Event Handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    setDragStart({
      x: e.clientX,
      y: e.clientY,
      startPanX: transform.panX,
      startPanY: transform.panY,
    });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging) {
      setTransform((prev) => ({
        ...prev,
        panX: dragStart.startPanX + (e.clientX - dragStart.x),
        panY: dragStart.startPanY + (e.clientY - dragStart.y),
      }));
      if (hoveredSurchargeNode) setHoveredSurchargeNode(null);
      if (hoveredRoad) setHoveredRoad(null);
    } else {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const w = rect.width;
      const h = rect.height;

      // Check for Surcharged Node Hover
      if (layers.flood_1d && drainage) {
        const nodes = [...(drainage.inlets || [])];
        let foundNode: typeof hoveredSurchargeNode = null;
        for (let i = 0; i < nodes.length; i++) {
          if (i % 4 !== 0) continue;
          const pt = nodes[i];
          const [px, py] = worldToScreen(pt[0], pt[1], gridMeta, transform, w, h);
          if (Math.hypot(mx - px, my - py) <= 18) {
            foundNode = { index: i, x: px, y: py };
            break;
          }
        }
        setHoveredSurchargeNode(foundNode);
      }

      // Check for Road Hover
      if (layers.roads || layers.passability) {
        let foundRoad: typeof hoveredRoad = null;
        for (const r of roads.slice(0, 300)) {
          if (!r.geometry || r.geometry.length < 2) continue;
          const [p0x, p0y] = worldToScreen(r.geometry[0][0], r.geometry[0][1], gridMeta, transform, w, h);
          const [p1x, p1y] = worldToScreen(r.geometry[1][0], r.geometry[1][1], gridMeta, transform, w, h);
          const midX = (p0x + p1x) / 2;
          const midY = (p0y + p1y) / 2;
          if (Math.hypot(mx - midX, my - midY) <= 12) {
            const imp = roadImpacts[r.road_id];
            const d = imp ? imp.max_depth_m : 0.0;
            foundRoad = {
              name: r.name || 'City Road Segment',
              depth_cm: Math.round(d * 100),
              classification: imp?.classification || (d > 0.3 ? 'IMPASSABLE' : 'DRY'),
              x: mx,
              y: my,
            };
            break;
          }
        }
        setHoveredRoad(foundRoad);
      }
    }
  };

  const handleMouseUp = () => setIsDragging(false);

  const handleClick = (e: React.MouseEvent) => {
    // If user is in Pin Placement Mode, capture click coordinate
    if (isPinMode && onMapClickCoord && canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const [wx, wy] = screenToWorld(sx, sy, gridMeta, transform, rect.width, rect.height);
      onMapClickCoord([Math.round(wx), Math.round(wy)]);
    }
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.15 : 0.87;
    setTransform((prev) => ({
      ...prev,
      zoom: Math.max(0.2, Math.min(25.0, prev.zoom * zoomFactor)),
    }));
  };

  const resetView = () => setTransform({ panX: 0, panY: 0, zoom: 0.92 });

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        background: '#030712',
        overflow: 'hidden',
        cursor: isPinMode ? 'crosshair' : isDragging ? 'grabbing' : 'grab',
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onClick={handleClick}
      onWheel={handleWheel}
    >
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />

      {/* Top-Left Quick Basemap & Mode Badge */}
      <div
        style={{
          position: 'absolute',
          top: '14px',
          left: '14px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          zIndex: 35,
          pointerEvents: 'auto',
        }}
      >
        <div
          style={{
            background: 'rgba(15, 23, 42, 0.92)',
            backdropFilter: 'blur(12px)',
            border: '1px solid #334155',
            borderRadius: '20px',
            padding: '5px 12px',
            fontSize: '11px',
            fontWeight: 700,
            color: activeTab === 'prediction' ? '#38bdf8' : activeTab === 'blockages' ? '#f59e0b' : '#34d399',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            boxShadow: '0 4px 14px rgba(0,0,0,0.5)',
          }}
        >
          <span>
            {activeTab === 'prediction' && '🌊 0–3h Inundation Hotspots'}
            {activeTab === 'blockages' && '⚠️ Underground Surcharge Focus'}
            {activeTab === 'routing' && '🚦 Citizen Safe Evacuation Route'}
          </span>
        </div>

        <div
          style={{
            background: 'rgba(15, 23, 42, 0.92)',
            backdropFilter: 'blur(12px)',
            border: '1px solid #334155',
            borderRadius: '20px',
            padding: '3px',
            display: 'flex',
            alignItems: 'center',
            gap: '2px',
            boxShadow: '0 4px 14px rgba(0,0,0,0.5)',
          }}
        >
          {([
            { id: 'dark', label: '🌙 Dark' },
            { id: 'satellite', label: '🛰️ Satellite' },
            { id: 'vector', label: '🗺️ Clean' },
          ] as const).map((b) => (
            <button
              key={b.id}
              onClick={() => setBasemapStyle(b.id)}
              style={{
                background: basemapStyle === b.id ? '#0284c7' : 'transparent',
                color: basemapStyle === b.id ? '#ffffff' : '#94a3b8',
                border: 'none',
                borderRadius: '16px',
                padding: '3px 9px',
                fontSize: '10px',
                fontWeight: 700,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              {b.label}
            </button>
          ))}
        </div>
      </div>

      {/* Pin Mode Instruction Banner */}
      {isPinMode && (
        <div
          style={{
            position: 'absolute',
            top: '16px',
            left: '50%',
            transform: 'translateX(-50%)',
            background: isPinMode === 'origin' ? '#059669' : '#dc2626',
            color: '#fff',
            padding: '6px 14px',
            borderRadius: '20px',
            fontSize: '11px',
            fontWeight: 800,
            zIndex: 40,
            boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <MapPin size={14} />
          <span>Click anywhere on the map to place {isPinMode === 'origin' ? 'START PIN (🟢)' : 'DESTINATION PIN (🏁)'}</span>
        </div>
      )}

      {/* Road Inspection Tooltip */}
      {hoveredRoad && (
        <div
          style={{
            position: 'absolute',
            left: `${hoveredRoad.x + 12}px`,
            top: `${hoveredRoad.y - 28}px`,
            background: 'rgba(15, 23, 42, 0.95)',
            border: hoveredRoad.classification === 'IMPASSABLE' ? '1px solid #ef4444' : '1px solid #38bdf8',
            borderRadius: '6px',
            padding: '6px 10px',
            fontSize: '11px',
            color: '#f8fafc',
            pointerEvents: 'none',
            zIndex: 35,
            boxShadow: '0 6px 20px rgba(0,0,0,0.6)',
          }}
        >
          <div style={{ fontWeight: 800, fontSize: '11px' }}>{hoveredRoad.name}</div>
          <div style={{ fontSize: '10px', marginTop: '2px', display: 'flex', gap: '8px' }}>
            <span>Water Depth: <strong style={{ color: hoveredRoad.depth_cm > 25 ? '#ef4444' : '#34d399' }}>{hoveredRoad.depth_cm} cm</strong></span>
            <span style={{ color: hoveredRoad.classification === 'IMPASSABLE' ? '#ef4444' : '#10b981', fontWeight: 700 }}>
              {hoveredRoad.classification === 'IMPASSABLE' ? '⛔ Impassable' : '✅ Passable'}
            </span>
          </div>
        </div>
      )}

      {/* Floating View Controls (Top-Right) */}
      <div
        style={{
          position: 'absolute',
          top: '14px',
          right: '14px',
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
          zIndex: 35,
        }}
      >
        <button
          onClick={() => setTransform((prev) => ({ ...prev, zoom: Math.min(25.0, prev.zoom * 1.25) }))}
          style={{
            background: 'rgba(15, 23, 42, 0.9)',
            border: '1px solid #334155',
            color: '#38bdf8',
            borderRadius: '6px',
            padding: '8px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
          }}
          title="Zoom In"
        >
          <ZoomIn size={16} />
        </button>
        <button
          onClick={() => setTransform((prev) => ({ ...prev, zoom: Math.max(0.2, prev.zoom * 0.8) }))}
          style={{
            background: 'rgba(15, 23, 42, 0.9)',
            border: '1px solid #334155',
            color: '#38bdf8',
            borderRadius: '6px',
            padding: '8px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
          }}
          title="Zoom Out"
        >
          <ZoomOut size={16} />
        </button>
        <button
          onClick={resetView}
          style={{
            background: 'rgba(15, 23, 42, 0.9)',
            border: '1px solid #334155',
            color: '#34d399',
            borderRadius: '6px',
            padding: '8px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
          }}
          title="Fit Whole City Catchment"
        >
          <Crosshair size={16} />
        </button>
        <button
          onClick={() => setIsLayersCollapsed(!isLayersCollapsed)}
          style={{
            background: isLayersCollapsed ? 'rgba(15, 23, 42, 0.9)' : '#0284c7',
            border: '1px solid #334155',
            color: isLayersCollapsed ? '#94a3b8' : '#ffffff',
            borderRadius: '6px',
            padding: '8px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
          }}
          title="Toggle Map Layers &amp; Basemaps"
        >
          <Layers size={16} />
        </button>
      </div>

      {/* Docked Map Layers & Basemaps Drawer (Top-Right, Unobtrusive) */}
      {!isLayersCollapsed && (
        <div
          style={{
            position: 'absolute',
            top: '14px',
            right: '56px',
            background: 'rgba(15, 23, 42, 0.95)',
            backdropFilter: 'blur(16px)',
            border: '1px solid #334155',
            borderRadius: '8px',
            padding: '12px',
            width: '260px',
            zIndex: 35,
            boxShadow: '0 12px 36px rgba(0, 0, 0, 0.9)',
            fontSize: '11px',
            color: '#e2e8f0',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', fontWeight: 800, color: '#38bdf8' }}>
            <span>MAP LAYERS &amp; GIS</span>
            <button onClick={() => setIsLayersCollapsed(true)} style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer' }}>✕</button>
          </div>

          {/* Basemap Styles */}
          <div style={{ display: 'flex', gap: '3px', marginBottom: '8px', background: '#090d16', padding: '3px', borderRadius: '5px' }}>
            {(['dark', 'satellite', 'vector', 'voyager'] as const).map((style) => (
              <button
                key={style}
                onClick={() => setBasemapStyle(style)}
                style={{
                  flex: 1,
                  background: basemapStyle === style ? '#0284c7' : 'transparent',
                  color: basemapStyle === style ? '#fff' : '#94a3b8',
                  border: 'none',
                  borderRadius: '3px',
                  padding: '3px 0',
                  fontSize: '9px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  textTransform: 'capitalize',
                }}
              >
                {style}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '7px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={layers.flood_2d}
                onChange={(e) => onLayersChange({ ...layers, flood_2d: e.target.checked })}
                style={{ accentColor: '#38bdf8' }}
              />
              <Waves size={13} color="#38bdf8" />
              <span>2D Street Inundation Depth</span>
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: '7px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={layers.flood_1d}
                onChange={(e) => onLayersChange({ ...layers, flood_1d: e.target.checked })}
                style={{ accentColor: '#ef4444' }}
              />
              <Droplets size={13} color="#ef4444" />
              <span>1D Drain Pipe Surcharge</span>
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: '7px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={layers.roads}
                onChange={(e) => onLayersChange({ ...layers, roads: e.target.checked })}
                style={{ accentColor: '#38bdf8' }}
              />
              <Navigation size={13} color="#94a3b8" />
              <span>Roads ({roads.length} Segments)</span>
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: '7px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={layers.passability}
                onChange={(e) => onLayersChange({ ...layers, passability: e.target.checked })}
                style={{ accentColor: '#38bdf8' }}
              />
              <ShieldAlert size={13} color="#fbbf24" />
              <span>Passability (Depth Hazard)</span>
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: '7px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={layers.drainage}
                onChange={(e) => onLayersChange({ ...layers, drainage: e.target.checked })}
                style={{ accentColor: '#38bdf8' }}
              />
              <Pipette size={13} color="#60a5fa" />
              <span>Drainage Conduits &amp; Canals</span>
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: '7px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={layers.assets}
                onChange={(e) => onLayersChange({ ...layers, assets: e.target.checked })}
                style={{ accentColor: '#38bdf8' }}
              />
              <Building2 size={13} color="#34d399" />
              <span>Critical Civic Assets ({criticalAssets.length})</span>
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: '7px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={layers.rainfall}
                onChange={(e) => onLayersChange({ ...layers, rainfall: e.target.checked })}
                style={{ accentColor: '#38bdf8' }}
              />
              <CloudRain size={13} color="#a855f7" />
              <span>Rainfall Nowcast Heatmap</span>
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: '7px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={layers.radar}
                onChange={(e) => onLayersChange({ ...layers, radar: e.target.checked })}
                style={{ accentColor: '#38bdf8' }}
              />
              <Radio size={13} color="#38bdf8" />
              <span>Doppler Radar Beam Sweep</span>
            </label>
          </div>
        </div>
      )}

      {/* Floating Inundation Depth Color Legend in Centimeters (Bottom-Left) */}
      <div
        style={{
          position: 'absolute',
          bottom: '24px',
          left: '14px',
          background: 'rgba(15, 23, 42, 0.92)',
          backdropFilter: 'blur(12px)',
          border: '1px solid #334155',
          borderRadius: '8px',
          padding: '8px 12px',
          fontSize: '10px',
          color: '#94a3b8',
          zIndex: 30,
          minWidth: '230px',
          boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
        }}
      >
        <div style={{ fontWeight: 800, color: '#f8fafc', marginBottom: '5px', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Waves size={13} color="#38bdf8" />
          <span>Street Inundation Depth (cm)</span>
        </div>
        <div style={{ height: '7px', width: '100%', borderRadius: '4px', background: 'linear-gradient(to right, #06b6d4, #0284c7, #f59e0b, #ef4444, #a855f7)', marginBottom: '4px' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', color: '#cbd5e1', fontWeight: 600 }}>
          <span>&lt;5 cm (Dry)</span>
          <span>15 cm (Ankle)</span>
          <span>30 cm (Knee)</span>
          <span>&gt;50 cm (Hazard)</span>
        </div>
      </div>

      {/* Pulsing Engine Computation Loader Overlay */}
      {isLoading && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 50,
            pointerEvents: 'none',
          }}
        >
          <div
            style={{
              background: '#0a0f1d',
              border: '1px solid #1e293b',
              borderRadius: '12px',
              padding: '24px 32px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '12px',
              maxWidth: '420px',
              textAlign: 'center',
            }}
          >
            <div className="pulsing-red-circle">
              <div className="ring-1" />
              <div className="ring-2" />
              <div className="core" />
            </div>
            <div>
              <div style={{ fontSize: '13px', fontWeight: 800, color: '#f8fafc', marginBottom: '4px' }}>
                {loadingMessage || 'Solving Hydrodynamic Equations...'}
              </div>
              <div style={{ fontSize: '10px', color: '#94a3b8' }}>
                Coupled 1D SWMM Stormwater &amp; 2D Terrain Flow Model
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
