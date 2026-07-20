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
// @name         Jellyfin 鎮仠澶氱獥棰勮 (MPV鐗?
// @namespace    http://tampermonkey.net/
// @version      4.8
// @description  鏀寔6绐楀彛 2x3 鐭╅樀鎺掑垪锛岃嚜鍔ㄥ鎵剧┖浣嶇敓鎴愶紝甯︿綅缃蹇嗗拰绮剧伒鍥鹃瑙?
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

    // 鍏ㄥ眬鍔寔骞跺湪鎹曡幏鏈熼棿鏈夋潯浠跺湴杩囨护/淇濆瓨 mxreality.js 娉ㄥ唽鐨勫叏灞€浜嬩欢鐩戝惉鍣?
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
    let previewWindows = []; // 瀛樺偍绐楀彛瀵硅薄鐨勬暟缁?[{el, slotIndex, timestamp}]
    const currentlyOpeningIds = new Set(); // 姝ｅ湪鎵撳紑鐨勮棰?ID锛岄槻姝㈠紓姝ョ珵鎬佸鑷存墦寮€閲嶅瑙嗛
    let topZIndex = 200000;
    const MAX_WINDOWS = 3;
    const COLS = 3;
    const ROWS = 1;
 
    // 澧炲姞鍏ㄥ眬鏍囧織浣嶇敤浜庢帶鍒舵槸鍚﹀惎鍔ㄥ師鐢诲紩鎿庡強鎾斁鍙傛暟
    let isRealVideoPreview = false; // 榛樿鍏抽棴
    let isAutoPlayEnabled = false; // 榛樿鍏抽棴
    let globalPlaySpeed = 50.0; // 榛樿鍊嶉€?
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
        // 榛樿鍥為€€鍊?
        const defaultRet = { width: 320, interval: 10, id: null, cols: 10, rows: 10 };
        if (!info) return defaultRet;
        
        const mediaSource = info.MediaSources?.[0];
        // 灏濊瘯澶氱瀛楁鍛藉悕鍙兘锛歍rickplay, TrickPlay, trickplay
        const manifests = mediaSource?.Trickplay || mediaSource?.TrickPlay || mediaSource?.trickplay || info.Trickplay || info.TrickPlay;
        const id = mediaSource?.Id || info.Id || null;
        
        let width = 320;
        let interval = 10;
        let cols = 10; 
        let rows = 10;

        // 濡傛灉鎵惧埌浜?manifest锛屽皾璇曡В鏋?
        if (manifests && typeof manifests === 'object') {
            let config = manifests;
            
            // 鍏抽敭淇锛氭煇浜涙儏鍐典笅锛宮anifests 琚寘瑁瑰湪 MediaSourceId 涓?
            // 缁撴瀯濡傦細 { "3cc37...": { "640": {...} } }
            // 灏濊瘯妫€娴嬫槸鍚︿负杩欑宓屽缁撴瀯
            const keys = Object.keys(manifests);
            if (keys.length === 1 && manifests[keys[0]] && typeof manifests[keys[0]] === 'object' && !manifests.Width && !manifests[320] && !manifests[640]) {
                 // 鐪嬭捣鏉ュ儚鏄 ID 鍖呰９浜嗭紝瑙ｅ寘
                 config = manifests[keys[0]];
            }

            // 鎵佸钩缁撴瀯澶勭悊
            if (config.Width && !config[config.Width]) {
                 const m = config;
                 width = m.Width;
                 // 鏅鸿兘绾犳 Interval 鍗曚綅
                 // Jellyfin Ticks = 10,000,000 per sec
                 // Milliseconds = 1,000 per sec
                 let rawInterval = m.Interval || 10000;
                 // 濡傛灉鍊煎ぇ浜?1,000,000锛屽嚑涔庤偗瀹氭槸 Ticks
                 if (rawInterval > 1000000) interval = rawInterval / 10000000;
                 // 濡傛灉鍊煎湪 1000 - 100000 涔嬮棿锛屽嚑涔庤偗瀹氭槸姣 (渚嬪 10000ms = 10s)
                 else if (rawInterval > 100) interval = rawInterval / 1000;
                 // 鍚﹀垯鍋囪瀹冨凡缁忔槸绉?
                 else interval = rawInterval;

                 // 鍚屾淇鍒楁暟閫昏緫
                 if (m.TileWidth && m.TileWidth <= 20) {
                     cols = m.TileWidth;
                     rows = m.TileHeight || m.TileWidth;
                 } else if (m.ThumbnailWidth && m.Width > m.ThumbnailWidth) {
                     cols = Math.round(m.Width / m.ThumbnailWidth);
                     rows = Math.round(m.Height / m.ThumbnailHeight);
                 }
                 // console.log(`[JF] Found flat Trickplay manifest ${width}w for item ${id}, Interval: ${interval}s, Grid: ${cols}x${rows}`, m);
            } else {
                // 鏍囧噯缁撴瀯锛歿"320": {...}, "640": {...}}
                const widths = Object.keys(config).map(Number).filter(n => !isNaN(n));
                if (widths.length > 0) {
                    // 浼樺厛鎵?640锛屽叾娆℃壘鏈€澶у€硷紝鏈€鍚庝娇鐢?320
                    width = widths.includes(640) ? 640 : (widths.includes(320) ? 320 : Math.max(...widths));
                    
                    const m = config[width.toString()] || config[width];
                    if (m) {
                        // 鏅鸿兘绾犳 Interval 鍗曚綅
                        let rawInterval = m.Interval || 10000;
                        if (rawInterval > 1000000) interval = rawInterval / 10000000;
                        else if (rawInterval > 100) interval = rawInterval / 1000;
                        else interval = rawInterval;
                        
                        // 閫昏緫淇锛歍ileWidth / TileHeight 鍦ㄤ笉鍚岀増鏈殑鎻掍欢涓惈涔変笉鍚?
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
            /* 鍘婚櫎 overflow: hidden; 浠ヤ究 trickplay 婧㈠嚭鏄剧ず鍦ㄤ笅鏂?*/
            display: flex; flex-direction: column; 
            transition: all 0.4s cubic-bezier(0.165, 0.84, 0.44, 1);
        }
        .jf-preview-header {
            background: #1a1a1a; padding: 6px 12px; display: flex;
            justify-content: space-between; align-items: center; color: #fff;
            cursor: move; font-size: 13px; flex-shrink: 0;
            border-top-left-radius: 10px; border-top-right-radius: 10px; /* 琛ュ伩澶栧眰鐨?overflow:hidden 鍘婚櫎 */
        }
        .jf-btn-close { cursor: pointer; padding: 2px 8px; background: #cc3333; border-radius: 4px; font-size: 11px; font-weight: bold; color: white; }
        .jf-btn-delete { cursor: pointer; padding: 2px 8px; background: #880000; border-radius: 4px; font-size: 11px; font-weight: bold; color: white; margin-right: 4px; }
        .jf-btn-favorite { cursor: pointer; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; color: white; margin-right: 4px; }
        .jf-btn-reload { cursor: pointer; padding: 2px 8px; background: #28a745; border-radius: 4px; font-size: 11px; font-weight: bold; color: white; margin-right: 4px; }
        .video-wrapper { position: relative; flex: 1; background: #000; display: flex; align-items: center; justify-content: center; border-bottom-left-radius: 10px; border-bottom-right-radius: 10px; }
        .jf-video-el { width: 100%; height: 100%; object-fit: contain; cursor: move; object-position: top; border-bottom-left-radius: 10px; border-bottom-right-radius: 10px; }
        
        /* 澧炲姞鑷姩鎾斁寮€鍏虫寜閽牱寮?*/
        .jf-btn-autoplay-toggle {
            display: inline-flex; align-items: center; justify-content: center;
            padding: 0 12px; margin-left: auto; height: 32px; border-radius: 6px;
            background: #2a2a2a; color: #fff; cursor: pointer; font-size: 14px;
            border: 1px solid #444; transition: all 0.2s;
        }
        .jf-btn-autoplay-toggle.active { background: #00a4dc; border-color: #00a4dc; }
        
        .jf-trickplay-thumb {
            position: absolute; 
            /* 鎸埌瑙嗛鍜岃繘搴︽潯涓嬫柟 */
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
        /* 鍏ㄥ眬棰勮鍥惧眰 - 澧炲ぇ灏哄 */
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
            z-index: 100; /* 纭繚鍦ㄦ渶涓婂眰 */
            border-radius: inherit;
            background-size: contain;
            filter: brightness(1.15); /* 澧炲姞浜害 */
            background-color: #000; /* 榛戣壊鑳屾櫙闃叉閫忔槑绌块€?*/
        }
        
        /* 闅愯棌 Jellyfin 榛樿鐨勬偓鍋滅伆鑹查伄缃?*/
        body .itemsContainer.jf-large-thumbnail .card:hover .cardOverlayContainer,
        body .itemsContainer.jf-large-thumbnail .card:hover .cardOverlayTarget,
        body .itemsContainer.jf-large-thumbnail .card:hover .cardImageContainer::after {
            background: transparent !important;
            background-color: transparent !important;
        }

        /* 闅愯棌闀挎寜澶氶€夋ā寮忎笅鐨勬祬钃濊壊閬僵锛屽苟鎻愬崌琚€変腑缂╃暐鍥剧殑浜害 */
        body .itemsContainer.jf-large-thumbnail .card .itemSelectionPanel,
        body .itemsContainer.jf-large-thumbnail .card.selected .cardOverlayContainer,
        body .itemsContainer.jf-large-thumbnail .card.selected .cardOverlayTarget {
            background: transparent !important;
            background-color: transparent !important;
            border: 3px solid #00a4dc !important; /* 淇濈暀涓嬭竟妗嗘彁绀哄凡琚€変腑 */
            border-radius: var(--card-border-radius, 6px);
        }
        body .itemsContainer.jf-large-thumbnail .card.selected .cardScalable,
        body .itemsContainer.jf-large-thumbnail .card.selected .cardImageContainer {
            filter: brightness(1.3) !important; /* 鎻愬崌 30% 浜害 */
        }


        /* --- 缂╃暐鍥炬ā寮忓己鍒舵斁澶ф柟妗?(鍖呭惈鍔ㄦ€佸垪鏁板拰榛樿璁剧疆) --- */
        
        /* 鍔ㄦ€佸垪鏁版帶鍒舵柟妗?*/
        body.jf-custom-cols .itemsContainer.jf-large-thumbnail .card {
            width: var(--jf-thumb-width) !important;
            flex-basis: var(--jf-thumb-width) !important;
            margin: var(--jf-thumb-margin) !important;
            flex-grow: 0 !important;
            flex-shrink: 0 !important;
        }

        /* 榛樿鑷姩妯″紡: 3鍒?*/
        body:not(.jf-custom-cols) .itemsContainer.jf-large-thumbnail .card {
            width: 32.53% !important;
            flex-basis: 32.53% !important;
            flex-grow: 0 !important;
            flex-shrink: 0 !important;
            margin: 0.4% !important;
        }

        /* 缁欏鍣ㄧ殑涓や晶鍑忓幓鍐呰竟璺濓紝浣垮畠鑳芥洿濂藉湴鍗犵敤鏁翠釜椤甸潰 */
        body.jf-custom-cols .itemsContainer.jf-large-thumbnail,
        body:not(.jf-custom-cols) .itemsContainer.jf-large-thumbnail {
             padding-left: 0.2% !important;
             padding-right: 0.2% !important;
        }
        
        /* 鍙纭繚鍐呴儴瀹瑰櫒璺熷崱鐗囩瓑瀹斤紝鍥剧墖灏变細闅忔瘮渚嬫斁澶?*/
        .itemsContainer.jf-large-thumbnail .cardBox,
        .itemsContainer.jf-large-thumbnail .cardScalable,
        .itemsContainer.jf-large-thumbnail .cardPadder,
        .itemsContainer.jf-large-thumbnail .cardContent,
        .itemsContainer.jf-large-thumbnail .cardImageContainer {
            width: 100% !important;
        }
        .itemsContainer.jf-large-thumbnail .cardPadder {
            padding-bottom: 56.25% !important; /* 寮哄埗 16:9 姣斾緥楂?*/
        }
        /* 纭繚鑷姩鎾斁灞傝鐩栨暣涓尯鍩?*/
        .itemsContainer.jf-large-thumbnail .jf-autoplay-overlay {
            width: 100% !important;
            height: 100% !important;
            position: absolute !important;
            top: 0 !important;
            left: 0 !important;
            z-index: 10 !important; /* 纭繚鍦ㄦ捣鎶ヤ箣涓?*/
        }
        .itemsContainer.jf-large-thumbnail .cardText {
            font-size: 1.25em !important;
        }
        .itemsContainer.jf-large-thumbnail .cardOverlayButton {
            font-size: 1.8em !important;
        }

        /* 榛樿鑷姩妯″紡: 灏忓睆骞?2 鍒?*/
        @media (max-width: 1600px) {
            body:not(.jf-custom-cols) .itemsContainer.jf-large-thumbnail .card { 
                width: 47% !important; 
                flex-basis: 47% !important; 
                margin: 1.5% !important;
            }
        }
        
        /* PC 绔繘搴︽潯鏍峰紡 */
        .jf-pc-progress-bg {
            position: absolute; bottom: 0; left: 0; width: 100%; height: 5px; 
            background: rgba(0,0,0,0.5); z-index: 100; display: none;
            pointer-events: none !important;
        }
        .jf-pc-progress-bar {
            height: 100%;
            background: #00a4dc; width: 0%;
        }
        
        /* 鐙珛鐨勫叏灞€杩涘害鏉℃偓娴獥锛岀敤浜庤閬垮崱鐗囦簨浠跺啿绐佸拰鎻愪緵鏇村ソ浜や簰 */
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

        /* 鐙珛杩涘害鏉＄殑灏忓瀷鎮诞棰勮鍥?*/
        #jf-global-trickplay-preview {
            position: absolute; width: 320px; height: 180px;
            background-color: #000; z-index: 99999999; display: none;
            border: 2px solid #00a4dc; border-radius: 4px;
            background-repeat: no-repeat; pointer-events: none;
            box-shadow: 0 4px 10px rgba(0,0,0,0.8);
            transform: translateX(-50%);
        }
        /* 娴锋姤宸︿笅瑙掓挱鏀炬鏁拌鏍?*/
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

        // 1. 涔愯鏇存柊锛氬厛鍦ㄦ湰鍦?cache 涓鍔犳挱鏀炬鏁板苟鏇存柊鐣岄潰瑙掓爣
        const cached = itemCache.get(itemId);
        if (cached) {
            if (!cached.UserData) cached.UserData = {};
            cached.UserData.PlayCount = (cached.UserData.PlayCount || 0) + 1;
            cached.UserData.Played = true;

            // 鏇存柊椤甸潰涓婃捣鎶ュ崱鐗囩殑鎾斁娆℃暟瑙掓爣
            const card = document.querySelector(`.card[data-id="${itemId}"]`);
            if (card) {
                updatePlayCountBadge(card, itemId, cached);
            }

            // 鏇存柊娴姩棰勮绐楀彛鏍囬鏍忎腑鐨勬挱鏀炬鏁拌鏍?
            const titleBadges = document.querySelectorAll(`.jf-preview-instance[data-item-id="${itemId}"] .jf-title-play-count`);
            titleBadges.forEach(badge => {
                badge.textContent = `[鎾斁: ${cached.UserData.PlayCount}]`;
            });
        }

        const url = `${auth.url}/Users/${auth.userId}/PlayedItems/${itemId}?api_key=${auth.token}`;
        try {
            const res = await fetch(url, { method: 'POST' });
            if (res.ok) {
                // 2. 浠庢湇鍔″櫒鑾峰彇鏈€鏂颁俊鎭繘琛岀簿鍑嗘洿鏂颁笌鏍″噯
                const updatedInfo = await getItemInfo(itemId, auth);
                if (updatedInfo) {
                    // 闃叉楂樺苟鍙戞垨鑰呮湇鍔″櫒寤惰繜鍐欏叆瀵艰嚧娆℃暟鍥為€€锛屽彇鏈湴涔愯鏇存柊鍜屾湇鍔″櫒杩斿洖鐨勬渶澶у€?
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
                        badge.textContent = `[鎾斁: ${updatedInfo.UserData.PlayCount}]`;
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
        // API 淇: 'Started' 瀵瑰簲 /Sessions/Playing锛屽叾浠栧 'Progress'/'Stopped' 瀵瑰簲 /Sessions/Playing/{type}
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
        winObj.timestamp = Date.now(); // 鏇存柊鏃堕棿鎴筹紝纭繚鍏跺湪鎺掑簭涓浜庘€滄渶鏂扳€?
        
        // 纭繚宸︿笂瑙?(slot 1) 鐨勭獥鍙ｅ眰绾у缁堥珮浜庡乏涓嬭 (slot 2)
        // 闃叉 slot 1 鐨?trickplay 棰勮鍥捐 slot 2 閬尅
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


    // 璁＄畻鐭╅樀浣嶇疆
    function getSlotStyle(slotIndex) {
        const padding = 10;
        const headerOffset = 70; // 鏍囬鏍忛鐣?
        const bottomOffset = 180; // 搴曢儴 Trickplay 棰勭暀
        const gap = 15;
        
        const screenW = window.innerWidth - padding * 2;
        const screenH = window.innerHeight - headerOffset - bottomOffset;
        const uiH = 35 + 40; // 绐楀彛 Header(35) + Footer(40)

        // 璁＄畻鏈€澶у彲琛屽搴︼紝纭繚宸︿晶涓や釜鍨傜洿鍙犲姞鐨勫皬绐椾笉瓒呭嚭楂樺害闄愬埗锛屼笖鏃犻粦杈?(16:9)
        // 2 * (w_small * 9/16 + uiH) + gap <= screenH
        let max_w_small = (screenH - (uiH * 2) - gap) / (18/16);
        
        // 璁＄畻鍙充晶澶х獥鐨勬渶澶у搴?
        // w_big * 9/16 + uiH <= screenH
        let max_w_big = (screenH - uiH) / (9/16);

        // 鐞嗘兂姣斾緥鍒嗛厤锛氬彸渚у崰 65% 宸﹀彸
        let w_big = Math.min(max_w_big, screenW * 0.65);
        let w_small = Math.min(max_w_small, screenW - w_big - gap);
        
        // 濡傛灉瀹藉害杩樻湁鍓╀綑锛屾寜姣斾緥绋嶅井鏀惧ぇ
        const remainingW = screenW - (w_big + w_small + gap);
        if (remainingW > 0) {
            const ratio = w_big / (w_big + w_small);
            w_big += remainingW * ratio;
            w_small += remainingW * (1 - ratio);
            // 鍐嶆纭繚涓嶈秴鍑洪珮搴?
            w_big = Math.min(w_big, max_w_big);
            w_small = Math.min(w_small, max_w_small);
        }

        const h_big = (w_big * 9 / 16) + uiH;
        const h_small = (w_small * 9 / 16) + uiH;

        // 棰勮 3 涓綅缃?
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
            // 浼樺厛鎸戦€夋挱鏀炬鏁颁负闆讹紙鏈挱鏀捐繃涓旀棤杩涘害鏉★級鐨勮棰?
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
        currentlyOpeningIds.add(itemId); // 绔嬪嵆鏍囪涓烘鍦ㄥ姞杞斤紝闃叉澶氱獥骞跺彂璇锋眰绔炴€?
        const title = card.querySelector('.cardText')?.innerText || '瑙嗛棰勮';
        let startSecond = autoplayStates.get(itemId) || null;
        createPreview(itemId, title, startSecond);
    }

    const reservedSlots = new Set();

    // 瀵绘壘鍙敤妲戒綅
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

        // 娓呯悊 mxreality.js 娉ㄥ唽鍦?window/document 涓婄殑鍏ㄥ眬浜嬩欢鐩戝惉鍣?
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

        // 杩樺師璁板綍鐨勬粴鍔ㄥ睘鎬с€佹牱寮忎笌 class
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
        // 鎵惧埌鎵€鏈?slotIndex 澶т簬 closedSlotIndex 鐨勭獥鍙?
        const windowsToShift = previewWindows
            .filter(w => w.slotIndex > closedSlotIndex)
            .sort((a, b) => a.slotIndex - b.slotIndex);
            
        // 灏嗗畠浠殑浣嶇疆鍚戝墠閫掕ˉ
        windowsToShift.forEach(w => {
            w.slotIndex -= 1;
            const newStyle = getSlotStyle(w.slotIndex);
            Object.assign(w.el.style, newStyle);
        });
        
        // 鍙湁鍦ㄩ殢鏈烘ā寮忎笅锛屾墠寮€鍚竴涓柊鐨勫～琛ョ┖浣?
        if (isRandomMode || isTryNewRandomMode || isFavoriteRandomMode) openRandomWindow();
    }


    async function createPreview(itemId, title, startSecond = null) {
        const auth = getAuth();
        if (!auth) {
            currentlyOpeningIds.delete(itemId);
            return;
        }

        let slotIndex = findEmptySlot();

        // 濡傛灉浣嶇疆婊′簡锛屾壘鍒版渶鏃╃殑閭ｄ釜
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

        // --- 澧炲姞瀛楀箷鎻愬彇閫昏緫 ---
        const mediaSource = info?.MediaSources?.[0];
        const mediaSourceId = mediaSource?.Id;
        // 杩囨护鍑烘枃鏈被瀛楀箷
        const subtitleStreams = mediaSource?.MediaStreams?.filter(s => s.Type === 'Subtitle' && !['pgssub', 'dvdsub', 'dvbsub'].includes(s.Codec?.toLowerCase())) || [];
        
        let subtitleSelectHtml = '';
        let tracksHtml = '';
        if (subtitleStreams.length > 0) {
            subtitleSelectHtml = `<select class="jf-subtitle-select" style="background:#333; color:#fff; border:none; margin-right:10px; border-radius:3px; padding:2px; font-size:12px; outline:none; max-width:120px;">
                <option value="-1">鍏抽棴瀛楀箷</option>
                ${subtitleStreams.map((s, i) => `<option value="${s.Index}">${s.Title || s.Language || `Subtitle ${i+1}`}</option>`).join('')}
            </select>`;
            
            subtitleStreams.forEach(s => {
                const trackUrl = `${auth.url}/Videos/${itemId}/${mediaSourceId}/Subtitles/${s.Index}/Stream.vtt?api_key=${auth.token}`;
                tracksHtml += `<track kind="subtitles" label="${s.Title || s.Language || `Subtitle ${s.Index}`}" src="${trackUrl}" srclang="${s.Language || 'en'}" data-index="${s.Index}">`;
            });
        }
        // --- 缁撴潫瀛楀箷鎻愬彇閫昏緫 ---

        const container = document.createElement('div');
        container.className = 'jf-preview-instance';
        container.setAttribute('data-item-id', itemId);
        const pos = getSlotStyle(slotIndex);
        Object.assign(container.style, pos);

        const videoUrl = `${auth.url}/Items/${itemId}/Download?api_key=${auth.token}`;
        container.innerHTML = `
            <div class="jf-preview-header">
                <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:50%;"><span class="jf-title-play-count" style="color:#aaa; font-size:11px; margin-right:8px;" title="鎾斁娆℃暟">[鎾斁: ${playCount}]</span>${title}</span>
                <div style="display:flex; align-items:center;">
                    ${subtitleSelectHtml}
                    <select class="jf-select-vr-mode" style="background:#333; color:#fff; border:none; margin-right:4px; border-radius:3px; padding:2px; font-size:12px; outline:none; display:none;">
                        <option value="360_2d">360掳 2D</option>
                        <option value="360_3d_lr">360掳 宸﹀彸</option>
                        <option value="360_3d_tb">360掳 涓婁笅</option>
                        <option value="180_2d">180掳 2D</option>
                        <option value="180_3d_lr">180掳 宸﹀彸</option>
                        <option value="plane_2d">骞抽潰褰遍櫌</option>
                    </select>
                    <div class="jf-btn-vr" style="cursor: pointer; padding: 2px 8px; background: #5533ff; border-radius: 4px; font-size: 11px; font-weight: bold; color: white; margin-right: 4px;" title="寮€鍚?鍏抽棴 VR 妯″紡">馃ソ VR</div>
                    <div class="jf-btn-next-video" style="cursor: pointer; padding: 2px 8px; background: #e67e22; border-radius: 4px; font-size: 11px; font-weight: bold; color: white; margin-right: 4px;" title="鎾斁涓嬩竴涓?Part 鎴栬棰?>涓嬩竴閮?/div>
                    <div class="jf-btn-mpv" style="cursor: pointer; padding: 2px 8px; background: #00b300; border-radius: 4px; font-size: 11px; font-weight: bold; color: white; margin-right: 4px;" title="浣跨敤 MPV Shim 鎾斁">MPV 鎾斁</div>
                    <div class="jf-btn-next" style="cursor: pointer; padding: 2px 8px; background: #00a4dc; border-radius: 4px; font-size: 11px; font-weight: bold; color: white; margin-right: 4px; display: ${(isRandomMode || isTryNewRandomMode || isFavoriteRandomMode) ? 'block' : 'none'};">鎹竴涓?/div>
                    <div class="jf-btn-reload" title="閲嶆柊鍔犺浇姝ょ獥鍙?>鍒锋柊</div>
                    <div class="jf-btn-favorite" title="鍔犲叆/鍙栨秷鏈€鐖? style="background: ${isFav ? '#e6b800' : '#444'};" data-isfav="${isFav}">${isFav ? '宸叉渶鐖? : '鏈€鐖?}</div>
                    <div class="jf-btn-delete" title="鍒犻櫎瑙嗛鏂囦欢">鍒犻櫎</div>
                    <div class="jf-btn-close">鍏抽棴</div>
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
        
        // --- 澧炲姞瀛楀箷鍒囨崲閫昏緫 ---
        const subtitleSelect = container.querySelector('.jf-subtitle-select');
        if (subtitleSelect) {
            const fileName = info?.Path || title || '';
            // 鍖归厤甯歌鐨勭‖瀛楀箷鏍囪瘑锛屽 -C, -UC, -c.mp4, -UC_FHD 绛?
            const hasHardcodedSubs = /-(u?c)(?:[^a-z0-9]|$)/i.test(fileName);

            if (hasHardcodedSubs) {
                subtitleSelect.value = "-1"; // 榛樿鍏抽棴澶栨寕瀛楀箷
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
            subtitleSelect.addEventListener('mousedown', (e) => e.stopPropagation()); // 闃叉鎷栨嫿骞叉壈
            
            videoEl.addEventListener('loadedmetadata', updateSubtitles, { once: true });
        }
        // --- 缁撴潫瀛楀箷鍒囨崲閫昏緫 ---
        
        // 鍒ゅ畾璺宠浆鏃堕棿锛氫紭鍏堜娇鐢ㄧ偣鍑绘椂鐨勯瑙堟椂闂达紝鍏舵鏄湇鍔″櫒璁板綍鐨勬椂闂?
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
        winObj.info = info; // 瀛樺偍 info 渚涘悗缁娇鐢?

        // 鑾峰彇 AdditionalParts
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

        // 鍒濆鍖栭瑙堝浘涓庝氦浜?
        setupTrickplay(winObj, itemId, auth);
        setupInteractions(winObj);

        markAsPlayed(itemId, auth);
        reportPlayback(itemId, auth, 0, false, 'Started');

        // 姣?10 绉掑嵆鏃朵笂鎶ヨ繘搴?
        winObj.progressTimer = setInterval(() => {
            if (!videoEl.paused) {
                reportPlayback(itemId, auth, videoEl.currentTime, false, 'Progress');
            }
        }, 10000);

        // === 鏂板锛歁PV Shim 鎶曞睆鍔熻兘 ===
        const btnMPV = container.querySelector('.jf-btn-mpv');
        if (btnMPV) {
            btnMPV.onclick = async (e) => {
                e.stopPropagation();
                const auth = getAuth();
                if (!auth) return;

                // 鏆傚仠褰撳墠灏忕獥鍙ｇ殑瑙嗛鎾斁浠ヨ妭鐪佽祫婧?
                if (videoEl) {
                    videoEl.pause();
                }

                const startTicks = Math.floor((videoEl ? videoEl.currentTime : 0) * 10000000);

                // 鏌ヨ鎵€鏈?Sessions锛屽鎵?MPV Shim
                let mpvSession = null;
                try {
                    const res = await fetch(`${auth.url}/Sessions?api_key=${auth.token}`);
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);
                    const sessions = await res.json();

                    // 璇婃柇锛氭墦鍗版墍鏈変細璇濓紝鏂逛究 F12 璋冭瘯
                    console.log('[JF MPV] 褰撳墠鎵€鏈?Sessions:');
                    sessions.forEach(s => console.log(
                        `  Client="${s.Client}" | DeviceName="${s.DeviceName}" | SupportsMediaControl=${s.SupportsMediaControl} | Id=${s.Id}`
                    ));

                    // 1. 绮剧‘鍖归厤瀹樻柟瀹㈡埛绔悕 "Jellyfin MPV Shim"
                    mpvSession = sessions.find(s => s.Client === 'Jellyfin MPV Shim');

                    // 2. 瀹芥澗鍖归厤锛欳lient 鎴?DeviceName 鍚?"mpv"锛堝ぇ灏忓啓涓嶆晱鎰燂級
                    if (!mpvSession) {
                        mpvSession = sessions.find(s =>
                            (s.Client && s.Client.toLowerCase().includes('mpv')) ||
                            (s.DeviceName && s.DeviceName.toLowerCase().includes('mpv'))
                        );
                    }

                    // 3. 鏈€鍚庡厹搴曪細鏀寔濯掍綋鎺у埗 涓?闈炴祻瑙堝櫒 Web 瀹㈡埛绔?
                    if (!mpvSession) {
                        mpvSession = sessions.find(s =>
                            s.SupportsMediaControl &&
                            s.Client !== 'Jellyfin Web' &&
                            s.Client !== 'Jellyfin Web Client'
                        );
                    }
                } catch (err) {
                    console.error('[JF MPV] 鑾峰彇 Sessions 澶辫触:', err);
                    showToast('鉂?鏃犳硶鏌ヨ Sessions锛岃妫€鏌?F12 鎺у埗鍙?, 'warning');
                    return;
                }

                if (mpvSession) {
                    console.log(`[JF MPV] 鎵惧埌鐩爣: Client="${mpvSession.Client}" Device="${mpvSession.DeviceName}"锛屾鍦ㄦ姇灞?..`);
                    try {
                        const playParams = new URLSearchParams({
                            api_key: auth.token,
                            playCommand: 'PlayNow',
                            itemIds: itemId,
                            startPositionTicks: startTicks
                        });
                        const playUrl = `${auth.url}/Sessions/${mpvSession.Id}/Playing?${playParams}`;
                        const playRes = await fetch(playUrl, { method: 'POST' });
                        console.log(`[JF MPV] 鎶曞睆鍝嶅簲: HTTP ${playRes.status}`);
                        if (playRes.ok) {
                            showToast(`馃幀 宸叉姇灞忓埌 ${mpvSession.Client} (${mpvSession.DeviceName})锛乣);
                            return;
                        } else {
                            const errText = await playRes.text().catch(() => '');
                            console.error('[JF MPV] 鎶曞睆澶辫触:', errText);
                            showToast(`鉂?鎶曞睆澶辫触 HTTP ${playRes.status}锛岃鏌ョ湅 F12 鎺у埗鍙癭, 'warning');
                        }
                    } catch (playErr) {
                        console.error('[JF MPV] 鎶曞睆璇锋眰寮傚父:', playErr);
                        showToast('鉂?鎶曞睆璇锋眰寮傚父锛岃鏌ョ湅 F12 鎺у埗鍙?, 'warning');
                    }
                } else {
                    // 鏈壘鍒颁换浣曞彲鎺у埗鐨?MPV 浼氳瘽
                    console.warn('[JF MPV] 鏈壘鍒板彲鐢?MPV Shim Session锛岃鏌ョ湅 F12 鎺у埗鍙颁腑鐨?Sessions 鍒楄〃纭瀹㈡埛绔悕绉般€?);
                    showToast('鈿狅笍 鏈壘鍒?MPV Shim 浼氳瘽锛佺‘璁わ細1) MPV Shim 宸插惎鍔ㄥ苟鐧诲綍  2) F12 鏌ョ湅 [JF MPV] 鏃ュ織  3) 纭 Client 鍚嶇О', 'warning');
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
                // 閿€姣佺獥鍙ｄ絾涓嶈Е鍙戦€掕ˉ锛岃 createPreview 鐩存帴濉洖鍘熸Ы浣?
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
                    btnFavorite.innerText = currentlyFav ? '宸叉渶鐖? : '鏈€鐖?;
                    btnFavorite.style.background = currentlyFav ? '#e6b800' : '#444';
                    
                    // 灏濊瘯鍦ㄩ〉闈笂鎵惧埌瀵瑰簲鐨勫崱鐗囧苟鏇存柊鍏剁埍蹇冨浘鏍?
                    const card = document.querySelector(`.card[data-id="${itemId}"]`);
                    if (card) {
                        let favIcon = card.querySelector('.jf-custom-fav-icon');
                        if (currentlyFav) {
                            if (!favIcon) {
                                favIcon = document.createElement('div');
                                favIcon.className = 'jf-custom-fav-icon';
                                favIcon.innerHTML = '鉂わ笍';
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
                if (confirm('纭畾瑕佸垹闄ゆ瑙嗛鍚楋紵\n璀﹀憡锛氳繖灏嗕粠鏈嶅姟鍣ㄥ拰鐗╃悊纭洏涓婃案涔呭垹闄よ鏂囦欢锛?)) {
                    const currentSlot = winObj.slotIndex;
                    destroyWindow(winObj);
                    
                    // 璋冪敤 API 鍒犻櫎
                    await deleteItem(itemId, auth);
                    
                    // 瑙﹀彂閫掕ˉ锛堝唴閮ㄤ細鍒ゆ柇鏄惁寮€鍚柊绐楀彛锛?
                    handleRandomWindowClose(currentSlot);
                    
                    // 浠庡綋鍓嶉〉闈?DOM 涓Щ闄よ鍗＄墖锛岄伩鍏嶅啀娆¤闅忔満鎶戒腑
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

    // 澶勭悊绮剧伒鍥?
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
            // 妯″紡锛氬湪搴曢儴 1/8 鍖哄煙鎴栬€呮鍦ㄦ粴鍔ㄥ鎵捐繘搴︽椂锛屾樉绀哄師鐢熸帶浠?
            if (e.offsetY > video.offsetHeight * 0.875 || winObj.isWheelSeeking) {
                video.controls = true; 
                // 濡傛灉姝ｅ湪婊氳疆蹇繘锛屽垯涓嶈鏍规嵁榧犳爣浣嶇疆鏇存柊棰勮鍥撅紝閬垮厤鍐茬獊
                if (winObj.isWheelSeeking) return;

                const rect = video.getBoundingClientRect();
                const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                update(video.duration * percent, percent);
            } else {
                video.controls = false; // 绂诲紑鍖哄煙闅愯棌鎺т欢
                if (!winObj.isWheelSeeking) thumbBox.style.display = 'none';
            }
        });

        video.addEventListener('mouseleave', () => {
            video.controls = false;
            // 濡傛灉涓嶆槸鍦ㄦ粴鍔ㄤ腑锛屽垯闅愯棌
            if (!winObj.isWheelSeeking) thumbBox.style.display = 'none';
        });

        // 褰撹棰戠湡姝ｈ烦杞畬鎴愬悗锛屼氦鐢卞欢鏃跺櫒鍘婚殣钘忕缉鐣ュ浘锛岄槻姝㈣烦鍔?
        video.addEventListener('seeked', () => {
             // 淇濈暀涓虹┖锛屼氦鐢?wheelTimer/hideTimer 鑷劧绠＄悊
        });
    }

    // 鑷姩鎾斁涓庡垎娈靛鐞嗙浉鍏宠緟鍔╁嚱鏁?
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

        headerTitleSpan.innerHTML = `<span class="jf-title-play-count" style="color:#aaa; font-size:11px; margin-right:8px;" title="鎾斁娆℃暟">[鎾斁: ${playCount}]</span>${baseTitle}${partText}`;
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
        const videoUrl = `${winObj.auth.url}/Items/${partItem.Id}/Download?MediaSourceId=${mediaSourceId}&api_key=${winObj.auth.token}`;
        
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

        // 鑾峰彇鏂?Item 鐨?AdditionalParts
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
            const videoUrl = `${winObj.auth.url}/Items/${nextItemId}/Download?MediaSourceId=${mediaSourceId}&api_key=${winObj.auth.token}`;
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

        // 1. 妫€鏌ュ綋鍓?item 鏄惁鏈夋湭鎾斁瀹岀殑鍒嗘 (AdditionalParts)
        if (winObj.partsList && winObj.currentPartIndex < winObj.partsList.length - 1) {
            const nextPartIndex = winObj.currentPartIndex + 1;
            console.log(`[JF] Playing next part (${nextPartIndex + 1}/${winObj.partsList.length}) of item ${winObj.mainItemId}`);
            await playPartInWindow(winObj, nextPartIndex);
            return;
        }

        // 2. 鍚﹀垯锛屽鎵惧悓涓€涓枃浠跺す/Season 涓殑涓嬩竴涓?Item (涓嬩竴闆?鍚屼竴涓枃浠跺す涓嬬殑涓嬩竴閮ㄥ奖鐗?
        const nextItem = await getNextItemInFolder(winObj.mainItemId, winObj.info, winObj.auth);
        if (nextItem) {
            console.log(`[JF] Autoplay transitioning to next item in folder: ${nextItem.title} (ID: ${nextItem.id})`);
            await transitionWindowToItem(winObj, nextItem.id, nextItem.title);
            return;
        }

        // 3. 鍏滃簳锛氬鎵鹃〉闈笂鐨勪笅涓€涓崱鐗?
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

    // 浜や簰涓庢墜鍔ㄨ皟鏁?
    function toggleVRForWindow(winObj) {
        const btn = winObj.el.querySelector('.jf-btn-vr');
        const select = winObj.el.querySelector('.jf-select-vr-mode');
        const videoEl = winObj.el.querySelector('.jf-video-el');

        if (!videoEl) return;

        if (winObj.vrActive) {
            closeVRForWindow(winObj);
            btn.innerHTML = '馃ソ VR';
            btn.style.backgroundColor = '#5533ff';
            select.style.display = 'none';
        } else {
            winObj.vrActive = true;
            btn.innerHTML = '鉂?閫€鍑?;
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

        // 澶囦唤鍏抽敭鐨勫叏灞€婊氬姩灞炴€т笌鏍峰紡锛堥槻鑼?mxreality.js 閫氳繃鐩存帴璧嬪€艰鐩栬€岀粫杩?addEventListener 鍔寔锛?
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

        // 鍚敤鍏ㄥ眬鍔寔閫昏緫锛岀敤浜庢崟鑾峰紓姝?寤惰繜娉ㄥ唽鐨?mxreality.js 鐩戝惉鍣ㄥ苟灞忚斀鍏ㄥ眬婊氬姩鍔寔
        winObj.capturedWindowListeners = [];
        window.jfVRCapturingActiveList = winObj.capturedWindowListeners;
        window.jfVRCapturing = true;

        // 5绉掑悗鍋滄鍏ㄥ眬鍔寔鎹曡幏锛堟鏃?mxreality.js 鍐呴儴寮傛鍒濆鍖栨祦绋嬪潎宸插畬姣曪級
        setTimeout(() => {
            if (window.jfVRCapturingActiveList === winObj.capturedWindowListeners) {
                window.jfVRCapturing = false;
                window.jfVRCapturingActiveList = null;
            }
        }, 5000);

        // 鍒濆鍖?Three.js
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

        // 浣跨敤 ResizeObserver 鐩戝惉绐楀彛灏哄鍙樺寲浠ヨ皟鏁?canvas
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

        // 娓呯悊 mxreality.js 娉ㄥ唽鍦?window/document 涓婄殑鍏ㄥ眬浜嬩欢鐩戝惉鍣?
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

        // 杩樺師璁板綍鐨勬粴鍔ㄥ睘鎬с€佹牱寮忎笌 class
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
            if (e.buttons === 1) return; // 蹇界暐宸﹂敭鎷栨嫿浠ュ厑璁哥獥鍙ｆ嫋鍔?缂╂斁

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
            // 闃绘宸﹂敭 mousedown 浜嬩欢鍦?VR 瀹瑰櫒鍐呭啋娉★紝浠ラ伩鍏嶈Е鍙?jf-preview-instance 鐨勬嫋鎷藉姩浣滃共鎵?look-around
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
                    toggleVRForWindow(winObj); // 涓敭閫€鍑?VR 妯″紡
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

        // 鍙抽敭鐐瑰嚮鏍囬鏍忔椂锛屼唬鐞嗚Е鍙戝搴旀捣鎶ョ殑鍘熺敓鍙抽敭鑿滃崟
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

        // 鏃犺鐐瑰嚮鍝噷锛岄兘缃《锛涗腑閿偣鍑诲垯鍏抽棴
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
        }, true); // 浣跨敤鎹曡幏妯″紡浼樺厛澶勭悊涓敭鍏抽棴

        const startDrag = (e) => {
            if (e.button !== 0) return; // 鍙湁宸﹂敭鍙互鎷栧姩
            if (e.target.classList.contains('jf-btn-close') || e.target.classList.contains('jf-btn-delete') || e.target.classList.contains('jf-btn-next') || e.target.classList.contains('jf-btn-favorite') || e.target.classList.contains('jf-btn-reload') || e.target.closest('.jf-subtitle-select') || e.target.classList.contains('jf-btn-vr') || e.target.classList.contains('jf-btn-next-video') || e.target.closest('.jf-select-vr-mode')) return;
            // 濡傛灉鐐瑰嚮鐨勬槸瑙嗛鍖哄煙涓斿湪搴曢儴 20% 鑼冨洿鍐咃紙閫氬父鏄繘搴︽潯锛夛紝鍒欎笉瑙﹀彂鎷栧姩
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

            // 鎷︽埅鐐瑰嚮浜嬩欢浠ラ槻姝㈣瑙﹀彂鏆傚仠
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

        // 婊氳疆蹇繘蹇€€ logic - 浼樺寲娴佺晠搴?
        let wheelTimer = null;
        let hideTimer = null;
        
        el.addEventListener('wheel', (e) => {
            e.preventDefault();
            const step = 5;
            const duration = video.duration || 0;
            if (duration === 0) return;

            // 鏍囪姝ｅ湪浣跨敤婊氳疆瀵绘壘锛屾樉绀哄師鐢熸帶浠?
            winObj.isWheelSeeking = true;
            video.controls = true;

            // 绔嬪嵆璁＄畻骞舵洿鏂拌棰戞椂闂达紝浠ュ悓姝ュ師鐢熻繘搴︽潯
            let targetTime = video.currentTime;
            if (e.deltaY > 0) {
                targetTime = Math.min(duration, targetTime + step);
            } else {
                targetTime = Math.max(0, targetTime - step);
            }
            
            video.currentTime = targetTime;
            
            // 瀹炴椂鏄剧ず trickplay 缂╃暐鍥?
            if (typeof winObj.updateThumb === 'function') {
                winObj.updateThumb(targetTime, targetTime / duration);
            }

            clearTimeout(wheelTimer);
            clearTimeout(hideTimer);
            
            wheelTimer = setTimeout(() => {
                if (!video.paused) video.play().catch(() => { });
                // 蹇繘鍚庝笂鎶ヤ竴娆¤繘搴︼紝纭繚鍚屾
                reportPlayback(winObj.itemId, winObj.auth, video.currentTime, false, 'Progress');
                
                // 寤惰繜 0.3 绉掑悗鍏抽棴棰勮鍜屾帶鍒舵潯
                hideTimer = setTimeout(() => { 
                    winObj.isWheelSeeking = false;
                    const thumbBox = winObj.el.querySelector('.jf-trickplay-thumb');
                    if (thumbBox) thumbBox.style.display = 'none';
                    // 濡傛灉涓嶅湪搴曢儴 1/8 鐑尯锛堝嵆甯歌杩涘害鏉″尯鍩燂級锛屽垯鍏抽棴鍘熺敓鎺т欢灞曠ず
                    if (!video.matches(':hover') || e.offsetY <= video.offsetHeight * 0.875) {
                         video.controls = false;
                    }
                }, 300);
            }, 100); // 绋嶅井澧炲姞闃叉姈锛屽噺灏戦绻佺殑 API 涓婃姤
        }, { passive: false });
    }

        style.textContent += `
            .countIndicator, .playedIndicator, .playedIndicatorContainer, .playCountIndicator, .playcount {
                pointer-events: auto !important;
                cursor: pointer !important;
            }
        `;
        document.head.appendChild(style);

    // --- 鍒涘缓鐪熸鐨勮劚绂绘鏋剁殑鎮诞杩涘害鏉＄粍浠?---
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

         // 鏇存柊鎮诞 trickplay 鐨勭敾闈㈠拰浣嶇疆
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
             // 闄愬埗宸﹀彸杈圭晫锛岄伩鍏嶈秴鍑哄睆骞?
             const safeX = Math.max(160, Math.min(window.innerWidth - 160, clientX));
             globalTrickplayPreview.style.left = (safeX + window.scrollX) + 'px';
             // 鏀逛负鍦ㄨ繘搴︽潯涓嬫柟鏄剧ず锛岄伩鍏嶆尅浣忓崱鐗囧唴姝ｅ湪鎾斁鐨勮棰?
             globalTrickplayPreview.style.top = (pRect.bottom + window.scrollY + 10) + 'px'; 
         }
         
         // 涓嶈鏄帹鎷戒腑杩樻槸鍗曞嚮涓紝閮藉彲浠ユ洿鏂颁竴娆″簳灞傜殑瀹為檯鎾斁鍗＄墖杩涘害
         if (doSeek) {
              const cardEl = document.querySelector(`[data-id="${itemId}"].card`);
              if (cardEl) {
                  const rv = cardEl.querySelector('.jf-real-video');
                  if (rv && typeof isRealVideoPreview !== 'undefined' && isRealVideoPreview) {
                      rv.currentTime = cSeek;
                      rv.play().catch(()=>{});
                  } else {
                      // 灏嗘捣鎶ヨ儗鍚庣殑 trickplay 鐢婚潰涔熷悓姝ユ嫧鍔ㄨ繃鍘?
                      const rect = cardEl.getBoundingClientRect();
                      const evt = new MouseEvent('mousemove', { clientX: clientX, clientY: rect.top + rect.height/2, bubbles: true });
                      cardEl.dispatchEvent(evt);
                  }
                  
                  // 鍚屾鏇存柊搴曟灏忚繘搴︽潯
                  const fakePb = cardEl.querySelector('.jf-pc-progress-bar');
                  if (fakePb) fakePb.style.width = (clickedPercent * 100) + '%';
              }
         }
    }

    // --- 鐙珛杩涘害鏉℃嫋鍔ㄤ笌鎮仠浜嬩欢鐢熷懡鍛ㄦ湡 ---
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
                 // 濡傛灉涓嶅湪杩涘害鏉″唴閮ㄦ澗鎵嬶紝闅愯棌 trickplay 灏忛瑙?
                 globalTrickplayPreview.style.display = 'none';
             }
        });
    });

    globalProgressPopup.addEventListener('mousemove', (e) => {
        if (!isDraggingGlobalProgress) {
             handleProgressInteraction(e, false); // 浠呰窡闅忓嚭棰勮锛屼笉鏇存柊瀹為檯杩涘害
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

         // 鍔犲叆婊氳疆杈圭晫闄愬埗锛屽悜涓嬫粴蹇繘锛屽悜涓婃粴鍊掗€€锛堥檷浣庨€熷害锛?
         const step = 5; // 闄嶄綆涓烘瘡娆℃粴鍔?5 绉?
         if (e.deltaY > 0) {
              currentSeek = Math.min(durSec, currentSeek + step);
         } else {
              currentSeek = Math.max(0, currentSeek - step);
         }

         // 璁＄畻鍋囪繘搴?X 鍧愭爣浣嶇疆浼犻€掔粰浜や簰鏍稿績
         const pRect = globalProgressPopup.getBoundingClientRect();
         const fakeClientX = pRect.left + (currentSeek / durSec) * pRect.width;
         
         handleProgressInteraction({ clientX: fakeClientX }, true);
    }, { passive: false });

    // --- 鍗＄墖涓婃粴杞揩杩涘揩閫€ ---
    document.addEventListener('wheel', (e) => {
        // 濡傛灉鏄湪杩涘害鏉″脊绐椾笂婊氬姩锛屽凡缁忔湁鍗曠嫭閫昏緫澶勭悊
        if (e.target.closest('#jf-global-progress-popup')) return;

        const card = e.target.closest('[data-id].card');
        if (!card) return;

        // 濡傛灉鍘熺敾寮曟搸鍜岃嚜鍔ㄨ疆鎾兘娌″紑锛屽氨涓嶆帴绠℃粴杞?
        if (typeof isRealVideoPreview !== 'undefined' && !isRealVideoPreview && !isAutoPlayEnabled) return;

        const rv = card.querySelector('.jf-real-video');
        const overlay = card.querySelector('.jf-sprite-overlay');
        
        // 鍒ゆ柇褰撳墠鏄惁鏈夋鍦ㄥ睍鐜扮殑棰勮
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
        
        // 涓轰簡鍜屾嫋鎷藉悓姝ワ紝鎴戜滑涔熻皟鐢?handleProgressInteraction 鏉ユ洿鏂?UI
        // 鎴栬€呰嚦灏戞洿鏂板簳閮ㄧ殑杩涘害鏉¤繘搴?
        const percent = currentSeek / durSec;
        const fakePb = card.querySelector('.jf-pc-progress-bar');
        if (fakePb) fakePb.style.width = (percent * 100) + '%';
        
        if (globalProgressPopup.dataset.itemId === itemId && globalProgressPopup.style.display === 'block') {
             const pb = globalProgressPopup.firstChild;
             if (pb) pb.style.width = (percent * 100) + '%';
             
             // 濡傛灉鎯宠瀹冨儚鏄湪鎷栧姩涓€鏍凤紝涔熷彲浠ョ洿鎺ヨ绠楃櫨鍒嗘瘮瀵瑰簲鍧愭爣骞惰皟鐢?handleProgressInteraction
             // 浣嗙洿鎺ユ敼杩涘害鏉″苟鏇存柊 autoplayStates 宸茬粡瓒冲锛宮ousemove 绛変細鍚屾
             
             // 涔熷悓姝ヤ竴涓?trickplay
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

     // --- 鍏ㄥ眬浜や簰浜嬩欢鎷︽埅涓庡垎鍙?(寮哄埗鐗╃悊鍒囨柇搴曞眰妗嗘灦浠ｇ悊) ---
    let clickStartTime = 0;
    const pointerEvents = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'touchstart', 'touchend'];
    
    pointerEvents.forEach(evt => {
        document.addEventListener(evt, async (e) => {
            // 鐙珛寮圭獥缁勪欢锛屼笉鍐嶉渶瑕佹嫤鎴唴閮ㄤ簨浠?
            if (e.target.closest('#jf-global-progress-popup')) return;

            // 2. 闀挎寜鏃堕棿璁板綍
            if (evt === 'mousedown' || evt === 'touchstart' || evt === 'pointerdown') {
                clickStartTime = Date.now();
            }

            // 3. 鎷︽埅鍘熺敾寮曟搸鎴栧揩鐓у紩鎿庡湪涓婁笁鍒嗕箣浜屽尯鍩熺殑寮傚父浜嬩欢
            const card = e.target.closest('[data-id].card');
            if (!card || e.target.closest('.jf-preview-instance') || e.target.closest('.jf-btn-close')) return;

            const rect = card.getBoundingClientRect();
            const clientY = e.clientY ?? (e.touches && e.touches.length > 0 ? e.touches[0].clientY : rect.top);
            const mouseY = clientY - rect.top;

            // 濡傛灉鏄師鐢诲紩鎿庯紝涓嶅脊绐楋紝涓婇潰2/3姝诲瘋锛堟垨鐢ㄤ簬瑙﹀彂瓒呰繃3鍒楁椂鐨勬墜鍔ㄦ挱鏀撅級锛屼笅闈?/3鍘熺敓鍔ㄤ綔
            if (typeof isRealVideoPreview !== 'undefined' && isRealVideoPreview) {
                 if (mouseY <= rect.height * 0.66) {                     
                     // 鍏ㄥ眬鎵嬪姩鎾斁/鏆傚仠寮€鍏?(涓嶈鍒楁暟锛岀偣鍑讳笂 2/3 鍖哄煙鍧囧彲鎺у埗鎾斁涓庢殏鍋?
                     if (evt === 'click' || evt === 'touchend') {
                          // 濡傛灉鏄暱鎸夛紝鍒欐斁杩囦互鏀寔绯荤粺鍘熸湁闀挎寜澶氶€夋搷浣?
                          if (Date.now() - clickStartTime > 500) return;
                          
                          e.preventDefault();
                          e.stopPropagation();
                          e.stopImmediatePropagation();
                          
                          const rv = card.querySelector('.jf-real-video');
                          if (rv) {
                              // 濡傛灉姝ｅ湪灏濊瘯鎾斁鎴栧凡缁忔槸鎵嬪姩鎾斁鐘舵€?
                              const isCurrentlyPlaying = rv.style.display === 'block' && rv.dataset.userPaused !== 'true';

                              if (isCurrentlyPlaying) {
                                  rv.dataset.manualPlay = 'false';
                                  rv.dataset.userPaused = 'true';
                                  rv.pause();
                                  rv.style.display = 'none';
                                  
                                  const overlay = card.querySelector('.jf-sprite-overlay');
                                  if (overlay) overlay.style.display = 'none'; // 闅愯棌 trickplay 鍙犲眰闇插嚭鍘熷鍥剧墖
                              } else {
                                  rv.dataset.manualPlay = 'true';
                                  rv.dataset.userPaused = 'false';
                                  // 绔嬪嵆灏濊瘯鍔犺浇鍜屾挱鏀?
                                  const auth = typeof getAuth === 'function' ? getAuth() : null;
                                  const itemId = card.getAttribute('data-id');
                                  if (auth && itemId) {
                                      rv.style.display = 'block';
                                      const videoUrl = `${auth.url}/Videos/${itemId}/stream?static=true&api_key=${auth.token}`;
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

            // 4. 褰撳師鐢诲紩鎿庡拰鑷姩杞挱閮藉叧闂椂锛屽鐞嗙偣鍑诲脊绐?
            if (!isRealVideoPreview && !isAutoPlayEnabled) {
                if (evt === 'click') {
                    // 濡傛灉鏄暱鎸?姣斿涓轰簡閫変腑鏂囨湰绛夐粯璁よ涓?锛屾斁杩?
                    if (Date.now() - clickStartTime > 500) return;
                    
                    // 涓嬩笁鍒嗕箣涓€涓嶅脊绐楋紝鐩存帴杞師娴佺▼杩涘叆璇︽儏
                    if (mouseY > rect.height * 0.66) return;

                    const itemId = card.getAttribute('data-id');
                    const type = card.getAttribute('data-type');
                    const folderTypes = ['Folder', 'CollectionFolder', 'Series', 'Season', 'BoxSet', 'Playlist', 'MusicAlbum', 'MusicArtist', 'UserView'];
                    if (type && folderTypes.includes(type)) return;

                    const auth = getAuth();
                    if (!auth) return;

                    // 纭涓哄皬绐楀姩浣滃悗锛屽悶鎺夌偣鍑讳簨浠?
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();

                    const title = card.querySelector('.cardText')?.innerText || '瑙嗛棰勮';
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
    
    // --- 娴锋姤鎾斁娆℃暟瑙掓爣 ---
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
        badge.textContent = '鈻?' + playCount;
        badge.style.cssText = '';
    }

    // --- PC 绔紶鏍囨偓鍋滃師浣嶉瑙?(鏇夸唬 Global Trickplay) ---
    let activeHoverCard = null;
    const cardUICache = new WeakMap();

    function getCardUI(card) {
        let cached = cardUICache.get(card);
        if (cached) return cached;

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
            
            // 鍘熺敾寮曟搸妯″紡涓嬭嚜鍔ㄥ埄鐢ㄨ棰戞湰韬椂闂村埢搴︽洿鏂拌繘搴︽潯
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
        cardUICache.set(card, ui);
        return ui;
    }

    document.addEventListener('mousemove', async (e) => {
        const isHoveringPopup = !!e.target.closest('#jf-global-progress-popup');
        const cardTarget = e.target.closest('.card');
        const card = cardTarget || (isHoveringPopup ? activeHoverCard : null);
        
        // 1. 澶勭悊绉诲嚭閫昏緫锛氬鏋滈紶鏍囩寮€浜嗕箣鍓嶇殑鍗＄墖锛屾垨鑰呭垏鎹㈠埌浜嗘柊鍗＄墖
        if (activeHoverCard && activeHoverCard !== card) {
             const oldUI = getCardUI(activeHoverCard);
             if (oldUI) {
                 oldUI.progressBg.style.display = 'none';
             }
             activeHoverCard = null;
             globalProgressPopup.style.display = 'none';
        }

        if (!card) return;

        // 2. 浠呯缉鐣ュ浘妯″紡锛堟í鍥撅級鍚敤浜や簰棰勮
        // 浣跨敤涓?mobile 鐗堜竴鑷寸殑妫€娴嬮€昏緫
        const imgContainer = card.querySelector('.cardImageContainer') || card.querySelector('.cardPadder') || card;
        const imgRect = imgContainer.getBoundingClientRect();
        if (imgRect.width / imgRect.height < 1.3) return;

        const itemId = card.getAttribute('data-id');
        if (!itemId) return;

        activeHoverCard = card;

        // 3. 鏁版嵁棰勫姞杞?(濡傛灉鏁版嵁涓嶅瓨鍦紝鍙戣捣璇锋眰浣嗕笉绔嬪嵆鏇存柊UI)
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

        // 4. 鑾峰彇 UI
        const ui = getCardUI(card);
        if (!ui) return;

        // 鏇存柊娴锋姤瑙掓爣锛堢紦瀛樺懡涓椂涔熶繚鎸佸悓姝ワ級
        updatePlayCountBadge(card, itemId, itemInfo);

        // 5. 鏄剧ず UI 缁勪欢
        ui.progressBg.style.display = 'block';
        
        // --- 鍏ㄥ眬鎮诞杩涘害鏉℃樉绀轰笌璺熼殢閫昏緫 ---
        const uiRect = ui.container.getBoundingClientRect();
        const localMouseY = e.clientY - uiRect.top;
        if (isRealVideoPreview && (localMouseY > uiRect.height - 30 || isHoveringPopup)) {
             globalProgressPopup.style.display = 'block';
             globalProgressPopup.style.left = (uiRect.left + window.scrollX) + 'px';
             // 绱ц创瀹瑰櫒搴曠寰€涓?6px
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

             // 鑻ヤ笉鍙瑕佹眰鎴栧ぇ鍒楁ā寮忎笅娌″紑鍚墜鍔ㄦ挱鏀撅紝鍧囩姝㈠叾鍦?hover 鏃剁鏉冩挱鏀?
             if (!isVisibleEnough || (!isColsAllowed && !isManualPlay) || isUserPaused) {
                  ui.realVideo.style.display = 'none';
                  ui.overlay.style.display = 'none'; // 淇濇寔闇插嚭鍘熷浘搴曡壊
                  return; 
             }
             
             ui.overlay.style.display = 'none';
             ui.realVideo.style.display = 'block';
             
             // 濡傛灉婧愯鏇挎崲/鏈缃紝鍒欐洿鏂?src 閬垮厤閲嶅鍔犺浇
             const videoUrl = `${auth.url}/Videos/${itemId}/stream?static=true&api_key=${auth.token}`;
             if (!ui.realVideo.src || !ui.realVideo.src.includes(videoUrl)) {
                 ui.realVideo.src = videoUrl;
                 ui.realVideo.currentTime = autoplayStates.get(itemId) || 0;
                 if (typeof markAsPlayed === 'function') markAsPlayed(itemId, auth);
                 if (typeof reportPlayback === 'function') reportPlayback(itemId, auth, ui.realVideo.currentTime, false, 'Started');
             }
             
             ui.realVideo.playbackRate = globalPlaySpeed;
             ui.realVideo.play().catch(() => {});
             
             // 婊戝姩榧犳爣鏃朵笉鍐嶆洿鏂板疄鏃惰繘搴︽潯鍜屾椂闂?(鐢辫棰戜簨浠?timeupdate 鎺ョ锛屾垨鐢辫繘搴︽潯鐨?mousedown 鐐瑰嚮澶勭悊)
             
        } else {
             ui.realVideo.style.display = 'none';
             ui.overlay.style.display = 'block';

             // 6. 浠呭湪 Trickplay 妯″紡涓嬭窡闅忛紶鏍囨粦鍔ㄨ绠楄繘搴?
             const rect = ui.container.getBoundingClientRect();
             const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
             
             // 鏇存柊杩涘害鏉?
             ui.progressBar.style.width = (percent * 100) + '%';

             // 7. 鏇存柊 Trickplay 鐢婚潰
             const seekTime = durationSec * percent;
             
             // 鍏抽敭鏇存柊锛氬悓姝ヨ嚜鍔ㄦ挱鏀剧姸鎬侊紝浣块紶鏍囩寮€鍚庤兘鎺ョ画鎾斁
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
                 
                 // 璁＄畻 offset
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
        // 鍏ㄥ眬绂诲紑娓呯悊
        if (activeHoverCard) {
             const oldUI = getCardUI(activeHoverCard);
             if (oldUI) {
                  oldUI.progressBg.style.display = 'none';
                  // 灏嗚棰戞殏鍋滃苟闅愯棌锛岄伩鍏嶆嫋鎱㈡祻瑙堝櫒鍜屽悗鍙颁竴鐩存挱鏀?
                  if (oldUI.realVideo) {
                      oldUI.realVideo.pause();
                      oldUI.realVideo.style.display = 'none';
                  }
             }
             activeHoverCard = null;
        }
    });

    // --- 缂╃暐鍥炬ā寮忚嚜鍔ㄦ挱鏀鹃€昏緫 ---
    const visibleCards = new Set();
    const autoplayStates = new Map(); // itemId -> currentSecond

    function initAutoplay() {
        if (typeof IntersectionObserver === 'undefined') return;

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                const card = entry.target;
                if (entry.isIntersecting) {
                    visibleCards.add(card);
                    
                    // 绔嬪嵆鑾峰彇璇︽儏骞跺睍绀烘挱鏀炬鏁拌鏍?
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
                    // 褰诲簳閲婃斁鑴辩褰撳墠瑙嗗彛鐨勮棰戣祫婧愪互闃叉鍐呭瓨娉勬紡
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

        // 鍒濆鍖栧紑鍏虫寜閽?(鎻掑叆鍒伴《閮ㄨ彍鍗曚腑)
        function setupToggleBtn() {
            const headerActions = document.querySelector('.headerRight');
            if (headerActions && !document.querySelector('.jf-btn-autoplay-toggle')) {
                // 鍘熺敾寮曟搸鎸夐挳
                const realVideoBtn = document.createElement('div');
                realVideoBtn.className = 'jf-btn-autoplay-toggle';
                realVideoBtn.style.marginLeft = 'auto'; // 淇濈暀闈犲乏瀵归綈骞舵帹寮€鍘熸湰鎸夐挳
                realVideoBtn.innerText = '鍘熺敾寮曟搸: 鍏?;
                realVideoBtn.onclick = () => {
                     isRealVideoPreview = !isRealVideoPreview;
                     realVideoBtn.classList.toggle('active', isRealVideoPreview);
                     realVideoBtn.innerText = '鍘熺敾寮曟搸: ' + (isRealVideoPreview ? '寮€' : '鍏?);
                     
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
                btn.style.marginLeft = '8px'; // 缁欒嚜鍔ㄨ疆鎾姞涓婁竴鐐瑰乏闂磋窛
                btn.innerText = '鑷姩杞挱: 鍏?;
                btn.onclick = () => {
                    isAutoPlayEnabled = !isAutoPlayEnabled;
                    btn.classList.toggle('active', isAutoPlayEnabled);
                    btn.innerText = '鑷姩杞挱: ' + (isAutoPlayEnabled ? '寮€' : '鍏?);
                    // 鍏抽棴鏃讹紝褰诲簳闅愯棌鎵€鏈夋鍦ㄨ嚜鍔ㄨ疆鎾殑鍙犲姞灞?
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
                speedBtn.innerText = '閫熷害: ' + globalPlaySpeed + 'x';
                speedBtn.onclick = () => {
                     let idx = speedOptions.indexOf(globalPlaySpeed);
                     idx = (idx + 1) % speedOptions.length;
                     globalPlaySpeed = speedOptions[idx];
                     speedBtn.innerText = '閫熷害: ' + globalPlaySpeed + 'x';
                };

                // 鍒楁暟婊戝潡
                const sliderContainer = document.createElement('div');
                sliderContainer.className = 'jf-btn-autoplay-toggle';
                sliderContainer.style.marginLeft = '8px';
                sliderContainer.style.cursor = 'default';
                sliderContainer.style.padding = '0 8px';
                
                const label = document.createElement('span');
                label.innerText = '鍒楁暟: ';
                label.style.marginRight = '6px';
                
                const slider = document.createElement('input');
                slider.type = 'range';
                slider.min = '0'; // 0 = 鑷姩
                slider.max = '8';
                slider.step = '1';
                slider.style.width = '60px'; // 闃叉婊戝潡杩囬暱
                
                const valLabel = document.createElement('span');
                valLabel.style.marginLeft = '6px';
                valLabel.style.display = 'inline-block';
                valLabel.style.minWidth = '24px'; 
                
                function updateCols(cols) {
                    if (cols === 0) {
                        slider.value = 0;
                        valLabel.innerText = '鑷姩';
                        document.body.classList.remove('jf-custom-cols');
                    } else {
                        slider.value = cols;
                        valLabel.innerText = cols;
                        document.body.classList.add('jf-custom-cols');
                        
                        // 鍔ㄦ€佽绠楀崰姣? 姣忚闂磋窛缂╁皬涓?0.4%, 鍑忓幓涓よ竟 margin
                        let margin = 0.4; 
                        let itemW = (100 - cols * margin * 2) / cols;
                        // 绮剧‘鍒板皬鏁扮偣鍚庝袱浣嶇殑鐧惧垎姣旓紝閬垮厤娴偣鏁伴€犳垚鐨勬崲琛?
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
                randomBtn.innerText = '闅忔満3绐?;
                randomBtn.onclick = () => {
                    const cards = Array.from(document.querySelectorAll('.card[data-id]')).filter(c => {
                        const type = c.getAttribute('data-type');
                        return !type || !folderTypes.includes(type);
                    });

                    if (cards.length === 0) {
                        alert('褰撳墠椤甸潰娌℃湁鎵惧埌鍙挱鏀剧殑瑙嗛锛?);
                        return;
                    }

                    isRandomMode = true;
                    isTryNewRandomMode = false;
                    isFavoriteRandomMode = false;
                    randomCols = 3;
                    randomGap = 20;

                    // 娓呴櫎鐜版湁鐨?
                    [...previewWindows].forEach(w => destroyWindow(w));

                    // 闅忔満閫変笁涓墦寮€
                    for (let i = 0; i < 3; i++) {
                        openRandomWindow();
                    }
                };

                const favoriteBtn = document.createElement('div');
                favoriteBtn.className = 'jf-btn-autoplay-toggle';
                favoriteBtn.style.marginLeft = '8px';
                favoriteBtn.style.backgroundColor = '#e91e63';
                favoriteBtn.style.borderColor = '#e91e63';
                favoriteBtn.innerText = '鏈€鐖遍殢鏈?;
                favoriteBtn.onclick = async () => {
                    const cards = Array.from(document.querySelectorAll('.card[data-id]')).filter(c => {
                        const type = c.getAttribute('data-type');
                        return !type || !folderTypes.includes(type);
                    });

                    if (cards.length === 0) {
                        alert('褰撳墠椤甸潰娌℃湁鎵惧埌鍙挱鏀剧殑瑙嗛锛?);
                        return;
                    }

                    isRandomMode = false;
                    isTryNewRandomMode = false;
                    isFavoriteRandomMode = true;
                    randomCols = 3;
                    randomGap = 20;

                    showToast('馃攳 姝ｅ湪鍔犺浇椤甸潰涓墍鏈夎棰戠殑鎾斁鏁版嵁...', 'info');
                    favoriteBtn.innerText = '鍔犺浇涓?..';
                    favoriteBtn.style.pointerEvents = 'none';

                    try {
                        await preloadAllCardsInfo();
                    } catch (e) {
                        console.error('[JF] Preload failed', e);
                    } finally {
                        favoriteBtn.innerText = '鏈€鐖遍殢鏈?;
                        favoriteBtn.style.pointerEvents = 'auto';
                    }

                    const favCount = cards.filter(card => {
                        const itemId = card.getAttribute('data-id');
                        const info = itemCache.get(itemId);
                        return info?.UserData?.IsFavorite || false;
                     }).length;

                    if (favCount === 0) {
                        alert('褰撳墠椤甸潰娌℃湁鎵惧埌浠讳綍琚偍鏍囪涓衡€滄渶鐖扁€濈殑瑙嗛锛?);
                        isFavoriteRandomMode = false;
                        return;
                    }

                    // 娓呴櫎鐜版湁鐨?
                    [...previewWindows].forEach(w => destroyWindow(w));

                    // 闅忔満閫変笁涓墦寮€
                    for (let i = 0; i < 3; i++) {
                        openRandomWindow();
                    }
                };

                const tryNewBtn = document.createElement('div');
                tryNewBtn.className = 'jf-btn-autoplay-toggle';
                tryNewBtn.style.marginLeft = '8px';
                tryNewBtn.style.backgroundColor = '#9c27b0';
                tryNewBtn.style.borderColor = '#9c27b0';
                tryNewBtn.innerText = '灏濇柊闅忔満';
                tryNewBtn.onclick = async () => {
                    const cards = Array.from(document.querySelectorAll('.card[data-id]')).filter(c => {
                        const type = c.getAttribute('data-type');
                        return !type || !folderTypes.includes(type);
                    });

                    if (cards.length === 0) {
                        alert('褰撳墠椤甸潰娌℃湁鎵惧埌鍙挱鏀剧殑瑙嗛锛?);
                        return;
                    }

                    isRandomMode = false;
                    isTryNewRandomMode = true;
                    isFavoriteRandomMode = false;
                    randomCols = 3;
                    randomGap = 20;

                    showToast('馃攳 姝ｅ湪鍔犺浇椤甸潰涓墍鏈夎棰戠殑鎾斁鏁版嵁...', 'info');
                    tryNewBtn.innerText = '鍔犺浇涓?..';
                    tryNewBtn.style.pointerEvents = 'none';

                    try {
                        await preloadAllCardsInfo();
                    } catch (e) {
                        console.error('[JF] Preload failed', e);
                    } finally {
                        tryNewBtn.innerText = '灏濇柊闅忔満';
                        tryNewBtn.style.pointerEvents = 'auto';
                    }

                    // 娓呴櫎鐜版湁鐨?
                    [...previewWindows].forEach(w => destroyWindow(w));

                    // 闅忔満閫変笁涓墦寮€
                    for (let i = 0; i < 3; i++) {
                        openRandomWindow();
                    }
                };

                // 鍙嶅悜鎻掑叆浠ヤ繚璇侀『搴? sliderContainer鍦ㄥ彸, speedBtn, btn, realVideoBtn鍦ㄥ乏
                headerActions.prepend(sliderContainer);
                headerActions.prepend(speedBtn);
                headerActions.prepend(btn);
                headerActions.prepend(realVideoBtn);
                headerActions.prepend(tryNewBtn);
                headerActions.prepend(favoriteBtn);
                headerActions.prepend(randomBtn);
            }
        }        setInterval(setupToggleBtn, 1000);

        // 璁板綍涓婃鏇存柊鏃堕棿鎺у埗鎾斁閫熺巼
        let lastUpdateTime = Date.now();

        setInterval(async () => {
            const now = Date.now();
            const dt = now - lastUpdateTime;
            lastUpdateTime = now;

            const auth = getAuth();
            if (!auth) return;

            for (const card of visibleCards) {
                // 濡傛灉榧犳爣姝ｅ湪鎮仠锛屽繀瀹氳烦杩?
                if (card.matches(':hover')) continue;

                const rect = card.getBoundingClientRect();
                const ui = getCardUI(card);
                
                // --- 浠ヤ笅澶勭悊闈炴偓鍋滅姸鎬佷笅锛堢敱寮€鍏冲喅瀹氭槸鍚﹁嚜鍔ㄨ疆鎾級---
                // 1. 濡傛灉寮€鍏抽兘琚叧闂紝鎴栬€呭崱鐗囧浘鐗囧尯鍩熶笉鏄í鍥炬ā寮忥紝闅愯棌鍙犲姞灞傚苟璺宠繃璁＄畻
                // 淇锛氬繀椤讳娇鐢?ui.container 鑰屼笉鏄?card 鏉ヨ绠楀楂樻瘮
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

                // 浼樺寲锛氬鏋滈紶鏍囨鎮仠鍦ㄥ崱鐗囦笂锛屼氦缁?mousemove 閫昏緫澶勭悊
                if (card.matches(':hover')) continue;

                ui.progressBg.style.display = 'block'; // 鑷姩鎾斁鏃朵篃鏄剧ず杩涘害鏉?

                const durationSec = info.RunTimeTicks / 10000000;
                let curTime = autoplayStates.get(itemId) || 0;
                
                if (isRealVideoPreview) {
                     // 1. 瑙嗚鐜囨娴嬶細椤甸潰涓婃湭鏄剧ず瓒呰繃涓夊垎涔嬩竴鐨勭缉鐣ュ浘涓嶆挱鏀捐棰?
                     const imgRectLocal = ui ? ui.container.getBoundingClientRect() : rect;
                     const visibleHeight = Math.min(imgRectLocal.bottom, window.innerHeight) - Math.max(imgRectLocal.top, 0);
                     const isVisibleEnough = (visibleHeight >= imgRectLocal.height * 0.33);

                     // 2. 鍒楁暟妫€娴嬶細澶т簬3鍒楁椂绂佺敤鑷姩鎾斁
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
                                  // 濡傛灉鏄洜涓烘粴鍑哄睆骞曞鑷村仠姝㈢殑锛岄噸缃负闈炴墜鍔ㄧ姸鎬侊紝鍏嶅緱涓嬫婊氬洖鏉ュ張澶勪簬濂囨€姸鎬?
                                  ui.realVideo.dataset.manualPlay = 'false';
                                  ui.realVideo.dataset.userPaused = 'false';
                              }
                          }
                          continue; 
                     }
                     
                     ui.overlay.style.display = 'none';
                     ui.realVideo.style.display = 'block';
                     
                     const videoUrl = `${auth.url}/Videos/${itemId}/stream?static=true&api_key=${auth.token}`;
                     if (!ui.realVideo.src || !ui.realVideo.src.includes(videoUrl)) {
                         ui.realVideo.src = videoUrl;
                         // 鍒濇寤虹珛瑙嗛杩炴帴锛岀洿鎺ヨ缃繘搴﹀苟鐢辫棰戣嚜韬潵鎺у埗鍚庣画娴侀€濓紝涓嶅啀姝ヨ繘鍙犲姞 dt
                         ui.realVideo.currentTime = curTime;
                         if (typeof markAsPlayed === 'function') markAsPlayed(itemId, auth);
                         if (typeof reportPlayback === 'function') reportPlayback(itemId, auth, ui.realVideo.currentTime, false, 'Started');
                     } 
                     
                     // 鎸佺画妫€鏌ユ槸涓嶆槸宸茬粡鍦ㄦ挱锛岀淮鎸侀€熷害
                     ui.realVideo.playbackRate = globalPlaySpeed;
                     ui.realVideo.play().catch(()=>{});

                     // 璁╄繘搴︽潯瀹炴椂璺熼殢鍘熺敾瑙嗛鑷韩鐨勭粷瀵硅繘搴︼紝鑰屼笉鍐嶄汉涓虹疮鍔?curTime
                     curTime = ui.realVideo.currentTime;
                     autoplayStates.set(itemId, curTime);
                     
                     const percent = curTime / durationSec;
                     ui.progressBar.style.width = (percent * 100) + '%';
                     
                } else {
                     ui.realVideo.style.display = 'none';
                     ui.overlay.style.display = 'block';

                     // 鍘熸湁渚濋潬鍥剧墖姝ヨ繘鐨勫揩鐓ч€昏緫
                     const tp = getTrickplayInfo(info);
                     const targetId = tp.id || itemId;
                     const tpInterval = tp.interval || 10;
                     
                     // 浣跨敤鏃堕棿宸绠楁杩涜繘搴?
                     let moveAmount = (dt / 1000) * globalPlaySpeed;
                     curTime = (curTime + moveAmount) % durationSec; 
                     autoplayStates.set(itemId, curTime);
     
                     // 鏇存柊杩涘害鏉?
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

    // --- 甯冨眬妫€娴嬶細缂╃暐鍥炬ā寮忚嚜鍔ㄦ斁澶?---
    function checkLayoutMode() {
        // 閬嶅巻鎵€鏈夊彲鑳界殑缃戞牸瀹瑰櫒
        const containers = document.querySelectorAll('.itemsContainer');
        
        containers.forEach(container => {
            // 杩囨护锛氭帓闄ゆí鍚戞粴鍔ㄥ鍣紙棣栭〉銆佽鎯呴〉鎺ㄨ崘绛夛級锛屽彧澶勭悊涓诲獟浣撳簱缃戞牸
            if (container.closest('.emby-scroller') || container.classList.contains('scrollSlider')) return;

            const card = container.querySelector('.card');
            if (!card) return;
            
            // 浣跨敤 cardPadder (鍥剧墖鍗犱綅瀹瑰櫒) 鏉ユ娴嬪楂樻瘮锛屾帓闄ゆ枃瀛楅珮搴﹀共鎵帮紝纭繚娴锋姤/缂╃暐鍥惧垽鏂噯纭?
            const measureEl = card.querySelector('.cardPadder') || card.querySelector('.cardImageContainer') || card;
            const rect = measureEl.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) return;

            // 16:9 = 1.77, 2:3 = 0.66, 3:4 = 0.75
            // 璁惧畾 1.3 涓洪槇鍊硷紝涓ユ牸鍖哄垎妯浘鍜岀珫鍥?
            const isLandscape = rect.width / rect.height > 1.3;
            
            if (isLandscape) {
                container.classList.add('jf-large-thumbnail');
            } else {
                container.classList.remove('jf-large-thumbnail');
            }
        });
    }

    // 鍚姩寰幆妫€娴?
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