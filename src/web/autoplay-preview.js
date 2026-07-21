(async function() {
    'use strict';

    if (window.jfAutoplayPreviewActive) return;
    window.jfAutoplayPreviewActive = true;

    async function loadRequiredLibraries() {
        if (window.THREE && window.VR && window.Hls) return;
        console.log('[Jellium Autoplay] Loading required libraries: Three.js, mxreality.js, Hls.js');
        const loadScript = (url) => new Promise((resolve) => {
            const script = document.createElement('script');
            script.src = url;
            script.onload = () => resolve(true);
            script.onerror = () => resolve(false);
            (document.head || document.documentElement).appendChild(script);
        });

        if (!window.THREE) {
            await loadScript('https://cdn.jsdelivr.net/npm/mxreality.js@1.2.20/build/three.js');
        }
        if (!window.VR) {
            await loadScript('https://cdn.jsdelivr.net/npm/mxreality.js@1.2.20/build/mxreality.js');
        }
        if (!window.Hls) {
            await loadScript('https://cdn.jsdelivr.net/npm/hls.js@latest');
        }
        console.log('[Jellium Autoplay] All libraries loaded successfully');
    }

    async function runScript() {
        await loadRequiredLibraries();
// ==UserScript==
// @name         Jellyfin 悬停多窗预览 (MPV版)
// @namespace    http://tampermonkey.net/
// @version      4.8
// @description  支持6窗口 2x3 矩阵排列，自动寻找空位生成，带位置记忆和精灵图预览
// @author       Gemini
// @match        https://jellyfin.622276.xyz:8443/*
// @match        https://jellyfinxxx.622276.xyz:8443/*
// @match        http://192.168.5.200:8098/*
// @require      https://cdn.jsdelivr.net/npm/mxreality.js@1.2.20/build/three.js
// @require      https://cdn.jsdelivr.net/npm/mxreality.js@1.2.20/build/mxreality.js
// @require      https://cdn.jsdelivr.net/npm/hls.js@latest
// @grant        none
// ==/UserScript==
 
(function () {
    'use strict';

    window.jfAutoplayActive = true;

    // 全局劫持并在捕获期间有条件地过滤/保存 mxreality.js 注册的全局事件监听器
    const originalEventTargetAdd = EventTarget.prototype.addEventListener;

    EventTarget.prototype.addEventListener = function(type, listener, options) {
        if (window.jfVRCapturing) {
            if (this === window || this === document || this === document.body || this === document.documentElement) {
                if (type === 'wheel' || type === 'mousewheel' || type === 'DOMMouseScroll' || type === 'touchmove') {
                    console.log(`[JF] Blocked mxreality.js global listener on:`, this, `type:`, type);
                    return;
                }
                if (window.jfVRCapturingActiveList) {
                    window.jfVRCapturingActiveList.push({ target: this, type, listener, options });
                }
            }
        }
        return originalEventTargetAdd.apply(this, arguments);
    };

    let hoverTimer = null;
    let previewWindows = []; // 存储窗口对象的数组 [{el, slotIndex, timestamp}]
    const currentlyOpeningIds = new Set(); // 正在打开的视频 ID，防止异步竞态导致打开重复视频
    let topZIndex = 200000;
    const MAX_WINDOWS = 3;
    const COLS = 3;
    const ROWS = 1;
 
    // 增加全局标志位用于控制是否启动原画引擎及播放参数
    let isRealVideoPreview = false; // 默认关闭
    let isAutoPlayEnabled = false; // 默认关闭
    let globalPlaySpeed = 50.0; // 默认倍速
    let globalThumbCols = parseInt(localStorage.getItem('jf-thumb-cols')) || 0;
    const speedOptions = [1.0, 2.0, 3.0, 5.0, 10.0, 20.0, 30.0, 50.0];

    let isRandomMode = false;
    let isTryNewRandomMode = false;
    let isFavoriteRandomMode = false;
    let randomCols = 3;
    let randomGap = 20;

    const itemCache = new Map();
    const isFetching = new Set();
    const folderTypes = ['Folder', 'CollectionFolder', 'Series', 'Season', 'BoxSet', 'Playlist', 'MusicAlbum', 'MusicArtist', 'UserView'];

    let overlapRaf = null;
    function updateOverlaps() {
        const sorted = [...previewWindows].sort((a, b) => parseInt(a.el.style.zIndex || 0) - parseInt(b.el.style.zIndex || 0));
        
        for (let i = 0; i < sorted.length; i++) {
            const upper = sorted[i];
            const rectU = upper.el.getBoundingClientRect();
            
            const rects = [];
            for (let j = 0; j < i; j++) {
                const lower = sorted[j];
                const rectL = lower.el.getBoundingClientRect();
                
                const ix1 = Math.max(rectU.left, rectL.left);
                const iy1 = Math.max(rectU.top, rectL.top);
                const ix2 = Math.min(rectU.right, rectL.right);
                const iy2 = Math.min(rectU.bottom, rectL.bottom);
                
                if (ix1 < ix2 && iy1 < iy2) {
                    rects.push({
                        x: ix1 - rectU.left,
                        y: iy1 - rectU.top,
                        w: ix2 - ix1,
                        h: iy2 - iy1
                    });
                }
            }
            
            if (rects.length > 0) {
                const W = rectU.width;
                const H = rectU.height;
                const headerH = 35;
                const footerH = 40;
                const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '">' +
                  '<mask id="m">' +
                    '<rect width="100%" height="100%" fill="white"/>' +
                    rects.map(r => '<rect x="' + r.x + '" y="' + r.y + '" width="' + r.w + '" height="' + r.h + '" fill="black"/>').join('') +
                    '<rect x="0" y="0" width="100%" height="' + headerH + '" fill="white"/>' +
                    '<rect x="0" y="' + Math.max(headerH, H - footerH) + '" width="100%" height="' + footerH + '" fill="white"/>' +
                  '</mask>' +
                  '<mask id="m2">' +
                    rects.map(r => '<rect x="' + r.x + '" y="' + r.y + '" width="' + r.w + '" height="' + r.h + '" fill="white"/>').join('') +
                    '<rect x="0" y="0" width="100%" height="' + headerH + '" fill="black"/>' +
                    '<rect x="0" y="' + Math.max(headerH, H - footerH) + '" width="100%" height="' + footerH + '" fill="black"/>' +
                  '</mask>' +
                  '<rect width="100%" height="100%" fill="white" mask="url(#m)"/>' +
                  '<rect width="100%" height="100%" fill="rgba(255,255,255,0.4)" mask="url(#m2)"/>' +
                '</svg>';
                const url = "url('data:image/svg+xml;utf8," + encodeURIComponent(svg) + "')";
                if (upper.lastMaskUrl !== url) {
                    upper.lastMaskUrl = url;
                    upper.el.style.webkitMaskImage = url;
                    upper.el.style.maskImage = url;
                }
            } else {
                if (upper.lastMaskUrl !== 'none') {
                    upper.lastMaskUrl = 'none';
                    upper.el.style.webkitMaskImage = 'none';
                    upper.el.style.maskImage = 'none';
                }
            }
        }
    }

    function scheduleUpdateOverlaps() {
        if (overlapRaf) return;
        overlapRaf = requestAnimationFrame(() => {
            overlapRaf = null;
            updateOverlaps();
        });
    }

    function getTrickplayInfo(info) {
        // 默认回退值
        const defaultRet = { width: 320, interval: 10, id: null, cols: 10, rows: 10 };
        if (!info) return defaultRet;
        
        const mediaSource = info.MediaSources?.[0];
        // 尝试多种字段命名可能：Trickplay, TrickPlay, trickplay
        const manifests = mediaSource?.Trickplay || mediaSource?.TrickPlay || mediaSource?.trickplay || info.Trickplay || info.TrickPlay;
        const id = mediaSource?.Id || info.Id || null;
        
        let width = 320;
        let interval = 10;
        let cols = 10; 
        let rows = 10;

        // 如果找到了 manifest，尝试解析
        if (manifests && typeof manifests === 'object') {
            let config = manifests;
            
            // 关键修复：某些情况下，manifests 被包裹在 MediaSourceId 中
            // 结构如： { "3cc37...": { "640": {...} } }
            // 尝试检测是否为这种嵌套结构
            const keys = Object.keys(manifests);
            if (keys.length === 1 && manifests[keys[0]] && typeof manifests[keys[0]] === 'object' && !manifests.Width && !manifests[320] && !manifests[640]) {
                 // 看起来像是被 ID 包裹了，解包
                 config = manifests[keys[0]];
            }

            // 扁平结构处理
            if (config.Width && !config[config.Width]) {
                 const m = config;
                 width = m.Width;
                 // 智能纠正 Interval 单位
                 // Jellyfin Ticks = 10,000,000 per sec
                 // Milliseconds = 1,000 per sec
                 let rawInterval = m.Interval || 10000;
                 // 如果值大于 1,000,000，几乎肯定是 Ticks
                 if (rawInterval > 1000000) interval = rawInterval / 10000000;
                 // 如果值在 1000 - 100000 之间，几乎肯定是毫秒 (例如 10000ms = 10s)
                 else if (rawInterval > 100) interval = rawInterval / 1000;
                 // 否则假设它已经是秒
                 else interval = rawInterval;

                 // 同步修正列数逻辑
                 if (m.TileWidth && m.TileWidth <= 20) {
                     cols = m.TileWidth;
                     rows = m.TileHeight || m.TileWidth;
                 } else if (m.ThumbnailWidth && m.Width > m.ThumbnailWidth) {
                     cols = Math.round(m.Width / m.ThumbnailWidth);
                     rows = Math.round(m.Height / m.ThumbnailHeight);
                 }
                 // console.log(`[JF] Found flat Trickplay manifest ${width}w for item ${id}, Interval: ${interval}s, Grid: ${cols}x${rows}`, m);
            } else {
                // 标准结构：{"320": {...}, "640": {...}}
                const widths = Object.keys(config).map(Number).filter(n => !isNaN(n));
                if (widths.length > 0) {
                    // 优先找 640，其次找最大值，最后使用 320
                    width = widths.includes(640) ? 640 : (widths.includes(320) ? 320 : Math.max(...widths));
                    
                    const m = config[width.toString()] || config[width];
                    if (m) {
                        // 智能纠正 Interval 单位
                        let rawInterval = m.Interval || 10000;
                        if (rawInterval > 1000000) interval = rawInterval / 10000000;
                        else if (rawInterval > 100) interval = rawInterval / 1000;
                        else interval = rawInterval;
                        
                        // 逻辑修正：TileWidth / TileHeight 在不同版本的插件中含义不同
                        if (m.TileWidth && m.TileWidth <= 20) {
                             cols = m.TileWidth;
                             rows = m.TileHeight || m.TileWidth;
                        } else if (m.ThumbnailWidth && m.Width > m.ThumbnailWidth) {
                            cols = Math.round(m.Width / m.ThumbnailWidth);
                            rows = Math.round(m.Height / m.ThumbnailHeight);
                        }
                    }
                    // console.log(`[JF] Found Trickplay ${width}w for item ${id}, Interval: ${interval}s, Grid: ${cols}x${rows}`, m);
                } else {
                    // console.log(`[JF] No valid widths in manifest for item ${id}`, config);
                }
            }
        } else {
            // console.log(`[JF] No Trickplay manifest found for item ${id}. Fields checked:`, manifests);
            // if (info) console.log(`[JF] Full item info:`, info);
        }
        
        return { width, interval, id, cols, rows };
    }

    const style = document.createElement('style');
    style.innerHTML = `
        .jf-preview-instance {
            position: fixed; z-index: 200000; background: #000; border-radius: 10px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.8); border: 1px solid rgba(255,255,255,0.2);
            /* 去除 overflow: hidden; 以便 trickplay 溢出显示在下方 */
            display: flex; flex-direction: column; 
            transition: all 0.4s cubic-bezier(0.165, 0.84, 0.44, 1);
        }
        .jf-preview-header {
            background: #1a1a1a; padding: 6px 12px; display: flex;
            justify-content: space-between; align-items: center; color: #fff;
            cursor: move; font-size: 13px; flex-shrink: 0;
            border-top-left-radius: 10px; border-top-right-radius: 10px; /* 补偿外层的 overflow:hidden 去除 */
        }
        .jf-btn-close { cursor: pointer; padding: 2px 8px; background: #cc3333; border-radius: 4px; font-size: 11px; font-weight: bold; color: white; }
        .jf-btn-delete { cursor: pointer; padding: 2px 8px; background: #880000; border-radius: 4px; font-size: 11px; font-weight: bold; color: white; margin-right: 4px; }
        .jf-btn-favorite { cursor: pointer; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; color: white; margin-right: 4px; }
        .jf-btn-reload { cursor: pointer; padding: 2px 8px; background: #28a745; border-radius: 4px; font-size: 11px; font-weight: bold; color: white; margin-right: 4px; }
        .video-wrapper { position: relative; flex: 1; background: #000; display: flex; align-items: center; justify-content: center; border-bottom-left-radius: 10px; border-bottom-right-radius: 10px; }
        .jf-video-el { width: 100%; height: 100%; object-fit: contain; cursor: move; object-position: top; border-bottom-left-radius: 10px; border-bottom-right-radius: 10px; }
        
        /* 增加自动播放开关按钮样式 */
        .jf-btn-autoplay-toggle {
            display: inline-flex; align-items: center; justify-content: center;
            padding: 0 12px; margin-left: auto; height: 32px; border-radius: 6px;
            background: #2a2a2a; color: #fff; cursor: pointer; font-size: 14px;
            border: 1px solid #444; transition: all 0.2s;
        }
        .jf-btn-autoplay-toggle.active { background: #00a4dc; border-color: #00a4dc; }
        
        .jf-trickplay-thumb {
            position: absolute; 
            /* 挪到视频和进度条下方 */
            top: calc(100% + 5px); left: 50%; transform: translateX(-50%);
            width: 300px; height: 168px; border: 2px solid #00a4dc; border-radius: 4px;
            background: #111 no-repeat; display: none; pointer-events: none; z-index: 200006;
            background-size: 1000% 1000%;
        }
        .resizer-se { position: absolute; right: 0; bottom: 0; width: 16px; height: 16px; cursor: se-resize; background: linear-gradient(135deg, transparent 70%, rgba(255,255,255,0.4) 70%); }
        .jf-btn-vr { cursor: pointer; padding: 2px 8px; background: #5533ff; border-radius: 4px; font-size: 11px; font-weight: bold; color: white; margin-right: 4px; }
        .jf-select-vr-mode { background:#333; color:#fff; border:none; margin-right:4px; border-radius:3px; padding:2px; font-size:12px; outline:none; }
        .jf-vr-container { display: none; position: absolute; top: 0; left: 0; width: 100%; height: 100%; z-index: 5; background: #000; border-bottom-left-radius: 10px; border-bottom-right-radius: 10px; overflow: hidden; }
        .jf-vr-container canvas { display: block; border-bottom-left-radius: 10px; border-bottom-right-radius: 10px; }
        /* 全局预览图层 - 增大尺寸 */
        .jf-global-trickplay {
            position: fixed;
            z-index: 2000000;
            pointer-events: none;
            width: 480px;
            height: 270px;
            background-color: #000;
            background-repeat: no-repeat;
            box-shadow: 0 15px 50px rgba(0,0,0,0.8);
            border: 2px solid #00a4dc;
            display: none;
            border-radius: 6px;
            background-size: contain;
        }
        .jf-autoplay-overlay {
            position: absolute; top: 0; left: 0; width: 100%; height: 100%;
            background-repeat: no-repeat;
            display: none; pointer-events: none; 
            z-index: 100; /* 确保在最上层 */
            border-radius: inherit;
            background-size: contain;
            filter: brightness(1.15); /* 增加亮度 */
            background-color: transparent;
        }
        
        /* 隐藏 Jellyfin 默认的悬停灰色遮罩 */
        body .itemsContainer.jf-large-thumbnail .card:hover .cardOverlayContainer,
        body .itemsContainer.jf-large-thumbnail .card:hover .cardOverlayTarget,
        body .itemsContainer.jf-large-thumbnail .card:hover .cardImageContainer::after {
            background: transparent !important;
            background-color: transparent !important;
        }

        /* 隐藏长按多选模式下的浅蓝色遮罩，并提升被选中缩略图的亮度 */
        body .itemsContainer.jf-large-thumbnail .card .itemSelectionPanel,
        body .itemsContainer.jf-large-thumbnail .card.selected .cardOverlayContainer,
        body .itemsContainer.jf-large-thumbnail .card.selected .cardOverlayTarget {
            background: transparent !important;
            background-color: transparent !important;
            border: 3px solid #00a4dc !important; /* 保留下边框提示已被选中 */
            border-radius: var(--card-border-radius, 6px);
        }
        body .itemsContainer.jf-large-thumbnail .card.selected .cardScalable,
        body .itemsContainer.jf-large-thumbnail .card.selected .cardImageContainer {
            filter: brightness(1.3) !important; /* 提升 30% 亮度 */
        }


        /* --- 缩略图模式强制放大方案 (包含动态列数和默认设置) --- */
        
        /* 动态列数控制方案 */
        body.jf-custom-cols .itemsContainer.jf-large-thumbnail .card {
            width: var(--jf-thumb-width) !important;
            flex-basis: var(--jf-thumb-width) !important;
            margin: var(--jf-thumb-margin) !important;
            flex-grow: 0 !important;
            flex-shrink: 0 !important;
        }

        /* 默认自动模式: 3列 */
        body:not(.jf-custom-cols) .itemsContainer.jf-large-thumbnail .card {
            width: 32.53% !important;
            flex-basis: 32.53% !important;
            flex-grow: 0 !important;
            flex-shrink: 0 !important;
            margin: 0.4% !important;
        }

        /* 给容器的两侧减去内边距，使它能更好地占用整个页面 */
        body.jf-custom-cols .itemsContainer.jf-large-thumbnail,
        body:not(.jf-custom-cols) .itemsContainer.jf-large-thumbnail {
             padding-left: 0.2% !important;
             padding-right: 0.2% !important;
        }
        
        /* 只要确保内部容器跟卡片等宽，图片就会随比例放大 */
        .itemsContainer.jf-large-thumbnail .cardBox,
        .itemsContainer.jf-large-thumbnail .cardScalable,
        .itemsContainer.jf-large-thumbnail .cardPadder,
        .itemsContainer.jf-large-thumbnail .cardContent,
        .itemsContainer.jf-large-thumbnail .cardImageContainer {
            width: 100% !important;
        }
        .itemsContainer.jf-large-thumbnail .cardPadder {
            padding-bottom: 56.25% !important; /* 强制 16:9 比例高 */
        }
        /* 确保自动播放层覆盖整个区域 */
        .itemsContainer.jf-large-thumbnail .jf-autoplay-overlay {
            position: absolute !important;
            z-index: 10 !important; /* 确保在海报之上 */
        }
        .itemsContainer.jf-large-thumbnail .cardText {
            font-size: 1.25em !important;
        }
        .itemsContainer.jf-large-thumbnail .cardOverlayButton {
            font-size: 1.8em !important;
        }

        /* 默认自动模式: 小屏幕 2 列 */
        @media (max-width: 1600px) {
            body:not(.jf-custom-cols) .itemsContainer.jf-large-thumbnail .card { 
                width: 47% !important; 
                flex-basis: 47% !important; 
                margin: 1.5% !important;
            }
        }
        
        /* PC 端进度条样式 */
        .jf-pc-progress-bg {
            position: absolute; bottom: 0; left: 0; width: 100%; height: 5px; 
            background: rgba(0,0,0,0.5); z-index: 100; display: none;
            pointer-events: none !important;
        }
        .jf-pc-progress-bar {
            height: 100%;
            background: #00a4dc; width: 0%;
        }
        
        /* 独立的全局进度条悬浮窗，用于规避卡片事件冲突和提供更好交互 */
        #jf-global-progress-popup {
            position: absolute; height: 16px; background: rgba(0,0,0,0.9);
            z-index: 9999999; display: none; cursor: pointer; border-radius: 4px;
            box-shadow: 0 4px 10px rgba(0,0,0,0.8); border: 1px solid #00a4dc;
            pointer-events: auto !important; box-sizing: border-box;
        }
        #jf-global-progress-popup .jf-popup-bar {
            height: 100%; background: #00a4dc; width: 0%; pointer-events: none;
            box-shadow: 0 0 2px rgba(0,0,0,0.8);
        }

        /* 独立进度条的小型悬浮预览图 */
        #jf-global-trickplay-preview {
            position: absolute; width: 320px; height: 180px;
            background-color: #000; z-index: 99999999; display: none;
            border: 2px solid #00a4dc; border-radius: 4px;
            background-repeat: no-repeat; pointer-events: none;
            box-shadow: 0 4px 10px rgba(0,0,0,0.8);
            transform: translateX(-50%);
        }
        /* 海报左下角播放次数角标 */
        .jf-play-count-badge {
            position: absolute;
            bottom: 6px;
            left: 6px;
            z-index: 20;
            background: rgba(0,0,0,0.65);
            color: #fff;
            font-size: 11px;
            font-weight: 600;
            padding: 2px 6px;
            border-radius: 4px;
            pointer-events: none;
            line-height: 1.4;
            white-space: nowrap;
            backdrop-filter: blur(2px);
        }
    `;
    document.head.appendChild(style);

    function getAuth() {
        const client = window.ApiClient;
        if (!client) return null;
        return {
            url: (typeof client.baseUrl === 'function') ? client.baseUrl() : (client.baseUrl || window.location.origin),
            token: (typeof client.accessToken === 'function') ? client.accessToken() : client.accessToken,
            userId: (typeof client.getCurrentUserId === 'function') ? client.getCurrentUserId() : (client.currentUserId || client._currentUserId),
            serverId: (typeof client.serverId === 'function') ? client.serverId() : (client.serverId || (typeof client.serverInfo === 'function' ? client.serverInfo()?.Id : ''))
        };
    }

    function showToast(message, type = 'success') {
        const toast = document.createElement('div');
        toast.className = 'jf-toast';
        toast.style.cssText = `
            position: fixed;
            bottom: 30px;
            right: 30px;
            background: rgba(20, 20, 20, 0.95);
            color: #fff;
            padding: 12px 24px;
            border-radius: 8px;
            border-left: 4px solid ${type === 'success' ? '#00b300' : '#ff3333'};
            box-shadow: 0 10px 30px rgba(0,0,0,0.5);
            font-size: 14px;
            font-weight: bold;
            z-index: 3000000;
            opacity: 0;
            transform: translateY(20px);
            transition: all 0.3s cubic-bezier(0.165, 0.84, 0.44, 1);
            pointer-events: none;
        `;
        toast.innerText = message;
        document.body.appendChild(toast);
        
        // Trigger reflow
        toast.offsetHeight;
        toast.style.opacity = '1';
        toast.style.transform = 'translateY(0)';
        
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(-20px)';
            setTimeout(() => toast.remove(), 300);
        }, 5000);
    }

    async function markAsPlayed(itemId, auth) {
        if (!auth.userId || !auth.token) return;

        // 1. 乐观更新：先在本地 cache 中增加播放次数并更新界面角标
        const cached = itemCache.get(itemId);
        if (cached) {
            if (!cached.UserData) cached.UserData = {};
            cached.UserData.PlayCount = (cached.UserData.PlayCount || 0) + 1;
            cached.UserData.Played = true;

            // 更新页面上海报卡片的播放次数角标
            const card = document.querySelector(`.card[data-id="${itemId}"]`);
            if (card) {
                updatePlayCountBadge(card, itemId, cached);
            }

            // 更新浮动预览窗口标题栏中的播放次数角标
            const titleBadges = document.querySelectorAll(`.jf-preview-instance[data-item-id="${itemId}"] .jf-title-play-count`);
            titleBadges.forEach(badge => {
                badge.textContent = `[播放: ${cached.UserData.PlayCount}]`;
            });
        }

        const url = `${auth.url}/Users/${auth.userId}/PlayedItems/${itemId}?api_key=${auth.token}`;
        try {
            const res = await fetch(url, { method: 'POST' });
            if (res.ok) {
                // 2. 从服务器获取最新信息进行精准更新与校准
                const updatedInfo = await getItemInfo(itemId, auth);
                if (updatedInfo) {
                    // 防止高并发或者服务器延迟写入导致次数回退，取本地乐观更新和服务器返回的最大值
                    const serverCount = updatedInfo.UserData?.PlayCount || 0;
                    const localCount = cached?.UserData?.PlayCount || 0;
                    if (!updatedInfo.UserData) updatedInfo.UserData = {};
                    updatedInfo.UserData.PlayCount = Math.max(serverCount, localCount);

                    itemCache.set(itemId, updatedInfo);
                    
                    const card = document.querySelector(`.card[data-id="${itemId}"]`);
                    if (card) {
                        updatePlayCountBadge(card, itemId, updatedInfo);
                    }
                    const titleBadges = document.querySelectorAll(`.jf-preview-instance[data-item-id="${itemId}"] .jf-title-play-count`);
                    titleBadges.forEach(badge => {
                        badge.textContent = `[播放: ${updatedInfo.UserData.PlayCount}]`;
                    });
                }
            }
        } catch (e) { console.error('[JF] Mark played failed', e); }
    }

    async function deleteItem(itemId, auth) {
        if (!auth.userId || !auth.token) return false;
        const url = `${auth.url}/Items/${itemId}?api_key=${auth.token}`;
        try {
            const res = await fetch(url, { method: 'DELETE' });
            return res.ok;
        } catch (e) { console.error('[JF] Delete failed', e); return false; }
    }

    async function toggleFavorite(itemId, auth, isFavorite) {
        if (!auth.userId || !auth.token) return false;
        const url = `${auth.url}/Users/${auth.userId}/FavoriteItems/${itemId}?api_key=${auth.token}`;
        try {
            const res = await fetch(url, { method: isFavorite ? 'DELETE' : 'POST' });
            return res.ok;
        } catch (e) { console.error('[JF] Favorite toggle failed', e); return false; }
    }

    async function getItemInfo(itemId, auth) {
        if (!auth.userId || !auth.token) return null;
        const url = `${auth.url}/Users/${auth.userId}/Items/${itemId}?api_key=${auth.token}&Fields=MediaSources,Trickplay,ParentId`;
        try {
            const res = await fetch(url);
            return await res.json();
        } catch (e) { return null; }
    }

    async function preloadAllCardsInfo() {
        const auth = getAuth();
        if (!auth) return;
        const cards = Array.from(document.querySelectorAll('.card[data-id]')).filter(c => {
            const type = c.getAttribute('data-type');
            return !type || !folderTypes.includes(type);
        });
        if (cards.length === 0) return;

        const uncachedCards = cards.filter(card => {
            const itemId = card.getAttribute('data-id');
            return itemId && !itemCache.has(itemId);
        });

        if (uncachedCards.length > 0) {
            const uncachedIds = uncachedCards.map(c => c.getAttribute('data-id'));
            const chunkSize = 50;
            const chunks = [];
            for (let i = 0; i < uncachedIds.length; i += chunkSize) {
                chunks.push(uncachedIds.slice(i, i + chunkSize));
            }

            const promises = chunks.map(async (chunk) => {
                const idsString = chunk.join(',');
                const url = `${auth.url}/Users/${auth.userId}/Items?api_key=${auth.token}&Ids=${idsString}&Fields=MediaSources,Trickplay`;
                try {
                    const res = await fetch(url);
                    const data = await res.json();
                    const items = data.Items || [];
                    items.forEach(item => {
                        if (item && item.Id) {
                            itemCache.set(item.Id, item);
                        }
                    });
                } catch (e) {
                    console.error('[JF] Bulk preload chunk failed', e);
                }
            });

            await Promise.all(promises);
        }

        // Update all cards' play count badges on the page
        cards.forEach(card => {
            const itemId = card.getAttribute('data-id');
            if (itemId) {
                const info = itemCache.get(itemId);
                if (info) {
                    updatePlayCountBadge(card, itemId, info);
                }
            }
        });
    }

    async function reportPlayback(itemId, auth, positionSec, isPaused, type = 'Progress') {
        if (!auth.token) return;
        // API 修正: 'Started' 对应 /Sessions/Playing，其他如 'Progress'/'Stopped' 对应 /Sessions/Playing/{type}
        const endpoint = type === 'Started' ? '' : `/${type}`;
        const url = `${auth.url}/Sessions/Playing${endpoint}?api_key=${auth.token}`;
        const body = {
            ItemId: itemId,
            PositionTicks: Math.floor(positionSec * 10000000),
            IsPaused: isPaused,
            VolumeLevel: 100,
            EventName: type
        };
        try {
            await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
        } catch (e) { }
    }

    function bringToFront(winObj) {
        topZIndex++;
        winObj.el.style.zIndex = topZIndex;
        winObj.timestamp = Date.now(); // 更新时间戳，确保其在排序中处于“最新”
        
        // 确保左上角 (slot 1) 的窗口层级始终高于左下角 (slot 2)
        // 防止 slot 1 的 trickplay 预览图被 slot 2 遮挡
        const slot1Win = previewWindows.find(w => w.slotIndex === 1);
        const slot2Win = previewWindows.find(w => w.slotIndex === 2);
        if (slot1Win && slot2Win) {
            if (parseInt(slot1Win.el.style.zIndex || 0) <= parseInt(slot2Win.el.style.zIndex || 0)) {
                topZIndex++;
                slot1Win.el.style.zIndex = topZIndex;
                slot1Win.timestamp = Date.now();
            }
        }

        scheduleUpdateOverlaps();
    }


    // 计算矩阵位置
    function getSlotStyle(slotIndex) {
        const padding = 10;
        const headerOffset = 70; // 标题栏预留
        const bottomOffset = 180; // 底部 Trickplay 预留
        const gap = 15;
        
        const screenW = window.innerWidth - padding * 2;
        const screenH = window.innerHeight - headerOffset - bottomOffset;
        const uiH = 35 + 40; // 窗口 Header(35) + Footer(40)

        // 计算最大可行宽度，确保左侧两个垂直叠加的小窗不超出高度限制，且无黑边 (16:9)
        // 2 * (w_small * 9/16 + uiH) + gap <= screenH
        let max_w_small = (screenH - (uiH * 2) - gap) / (18/16);
        
        // 计算右侧大窗的最大宽度
        // w_big * 9/16 + uiH <= screenH
        let max_w_big = (screenH - uiH) / (9/16);

        // 理想比例分配：右侧占 65% 左右
        let w_big = Math.min(max_w_big, screenW * 0.65);
        let w_small = Math.min(max_w_small, screenW - w_big - gap);
        
        // 如果宽度还有剩余，按比例稍微放大
        const remainingW = screenW - (w_big + w_small + gap);
        if (remainingW > 0) {
            const ratio = w_big / (w_big + w_small);
            w_big += remainingW * ratio;
            w_small += remainingW * (1 - ratio);
            // 再次确保不超出高度
            w_big = Math.min(w_big, max_w_big);
            w_small = Math.min(w_small, max_w_small);
        }

        const h_big = (w_big * 9 / 16) + uiH;
        const h_small = (w_small * 9 / 16) + uiH;

        // 预设 3 个位置
        const positions = [
            { left: screenW - w_big, top: headerOffset, width: w_big, height: h_big },
            { left: 0, top: headerOffset, width: w_small, height: h_small },
            { left: 0, top: headerOffset + h_small + gap, width: w_small, height: h_small }
        ];
        
        const p = positions[slotIndex % positions.length];
        return {
            left: (padding + p.left) + 'px',
            top: p.top + 'px',
            width: p.width + 'px',
            height: p.height + 'px'
        };
    }




    function openRandomWindow() {
        const cards = Array.from(document.querySelectorAll('.card[data-id]')).filter(c => {
            const type = c.getAttribute('data-type');
            return !type || !folderTypes.includes(type);
        });
        if (cards.length === 0) return;

        const openedIds = [
            ...previewWindows.map(w => w.itemId),
            ...currentlyOpeningIds
        ];
        const available = cards.filter(c => !openedIds.includes(c.getAttribute('data-id')));
        let pool = available.length > 0 ? available : cards;
        
        if (isFavoriteRandomMode) {
            pool = pool.filter(card => {
                const itemId = card.getAttribute('data-id');
                const info = itemCache.get(itemId);
                return info?.UserData?.IsFavorite || false;
            });
        } else if (isTryNewRandomMode) {
            const playCountMap = new Map();
            pool.forEach(card => {
                const itemId = card.getAttribute('data-id');
                const info = itemCache.get(itemId);
                
                // Fallback to UI indicator if info is not loaded
                const playedInd = card.querySelector('.playedIndicator, .playedIndicatorContainer, .playCountIndicator, .playcount');
                const isPlayedUI = playedInd && !playedInd.classList.contains('hide') && !playedInd.classList.contains('hidden') && playedInd.style.display !== 'none';
                
                let playCount = info?.UserData?.PlayCount;
                if (playCount === undefined || playCount === null) {
                    playCount = isPlayedUI ? 1 : 0;
                }
                
                playCountMap.set(card, playCount);
            });

            let minPlayCount = Infinity;
            playCountMap.forEach((playCount) => {
                if (playCount < minPlayCount) {
                    minPlayCount = playCount;
                }
            });

            pool = pool.filter(card => playCountMap.get(card) === minPlayCount);
        } else {
            // 优先挑选播放次数为零（未播放过且无进度条）的视频
            const unplayedPool = pool.filter(c => {
                const playedInd = c.querySelector('.playedIndicator, .playedIndicatorContainer, .playCountIndicator, .playcount');
                const isPlayed = playedInd && !playedInd.classList.contains('hide') && !playedInd.classList.contains('hidden') && playedInd.style.display !== 'none';
                const progBar = c.querySelector('.itemProgressBar, .playbackProgress, .progressBar');
                const hasProgress = progBar && !progBar.classList.contains('hide') && !progBar.classList.contains('hidden') && progBar.style.display !== 'none';
                return !isPlayed && !hasProgress;
            });
            if (unplayedPool.length > 0) {
                pool = unplayedPool;
            }
        }
        
        if (pool.length === 0) {
            pool = available.length > 0 ? available : cards;
        }

        const card = pool[Math.floor(Math.random() * pool.length)];
        const itemId = card.getAttribute('data-id');
        currentlyOpeningIds.add(itemId); // 立即标记为正在加载，防止多窗并发请求竞态
        const title = card.querySelector('.cardText')?.innerText || '视频预览';
        let startSecond = autoplayStates.get(itemId) || null;
        createPreview(itemId, title, startSecond);
    }

    const reservedSlots = new Set();

    // 寻找可用槽位
    function findEmptySlot() {
        const occupiedSlots = previewWindows.map(w => w.slotIndex);
        for (let i = 0; i < MAX_WINDOWS; i++) {
            if (!occupiedSlots.includes(i) && !reservedSlots.has(i)) return i;
        }
        return -1;
    }

    function destroyWindow(instanceObj) {
        if (instanceObj.resizeObserver) {
            instanceObj.resizeObserver.disconnect();
            instanceObj.resizeObserver = null;
        }
        
        removeVRControlsForWindow(instanceObj);

        // 清理 mxreality.js 注册在 window/document 上的全局事件监听器
        if (instanceObj.capturedWindowListeners) {
            instanceObj.capturedWindowListeners.forEach(item => {
                item.target.removeEventListener(item.type, item.listener, item.options);
            });
            instanceObj.capturedWindowListeners = null;
        }
        if (window.jfVRCapturingActiveList === instanceObj.capturedWindowListeners) {
            window.jfVRCapturing = false;
            window.jfVRCapturingActiveList = null;
        }

        // 还原记录的滚动属性、样式与 class
        if (instanceObj.capturedProperties) {
            instanceObj.capturedProperties.forEach(item => {
                try {
                    item.target[item.prop] = item.value;
                } catch(e) {}
            });
            instanceObj.capturedProperties = null;
        }

        if (instanceObj.vrInstance) {
            instanceObj.vrInstance.video = null;
            try { instanceObj.vrInstance.destroy(); } catch(e) {}
            instanceObj.vrInstance = null;
        }

        const v = instanceObj.el.querySelector('video');
        if (v) {
            if (instanceObj.auth && instanceObj.itemId) {
                reportPlayback(instanceObj.itemId, instanceObj.auth, v.currentTime, true, 'Stopped');
            }
            v.pause();
            v.src = "";
        }
        if (instanceObj.progressTimer) clearInterval(instanceObj.progressTimer);
        instanceObj.el.remove();
        previewWindows = previewWindows.filter(w => w !== instanceObj);
        scheduleUpdateOverlaps();
    }

    function handleRandomWindowClose(closedSlotIndex) {
        // 找到所有 slotIndex 大于 closedSlotIndex 的窗口
        const windowsToShift = previewWindows
            .filter(w => w.slotIndex > closedSlotIndex)
            .sort((a, b) => a.slotIndex - b.slotIndex);
            
        // 将它们的位置向前递补
        windowsToShift.forEach(w => {
            w.slotIndex -= 1;
            const newStyle = getSlotStyle(w.slotIndex);
            Object.assign(w.el.style, newStyle);
        });
        
        // 只有在随机模式下，才开启一个新的填补空位
        if (isRandomMode || isTryNewRandomMode || isFavoriteRandomMode) openRandomWindow();
    }


    async function createPreview(itemId, title, startSecond = null) {
        const auth = getAuth();
        if (!auth) {
            currentlyOpeningIds.delete(itemId);
            return;
        }

        let slotIndex = findEmptySlot();

        // 如果位置满了，找到最早的那个
        if (slotIndex === -1) {
            const oldest = previewWindows.sort((a, b) => a.timestamp - b.timestamp)[0];
            slotIndex = oldest.slotIndex;
            destroyWindow(oldest);
        }

        reservedSlots.add(slotIndex);

        let info;
        try {
            info = await getItemInfo(itemId, auth);
        } catch (e) {
            reservedSlots.delete(slotIndex);
            currentlyOpeningIds.delete(itemId);
            return;
        }
        reservedSlots.delete(slotIndex);
        if (info) {
            itemCache.set(itemId, info);
        }

                        const resumeTicks = info?.UserData?.PlaybackPositionTicks || 0;
        const isFav = info?.UserData?.IsFavorite || false;
        const playCount = info?.UserData?.PlayCount || 0;

        // --- 增加字幕提取逻辑 ---
        const mediaSource = info?.MediaSources?.[0];
        const mediaSourceId = mediaSource?.Id;
        // 过滤出文本类字幕
        const subtitleStreams = mediaSource?.MediaStreams?.filter(s => s.Type === 'Subtitle' && !['pgssub', 'dvdsub', 'dvbsub'].includes(s.Codec?.toLowerCase())) || [];
        
        let subtitleSelectHtml = '';
        let tracksHtml = '';
        if (subtitleStreams.length > 0) {
            subtitleSelectHtml = `<select class="jf-subtitle-select" style="background:#333; color:#fff; border:none; margin-right:10px; border-radius:3px; padding:2px; font-size:12px; outline:none; max-width:120px;">
                <option value="-1">关闭字幕</option>
                ${subtitleStreams.map((s, i) => `<option value="${s.Index}">${s.Title || s.Language || `Subtitle ${i+1}`}</option>`).join('')}
            </select>`;
            
            subtitleStreams.forEach(s => {
                const trackUrl = `${auth.url}/Videos/${itemId}/${mediaSourceId}/Subtitles/${s.Index}/Stream.vtt?api_key=${auth.token}`;
                tracksHtml += `<track kind="subtitles" label="${s.Title || s.Language || `Subtitle ${s.Index}`}" src="${trackUrl}" srclang="${s.Language || 'en'}" data-index="${s.Index}">`;
            });
        }
        // --- 结束字幕提取逻辑 ---

        const container = document.createElement('div');
        container.className = 'jf-preview-instance';
        container.setAttribute('data-item-id', itemId);
        const pos = getSlotStyle(slotIndex);
        Object.assign(container.style, pos);

        const videoUrl = getVideoStreamUrl(itemId, auth, mediaSourceId);
        container.innerHTML = `
            <div class="jf-preview-header">
                <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:50%;"><span class="jf-title-play-count" style="color:#aaa; font-size:11px; margin-right:8px;" title="播放次数">[播放: ${playCount}]</span>${title}</span>
                <div style="display:flex; align-items:center;">
                    ${subtitleSelectHtml}
                    <select class="jf-select-vr-mode" style="background:#333; color:#fff; border:none; margin-right:4px; border-radius:3px; padding:2px; font-size:12px; outline:none; display:none;">
                        <option value="360_2d">360° 2D</option>
                        <option value="360_3d_lr">360° 左右</option>
                        <option value="360_3d_tb">360° 上下</option>
                        <option value="180_2d">180° 2D</option>
                        <option value="180_3d_lr">180° 左右</option>
                        <option value="plane_2d">平面影院</option>
                    </select>
                    <div class="jf-btn-vr" style="cursor: pointer; padding: 2px 8px; background: #5533ff; border-radius: 4px; font-size: 11px; font-weight: bold; color: white; margin-right: 4px;" title="开启/关闭 VR 模式">🥽 VR</div>
                    <div class="jf-btn-next-video" style="cursor: pointer; padding: 2px 8px; background: #e67e22; border-radius: 4px; font-size: 11px; font-weight: bold; color: white; margin-right: 4px;" title="播放下一个 Part 或视频">下一部</div>
                    <div class="jf-btn-mpv" style="cursor: pointer; padding: 2px 8px; background: #00b300; border-radius: 4px; font-size: 11px; font-weight: bold; color: white; margin-right: 4px;" title="使用 MPV Shim 播放">MPV 播放</div>
                    <div class="jf-btn-next" style="cursor: pointer; padding: 2px 8px; background: #00a4dc; border-radius: 4px; font-size: 11px; font-weight: bold; color: white; margin-right: 4px; display: ${(isRandomMode || isTryNewRandomMode || isFavoriteRandomMode) ? 'block' : 'none'};">换一个</div>
                    <div class="jf-btn-reload" title="重新加载此窗口">刷新</div>
                    <div class="jf-btn-favorite" title="加入/取消最爱" style="background: ${isFav ? '#e6b800' : '#444'};" data-isfav="${isFav}">${isFav ? '已最爱' : '最爱'}</div>
                    <div class="jf-btn-delete" title="删除视频文件">删除</div>
                    <div class="jf-btn-close">关闭</div>
                </div>
            </div>
            <div class="video-wrapper">
                <video class="jf-video-el" autoplay playsinline muted>
                    <source src="${videoUrl}" type="video/mp4">
                    ${tracksHtml}
                </video>
                <div class="jf-trickplay-thumb"></div>
            </div>
            <div class="resizer-se"></div>
        `;

        document.body.appendChild(container);

        const videoEl = container.querySelector('.jf-video-el');

        // Binds VR toggle and select
        const btnVR = container.querySelector('.jf-btn-vr');
        const selectVR = container.querySelector('.jf-select-vr-mode');
        
        btnVR.onclick = (e) => {
            e.stopPropagation();
            toggleVRForWindow(winObj);
        };
        btnVR.onmousedown = (e) => e.stopPropagation();

        selectVR.onchange = (e) => {
            winObj.vrMode = e.target.value;
            if (winObj.vrActive && winObj.vrInstance) {
                updateGeometryAndTextureForWin(winObj, winObj.vrMode);
            }
        };
        selectVR.onmousedown = (e) => e.stopPropagation();
        
        // --- 增加字幕切换逻辑 ---
        const subtitleSelect = container.querySelector('.jf-subtitle-select');
        if (subtitleSelect) {
            const fileName = info?.Path || title || '';
            // 匹配常见的硬字幕标识，如 -C, -UC, -c.mp4, -UC_FHD 等
            const hasHardcodedSubs = /-(u?c)(?:[^a-z0-9]|$)/i.test(fileName);

            if (hasHardcodedSubs) {
                subtitleSelect.value = "-1"; // 默认关闭外挂字幕
            } else {
                const defaultStream = subtitleStreams.find(s => s.IsDefault) || subtitleStreams[0];
                if (defaultStream) {
                    subtitleSelect.value = defaultStream.Index;
                }
            }
            
            const updateSubtitles = () => {
                const selectedIndex = subtitleSelect.value;
                const tracks = videoEl.textTracks;
                for (let i = 0; i < tracks.length; i++) {
                    const trackEl = container.querySelectorAll('track')[i];
                    if (trackEl && trackEl.dataset.index === selectedIndex) {
                        tracks[i].mode = 'showing';
                    } else {
                        tracks[i].mode = 'hidden';
                    }
                }
            };
            
            subtitleSelect.addEventListener('change', (e) => {
                e.stopPropagation();
                updateSubtitles();
            });
            subtitleSelect.addEventListener('mousedown', (e) => e.stopPropagation()); // 防止拖拽干扰
            
            videoEl.addEventListener('loadedmetadata', updateSubtitles, { once: true });
        }
        // --- 结束字幕切换逻辑 ---
        
        // 判定跳转时间：优先使用点击时的预览时间，其次是服务器记录的时间
        const targetSeekTime = startSecond !== null ? startSecond : (resumeTicks / 10000000);
        
        if (targetSeekTime > 0) {
            videoEl.addEventListener('loadedmetadata', () => {
                videoEl.currentTime = targetSeekTime;
            }, { once: true });
        }

        const winObj = { el: container, slotIndex, timestamp: Date.now(), itemId, auth, mainItemId: itemId, partsList: [{ Id: itemId, Name: title }], currentPartIndex: 0 };
        previewWindows.push(winObj);
        currentlyOpeningIds.delete(itemId);
        bringToFront(winObj);
        winObj.info = info; // 存储 info 供后续使用

        // 获取 AdditionalParts
        let additionalParts = [];
        try {
            const url = `${auth.url}/Videos/${itemId}/AdditionalParts?api_key=${auth.token}&userId=${auth.userId}`;
            const res = await fetch(url);
            if (res.ok) {
                const data = await res.json();
                additionalParts = data.Items || [];
            }
        } catch (e) {
            console.error('[JF] Error fetching additional parts:', e);
        }
        winObj.partsList = [{ Id: itemId, Name: title }, ...additionalParts];
        winObj.currentPartIndex = 0;

        updateHeaderTitleForWin(winObj, title);

        videoEl.addEventListener('ended', () => {
            console.log('[JF] Video ended, playing next part or next video...');
            playNextForWindow(winObj);
        });

        const btnNextVideo = container.querySelector('.jf-btn-next-video');
        if (btnNextVideo) {
            btnNextVideo.onclick = (e) => {
                e.stopPropagation();
                playNextForWindow(winObj);
            };
            btnNextVideo.onmousedown = (e) => e.stopPropagation();
        }

        // 初始化预览图与交互
        setupTrickplay(winObj, itemId, auth);
        setupInteractions(winObj);

        markAsPlayed(itemId, auth);
        reportPlayback(itemId, auth, 0, false, 'Started');

        // 每 10 秒即时上报进度
        winObj.progressTimer = setInterval(() => {
            if (!videoEl.paused) {
                reportPlayback(itemId, auth, videoEl.currentTime, false, 'Progress');
            }
        }, 10000);

        // === 新增：MPV Shim 投屏功能 ===
        const btnMPV = container.querySelector('.jf-btn-mpv');
        if (btnMPV) {
            btnMPV.onclick = async (e) => {
                e.stopPropagation();
                const auth = getAuth();
                if (!auth) return;

                // 暂停当前小窗口的视频播放以节省资源
                if (videoEl) {
                    videoEl.pause();
                }

                const startTicks = Math.floor((videoEl ? videoEl.currentTime : 0) * 10000000);

                // 查询所有 Sessions，寻找 MPV Shim
                let mpvSession = null;
                try {
                    const res = await fetch(`${auth.url}/Sessions?api_key=${auth.token}`);
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);
                    const sessions = await res.json();

                    // 诊断：打印所有会话，方便 F12 调试
                    console.log('[JF MPV] 当前所有 Sessions:');
                    sessions.forEach(s => console.log(
                        `  Client="${s.Client}" | DeviceName="${s.DeviceName}" | SupportsMediaControl=${s.SupportsMediaControl} | Id=${s.Id}`
                    ));

                    // 1. 精确匹配官方客户端名 "Jellyfin MPV Shim"
                    mpvSession = sessions.find(s => s.Client === 'Jellyfin MPV Shim');

                    // 2. 宽松匹配：Client 或 DeviceName 含 "mpv"（大小写不敏感）
                    if (!mpvSession) {
                        mpvSession = sessions.find(s =>
                            (s.Client && (s.Client.toLowerCase().includes('mpv') || s.Client.toLowerCase().includes('jellium'))) ||
                            (s.DeviceName && (s.DeviceName.toLowerCase().includes('mpv') || s.DeviceName.toLowerCase().includes('jellium')))
                        );
                    }

                    // 3. 最后兜底：支持媒体控制 且 非浏览器 Web 客户端
                    if (!mpvSession) {
                        mpvSession = sessions.find(s =>
                            s.SupportsMediaControl &&
                            s.Client !== 'Jellyfin Web' &&
                            s.Client !== 'Jellyfin Web Client'
                        );
                    }
                } catch (err) {
                    console.error('[JF MPV] 获取 Sessions 失败:', err);
                    showToast('❌ 无法查询 Sessions，请检查 F12 控制台', 'warning');
                    return;
                }

                if (mpvSession) {
                    console.log(`[JF MPV] 找到目标: Client="${mpvSession.Client}" Device="${mpvSession.DeviceName}"，正在投屏...`);
                    try {
                        const playParams = new URLSearchParams({
                            api_key: auth.token,
                            playCommand: 'PlayNow',
                            itemIds: itemId,
                            startPositionTicks: startTicks
                        });
                        const playUrl = `${auth.url}/Sessions/${mpvSession.Id}/Playing?${playParams}`;
                        const playRes = await fetch(playUrl, { method: 'POST' });
                        console.log(`[JF MPV] 投屏响应: HTTP ${playRes.status}`);
                        if (playRes.ok) {
                            showToast(`🎬 已投屏到 ${mpvSession.Client} (${mpvSession.DeviceName})！`);
                            return;
                        } else {
                            const errText = await playRes.text().catch(() => '');
                            console.error('[JF MPV] 投屏失败:', errText);
                            showToast(`❌ 投屏失败 HTTP ${playRes.status}，请查看 F12 控制台`, 'warning');
                        }
                    } catch (playErr) {
                        console.error('[JF MPV] 投屏请求异常:', playErr);
                        showToast('❌ 投屏请求异常，请查看 F12 控制台', 'warning');
                    }
                } else {
                    // 未找到任何可控制的 MPV 会话
                    console.warn('[JF MPV] 未找到可用 MPV Shim Session，请查看 F12 控制台中的 Sessions 列表确认客户端名称。');
                    showToast('⚠️ 未找到 MPV Shim 会话！确认：1) MPV Shim 已启动并登录  2) F12 查看 [JF MPV] 日志  3) 确认 Client 名称', 'warning');
                }
            };
        }

        const btnNext = container.querySelector('.jf-btn-next');
        if (btnNext) {
            btnNext.onclick = (e) => {
                e.stopPropagation();
                const currentSlot = winObj.slotIndex;
                destroyWindow(winObj);
                handleRandomWindowClose(currentSlot);
            };
        }

        const btnReload = container.querySelector('.jf-btn-reload');
        if (btnReload) {
            btnReload.onclick = (e) => {
                e.stopPropagation();
                const currentTime = videoEl.currentTime;
                // 销毁窗口但不触发递补，让 createPreview 直接填回原槽位
                destroyWindow(winObj);
                createPreview(itemId, title, currentTime);
            };
        }

        const btnFavorite = container.querySelector('.jf-btn-favorite');
        if (btnFavorite) {
            btnFavorite.onclick = async (e) => {
                e.stopPropagation();
                let currentlyFav = btnFavorite.getAttribute('data-isfav') === 'true';
                let success = await toggleFavorite(itemId, auth, currentlyFav);
                if (success) {
                    currentlyFav = !currentlyFav;
                    btnFavorite.setAttribute('data-isfav', currentlyFav.toString());
                    btnFavorite.innerText = currentlyFav ? '已最爱' : '最爱';
                    btnFavorite.style.background = currentlyFav ? '#e6b800' : '#444';
                    
                    // 尝试在页面上找到对应的卡片并更新其爱心图标
                    const card = document.querySelector(`.card[data-id="${itemId}"]`);
                    if (card) {
                        let favIcon = card.querySelector('.jf-custom-fav-icon');
                        if (currentlyFav) {
                            if (!favIcon) {
                                favIcon = document.createElement('div');
                                favIcon.className = 'jf-custom-fav-icon';
                                favIcon.innerHTML = '❤️';
                                favIcon.style.position = 'absolute';
                                favIcon.style.top = '5px';
                                favIcon.style.right = '5px';
                                favIcon.style.zIndex = '10';
                                favIcon.style.fontSize = '20px';
                                const imgContainer = card.querySelector('.cardImageContainer');
                                if (imgContainer) imgContainer.appendChild(favIcon);
                            }
                        } else if (favIcon) {
                            favIcon.remove();
                        }
                    }
                }
            };
        }

        const btnDelete = container.querySelector('.jf-btn-delete');
        if (btnDelete) {
            btnDelete.onclick = async (e) => {
                e.stopPropagation();
                if (confirm('确定要删除此视频吗？\n警告：这将从服务器和物理硬盘上永久删除该文件！')) {
                    const currentSlot = winObj.slotIndex;
                    destroyWindow(winObj);
                    
                    // 调用 API 删除
                    await deleteItem(itemId, auth);
                    
                    // 触发递补（内部会判断是否开启新窗口）
                    handleRandomWindowClose(currentSlot);
                    
                    // 从当前页面 DOM 中移除该卡片，避免再次被随机抽中
                    const card = document.querySelector(`.card[data-id="${itemId}"]`);
                    if (card) {
                        card.remove();
                    }
                }
            };
        }

        container.querySelector('.jf-btn-close').onclick = (e) => {
            e.stopPropagation();
            const currentSlot = winObj.slotIndex;
            destroyWindow(winObj);
            handleRandomWindowClose(currentSlot);
        };
    }

    // 处理精灵图
    function setupTrickplay(winObj, itemId, auth) {
        const video = winObj.el.querySelector('.jf-video-el');
        const thumbBox = winObj.el.querySelector('.jf-trickplay-thumb');

        const update = (time, xPercent) => {
            const tp = getTrickplayInfo(winObj.info);
            const targetId = tp.id || itemId;
            const tpInterval = tp.interval || 10;
            
            const totalTiles = Math.floor(time / tpInterval);
            const isSprite = tp.cols > 1;
            const spriteIdx = isSprite ? Math.floor(totalTiles / (tp.cols * tp.rows)) : totalTiles;
            
            thumbBox.style.display = 'block';
            if (xPercent !== undefined) thumbBox.style.left = (xPercent * 100) + '%';
            else thumbBox.style.left = '50%';

            thumbBox.style.backgroundImage = `url('${auth.url}/Videos/${targetId}/Trickplay/${tp.width}/${spriteIdx}.jpg?ApiKey=${auth.token}&MediaSourceId=${targetId}')`;
            
            if (isSprite) {
                const tileIdx = totalTiles % (tp.cols * tp.rows);
                const posX = (tileIdx % tp.cols / (tp.cols - 1)) * 100;
                const posY = (Math.floor(tileIdx / tp.cols) / (tp.rows - 1)) * 100;
                thumbBox.style.backgroundSize = `${tp.cols * 100}% ${tp.rows * 100}%`;
                thumbBox.style.backgroundPosition = `${posX}% ${posY}%`;
            } else {
                thumbBox.style.backgroundSize = 'contain';
                thumbBox.style.backgroundPosition = 'center';
            }
        };

        winObj.updateThumb = update;

        video.addEventListener('mousemove', (e) => {
            // 模式：在底部 1/8 区域或者正在滚动寻找进度时，显示原生控件
            if (e.offsetY > video.offsetHeight * 0.875 || winObj.isWheelSeeking) {
                video.controls = true; 
                // 如果正在滚轮快进，则不要根据鼠标位置更新预览图，避免冲突
                if (winObj.isWheelSeeking) return;

                const rect = video.getBoundingClientRect();
                const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                update(video.duration * percent, percent);
            } else {
                video.controls = false; // 离开区域隐藏控件
                if (!winObj.isWheelSeeking) thumbBox.style.display = 'none';
            }
        });

        video.addEventListener('mouseleave', () => {
            video.controls = false;
            // 如果不是在滚动中，则隐藏
            if (!winObj.isWheelSeeking) thumbBox.style.display = 'none';
        });

        // 当视频真正跳转完成后，交由延时器去隐藏缩略图，防止跳动
        video.addEventListener('seeked', () => {
             // 保留为空，交由 wheelTimer/hideTimer 自然管理
        });
    }

    // 自动播放与分段处理相关辅助函数
    function formatTime(seconds) {
        if (isNaN(seconds)) return '0:00';
        const hrs = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        const pad = (num) => String(num).padStart(2, '0');
        if (hrs > 0) {
            return `${hrs}:${pad(mins)}:${pad(secs)}`;
        }
        return `${mins}:${pad(secs)}`;
    }

    function updateHeaderTitleForWin(winObj, overrideTitle) {
        const headerTitleSpan = winObj.el.querySelector('.jf-preview-header span:first-child');
        if (!headerTitleSpan) return;

        const info = winObj.info;
        const playCount = info?.UserData?.PlayCount || 0;
        const baseTitle = overrideTitle || winObj.partsList?.[0]?.Name || info?.Name || 'Video';

        let partText = '';
        if (winObj.partsList && winObj.partsList.length > 1) {
            partText = ` (Part ${winObj.currentPartIndex + 1}/${winObj.partsList.length})`;
        }

        headerTitleSpan.innerHTML = `<span class="jf-title-play-count" style="color:#aaa; font-size:11px; margin-right:8px;" title="播放次数">[播放: ${playCount}]</span>${baseTitle}${partText}`;
    }

    async function playPartInWindow(winObj, partIndex) {
        const videoEl = winObj.el.querySelector('.jf-video-el');
        if (!videoEl) return;

        const partItem = winObj.partsList[partIndex];
        if (!partItem) return;

        winObj.currentPartIndex = partIndex;
        winObj.itemId = partItem.Id;

        // Stop current VR if active
        const wasVRActive = winObj.vrActive;
        if (wasVRActive) {
            closeVRForWindow(winObj);
        }

        // Fetch new item info for the part
        let info;
        try {
            info = await getItemInfo(partItem.Id, winObj.auth);
        } catch (e) {
            console.error('[JF] Failed to fetch info for part:', e);
        }
        if (info) {
            winObj.info = info;
            itemCache.set(partItem.Id, info);
        }

                        const mediaSource = info?.MediaSources?.[0];
        const mediaSourceId = mediaSource?.Id;
        const videoUrl = getVideoStreamUrl(partItem.Id, winObj.auth, mediaSourceId);
        
        videoEl.innerHTML = `<source src="${videoUrl}" type="video/mp4">`;
        videoEl.load();
        videoEl.play().catch(() => {});

        if (wasVRActive) {
            setTimeout(() => {
                toggleVRForWindow(winObj);
            }, 500);
        }

        updateHeaderTitleForWin(winObj);
        setupTrickplay(winObj, partItem.Id, winObj.auth);
    }

    async function transitionWindowToItem(winObj, nextItemId, nextTitle) {
        const wasVRActive = winObj.vrActive;
        if (winObj.vrActive) {
            closeVRForWindow(winObj);
        }

        let info;
        try {
            info = await getItemInfo(nextItemId, winObj.auth);
        } catch (e) {
            console.error('[JF] Failed to fetch info for transitioned item:', e);
            return;
        }

        if (info) {
            itemCache.set(nextItemId, info);
        }

        // 获取新 Item 的 AdditionalParts
        let additionalParts = [];
        try {
            const url = `${winObj.auth.url}/Videos/${nextItemId}/AdditionalParts?api_key=${winObj.auth.token}&userId=${winObj.auth.userId}`;
            const res = await fetch(url);
            if (res.ok) {
                const data = await res.json();
                additionalParts = data.Items || [];
            }
        } catch (e) {
            console.error('[JF] Error fetching additional parts:', e);
        }

        winObj.itemId = nextItemId;
        winObj.mainItemId = nextItemId;
        winObj.partsList = [{ Id: nextItemId, Name: nextTitle }, ...additionalParts];
        winObj.currentPartIndex = 0;
        winObj.info = info;

                        const videoEl = winObj.el.querySelector('.jf-video-el');
        if (videoEl) {
            const mediaSource = info?.MediaSources?.[0];
            const mediaSourceId = mediaSource?.Id;
            const videoUrl = getVideoStreamUrl(nextItemId, winObj.auth, mediaSourceId);
            videoEl.innerHTML = `<source src="${videoUrl}" type="video/mp4">`;
            videoEl.load();
            videoEl.play().catch(() => {});
        }

        updateHeaderTitleForWin(winObj, nextTitle);
        setupTrickplay(winObj, nextItemId, winObj.auth);

        if (wasVRActive) {
            setTimeout(() => {
                toggleVRForWindow(winObj);
            }, 500);
        }
    }

    async function getNextItemInFolder(itemId, info, auth) {
        const parentId = info?.ParentId || info?.SeasonId || info?.SeriesId;
        if (!parentId) return null;

        try {
            const url = `${auth.url}/Users/${auth.userId}/Items?ParentId=${parentId}&SortBy=SortName,ParentIndexNumber,IndexNumber,ProductionYear&api_key=${auth.token}`;
            const response = await fetch(url);
            const data = await response.json();
            const items = data.Items || [];

            const currentIndex = items.findIndex(item => item.Id === itemId);
            if (currentIndex !== -1 && currentIndex < items.length - 1) {
                const nextItem = items[currentIndex + 1];
                return {
                    id: nextItem.Id,
                    title: nextItem.Name
                };
            }
        } catch (e) {
            console.error('[JF] Error fetching next item in folder:', e);
        }
        return null;
    }

    async function playNextForWindow(winObj) {
        const videoEl = winObj.el.querySelector('.jf-video-el');
        if (!videoEl) return;

        // 1. 检查当前 item 是否有未播放完的分段 (AdditionalParts)
        if (winObj.partsList && winObj.currentPartIndex < winObj.partsList.length - 1) {
            const nextPartIndex = winObj.currentPartIndex + 1;
            console.log(`[JF] Playing next part (${nextPartIndex + 1}/${winObj.partsList.length}) of item ${winObj.mainItemId}`);
            await playPartInWindow(winObj, nextPartIndex);
            return;
        }

        // 2. 否则，寻找同一个文件夹/Season 中的下一个 Item (下一集/同一个文件夹下的下一部影片)
        const nextItem = await getNextItemInFolder(winObj.mainItemId, winObj.info, winObj.auth);
        if (nextItem) {
            console.log(`[JF] Autoplay transitioning to next item in folder: ${nextItem.title} (ID: ${nextItem.id})`);
            await transitionWindowToItem(winObj, nextItem.id, nextItem.title);
            return;
        }

        // 3. 兜底：寻找页面上的下一个卡片
        const currentCard = document.querySelector(`.card[data-id="${winObj.mainItemId}"]`);
        if (currentCard) {
            let nextCard = currentCard.nextElementSibling;
            while (nextCard && !nextCard.classList.contains('card')) {
                nextCard = nextCard.nextElementSibling;
            }
            if (nextCard) {
                const nextItemId = nextCard.getAttribute('data-id');
                const nextTitle = nextCard.querySelector('.cardText-first, .cardText')?.textContent || 'Next Video';
                if (nextItemId) {
                    console.log(`[JF] Autoplay falling back to next card: ${nextTitle} (ID: ${nextItemId})`);
                    await transitionWindowToItem(winObj, nextItemId, nextTitle);
                    return;
                }
            }
        }

        console.log('[JF] No next part or next item/card found.');
    }

    // 交互与手动调整
    function toggleVRForWindow(winObj) {
        const btn = winObj.el.querySelector('.jf-btn-vr');
        const select = winObj.el.querySelector('.jf-select-vr-mode');
        const videoEl = winObj.el.querySelector('.jf-video-el');

        if (!videoEl) return;

        if (winObj.vrActive) {
            closeVRForWindow(winObj);
            btn.innerHTML = '🥽 VR';
            btn.style.backgroundColor = '#5533ff';
            select.style.display = 'none';
        } else {
            winObj.vrActive = true;
            btn.innerHTML = '❌ 退出';
            btn.style.backgroundColor = '#d63031';
            select.style.display = 'inline-block';
            initVRForWindow(winObj);
        }
    }

    function initVRForWindow(winObj) {
        const videoEl = winObj.el.querySelector('.jf-video-el');
        const videoWrapper = winObj.el.querySelector('.video-wrapper');
        if (!videoEl || !videoWrapper) return;

        let vrContainer = winObj.el.querySelector('.jf-vr-container');
        if (!vrContainer) {
            vrContainer = document.createElement('div');
            vrContainer.className = 'jf-vr-container';
            videoWrapper.appendChild(vrContainer);
        }
        vrContainer.style.display = 'block';
        videoEl.style.opacity = '0';

        // 备份关键的全局滚动属性与样式（防范 mxreality.js 通过直接赋值覆盖而绕过 addEventListener 劫持）
        const targets = [
            { obj: window, name: 'window' },
            { obj: document, name: 'document' },
            { obj: document.body, name: 'body' },
            { obj: document.documentElement, name: 'html' }
        ];
        const props = ['onwheel', 'onmousewheel', 'ontouchmove'];

        winObj.capturedProperties = [];
        targets.forEach(t => {
            if (!t.obj) return;
            props.forEach(p => {
                winObj.capturedProperties.push({
                    target: t.obj,
                    prop: p,
                    value: t.obj[p]
                });
            });
        });

        if (document.body) {
            winObj.capturedProperties.push({ target: document.body.style, prop: 'overflow', value: document.body.style.overflow });
            winObj.capturedProperties.push({ target: document.body, prop: 'className', value: document.body.className });
        }
        if (document.documentElement) {
            winObj.capturedProperties.push({ target: document.documentElement.style, prop: 'overflow', value: document.documentElement.style.overflow });
            winObj.capturedProperties.push({ target: document.documentElement, prop: 'className', value: document.documentElement.className });
        }

        // 启用全局劫持逻辑，用于捕获异步/延迟注册的 mxreality.js 监听器并屏蔽全局滚动劫持
        winObj.capturedWindowListeners = [];
        window.jfVRCapturingActiveList = winObj.capturedWindowListeners;
        window.jfVRCapturing = true;

        // 5秒后停止全局劫持捕获（此时 mxreality.js 内部异步初始化流程均已完毕）
        setTimeout(() => {
            if (window.jfVRCapturingActiveList === winObj.capturedWindowListeners) {
                window.jfVRCapturing = false;
                window.jfVRCapturingActiveList = null;
            }
        }, 5000);

        // 初始化 Three.js
        const scene = new THREE.Scene();
        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.setSize(videoWrapper.clientWidth, videoWrapper.clientHeight);
        vrContainer.innerHTML = '';
        vrContainer.appendChild(renderer.domElement);

        const vr = new VR(scene, renderer, vrContainer, { fov: 100 });
        winObj.vrInstance = vr;
        vr.vrbox.radius = 500;

        vr.init(() => {
            console.log("VR Window Engine Initialized");
            setTimeout(() => {
                updateGeometryAndTextureForWin(winObj, winObj.vrMode || '360_2d');
            }, 100);
        });

        const videoSrc = videoEl.currentSrc || videoEl.src;
        if (!videoSrc) {
            console.error("No video source found for VR");
            return;
        }

        let playType = vr.resType.video;
        if (videoSrc.includes('.m3u8')) {
            playType = vr.resType.sliceVideo;
        }

        vr.play(videoSrc, playType, {
            muted: true,
            autoplay: true
        });

        if (vr.video) {
            vr.video.pause();
            vr.video.src = "";
            vr.video.removeAttribute("src");
            try { vr.video.load(); } catch(e) {}
        }

        const originalTexture = new THREE.VideoTexture(videoEl);
        originalTexture.generateMipmaps = false;
        originalTexture.minFilter = THREE.LinearFilter;
        originalTexture.magFilter = THREE.LinearFilter;
        originalTexture.format = THREE.RGBAFormat;

        const mesh = vr.VRObject.getObjectByName('__mxrealityDefault');
        if (mesh) {
            mesh.material.map = originalTexture;
            mesh.material.needsUpdate = true;
        }

        initVRControlsForWindow(winObj);

        // 使用 ResizeObserver 监听窗口尺寸变化以调整 canvas
        if (winObj.resizeObserver) {
            winObj.resizeObserver.disconnect();
        }
        winObj.resizeObserver = new ResizeObserver(() => {
            if (winObj.vrInstance && winObj.vrInstance.renderer) {
                const w = videoWrapper.clientWidth;
                const h = videoWrapper.clientHeight;
                winObj.vrInstance.renderer.setSize(w, h);
                if (winObj.vrInstance.effect) {
                    winObj.vrInstance.effect.setSize(w, h);
                }
                winObj.vrInstance.camera.aspect = w / h;
                winObj.vrInstance.camera.updateProjectionMatrix();
            }
        });
        winObj.resizeObserver.observe(videoWrapper);
    }

    function closeVRForWindow(winObj) {
        winObj.vrActive = false;
        
        const videoEl = winObj.el.querySelector('.jf-video-el');
        if (videoEl) {
            videoEl.style.opacity = '1';
        }

        const vrContainer = winObj.el.querySelector('.jf-vr-container');
        if (vrContainer) {
            vrContainer.style.display = 'none';
            vrContainer.innerHTML = '';
        }

        if (winObj.resizeObserver) {
            winObj.resizeObserver.disconnect();
            winObj.resizeObserver = null;
        }

        removeVRControlsForWindow(winObj);

        // 清理 mxreality.js 注册在 window/document 上的全局事件监听器
        if (winObj.capturedWindowListeners) {
            winObj.capturedWindowListeners.forEach(item => {
                item.target.removeEventListener(item.type, item.listener, item.options);
            });
            winObj.capturedWindowListeners = null;
        }
        if (window.jfVRCapturingActiveList === winObj.capturedWindowListeners) {
            window.jfVRCapturing = false;
            window.jfVRCapturingActiveList = null;
        }

        // 还原记录的滚动属性、样式与 class
        if (winObj.capturedProperties) {
            winObj.capturedProperties.forEach(item => {
                try {
                    item.target[item.prop] = item.value;
                } catch(e) {}
            });
            winObj.capturedProperties = null;
        }

        if (winObj.vrInstance) {
            winObj.vrInstance.video = null;
            try { winObj.vrInstance.destroy(); } catch(e) {}
            winObj.vrInstance = null;
        }
    }

    function updateGeometryAndTextureForWin(winObj, mode) {
        if (!winObj.vrInstance || !winObj.vrInstance.VRObject) return;
        const mesh = winObj.vrInstance.VRObject.getObjectByName('__mxrealityDefault');
        if (!mesh) return;

        const texture = mesh.material.map;
        if (texture) {
            texture.repeat.set(1, 1);
            texture.offset.set(0, 0);
            switch (mode) {
                case '360_3d_lr':
                case '180_3d_lr':
                    texture.repeat.set(0.5, 1);
                    texture.offset.set(0, 0); 
                    break;
                case '360_3d_tb':
                    texture.repeat.set(1, 0.5);
                    texture.offset.set(0, 0.5);
                    break;
            }
        }

        let newGeo;
        const radius = 500;

        switch (mode) {
            case '180_2d':
            case '180_3d_lr':
                newGeo = new THREE.SphereGeometry(radius, 60, 40, Math.PI * 1.5, Math.PI);
                newGeo.scale(-1, 1, 1);
                break;
            case 'plane_2d':
                newGeo = new THREE.PlaneGeometry(radius * 1.6, radius * 0.9);
                mesh.position.set(0, 0, -radius);
                mesh.rotation.set(0, 0, 0);
                mesh.scale.set(1, 1, 1); 
                mesh.material.side = THREE.DoubleSide;
                break;
            case '360_2d':
            case '360_3d_lr':
            case '360_3d_tb':
            default:
                newGeo = new THREE.SphereGeometry(radius, 60, 40);
                newGeo.scale(-1, 1, 1); 
                mesh.position.set(0, 0, 0);
                break;
        }

        if (mode !== 'plane_2d' && mesh.geometry.type !== 'PlaneGeometry') {
             mesh.position.set(0, 0, 0);
             mesh.rotation.set(0, 0, 0);
        }
        mesh.geometry.dispose();
        mesh.geometry = newGeo;
    }

    function zoomVRForWindow(winObj, zoomIn) {
        if (!winObj.vrInstance || !winObj.vrInstance.camera) return;
        const t = zoomIn ? -15 : 15;
        const fovStep = 0.05 * t;
        const targetFov = winObj.vrInstance.camera.fov + fovStep;
        if (targetFov >= 10 && targetFov <= 120) {
            winObj.vrInstance.camera.fov = targetFov;
            winObj.vrInstance.camera.updateProjectionMatrix();
        }
    }

    function startZoomingForWindow(winObj, zoomIn) {
        stopZoomingForWindow(winObj);
        zoomVRForWindow(winObj, zoomIn);
        winObj.zoomInterval = setInterval(() => {
            zoomVRForWindow(winObj, zoomIn);
        }, 50);
    }

    function stopZoomingForWindow(winObj) {
        if (winObj.zoomInterval) {
            clearInterval(winObj.zoomInterval);
            winObj.zoomInterval = null;
        }
    }

    function removeVRControlsForWindow(winObj) {
        stopZoomingForWindow(winObj);

        const vrContainer = winObj.el.querySelector('.jf-vr-container');
        if (!vrContainer) return;

        if (winObj.mouseMoveHandler) {
            vrContainer.removeEventListener('mousemove', winObj.mouseMoveHandler, { capture: true });
            winObj.mouseMoveHandler = null;
        }
        if (winObj.wheelHandler) {
            vrContainer.removeEventListener('wheel', winObj.wheelHandler, { capture: true });
            winObj.wheelHandler = null;
        }
        if (winObj.mouseDownHandler) {
            vrContainer.removeEventListener('mousedown', winObj.mouseDownHandler, { capture: true });
            winObj.mouseDownHandler = null;
        }
        if (winObj.mouseUpHandler) {
            vrContainer.removeEventListener('mouseup', winObj.mouseUpHandler, { capture: true });
            winObj.mouseUpHandler = null;
        }
        if (winObj.clickHandler) {
            vrContainer.removeEventListener('click', winObj.clickHandler, { capture: true });
            winObj.clickHandler = null;
        }
    }

    function initVRControlsForWindow(winObj) {
        removeVRControlsForWindow(winObj);

        const vrContainer = winObj.el.querySelector('.jf-vr-container');
        if (!vrContainer) return;

        winObj.mouseMoveHandler = function(e) {
            if (e.buttons === 1) return; // 忽略左键拖拽以允许窗口拖动/缩放

            if (!winObj.vrInstance || !winObj.vrInstance.controls) return;

            const sensitivity = 0.0025; 
            const dx = e.movementX || 0;
            const dy = e.movementY || 0;

            if (Math.abs(dx) > 0) winObj.vrInstance.controls.rotationLeft(dx * sensitivity);
            if (Math.abs(dy) > 0) winObj.vrInstance.controls.rotationUp(dy * sensitivity);
        };

        winObj.wheelHandler = function(e) {
            e.stopPropagation();
            e.stopImmediatePropagation();
            e.preventDefault();

            const video = winObj.el.querySelector('.jf-video-el');
            if (!video) return;

            const step = 10;
            const duration = video.duration || 0;
            if (duration === 0) return;

            let targetTime = video.currentTime;
            if (e.deltaY > 0) {
                targetTime = Math.min(duration, targetTime + step);
            } else {
                targetTime = Math.max(0, targetTime - step);
            }
            video.currentTime = targetTime;

            if (typeof winObj.updateThumb === 'function') {
                winObj.updateThumb(targetTime, targetTime / duration);
            }
        };

        winObj.mouseDownHandler = function(e) {
            // 阻止左键 mousedown 事件在 VR 容器内冒泡，以避免触发 jf-preview-instance 的拖拽动作干扰 look-around
            if (e.button === 0) {
                e.stopPropagation();
            }

            if (e.button === 3 || e.button === 4 || e.button === 1) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();

                if (e.button === 4) {
                    startZoomingForWindow(winObj, true);
                } else if (e.button === 3) {
                    startZoomingForWindow(winObj, false);
                } else if (e.button === 1) {
                    toggleVRForWindow(winObj); // 中键退出 VR 模式
                }
            }
        };

        winObj.mouseUpHandler = function(e) {
            stopZoomingForWindow(winObj);

            if (e.button === 3 || e.button === 4 || e.button === 1) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
            }
        };

        winObj.clickHandler = function(e) {
            if (e.button === 3 || e.button === 4 || e.button === 1) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
            }
        };

        vrContainer.addEventListener('mousemove', winObj.mouseMoveHandler, { capture: true });
        vrContainer.addEventListener('wheel', winObj.wheelHandler, { capture: true, passive: false });
        vrContainer.addEventListener('mousedown', winObj.mouseDownHandler, { capture: true });
        vrContainer.addEventListener('mouseup', winObj.mouseUpHandler, { capture: true });
        vrContainer.addEventListener('click', winObj.clickHandler, { capture: true });
    }

    function setupInteractions(winObj) {
        const el = winObj.el;
        let isDragging = false, isResizing = false;
        const header = el.querySelector('.jf-preview-header');
        const resizer = el.querySelector('.resizer-se');
        const video = el.querySelector('.jf-video-el');

        // 右键点击标题栏时，代理触发对应海报的原生右键菜单
        header.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const card = document.querySelector(`.card[data-id="${winObj.itemId}"]`);
            if (card) {
                const evt = new MouseEvent('contextmenu', {
                    bubbles: true,
                    cancelable: true,
                    view: window,
                    clientX: e.clientX,
                    clientY: e.clientY
                });
                card.dispatchEvent(evt);
            }
        });

        // 无论点击哪里，都置顶；中键点击则关闭
        el.addEventListener('mousedown', (e) => {
            bringToFront(winObj);
            if (e.button === 1) {
                if (winObj.vrActive) {
                    return;
                }
                e.stopPropagation();
                e.stopImmediatePropagation();
                e.preventDefault();
                const currentSlot = winObj.slotIndex;
                destroyWindow(winObj);
                handleRandomWindowClose(currentSlot);
            }
        }, true); // 使用捕获模式优先处理中键关闭

        const startDrag = (e) => {
            if (e.button !== 0) return; // 只有左键可以拖动
            if (e.target.classList.contains('jf-btn-close') || e.target.classList.contains('jf-btn-delete') || e.target.classList.contains('jf-btn-next') || e.target.classList.contains('jf-btn-favorite') || e.target.classList.contains('jf-btn-reload') || e.target.closest('.jf-subtitle-select') || e.target.classList.contains('jf-btn-vr') || e.target.classList.contains('jf-btn-next-video') || e.target.closest('.jf-select-vr-mode')) return;
            // 如果点击的是视频区域且在底部 20% 范围内（通常是进度条），则不触发拖动
            if (e.target.tagName === 'VIDEO' && e.offsetY > e.target.offsetHeight * 0.8) return;

            isDragging = true;
            let moved = false;
            const startX = e.clientX, startY = e.clientY;
            el.style.transition = 'none';
            let ox = e.clientX - el.offsetLeft, oy = e.clientY - el.offsetTop;

            const move = (ev) => {
                if (!isDragging) return;
                const dist = Math.sqrt(Math.pow(ev.clientX - startX, 2) + Math.pow(ev.clientY - startY, 2));
                if (dist > 5) moved = true;
                el.style.left = (ev.clientX - ox) + 'px'; el.style.top = (ev.clientY - oy) + 'px';
                scheduleUpdateOverlaps();
            };

            // 拦截点击事件以防止误触发暂停
            const onClick = (ev) => {
                if (moved) {
                    ev.stopImmediatePropagation();
                    ev.preventDefault();
                }
                video.removeEventListener('click', onClick, true);
            };
            video.addEventListener('click', onClick, true);

            const up = () => {
                isDragging = false;
                el.style.transition = 'all 0.4s cubic-bezier(0.165, 0.84, 0.44, 1)';
                document.removeEventListener('mousemove', move);
                document.removeEventListener('mouseup', up);
            };
            document.addEventListener('mousemove', move);
            document.addEventListener('mouseup', up);
        };

        header.onmousedown = startDrag;
        video.onmousedown = startDrag;

        resizer.onmousedown = (e) => {
            if (e.button !== 0) return;
            isResizing = true;
            el.style.transition = 'none';
            let sw = el.offsetWidth, sh = el.offsetHeight, sx = e.clientX, sy = e.clientY;
            const move = (ev) => {
                if (!isResizing) return;
                el.style.width = (sw + (ev.clientX - sx)) + 'px'; el.style.height = (sh + (ev.clientY - sy)) + 'px';
                scheduleUpdateOverlaps();
            };
            const up = () => { isResizing = false; el.style.transition = 'all 0.4s cubic-bezier(0.165, 0.84, 0.44, 1)'; document.removeEventListener('mousemove', move); };
            document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
            e.preventDefault();
        };

        // 滚轮快进快退 logic - 优化流畅度
        let wheelTimer = null;
        let hideTimer = null;
        
        el.addEventListener('wheel', (e) => {
            e.preventDefault();
            const step = 5;
            const duration = video.duration || 0;
            if (duration === 0) return;

            // 标记正在使用滚轮寻找，显示原生控件
            winObj.isWheelSeeking = true;
            video.controls = true;

            // 立即计算并更新视频时间，以同步原生进度条
            let targetTime = video.currentTime;
            if (e.deltaY > 0) {
                targetTime = Math.min(duration, targetTime + step);
            } else {
                targetTime = Math.max(0, targetTime - step);
            }
            
            video.currentTime = targetTime;
            
            // 实时显示 trickplay 缩略图
            if (typeof winObj.updateThumb === 'function') {
                winObj.updateThumb(targetTime, targetTime / duration);
            }

            clearTimeout(wheelTimer);
            clearTimeout(hideTimer);
            
            wheelTimer = setTimeout(() => {
                if (!video.paused) video.play().catch(() => { });
                // 快进后上报一次进度，确保同步
                reportPlayback(winObj.itemId, winObj.auth, video.currentTime, false, 'Progress');
                
                // 延迟 0.3 秒后关闭预览和控制条
                hideTimer = setTimeout(() => { 
                    winObj.isWheelSeeking = false;
                    const thumbBox = winObj.el.querySelector('.jf-trickplay-thumb');
                    if (thumbBox) thumbBox.style.display = 'none';
                    // 如果不在底部 1/8 热区（即常规进度条区域），则关闭原生控件展示
                    if (!video.matches(':hover') || e.offsetY <= video.offsetHeight * 0.875) {
                         video.controls = false;
                    }
                }, 300);
            }, 100); // 稍微增加防抖，减少频繁的 API 上报
        }, { passive: false });
    }

        style.textContent += `
            .countIndicator, .playedIndicator, .playedIndicatorContainer, .playCountIndicator, .playcount {
                pointer-events: auto !important;
                cursor: pointer !important;
            }
        `;
        document.head.appendChild(style);

    // --- 创建真正的脱离框架的悬浮进度条组件 ---
    let globalProgressPopup = document.createElement('div');
    globalProgressPopup.id = 'jf-global-progress-popup';
    globalProgressPopup.innerHTML = '<div class="jf-popup-bar"></div>';
    document.body.appendChild(globalProgressPopup);

    let globalTrickplayPreview = document.createElement('div');
    globalTrickplayPreview.id = 'jf-global-trickplay-preview';
    document.body.appendChild(globalTrickplayPreview);
    
    let isDraggingGlobalProgress = false;

    function handleProgressInteraction(e, doSeek) {
         const itemId = globalProgressPopup.dataset.itemId;
         if (!itemId) return;
         
         const pRect = globalProgressPopup.getBoundingClientRect();
         let clientX = e.clientX ?? (e.touches && e.touches.length > 0 ? e.touches[0].clientX : 0);
         if (!clientX) return;

         const clickedPercent = Math.max(0, Math.min(1, (clientX - pRect.left) / pRect.width));
         
         const cItemInfo = itemCache.get(itemId);
         if (!cItemInfo || !cItemInfo.RunTimeTicks) return;
         
         const durSec = cItemInfo.RunTimeTicks / 10000000;
         const cSeek = durSec * clickedPercent;
         
         if (doSeek) {
              autoplayStates.set(itemId, cSeek);
              const pb = globalProgressPopup.firstChild;
              if (pb) pb.style.width = (clickedPercent * 100) + '%';
         }

         // 更新悬浮 trickplay 的画面和位置
         const auth = getAuth();
         if (auth) {
             const tp = getTrickplayInfo(cItemInfo);
             const targetId = tp.id || itemId;
             const tpInterval = tp.interval || 10;
             const totalTiles = Math.floor(cSeek / tpInterval);
             const isSprite = tp.cols > 1;
             const spriteIdx = isSprite ? Math.floor(totalTiles / (tp.cols * tp.rows)) : totalTiles;
             
             const imageUrl = `${auth.url}/Videos/${targetId}/Trickplay/${tp.width}/${spriteIdx}.jpg?ApiKey=${auth.token}&MediaSourceId=${targetId}`;
             
             globalTrickplayPreview.style.backgroundImage = `url('${imageUrl}')`;
             if (isSprite) {
                 const tileIdx = totalTiles % (tp.cols * tp.rows);
                 globalTrickplayPreview.style.backgroundSize = `${tp.cols * 100}% ${tp.rows * 100}%`;
                 const x = tileIdx % tp.cols;
                 const y = Math.floor(tileIdx / tp.cols);
                 const posX = (x / (tp.cols - 1)) * 100;
                 const posY = (y / (tp.rows - 1)) * 100;
                 globalTrickplayPreview.style.backgroundPosition = `${posX}% ${posY}%`;
             } else {
                 globalTrickplayPreview.style.backgroundSize = 'contain';
                 globalTrickplayPreview.style.backgroundPosition = 'center';
             }
             
             globalTrickplayPreview.style.display = 'block';
             // 限制左右边界，避免超出屏幕
             const safeX = Math.max(160, Math.min(window.innerWidth - 160, clientX));
             globalTrickplayPreview.style.left = (safeX + window.scrollX) + 'px';
             // 改为在进度条下方显示，避免挡住卡片内正在播放的视频
             globalTrickplayPreview.style.top = (pRect.bottom + window.scrollY + 10) + 'px'; 
         }
         
         // 不论是推拽中还是单击中，都可以更新一次底层的实际播放卡片进度
         if (doSeek) {
              const cardEl = document.querySelector(`[data-id="${itemId}"].card`);
              if (cardEl) {
                  const rv = cardEl.querySelector('.jf-real-video');
                  if (rv && typeof isRealVideoPreview !== 'undefined' && isRealVideoPreview) {
                      rv.currentTime = cSeek;
                      rv.play().catch(()=>{});
                  } else {
                      // 将海报背后的 trickplay 画面也同步拨动过去
                      const rect = cardEl.getBoundingClientRect();
                      const evt = new MouseEvent('mousemove', { clientX: clientX, clientY: rect.top + rect.height/2, bubbles: true });
                      cardEl.dispatchEvent(evt);
                  }
                  
                  // 同步更新底框小进度条
                  const fakePb = cardEl.querySelector('.jf-pc-progress-bar');
                  if (fakePb) fakePb.style.width = (clickedPercent * 100) + '%';
              }
         }
    }

    // --- 独立进度条拖动与悬停事件生命周期 ---
    ['mousedown', 'touchstart'].forEach(evt => {
        globalProgressPopup.addEventListener(evt, (e) => {
             e.preventDefault();
             e.stopPropagation();
             isDraggingGlobalProgress = true;
             handleProgressInteraction(e, true);
        });
    });

    ['mousemove', 'touchmove'].forEach(evt => {
        document.addEventListener(evt, (e) => {
             if (isDraggingGlobalProgress) {
                 e.preventDefault();
                 handleProgressInteraction(e, true);
             }
        }, { passive: false });
    });

    ['mouseup', 'touchend'].forEach(evt => {
        document.addEventListener(evt, () => {
             if (isDraggingGlobalProgress) {
                 isDraggingGlobalProgress = false;
                 // 如果不在进度条内部松手，隐藏 trickplay 小预览
                 globalTrickplayPreview.style.display = 'none';
             }
        });
    });

    globalProgressPopup.addEventListener('mousemove', (e) => {
        if (!isDraggingGlobalProgress) {
             handleProgressInteraction(e, false); // 仅跟随出预览，不更新实际进度
        }
    });

    globalProgressPopup.addEventListener('mouseleave', (e) => {
        if (!isDraggingGlobalProgress) {
             globalTrickplayPreview.style.display = 'none';
        }
    });

    globalProgressPopup.addEventListener('wheel', (e) => {
         e.preventDefault();
         e.stopPropagation();

         const itemId = globalProgressPopup.dataset.itemId;
         if (!itemId) return;

         const cItemInfo = itemCache.get(itemId);
         if (!cItemInfo || !cItemInfo.RunTimeTicks) return;

         const durSec = cItemInfo.RunTimeTicks / 10000000;
         let currentSeek = autoplayStates.get(itemId) || 0;

         // 加入滚轮边界限制，向下滚快进，向上滚倒退（降低速度）
         const step = 5; // 降低为每次滚动 5 秒
         if (e.deltaY > 0) {
              currentSeek = Math.min(durSec, currentSeek + step);
         } else {
              currentSeek = Math.max(0, currentSeek - step);
         }

         // 计算假进度 X 坐标位置传递给交互核心
         const pRect = globalProgressPopup.getBoundingClientRect();
         const fakeClientX = pRect.left + (currentSeek / durSec) * pRect.width;
         
         handleProgressInteraction({ clientX: fakeClientX }, true);
    }, { passive: false });

    // --- 卡片上滚轮快进快退 ---
    document.addEventListener('wheel', (e) => {
        // 如果是在进度条弹窗上滚动，已经有单独逻辑处理
        if (e.target.closest('#jf-global-progress-popup')) return;

        const card = e.target.closest('[data-id].card');
        if (!card) return;

        // 如果原画引擎和自动轮播都没开，就不接管滚轮
        if (typeof isRealVideoPreview !== 'undefined' && !isRealVideoPreview && !isAutoPlayEnabled) return;

        const rv = card.querySelector('.jf-real-video');
        const overlay = card.querySelector('.jf-sprite-overlay');
        
        // 判断当前是否有正在展现的预览
        let isVideoPlaying = isRealVideoPreview && rv && rv.style.display === 'block';
        let isSpritePlaying = !isRealVideoPreview && overlay && overlay.style.display === 'block';
        
        if (!isVideoPlaying && !isSpritePlaying) return;

        const itemId = card.getAttribute('data-id');
        if (!itemId) return;

        const cItemInfo = itemCache.get(itemId);
        if (!cItemInfo || !cItemInfo.RunTimeTicks) return;

        e.preventDefault();
        e.stopPropagation();

        const durSec = cItemInfo.RunTimeTicks / 10000000;
        let currentSeek = autoplayStates.get(itemId) || 0;

        const step = 5;
        if (e.deltaY > 0) {
            currentSeek = Math.min(durSec, currentSeek + step);
        } else {
            currentSeek = Math.max(0, currentSeek - step);
        }

        autoplayStates.set(itemId, currentSeek);

        if (isVideoPlaying && rv) {
            rv.currentTime = currentSeek;
        }
        
        // 为了和拖拽同步，我们也调用 handleProgressInteraction 来更新 UI
        // 或者至少更新底部的进度条进度
        const percent = currentSeek / durSec;
        const fakePb = card.querySelector('.jf-pc-progress-bar');
        if (fakePb) fakePb.style.width = (percent * 100) + '%';
        
        if (globalProgressPopup.dataset.itemId === itemId && globalProgressPopup.style.display === 'block') {
             const pb = globalProgressPopup.firstChild;
             if (pb) pb.style.width = (percent * 100) + '%';
             
             // 如果想让它像是在拖动一样，也可以直接计算百分比对应坐标并调用 handleProgressInteraction
             // 但直接改进度条并更新 autoplayStates 已经足够，mousemove 等会同步
             
             // 也同步一下 trickplay
             const auth = getAuth();
             if (auth && globalTrickplayPreview.style.display === 'block') {
                 const tp = getTrickplayInfo(cItemInfo);
                 const targetId = tp.id || itemId;
                 const tpInterval = tp.interval || 10;
                 const totalTiles = Math.floor(currentSeek / tpInterval);
                 const isSprite = tp.cols > 1;
                 const spriteIdx = isSprite ? Math.floor(totalTiles / (tp.cols * tp.rows)) : totalTiles;
                 const imageUrl = `${auth.url}/Videos/${targetId}/Trickplay/${tp.width}/${spriteIdx}.jpg?ApiKey=${auth.token}&MediaSourceId=${targetId}`;
                 globalTrickplayPreview.style.backgroundImage = `url('${imageUrl}')`;
                 if (isSprite) {
                     const tileIdx = totalTiles % (tp.cols * tp.rows);
                     const x = tileIdx % tp.cols;
                     const y = Math.floor(tileIdx / tp.cols);
                     const posX = (x / (tp.cols - 1)) * 100;
                     const posY = (y / (tp.rows - 1)) * 100;
                     globalTrickplayPreview.style.backgroundPosition = `${posX}% ${posY}%`;
                 }
             }
        }
    }, { passive: false });

     // --- 全局交互事件拦截与分发 (强制物理切断底层框架代理) ---
    let clickStartTime = 0;
    const pointerEvents = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'touchstart', 'touchend'];
    
    pointerEvents.forEach(evt => {
        document.addEventListener(evt, async (e) => {
            // 独立弹窗组件，不再需要拦截内部事件
            if (e.target.closest('#jf-global-progress-popup')) return;

            // 2. 长按时间记录
            if (evt === 'mousedown' || evt === 'touchstart' || evt === 'pointerdown') {
                clickStartTime = Date.now();
            }

            // 3. 拦截原画引擎或快照引擎在上三分之二区域的异常事件
            const card = e.target.closest('[data-id].card');
            if (!card || e.target.closest('.jf-preview-instance') || e.target.closest('.jf-btn-close')) return;

            const rect = card.getBoundingClientRect();
            const clientY = e.clientY ?? (e.touches && e.touches.length > 0 ? e.touches[0].clientY : rect.top);
            const mouseY = clientY - rect.top;

            // 如果是原画引擎，不弹窗，上面2/3死寂（或用于触发超过3列时的手动播放），下面1/3原生动作
            if (typeof isRealVideoPreview !== 'undefined' && isRealVideoPreview) {
                 if (mouseY <= rect.height * 0.66) {                     
                     // 全局手动播放/暂停开关 (不论列数，点击上 2/3 区域均可控制播放与暂停)
                     if (evt === 'click' || evt === 'touchend') {
                          // 如果是长按，则放过以支持系统原有长按多选操作
                          if (Date.now() - clickStartTime > 500) return;
                          
                          e.preventDefault();
                          e.stopPropagation();
                          e.stopImmediatePropagation();
                          
                          const rv = card.querySelector('.jf-real-video');
                          if (rv) {
                              // 如果正在尝试播放或已经是手动播放状态
                              const isCurrentlyPlaying = rv.style.display === 'block' && rv.dataset.userPaused !== 'true';

                              if (isCurrentlyPlaying) {
                                  rv.dataset.manualPlay = 'false';
                                  rv.dataset.userPaused = 'true';
                                  rv.pause();
                                  rv.style.display = 'none';
                                  
                                  const overlay = card.querySelector('.jf-sprite-overlay');
                                  if (overlay) overlay.style.display = 'none'; // 隐藏 trickplay 叠层露出原始图片
                              } else {
                                  rv.dataset.manualPlay = 'true';
                                  rv.dataset.userPaused = 'false';
                                  // 立即尝试加载和播放
                                  const auth = typeof getAuth === 'function' ? getAuth() : null;
                                  const itemId = card.getAttribute('data-id');
                                  if (auth && itemId) {
                                      rv.style.display = 'block';
                                      const videoUrl = getVideoStreamUrl(itemId, auth);
                                      if (!rv.src || !rv.src.includes(videoUrl)) {
                                          rv.src = videoUrl;
                                          rv.currentTime = typeof autoplayStates !== 'undefined' ? (autoplayStates.get(itemId) || 0) : 0;
                                          if (typeof markAsPlayed === 'function') markAsPlayed(itemId, auth);
                                          if (typeof reportPlayback === 'function') reportPlayback(itemId, auth, rv.currentTime, false, 'Started');
                                      }
                                      rv.playbackRate = typeof globalPlaySpeed !== 'undefined' ? globalPlaySpeed : 1.0;
                                      rv.play().catch(()=>{});
                                  }
                              }
                          }
                     }
                     return; 
                 }
            }

            // 4. 当原画引擎和自动轮播都关闭时，处理点击弹窗
            if (!isRealVideoPreview && !isAutoPlayEnabled) {
                if (evt === 'click') {
                    // 如果是长按(比如为了选中文本等默认行为)，放过
                    if (Date.now() - clickStartTime > 500) return;
                    
                    // 下三分之一不弹窗，直接转原流程进入详情
                    if (mouseY > rect.height * 0.66) return;

                    const itemId = card.getAttribute('data-id');
                    const type = card.getAttribute('data-type');
                    const folderTypes = ['Folder', 'CollectionFolder', 'Series', 'Season', 'BoxSet', 'Playlist', 'MusicAlbum', 'MusicArtist', 'UserView'];
                    if (type && folderTypes.includes(type)) return;

                    const auth = getAuth();
                    if (!auth) return;

                    // 确认为小窗动作后，吞掉点击事件
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();

                    const title = card.querySelector('.cardText')?.innerText || '视频预览';
                    let startSecond = null;
                    let info = itemCache.get(itemId);
                    if (info && info.RunTimeTicks) {
                        const durationSec = info.RunTimeTicks / 10000000;
                        const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                        startSecond = durationSec * percent;
                    } else {
                         startSecond = autoplayStates.get(itemId) || null;
                    }

                    isRandomMode = false;
                    isTryNewRandomMode = false;
                    isFavoriteRandomMode = false;
                    createPreview(itemId, title, startSecond);
                }
            }
        }, true); // Use capture phase
    });
    
    // --- 海报播放次数角标 ---
    function updatePlayCountBadge(card, itemId, data) {
        const playCount = data?.UserData?.PlayCount ?? 0;
        const imgContainer = card.querySelector('.cardImageContainer') || card.querySelector('.cardBox');
        if (!imgContainer) return;
        if (getComputedStyle(imgContainer).position === 'static') imgContainer.style.position = 'relative';
        let badge = imgContainer.querySelector('.jf-play-count-badge');
        if (!badge) {
            badge = document.createElement('div');
            badge.className = 'jf-play-count-badge';
            imgContainer.appendChild(badge);
        }
        badge.textContent = '▶ ' + playCount;
        badge.style.cssText = '';
    }

    // --- PC 端鼠标悬停原位预览 (替代 Global Trickplay) ---
    let activeHoverCard = null;
    const cardUICache = new WeakMap();

        function getVideoStreamUrl(itemId, auth, mediaSourceId = null) {
        let url = auth.url + "/Videos/" + itemId + "/stream?container=mp4&VideoCodec=h264&AudioCodec=aac,mp3&api_key=" + auth.token;
        if (mediaSourceId) {
            url += "&MediaSourceId=" + mediaSourceId;
        }
        return url;
    }

        async function castToMpv(itemId, startTicks = 0) {
        const auth = getAuth();
        if (!auth) return;

        try {
            const res = await fetch(auth.url + "/Sessions?api_key=" + auth.token);
            if (!res.ok) throw new Error("HTTP " + res.status);
            const sessions = await res.json();

            let mpvSession = sessions.find(s => s.Client === 'Jellyfin MPV Shim');
            if (!mpvSession) {
                mpvSession = sessions.find(s =>
                    (s.Client && (s.Client.toLowerCase().includes('mpv') || s.Client.toLowerCase().includes('jellium'))) ||
                    (s.DeviceName && (s.DeviceName.toLowerCase().includes('mpv') || s.DeviceName.toLowerCase().includes('jellium')))
                );
            }

            if (!mpvSession) {
                mpvSession = sessions.find(s =>
                    s.SupportsMediaControl &&
                    s.Client !== 'Jellyfin Web' &&
                    s.Client !== 'Jellyfin Web Client'
                );
            }

            if (mpvSession) {
                console.log("[JF MPV] Automatically casting to: Client=" + mpvSession.Client + " Id=" + mpvSession.Id);
                const playParams = new URLSearchParams({
                    api_key: auth.token,
                    playCommand: 'PlayNow',
                    itemIds: itemId,
                    startPositionTicks: startTicks
                });
                const playUrl = auth.url + "/Sessions/" + mpvSession.Id + "/Playing?" + playParams.toString();
                await fetch(playUrl, { method: 'POST' });
            }
        } catch (e) {
            console.error('[JF MPV] Auto-cast failed:', e);
        }
    }

    function adjustOverlayAspect(ui, videoRatio = 16 / 9) {
        if (!ui || !ui.container) return;
        const rect = ui.container.getBoundingClientRect();
        const w = rect.width;
        const h = rect.height;
        if (w === 0 || h === 0) return;

        const targetRatio = videoRatio;
        const currentRatio = w / h;

        let targetW, targetH;
        if (currentRatio > targetRatio) {
            targetH = h;
            targetW = h * targetRatio;
        } else {
            targetW = w;
            targetH = w / targetRatio;
        }

        ui.overlay.style.width = targetW + 'px';
        ui.overlay.style.height = targetH + 'px';
        ui.overlay.style.left = ((w - targetW) / 2) + 'px';
        ui.overlay.style.top = ((h - targetH) / 2) + 'px';
        ui.overlay.style.position = 'absolute';
        
        if (ui.realVideo) {
            ui.realVideo.style.width = targetW + 'px';
            ui.realVideo.style.height = targetH + 'px';
            ui.realVideo.style.left = ((w - targetW) / 2) + 'px';
            ui.realVideo.style.top = ((h - targetH) / 2) + 'px';
            ui.realVideo.style.position = 'absolute';
            ui.realVideo.style.objectFit = 'contain';
        }
    }

    function getCardUI(card) {
        let cached = cardUICache.get(card);
        if (cached) {
            adjustOverlayAspect(cached);
            return cached;
        }

        let container = card.querySelector('.cardImageContainer') || card.querySelector('.cardBox');
        if (!container) return null;
        if (getComputedStyle(container).position === 'static') container.style.position = 'relative';

        let overlay = container.querySelector('.jf-autoplay-overlay.jf-sprite-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.className = 'jf-autoplay-overlay jf-sprite-overlay';
            container.appendChild(overlay);
        }

        let realVideo = container.querySelector('.jf-real-video');
        if (!realVideo) {
            realVideo = document.createElement('video');
            realVideo.className = 'jf-autoplay-overlay jf-real-video';
            realVideo.muted = true;
            realVideo.loop = true;
            realVideo.style.objectFit = 'cover';
            
            // 原画引擎模式下自动利用视频本身时间刻度更新进度条
            realVideo.addEventListener('timeupdate', () => {
                if (!isRealVideoPreview || realVideo.style.display === 'none' || !realVideo.duration) return;
                const percent = realVideo.currentTime / realVideo.duration;
                if (progressBg && progressBg.firstChild) {
                    progressBg.firstChild.style.width = (percent * 100) + '%';
                }
                const cItemId = card.getAttribute('data-id');
                if (cItemId) {
                    autoplayStates.set(cItemId, realVideo.currentTime);
                    if (globalProgressPopup.dataset.itemId === cItemId && globalProgressPopup.style.display === 'block') {
                        globalProgressPopup.firstChild.style.width = (percent * 100) + '%';
                    }
                }
            });

            container.appendChild(realVideo);
        }

        let progressBg = container.querySelector('.jf-pc-progress-bg');
        if (!progressBg) {
            progressBg = document.createElement('div');
            progressBg.className = 'jf-pc-progress-bg';
            progressBg.innerHTML = '<div class="jf-pc-progress-bar"></div>';
            container.appendChild(progressBg);
        }
        
        const ui = { overlay, progressBg, progressBar: progressBg.firstChild, realVideo, container };
        adjustOverlayAspect(ui);
        cardUICache.set(card, ui);
        return ui;
    }

    document.addEventListener('mousemove', async (e) => {
        const isHoveringPopup = !!e.target.closest('#jf-global-progress-popup');
        const cardTarget = e.target.closest('.card');
        const card = cardTarget || (isHoveringPopup ? activeHoverCard : null);
        
        // 1. 处理移出逻辑：如果鼠标离开了之前的卡片，或者切换到了新卡片
        if (activeHoverCard && activeHoverCard !== card) {
             const oldUI = getCardUI(activeHoverCard);
             if (oldUI) {
                 oldUI.progressBg.style.display = 'none';
             }
             activeHoverCard = null;
             globalProgressPopup.style.display = 'none';
        }

        if (!card) return;

        // 2. 仅缩略图模式（横图）启用交互预览
        // 使用与 mobile 版一致的检测逻辑
        const imgContainer = card.querySelector('.cardImageContainer') || card.querySelector('.cardPadder') || card;
        const imgRect = imgContainer.getBoundingClientRect();
        if (imgRect.width / imgRect.height < 1.3) return;

        const itemId = card.getAttribute('data-id');
        if (!itemId) return;

        activeHoverCard = card;

        // 3. 数据预加载 (如果数据不存在，发起请求但不立即更新UI)
        const itemInfo = itemCache.get(itemId);
        if (!itemInfo) {
             if (!isFetching.has(itemId)) {
                isFetching.add(itemId);
                const auth = getAuth();
                if (auth) {
                    getItemInfo(itemId, auth).then(data => {
                        if (data) {
                            itemCache.set(itemId, data);
                            updatePlayCountBadge(card, itemId, data);
                        }
                        isFetching.delete(itemId);
                    });
                }
             }
             return;
        }

        // 4. 获取 UI
        const ui = getCardUI(card);
        if (!ui) return;

        // 更新海报角标（缓存命中时也保持同步）
        updatePlayCountBadge(card, itemId, itemInfo);

        // 5. 显示 UI 组件
        ui.progressBg.style.display = 'block';
        
        // --- 全局悬浮进度条显示与跟随逻辑 ---
        const uiRect = ui.container.getBoundingClientRect();
        const localMouseY = e.clientY - uiRect.top;
        if (isRealVideoPreview && (localMouseY > uiRect.height - 30 || isHoveringPopup)) {
             globalProgressPopup.style.display = 'block';
             globalProgressPopup.style.left = (uiRect.left + window.scrollX) + 'px';
             // 紧贴容器底端往上16px
             globalProgressPopup.style.top = (uiRect.bottom - 16 + window.scrollY) + 'px';
             globalProgressPopup.style.width = uiRect.width + 'px';
             globalProgressPopup.dataset.itemId = itemId;
             
             if (!isHoveringPopup && ui.progressBar) {
                 globalProgressPopup.firstChild.style.width = ui.progressBar.style.width || '0%';
             }
        } else {
             globalProgressPopup.style.display = 'none';
        }

        const auth = getAuth();
        if (!auth) return;
        
        const durationSec = itemInfo.RunTimeTicks / 10000000;

        if (isRealVideoPreview) {
             const imgRect = ui ? ui.container.getBoundingClientRect() : imgContainer.getBoundingClientRect();
             const visibleHeight = Math.min(imgRect.bottom, window.innerHeight) - Math.max(imgRect.top, 0);
             const isVisibleEnough = (visibleHeight >= imgRect.height * 0.33);

             let currentCols = globalThumbCols > 0 ? globalThumbCols : (window.innerWidth <= 1600 ? 2 : 3);
             const isColsAllowed = currentCols <= 3;
             const isManualPlay = ui.realVideo.dataset.manualPlay === 'true';
             const isUserPaused = ui.realVideo.dataset.userPaused === 'true';

             // 若不可见要求或大列模式下没开启手动播放，均禁止其在 hover 时篡权播放
             if (!isVisibleEnough || (!isColsAllowed && !isManualPlay) || isUserPaused) {
                  ui.realVideo.style.display = 'none';
                  ui.overlay.style.display = 'none'; // 保持露出原图底色
                  return; 
             }
             
             ui.overlay.style.display = 'none';
             ui.realVideo.style.display = 'block';
             
             // 如果源被替换/未设置，则更新 src 避免重复加载
             const videoUrl = getVideoStreamUrl(itemId, auth);
             if (!ui.realVideo.src || !ui.realVideo.src.includes(videoUrl)) {
                 ui.realVideo.src = videoUrl;
                 ui.realVideo.currentTime = autoplayStates.get(itemId) || 0;
                 if (typeof markAsPlayed === 'function') markAsPlayed(itemId, auth);
                 if (typeof reportPlayback === 'function') reportPlayback(itemId, auth, ui.realVideo.currentTime, false, 'Started');
             }
             
             ui.realVideo.playbackRate = globalPlaySpeed;
             ui.realVideo.play().catch(() => {});
             
             // 滑动鼠标时不再更新实时进度条和时间 (由视频事件 timeupdate 接管，或由进度条的 mousedown 点击处理)
             
        } else {
             ui.realVideo.style.display = 'none';
              ui.overlay.style.display = 'block';

              // 6. 仅在 Trickplay 模式下跟随鼠标滑动计算进度
              const videoRatio = (itemInfo.Width && itemInfo.Height) ? (itemInfo.Width / itemInfo.Height) : (16 / 9);
              adjustOverlayAspect(ui, videoRatio);
              const rect = ui.container.getBoundingClientRect();
             const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
             
             // 更新进度条
             ui.progressBar.style.width = (percent * 100) + '%';

             // 7. 更新 Trickplay 画面
             const seekTime = durationSec * percent;
             
             // 关键更新：同步自动播放状态，使鼠标离开后能接续播放
             autoplayStates.set(itemId, seekTime);
             
             const tp = getTrickplayInfo(itemInfo);
             const targetId = tp.id || itemId;
             const tpInterval = tp.interval || 10;
     
             const totalTiles = Math.floor(seekTime / tpInterval);
             const isSprite = tp.cols > 1;
             const spriteIdx = isSprite ? Math.floor(totalTiles / (tp.cols * tp.rows)) : totalTiles;
             
             const imageUrl = `${auth.url}/Videos/${targetId}/Trickplay/${tp.width}/${spriteIdx}.jpg?ApiKey=${auth.token}&MediaSourceId=${targetId}`;
             
             ui.overlay.style.backgroundImage = `url('${imageUrl}')`;
             if (isSprite) {
                 const tileIdx = totalTiles % (tp.cols * tp.rows);
                 ui.overlay.style.backgroundSize = `${tp.cols * 100}% ${tp.rows * 100}%`;
                 
                 // 计算 offset
                 const x = tileIdx % tp.cols;
                 const y = Math.floor(tileIdx / tp.cols);
                 
                 const posX = (x / (tp.cols - 1)) * 100;
                 const posY = (y / (tp.rows - 1)) * 100;
                 
                 ui.overlay.style.backgroundPosition = `${posX}% ${posY}%`;
             } else {
                 ui.overlay.style.backgroundSize = 'contain';
                 ui.overlay.style.backgroundPosition = 'center';
             }
        }
    }, { passive: true });

    document.addEventListener('mouseleave', (e) => {
        // 全局离开清理
        if (activeHoverCard) {
             const oldUI = getCardUI(activeHoverCard);
             if (oldUI) {
                  oldUI.progressBg.style.display = 'none';
                  // 将视频暂停并隐藏，避免拖慢浏览器和后台一直播放
                  if (oldUI.realVideo) {
                      oldUI.realVideo.pause();
                      oldUI.realVideo.style.display = 'none';
                  }
             }
             activeHoverCard = null;
        }
    });

    // --- 缩略图模式自动播放逻辑 ---
    const visibleCards = new Set();
    const autoplayStates = new Map(); // itemId -> currentSecond

    function initAutoplay() {
        if (typeof IntersectionObserver === 'undefined') return;

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                const card = entry.target;
                if (entry.isIntersecting) {
                    visibleCards.add(card);
                    
                    // 立即获取详情并展示播放次数角标
                    const itemId = card.getAttribute('data-id');
                    const type = card.getAttribute('data-type');
                    if (itemId && (!type || !folderTypes.includes(type))) {
                        const auth = getAuth();
                        if (auth) {
                            const info = itemCache.get(itemId);
                            if (info) {
                                updatePlayCountBadge(card, itemId, info);
                            } else if (!isFetching.has(itemId)) {
                                isFetching.add(itemId);
                                getItemInfo(itemId, auth).then(data => {
                                    if (data) {
                                        itemCache.set(itemId, data);
                                        updatePlayCountBadge(card, itemId, data);
                                    }
                                    isFetching.delete(itemId);
                                }).catch(() => isFetching.delete(itemId));
                            }
                        }
                    }
                } else {
                    visibleCards.delete(card);
                    // 彻底释放脱离当前视口的视频资源以防止内存泄漏
                    const realVideo = card.querySelector('.jf-real-video');
                    if (realVideo) {
                        realVideo.pause();
                        realVideo.removeAttribute('src'); 
                        realVideo.load();
                        realVideo.style.display = 'none';
                    }
                }
            });
        }, { threshold: 0.1 });

        setInterval(() => {
            document.querySelectorAll('.card:not([data-jf-observed])').forEach(card => {
                card.setAttribute('data-jf-observed', 'true');
                observer.observe(card);
            });
        }, 2000);

        // 初始化开关按钮 (插入到顶部菜单中)
        function setupToggleBtn() {
            const headerActions = document.querySelector('.headerRight');
            if (headerActions && !document.querySelector('.jf-btn-autoplay-toggle')) {
                // 原画引擎按钮
                const realVideoBtn = document.createElement('div');
                realVideoBtn.className = 'jf-btn-autoplay-toggle';
                realVideoBtn.style.marginLeft = 'auto'; // 保留靠左对齐并推开原本按钮
                realVideoBtn.innerText = '原画引擎: 关';
                realVideoBtn.onclick = () => {
                     isRealVideoPreview = !isRealVideoPreview;
                     realVideoBtn.classList.toggle('active', isRealVideoPreview);
                     realVideoBtn.innerText = '原画引擎: ' + (isRealVideoPreview ? '开' : '关');
                     
                     if (!isRealVideoPreview) {
                         document.querySelectorAll('.jf-real-video').forEach(v => {
                             v.pause();
                             v.style.display = 'none';
                         });
                     } else {
                         document.querySelectorAll('.jf-sprite-overlay').forEach(el => {
                             el.style.display = 'none';
                         });
                     }
                };

                const btn = document.createElement('div');
                btn.className = 'jf-btn-autoplay-toggle';
                btn.style.marginLeft = '8px'; // 给自动轮播加上一点左间距
                btn.innerText = '自动轮播: 关';
                btn.onclick = () => {
                    isAutoPlayEnabled = !isAutoPlayEnabled;
                    btn.classList.toggle('active', isAutoPlayEnabled);
                    btn.innerText = '自动轮播: ' + (isAutoPlayEnabled ? '开' : '关');
                    // 关闭时，彻底隐藏所有正在自动轮播的叠加层
                    if (!isAutoPlayEnabled) {
                        document.querySelectorAll('.jf-autoplay-overlay, .jf-pc-progress-bg').forEach(el => {
                            if (el.tagName === 'VIDEO') { el.pause(); }
                            el.style.display = 'none';
                        });
                    }
                };

                const speedBtn = document.createElement('div');
                speedBtn.className = 'jf-btn-autoplay-toggle jf-btn-autoplay-speed';
                speedBtn.style.marginLeft = '8px';
                speedBtn.innerText = '速度: ' + globalPlaySpeed + 'x';
                speedBtn.onclick = () => {
                     let idx = speedOptions.indexOf(globalPlaySpeed);
                     idx = (idx + 1) % speedOptions.length;
                     globalPlaySpeed = speedOptions[idx];
                     speedBtn.innerText = '速度: ' + globalPlaySpeed + 'x';
                };

                // 列数滑块
                const sliderContainer = document.createElement('div');
                sliderContainer.className = 'jf-btn-autoplay-toggle';
                sliderContainer.style.marginLeft = '8px';
                sliderContainer.style.cursor = 'default';
                sliderContainer.style.padding = '0 8px';
                
                const label = document.createElement('span');
                label.innerText = '列数: ';
                label.style.marginRight = '6px';
                
                const slider = document.createElement('input');
                slider.type = 'range';
                slider.min = '0'; // 0 = 自动
                slider.max = '8';
                slider.step = '1';
                slider.style.width = '60px'; // 防止滑块过长
                
                const valLabel = document.createElement('span');
                valLabel.style.marginLeft = '6px';
                valLabel.style.display = 'inline-block';
                valLabel.style.minWidth = '24px'; 
                
                function updateCols(cols) {
                    if (cols === 0) {
                        slider.value = 0;
                        valLabel.innerText = '自动';
                        document.body.classList.remove('jf-custom-cols');
                    } else {
                        slider.value = cols;
                        valLabel.innerText = cols;
                        document.body.classList.add('jf-custom-cols');
                        
                        // 动态计算占比: 每行间距缩小为 0.4%, 减去两边 margin
                        let margin = 0.4; 
                        let itemW = (100 - cols * margin * 2) / cols;
                        // 精确到小数点后两位的百分比，避免浮点数造成的换行
                        itemW = Math.floor(itemW * 100) / 100;
                        document.documentElement.style.setProperty('--jf-thumb-width', itemW + '%');
                        document.documentElement.style.setProperty('--jf-thumb-margin', margin + '%');
                    }
                    globalThumbCols = cols;
                    localStorage.setItem('jf-thumb-cols', cols);
                }

                updateCols(globalThumbCols);

                slider.oninput = (e) => {
                    updateCols(parseInt(e.target.value));
                };

                sliderContainer.appendChild(label);
                sliderContainer.appendChild(slider);
                sliderContainer.appendChild(valLabel);

                const randomBtn = document.createElement('div');
                randomBtn.className = 'jf-btn-autoplay-toggle';
                randomBtn.style.marginLeft = '8px';
                randomBtn.style.backgroundColor = '#ff9800';
                randomBtn.style.borderColor = '#ff9800';
                randomBtn.innerText = '随机3窗';
                randomBtn.onclick = () => {
                    const cards = Array.from(document.querySelectorAll('.card[data-id]')).filter(c => {
                        const type = c.getAttribute('data-type');
                        return !type || !folderTypes.includes(type);
                    });

                    if (cards.length === 0) {
                        alert('当前页面没有找到可播放的视频！');
                        return;
                    }

                    isRandomMode = true;
                    isTryNewRandomMode = false;
                    isFavoriteRandomMode = false;
                    randomCols = 3;
                    randomGap = 20;

                    // 清除现有的
                    [...previewWindows].forEach(w => destroyWindow(w));

                    // 随机选三个打开
                    for (let i = 0; i < 3; i++) {
                        openRandomWindow();
                    }
                };

                const favoriteBtn = document.createElement('div');
                favoriteBtn.className = 'jf-btn-autoplay-toggle';
                favoriteBtn.style.marginLeft = '8px';
                favoriteBtn.style.backgroundColor = '#e91e63';
                favoriteBtn.style.borderColor = '#e91e63';
                favoriteBtn.innerText = '最爱随机';
                favoriteBtn.onclick = async () => {
                    const cards = Array.from(document.querySelectorAll('.card[data-id]')).filter(c => {
                        const type = c.getAttribute('data-type');
                        return !type || !folderTypes.includes(type);
                    });

                    if (cards.length === 0) {
                        alert('当前页面没有找到可播放的视频！');
                        return;
                    }

                    isRandomMode = false;
                    isTryNewRandomMode = false;
                    isFavoriteRandomMode = true;
                    randomCols = 3;
                    randomGap = 20;

                    showToast('🔍 正在加载页面中所有视频的播放数据...', 'info');
                    favoriteBtn.innerText = '加载中...';
                    favoriteBtn.style.pointerEvents = 'none';

                    try {
                        await preloadAllCardsInfo();
                    } catch (e) {
                        console.error('[JF] Preload failed', e);
                    } finally {
                        favoriteBtn.innerText = '最爱随机';
                        favoriteBtn.style.pointerEvents = 'auto';
                    }

                    const favCount = cards.filter(card => {
                        const itemId = card.getAttribute('data-id');
                        const info = itemCache.get(itemId);
                        return info?.UserData?.IsFavorite || false;
                     }).length;

                    if (favCount === 0) {
                        alert('当前页面没有找到任何被您标记为“最爱”的视频！');
                        isFavoriteRandomMode = false;
                        return;
                    }

                    // 清除现有的
                    [...previewWindows].forEach(w => destroyWindow(w));

                    // 随机选三个打开
                    for (let i = 0; i < 3; i++) {
                        openRandomWindow();
                    }
                };

                const tryNewBtn = document.createElement('div');
                tryNewBtn.className = 'jf-btn-autoplay-toggle';
                tryNewBtn.style.marginLeft = '8px';
                tryNewBtn.style.backgroundColor = '#9c27b0';
                tryNewBtn.style.borderColor = '#9c27b0';
                tryNewBtn.innerText = '尝新随机';
                tryNewBtn.onclick = async () => {
                    const cards = Array.from(document.querySelectorAll('.card[data-id]')).filter(c => {
                        const type = c.getAttribute('data-type');
                        return !type || !folderTypes.includes(type);
                    });

                    if (cards.length === 0) {
                        alert('当前页面没有找到可播放的视频！');
                        return;
                    }

                    isRandomMode = false;
                    isTryNewRandomMode = true;
                    isFavoriteRandomMode = false;
                    randomCols = 3;
                    randomGap = 20;

                    showToast('🔍 正在加载页面中所有视频的播放数据...', 'info');
                    tryNewBtn.innerText = '加载中...';
                    tryNewBtn.style.pointerEvents = 'none';

                    try {
                        await preloadAllCardsInfo();
                    } catch (e) {
                        console.error('[JF] Preload failed', e);
                    } finally {
                        tryNewBtn.innerText = '尝新随机';
                        tryNewBtn.style.pointerEvents = 'auto';
                    }

                    // 清除现有的
                    [...previewWindows].forEach(w => destroyWindow(w));

                    // 随机选三个打开
                    for (let i = 0; i < 3; i++) {
                        openRandomWindow();
                    }
                };

                // 反向插入以保证顺序: sliderContainer在右, speedBtn, btn, realVideoBtn在左
                headerActions.prepend(sliderContainer);
                headerActions.prepend(speedBtn);
                headerActions.prepend(btn);
                headerActions.prepend(realVideoBtn);
                headerActions.prepend(tryNewBtn);
                headerActions.prepend(favoriteBtn);
                headerActions.prepend(randomBtn);
            }
        }        setInterval(setupToggleBtn, 1000);

        // 记录上次更新时间控制播放速率
        let lastUpdateTime = Date.now();

        setInterval(async () => {
            const now = Date.now();
            const dt = now - lastUpdateTime;
            lastUpdateTime = now;

            const auth = getAuth();
            if (!auth) return;

            for (const card of visibleCards) {
                // 如果鼠标正在悬停，必定跳过
                if (card.matches(':hover')) continue;

                const rect = card.getBoundingClientRect();
                const ui = getCardUI(card);
                
                // --- 以下处理非悬停状态下（由开关决定是否自动轮播）---
                // 1. 如果开关都被关闭，或者卡片图片区域不是横图模式，隐藏叠加层并跳过计算
                // 修复：必须使用 ui.container 而不是 card 来计算宽高比
                const imgRect = ui ? ui.container.getBoundingClientRect() : rect;
                if (!(isAutoPlayEnabled || isRealVideoPreview) || imgRect.width / imgRect.height < 1.1) {
                     if (ui) {
                         ui.overlay.style.display = 'none';
                         ui.realVideo.style.display = 'none';
                         ui.realVideo.pause();
                         ui.progressBg.style.display = 'none';
                     }
                     continue;
                }

                const itemId = card.getAttribute('data-id');
                const type = card.getAttribute('data-type');
                if (!itemId || (type && folderTypes.includes(type))) continue;

                let info = itemCache.get(itemId);
                if (!info && !isFetching.has(itemId)) {
                    isFetching.add(itemId);
                    getItemInfo(itemId, auth).then(data => {
                        if (data) {
                            itemCache.set(itemId, data);
                            updatePlayCountBadge(card, itemId, data);
                        }
                        isFetching.delete(itemId);
                    }).catch(() => isFetching.delete(itemId));
                    continue;
                }
                if (!info || !info.RunTimeTicks) continue;

                if (!ui) continue;

                // 优化：如果鼠标正悬停在卡片上，交给 mousemove 逻辑处理
                if (card.matches(':hover')) continue;

                ui.progressBg.style.display = 'block'; // 自动播放时也显示进度条

                const durationSec = info.RunTimeTicks / 10000000;
                let curTime = autoplayStates.get(itemId) || 0;
                
                if (isRealVideoPreview) {
                     // 1. 视见率检测：页面上未显示超过三分之一的缩略图不播放视频
                     const imgRectLocal = ui ? ui.container.getBoundingClientRect() : rect;
                     const visibleHeight = Math.min(imgRectLocal.bottom, window.innerHeight) - Math.max(imgRectLocal.top, 0);
                     const isVisibleEnough = (visibleHeight >= imgRectLocal.height * 0.33);

                     // 2. 列数检测：大于3列时禁用自动播放
                     let currentCols = globalThumbCols > 0 ? globalThumbCols : (window.innerWidth <= 1600 ? 2 : 3);
                     const isColsAllowed = currentCols <= 3;
                     const isManualPlay = ui.realVideo && ui.realVideo.dataset.manualPlay === 'true';
                     const isUserPaused = ui.realVideo && ui.realVideo.dataset.userPaused === 'true';

                     if (!isVisibleEnough || (!isColsAllowed && !isManualPlay) || isUserPaused) {
                          if (ui.realVideo) {
                              ui.realVideo.pause();
                              ui.realVideo.style.display = 'none';
                              ui.overlay.style.display = 'none';
                              
                              if (!isVisibleEnough) {
                                  // 如果是因为滚出屏幕导致停止的，重置为非手动状态，免得下次滚回来又处于奇怪状态
                                  ui.realVideo.dataset.manualPlay = 'false';
                                  ui.realVideo.dataset.userPaused = 'false';
                              }
                          }
                          continue; 
                     }
                     
                     ui.overlay.style.display = 'none';
                     ui.realVideo.style.display = 'block';
                     
                     const videoUrl = getVideoStreamUrl(itemId, auth);
                     if (!ui.realVideo.src || !ui.realVideo.src.includes(videoUrl)) {
                         ui.realVideo.src = videoUrl;
                         // 初次建立视频连接，直接设置进度并由视频自身来控制后续流逝，不再步进叠加 dt
                         ui.realVideo.currentTime = curTime;
                         if (typeof markAsPlayed === 'function') markAsPlayed(itemId, auth);
                         if (typeof reportPlayback === 'function') reportPlayback(itemId, auth, ui.realVideo.currentTime, false, 'Started');
                     } 
                     
                     // 持续检查是不是已经在播，维持速度
                     ui.realVideo.playbackRate = globalPlaySpeed;
                     ui.realVideo.play().catch(()=>{});

                     // 让进度条实时跟随原画视频自身的绝对进度，而不再人为累加 curTime
                     curTime = ui.realVideo.currentTime;
                     autoplayStates.set(itemId, curTime);
                     
                     const percent = curTime / durationSec;
                     ui.progressBar.style.width = (percent * 100) + '%';
                     
                } else {
                     ui.realVideo.style.display = 'none';
                     ui.overlay.style.display = 'block';

                     // 原有依靠图片步进的快照逻辑
                     const videoRatio = (info.Width && info.Height) ? (info.Width / info.Height) : (16 / 9);
                     adjustOverlayAspect(ui, videoRatio);
                     const tp = getTrickplayInfo(info);
                     const targetId = tp.id || itemId;
                     const tpInterval = tp.interval || 10;
                     
                     // 使用时间差计算步进进度 
                     let moveAmount = (dt / 1000) * globalPlaySpeed;
                     curTime = (curTime + moveAmount) % durationSec; 
                     autoplayStates.set(itemId, curTime);
     
                     // 更新进度条
                     const percent = curTime / durationSec;
                     ui.progressBar.style.width = (percent * 100) + '%';
     
                     const totalTiles = Math.floor(curTime / tpInterval);
                     const isSprite = tp.cols > 1;
                     const spriteIdx = isSprite ? Math.floor(totalTiles / (tp.cols * tp.rows)) : totalTiles;
     
                     const imageUrl = `${auth.url}/Videos/${targetId}/Trickplay/${tp.width}/${spriteIdx}.jpg?ApiKey=${auth.token}&MediaSourceId=${targetId}`;
                     ui.overlay.style.backgroundImage = `url('${imageUrl}')`;
                     
                     if (isSprite) {
                         const tileIdx = totalTiles % (tp.cols * tp.rows);
                         const posX = (tileIdx % tp.cols / (tp.cols - 1)) * 100;
                         const posY = (Math.floor(tileIdx / tp.cols) / (tp.rows - 1)) * 100;
                         ui.overlay.style.backgroundSize = `${tp.cols * 100}% ${tp.rows * 100}%`;
                         ui.overlay.style.backgroundPosition = `${posX}% ${posY}%`;
                     } else {
                         ui.overlay.style.backgroundSize = 'contain';
                         ui.overlay.style.backgroundPosition = 'center';
                     }
                }
            }
        }, 100);
    }

    // --- 布局检测：缩略图模式自动放大 ---
    function checkLayoutMode() {
        // 遍历所有可能的网格容器
        const containers = document.querySelectorAll('.itemsContainer');
        
        containers.forEach(container => {
            // 过滤：排除横向滚动容器（首页、详情页推荐等），只处理主媒体库网格
            if (container.closest('.emby-scroller') || container.classList.contains('scrollSlider')) return;

            const card = container.querySelector('.card');
            if (!card) return;
            
            // 使用 cardPadder (图片占位容器) 来检测宽高比，排除文字高度干扰，确保海报/缩略图判断准确
            const measureEl = card.querySelector('.cardPadder') || card.querySelector('.cardImageContainer') || card;
            const rect = measureEl.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) return;

            // 16:9 = 1.77, 2:3 = 0.66, 3:4 = 0.75
            // 设定 1.3 为阈值，严格区分横图和竖图
            const isLandscape = rect.width / rect.height > 1.3;
            
            if (isLandscape) {
                container.classList.add('jf-large-thumbnail');
            } else {
                container.classList.remove('jf-large-thumbnail');
            }
        });
    }

    // 启动循环检测
    setInterval(checkLayoutMode, 2000);
    
    initAutoplay();

})();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', runScript);
    } else {
        runScript();
    }
})();