(function() {
    'use strict';

    if (window.jfAutoplayPreviewActive) return;
    window.jfAutoplayPreviewActive = true;

    const STYLES = `
        .jf-hover-preview-container {
            position: fixed;
            z-index: 2000000;
            background: rgba(20, 20, 20, 0.9);
            border-radius: 8px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.8);
            border: 1px solid rgba(255,255,255,0.15);
            backdrop-filter: blur(10px);
            width: 320px;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            pointer-events: auto;
            opacity: 0;
            transform: scale(0.95);
            transition: opacity 0.2s ease, transform 0.2s ease;
        }
        
        .jf-hover-preview-container.visible {
            opacity: 1;
            transform: scale(1);
        }

        .jf-hover-preview-header {
            padding: 8px 12px;
            background: rgba(30, 30, 30, 0.9);
            color: #fff;
            font-size: 13px;
            font-weight: 500;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            border-bottom: 1px solid rgba(255,255,255,0.1);
        }

        .jf-hover-preview-media {
            width: 320px;
            height: 180px;
            position: relative;
            background: #000;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .jf-hover-preview-sprite {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-color: #000;
            background-repeat: no-repeat;
            background-position: center;
            background-size: contain;
            z-index: 10;
        }

        .jf-hover-preview-video {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            object-fit: contain;
            z-index: 15;
            background: #000;
        }

        .jf-hover-preview-slider-container {
            position: absolute;
            bottom: 0;
            left: 0;
            width: 100%;
            height: 6px;
            background: rgba(255, 255, 255, 0.2);
            z-index: 25;
            cursor: pointer;
        }

        .jf-hover-preview-slider-bar {
            height: 100%;
            width: 0;
            background: #00a4dc;
            position: relative;
            transition: width 0.1s ease;
        }

        .jf-hover-preview-time-display {
            position: absolute;
            bottom: 10px;
            right: 10px;
            padding: 2px 6px;
            background: rgba(0, 0, 0, 0.8);
            border-radius: 4px;
            color: #fff;
            font-size: 11px;
            font-family: monospace;
            z-index: 20;
            pointer-events: none;
            border: 1px solid rgba(255, 255, 255, 0.1);
        }
    `;

    const styleElement = document.createElement('style');
    styleElement.textContent = STYLES;
    document.head.append(styleElement);

    function getAuthInfo() {
        try {
            const credentials = JSON.parse(localStorage.getItem('jellyfin_credentials'));
            if (!credentials || !credentials.Servers || !credentials.Servers.length) return null;
            return { serverUrl: window.location.origin, userId: credentials.Servers[0].UserId, accessToken: credentials.Servers[0].AccessToken };
        } catch (e) { return null; }
    }

    let hoverTimer = null;
    let videoTimer = null;
    let previewEl = null;
    let currentItemId = null;
    let currentItemData = null;

    function getTrickplayInfo(info) {
        const defaultRet = { width: 320, interval: 10, id: null, cols: 10, rows: 10 };
        if (!info) return defaultRet;
        
        const mediaSource = info.MediaSources?.[0];
        const manifests = mediaSource?.Trickplay || mediaSource?.TrickPlay || mediaSource?.trickplay || info.Trickplay || info.TrickPlay;
        const id = mediaSource?.Id || info.Id || null;
        
        let width = 320;
        let interval = 10;
        let cols = 10; 
        let rows = 10;

        if (manifests && typeof manifests === 'object') {
            let config = manifests;
            const keys = Object.keys(manifests);
            if (keys.length === 1 && manifests[keys[0]] && typeof manifests[keys[0]] === 'object' && !manifests.Width && !manifests[320] && !manifests[640]) {
                 config = manifests[keys[0]];
            }

            if (config.Width && !config[config.Width]) {
                 const m = config;
                 width = m.Width;
                 let rawInterval = m.Interval || 10000;
                 if (rawInterval > 1000000) interval = rawInterval / 10000000;
                 else if (rawInterval > 100) interval = rawInterval / 1000;
                 else interval = rawInterval;

                 if (m.TileWidth && m.TileWidth <= 20) {
                      cols = m.TileWidth;
                      rows = m.TileHeight || m.TileWidth;
                 } else if (m.ThumbnailWidth && m.Width > m.ThumbnailWidth) {
                      cols = Math.round(m.Width / m.ThumbnailWidth);
                      rows = Math.round(m.Height / m.ThumbnailHeight);
                 }
            } else {
                const widths = Object.keys(config).map(Number).filter(n => !isNaN(n));
                if (widths.length > 0) {
                    width = widths.includes(640) ? 640 : (widths.includes(320) ? 320 : Math.max(...widths));
                    const m = config[width.toString()] || config[width];
                    if (m) {
                        let rawInterval = m.Interval || 10000;
                        if (rawInterval > 1000000) interval = rawInterval / 10000000;
                        else if (rawInterval > 100) interval = rawInterval / 1000;
                        else interval = rawInterval;
                        
                        if (m.TileWidth && m.TileWidth <= 20) {
                             cols = m.TileWidth;
                             rows = m.TileHeight || m.TileWidth;
                        } else if (m.ThumbnailWidth && m.Width > m.ThumbnailWidth) {
                            cols = Math.round(m.Width / m.ThumbnailWidth);
                            rows = Math.round(m.Height / m.ThumbnailHeight);
                        }
                    }
                }
            }
        }
        
        return { width, interval, id, cols, rows };
    }

    function formatTime(seconds) {
        if (isNaN(seconds) || seconds < 0) return '00:00';
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        
        const mStr = m.toString().padStart(2, '0');
        const sStr = s.toString().padStart(2, '0');
        
        if (h > 0) {
            return `${h}:${mStr}:${sStr}`;
        }
        return `${mStr}:${sStr}`;
    }

    function removePreview() {
        if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
        if (videoTimer) { clearTimeout(videoTimer); videoTimer = null; }
        if (previewEl) {
            previewEl.classList.remove('visible');
            const el = previewEl;
            setTimeout(() => el.remove(), 200);
            previewEl = null;
        }
        currentItemId = null;
        currentItemData = null;
    }

    async function showPreview(card, itemId) {
        const auth = getAuthInfo();
        if (!auth) return;

        currentItemId = itemId;

        try {
            const apiUrl = `${auth.serverUrl}/Users/${auth.userId}/Items/${itemId}`;
            const response = await fetch(apiUrl, {
                headers: { 'Authorization': `MediaBrowser Client="JelliumDesktop", Device="Web", DeviceId="JelliumScript", Version="1.0.0", Token="${auth.accessToken}"`, 'Accept': 'application/json' }
            });
            if (!response.ok) return;
            const data = await response.json();
            if (currentItemId !== itemId) return; // Stale request
            currentItemData = data;

            // Generate layout structure
            const title = data.Name || '未知视频';
            const durationSecs = data.RunTimeTicks ? (data.RunTimeTicks / 10000000) : 0;

            const container = document.createElement('div');
            container.className = 'jf-hover-preview-container';
            container.innerHTML = `
                <div class="jf-hover-preview-header">${title}</div>
                <div class="jf-hover-preview-media">
                    <div class="jf-hover-preview-sprite"></div>
                    <div class="jf-hover-preview-time-display">00:00</div>
                    <div class="jf-hover-preview-slider-container">
                        <div class="jf-hover-preview-slider-bar"></div>
                    </div>
                </div>
            `;

            // Position calculation
            const rect = card.getBoundingClientRect();
            const spaceRight = window.innerWidth - rect.right;
            const spaceLeft = rect.left;
            let targetLeft = rect.right + 12;
            
            // Adjust horizontally if space is tight
            if (spaceRight < 340 && spaceLeft > 340) {
                targetLeft = rect.left - 332;
            } else if (spaceRight < 340 && spaceLeft < 340) {
                targetLeft = Math.max(10, window.innerWidth - 330);
            }

            let targetTop = rect.top + (rect.height / 2) - 110;
            targetTop = Math.max(10, Math.min(window.innerHeight - 240, targetTop));

            container.style.left = `${targetLeft}px`;
            container.style.top = `${targetTop}px`;

            document.body.appendChild(container);
            previewEl = container;

            // Trigger animation
            requestAnimationFrame(() => {
                container.classList.add('visible');
            });

            // Set up Trickplay logic
            const sprite = container.querySelector('.jf-hover-preview-sprite');
            const sliderBar = container.querySelector('.jf-hover-preview-slider-bar');
            const timeDisplay = container.querySelector('.jf-hover-preview-time-display');
            const mediaArea = container.querySelector('.jf-hover-preview-media');

            const tp = getTrickplayInfo(data);
            const targetId = tp.id || itemId;
            
            // Render initial image (poster or cover or first tile)
            if (data.ImageTags && data.ImageTags.Primary) {
                sprite.style.backgroundImage = `url('${auth.serverUrl}/Items/${itemId}/Images/Primary?maxHeight=180&maxWidth=320')`;
                sprite.style.backgroundSize = 'contain';
            }

            const updatePreview = (time, xPercent) => {
                const totalTiles = Math.floor(time / tp.interval);
                const isSprite = tp.cols > 1;
                const spriteIdx = isSprite ? Math.floor(totalTiles / (tp.cols * tp.rows)) : totalTiles;
                
                sprite.style.backgroundImage = `url('${auth.serverUrl}/Videos/${targetId}/Trickplay/${tp.width}/${spriteIdx}.jpg?ApiKey=${auth.accessToken}&MediaSourceId=${targetId}')`;
                
                if (isSprite) {
                    const tileIdx = totalTiles % (tp.cols * tp.rows);
                    const posX = (tileIdx % tp.cols / (tp.cols - 1)) * 100;
                    const posY = (Math.floor(tileIdx / tp.cols) / (tp.rows - 1)) * 100;
                    sprite.style.backgroundSize = `${tp.cols * 100}% ${tp.rows * 100}%`;
                    sprite.style.backgroundPosition = `${posX}% ${posY}%`;
                } else {
                    sprite.style.backgroundSize = 'contain';
                    sprite.style.backgroundPosition = 'center';
                }

                sliderBar.style.width = `${xPercent * 100}%`;
                timeDisplay.textContent = formatTime(time);
            };

            mediaArea.addEventListener('mousemove', (e) => {
                if (videoTimer) { clearTimeout(videoTimer); videoTimer = null; } // Pause video trigger on active sliding
                const mRect = mediaArea.getBoundingClientRect();
                const xPercent = Math.max(0, Math.min(1, (e.clientX - mRect.left) / mRect.width));
                
                if (durationSecs > 0) {
                    const targetTime = durationSecs * xPercent;
                    updatePreview(targetTime, xPercent);
                }
            });

            // Set up video autoplay preview timer (1.5s delay of hover)
            videoTimer = setTimeout(() => {
                if (currentItemId !== itemId || !previewEl) return;
                
                const video = document.createElement('video');
                video.className = 'jf-hover-preview-video';
                video.muted = true;
                video.autoplay = true;
                video.loop = true;
                
                // Mute and request WebM transcoded stream
                video.src = `${auth.serverUrl}/Videos/${itemId}/stream?VideoCodec=vp9,vp8&AudioCodec=opus&PlaySessionId=preview_${itemId}&api_key=${auth.accessToken}`;
                
                video.onplaying = () => {
                    // Hide the static sprite layer once video plays
                    sprite.style.display = 'none';
                };

                video.onerror = () => {
                    console.warn('[Jellium Preview] WebM video preview failed. Keeping sprite preview.');
                    video.remove();
                };

                mediaArea.appendChild(video);
            }, 1500);

        } catch (e) {
            console.error('[Jellium Preview] Error fetching item info:', e);
        }
    }

    document.addEventListener('mouseover', (e) => {
        const card = e.target.closest('.card') || e.target.closest('.listItem');
        if (!card) return;
        const itemId = card.getAttribute('data-id');
        if (!itemId) return;

        if (currentItemId === itemId) return; // Already loading/showing this one
        
        removePreview();

        hoverTimer = setTimeout(() => {
            showPreview(card, itemId);
        }, 500); // 500ms hover delay to prevent trigger on swipe-throughs
    });

    document.addEventListener('mouseout', (e) => {
        const card = e.target.closest('.card') || e.target.closest('.listItem');
        if (!card) return;
        
        // Check if mouse moved into another card or the preview box itself
        const toElement = e.relatedTarget;
        if (toElement && (toElement.closest('.jf-hover-preview-container') || toElement.closest('.card') || toElement.closest('.listItem'))) {
            return;
        }
        
        removePreview();
    });

    // Close preview if mouse enters and leaves the preview container
    document.addEventListener('mouseleave', (e) => {
        if (e.target && e.target.classList && e.target.classList.contains('jf-hover-preview-container')) {
            removePreview();
        }
    }, true);

})();
