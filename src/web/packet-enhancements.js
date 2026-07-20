(function() {
    'use strict';

    if (window.jfPacketEnhancementsActive) return;
    window.jfPacketEnhancementsActive = true;

    const TARGET_ITEM_TYPES = 'Movie,Series'; 

    const STYLES = `
        /* --- 播放次数角标 --- */
        .play-count-badge {
            position: absolute; top: 6px; left: 6px;
            background-color: rgba(0, 0, 0, 0.75); color: #eee;
            font-size: 0.75rem; font-weight: 500;
            padding: 2px 6px; border-radius: 4px;
            z-index: 9; pointer-events: none;
            backdrop-filter: blur(2px);
            display: flex; align-items: center; gap: 3px;
            box-shadow: 0 1px 2px rgba(0,0,0,0.5);
            border: 1px solid rgba(255,255,255,0.1);
        }

        /* --- 重复项高亮 --- */
        .duplicate-highlight .cardBox, 
        .duplicate-highlight .cardScalable,
        .duplicate-highlight.listItem { 
            box-shadow: inset 0 0 0 4px #ff4d4d !important;
            border-radius: 4px;
        }

        /* --- 筛选模式 --- */
        body.only-show-duplicates .itemsContainer .card:not(.duplicate-highlight),
        body.only-show-duplicates .itemsContainer .listItem:not(.duplicate-highlight),
        body.only-show-duplicates .vertical-wrap .card:not(.duplicate-highlight) {
            display: none !important;
        }

        /* --- 筛选按钮 --- */
        #duplicate-filter-btn {
            background: transparent; color: inherit;
            border: 1px solid transparent; padding: 0 10px;
            border-radius: 4px; cursor: pointer; margin-left: 8px;
            font-size: 0.9rem; display: inline-flex; align-items: center;
            height: 40px; vertical-align: middle; white-space: nowrap;
            font-weight: 500;
            transition: all 0.2s ease;
        }
        #duplicate-filter-btn:hover { background: rgba(255, 255, 255, 0.1); }
        #duplicate-filter-btn.active {
            background: #ff4d4d; color: white;
            box-shadow: 0 0 8px rgba(255, 77, 77, 0.5);
            transform: scale(1.05);
        }
        #duplicate-filter-btn.loading { 
            opacity: 0.7; 
            cursor: wait; 
            position: relative;
            overflow: hidden;
        }
        
        #duplicate-filter-btn.loading::after {
            content: '';
            position: absolute;
            top: 0;
            left: -100%;
            width: 100%;
            height: 100%;
            background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.2), transparent);
            animation: loading-shimmer 1.5s infinite;
        }
        
        @keyframes loading-shimmer {
            0% { left: -100%; }
            100% { left: 100%; }
        }
        
        .error-notification {
            position: fixed;
            top: 20px;
            right: 20px;
            background: #ff4d4d;
            color: white;
            padding: 10px 15px;
            border-radius: 4px;
            z-index: 9999;
            box-shadow: 0 2px 10px rgba(0,0,0,0.2);
            animation: jfSlideIn 0.3s ease-out;
        }
        
        @keyframes jfSlideIn {
            from {
                transform: translateX(100%);
                opacity: 0;
            }
            to {
                transform: translateX(0);
                opacity: 1;
            }
        }
    `;

    const styleElement = document.createElement('style');
    styleElement.textContent = STYLES;

    function getAuthInfo() {
        try {
            const credentials = JSON.parse(localStorage.getItem('jellyfin_credentials'));
            if (!credentials || !credentials.Servers || !credentials.Servers.length) return null;
            return { serverUrl: window.location.origin, userId: credentials.Servers[0].UserId, accessToken: credentials.Servers[0].AccessToken };
        } catch (e) { return null; }
    }

    const processedIds = new Set();
    const observedElements = new WeakSet();
    let globalDuplicateIds = new Set();
    let isDbLoaded = false;
    
    const DOMCache = {
        filterWrapper: null,
        getFilterWrapper() {
            if (!this.filterWrapper) {
                this.filterWrapper = document.querySelector('.btnFilter-wrapper') || document.querySelector('.btnFilter');
            }
            return this.filterWrapper;
        },
        invalidate() {
            this.filterWrapper = null;
        }
    };
    
    const DOMBatch = {
        pending: false,
        operations: [],
        add(operation) {
            this.operations.push(operation);
            if (!this.pending) {
                this.pending = true;
                requestAnimationFrame(() => this.flush());
            }
        },
        flush() {
            this.operations.forEach(op => op());
            this.operations = [];
            this.pending = false;
        }
    };
    
    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }
    
    function showErrorNotification(message) {
        const notification = document.createElement('div');
        notification.className = 'error-notification';
        notification.textContent = message;
        document.body.appendChild(notification);
        setTimeout(() => {
            notification.style.transition = 'opacity 0.5s';
            notification.style.opacity = '0';
            setTimeout(() => notification.remove(), 500);
        }, 3000);
    }

    async function batchFetchPlayCounts(itemIds) {
        const auth = getAuthInfo();
        if (!auth) return;

        const chunkSize = 30;
        for (let i = 0; i < itemIds.length; i += chunkSize) {
            const chunk = itemIds.slice(i, i + chunkSize);
            const idsString = chunk.join(',');
            const apiUrl = `${auth.serverUrl}/Users/${auth.userId}/Items?Ids=${idsString}&Fields=UserData`;
            
            try {
                console.log(`[Jellium Debug] Querying playcounts for ${chunk.length} items`);
                const response = await fetch(apiUrl, {
                    headers: { 
                        'Authorization': `MediaBrowser Client="JelliumDesktop", Device="Web", DeviceId="JelliumScript", Version="1.0.0", Token="${auth.accessToken}"`, 
                        'Accept': 'application/json' 
                    }
                });
                if (!response.ok) {
                    console.log(`[Jellium Debug] Response failed: ${response.status}`);
                    continue;
                }
                const data = await response.json();
                console.log(`[Jellium Debug] API returned ${data.Items ? data.Items.length : 0} items`);
                if (data && data.Items) {
                    DOMBatch.add(() => {
                        data.Items.forEach(item => {
                            const hasPlayCount = item.UserData && typeof item.UserData.PlayCount === 'number';
                            console.log(`[Jellium Debug] Item: "${item.Name}" (${item.Type}), PlayCount: ${hasPlayCount ? item.UserData.PlayCount : 'undefined/none'}`);
                            if (item.UserData && item.UserData.PlayCount > 0) {
                                const cards = document.querySelectorAll(`.card[data-id="${item.Id}"], .listItem[data-id="${item.Id}"]`);
                                console.log(`[Jellium Debug]   Found ${cards.length} matching cards in DOM for ID ${item.Id}`);
                                cards.forEach(card => {
                                    addBadgeToCard(card, item.UserData.PlayCount);
                                });
                            }
                        });
                    });
                }
            } catch (error) {
                console.error('[Jellium Debug] Batch playcount fetch failed:', error);
            }
        }
    }

    function addBadgeToCard(card, count) {
        if (card.querySelector('.play-count-badge')) return;
        const container = card.querySelector('.cardScalable') || card.querySelector('.cardBox') || card;
        console.log(`[Jellium Debug] Container found: ${!!container} for card. Selector checks: .cardScalable=${!!card.querySelector('.cardScalable')}, .cardBox=${!!card.querySelector('.cardBox')}`);
        if (!container) return;
        const badge = document.createElement('div');
        badge.className = 'play-count-badge';
        badge.innerHTML = `<svg style="width:10px;height:10px;fill:currentColor;" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg><span>${count}</span>`;
        if (window.getComputedStyle(container).position === 'static') container.style.position = 'relative';
        container.appendChild(badge);
        console.log(`[Jellium Debug]   Appended badge (${count}) to container successfully`);
    }

    async function buildDuplicateDatabase() {
        const auth = getAuthInfo();
        if (!auth) return;
        const btn = document.getElementById('duplicate-filter-btn');
        if (btn) { btn.innerText = '分析中...'; btn.classList.add('loading'); }

        try {
            const fields = "Name,Id"; 
            const batchSize = 2000;
            let startIndex = 0;
            let totalItems = 0;
            let processedItems = 0;
            
            const prefixMap = new Map();
            const duplicates = new Set();
            
            const countUrl = `${auth.serverUrl}/Users/${auth.userId}/Items?Recursive=true&IncludeItemTypes=${TARGET_ITEM_TYPES}&Limit=1`;
            const countResponse = await fetch(countUrl, {
                headers: { 'Authorization': `MediaBrowser Client="JelliumDesktop", Device="Web", DeviceId="JelliumScript", Version="1.0.0", Token="${auth.accessToken}"`, 'Accept': 'application/json' }
            });
            
            if (countResponse.ok) {
                const countData = await countResponse.json();
                totalItems = countData.TotalRecordCount || 0;
            }
            
            while (startIndex < totalItems || totalItems === 0) {
                const apiUrl = `${auth.serverUrl}/Users/${auth.userId}/Items?Recursive=true&IncludeItemTypes=${TARGET_ITEM_TYPES}&Fields=${fields}&StartIndex=${startIndex}&Limit=${batchSize}`;
                
                const response = await fetch(apiUrl, {
                    headers: { 'Authorization': `MediaBrowser Client="JelliumDesktop", Device="Web", DeviceId="JelliumScript", Version="1.0.0", Token="${auth.accessToken}"`, 'Accept': 'application/json' }
                });

                if (!response.ok) throw new Error("API Request Failed");
                
                const data = await response.json();
                const items = data.Items || [];
                
                if (items.length === 0) break;
                
                items.forEach(item => {
                    const name = item.Name.trim();
                    if (!name) return;
                    const firstSpaceIndex = name.indexOf(' ');
                    const prefix = (firstSpaceIndex !== -1 ? name.substring(0, firstSpaceIndex) : name).toLowerCase();
                    if (!prefixMap.has(prefix)) prefixMap.set(prefix, []);
                    prefixMap.get(prefix).push(item.Id);
                });
                
                processedItems += items.length;
                startIndex += batchSize;
                
                if (totalItems > 0) {
                    const progress = Math.round((processedItems / totalItems) * 100);
                    DOMBatch.add(() => {
                        if (btn) btn.innerText = `分析中... ${progress}%`;
                    });
                }
                
                await new Promise(resolve => setTimeout(resolve, 10));
            }

            prefixMap.forEach((ids) => {
                if (ids.length > 1) ids.forEach(id => duplicates.add(id));
            });

            globalDuplicateIds = duplicates;
            isDbLoaded = true;
            
            DOMBatch.add(() => {
                refreshAllHighlights();
            });

        } catch (e) {
            console.error(e);
            showErrorNotification("分析重复内容时出错，请重试");
            if (btn) btn.innerText = "Error";
        }
    }

    function applyHighlightToCard(card, id) {
        if (!isDbLoaded) return;
        const isDuplicate = globalDuplicateIds.has(id);
        const hasClass = card.classList.contains('duplicate-highlight');
        if (isDuplicate && !hasClass) card.classList.add('duplicate-highlight');
        else if (!isDuplicate && hasClass) card.classList.remove('duplicate-highlight');
    }

    function refreshAllHighlights() {
        const cards = document.querySelectorAll('.card[data-id], .listItem[data-id]');
        cards.forEach(card => {
            const id = card.getAttribute('data-id');
            if (id) applyHighlightToCard(card, id);
        });
        updateFilterButtonText();
        const btn = document.getElementById('duplicate-filter-btn');
        if(btn) btn.classList.remove('loading');
    }

    function updateFilterButtonText() {
        const btn = document.getElementById('duplicate-filter-btn');
        if (!btn) return;
        const count = globalDuplicateIds.size;
        const isFilterActive = document.body.classList.contains('only-show-duplicates');
        if (isFilterActive) {
            btn.innerText = `显示全部`;
        } else {
            btn.innerText = isDbLoaded ? (count > 0 ? `重复项 (${count})` : `无重复`) : `加载数据...`;
        }
    }

    function exitFilterMode() {
        if (document.body.classList.contains('only-show-duplicates')) {
            document.body.classList.remove('only-show-duplicates');
            const btn = document.getElementById('duplicate-filter-btn');
            if (btn) btn.classList.remove('active');
            updateFilterButtonText();
        }
    }

    function injectFilterButton() {
        const btn = document.getElementById('duplicate-filter-btn');
        const filterWrapper = DOMCache.getFilterWrapper();

        if (!filterWrapper) {
            exitFilterMode(); 
            if (btn) btn.style.display = 'none';
            DOMCache.invalidate();
            return;
        }

        if (btn && btn.style.display === 'none') {
            DOMBatch.add(() => {
                btn.style.display = 'inline-flex';
                if (filterWrapper.parentNode && filterWrapper.nextSibling !== btn) {
                    filterWrapper.parentNode.insertBefore(btn, filterWrapper.nextSibling);
                }
            });
            return;
        }

        if (btn) return;

        const newBtn = document.createElement('button');
        newBtn.id = 'duplicate-filter-btn';
        newBtn.innerText = '查重';
        newBtn.type = "button";
        newBtn.className = "paper-icon-button-light"; 
        
        newBtn.addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation();
            if (!isDbLoaded) { 
                buildDuplicateDatabase(); 
                return; 
            }
            
            const body = document.body;
            if (body.classList.contains('only-show-duplicates')) {
                exitFilterMode();
            } else {
                body.classList.add('only-show-duplicates');
                newBtn.classList.add('active');
                updateFilterButtonText();
            }
        });

        DOMBatch.add(() => {
            if (filterWrapper.parentNode) {
                filterWrapper.parentNode.insertBefore(newBtn, filterWrapper.nextSibling);
            }
        });
    }

    document.addEventListener('click', (e) => {
        const clickedCard = e.target.closest('.card') || e.target.closest('.listItem');
        if (clickedCard && !e.target.closest('.play-count-badge')) {
            const filterWrapper = DOMCache.getFilterWrapper();
            if (!filterWrapper) {
                exitFilterMode();
            }
        }
    }, true);

    const debouncedScheduleProcessing = debounce(() => {
        const cards = document.querySelectorAll('.card[data-id], .listItem[data-id]');
        const idsToFetch = [];
        cards.forEach(card => {
            const id = card.getAttribute('data-id');
            if (id) {
                if (!processedIds.has(id)) {
                    idsToFetch.push(id);
                    processedIds.add(id);
                }
                if (isDbLoaded) {
                    applyHighlightToCard(card, id);
                }
            }
        });

        if (idsToFetch.length > 0) {
            batchFetchPlayCounts(idsToFetch);
        }
        injectFilterButton();
    }, 200);
    
    function scheduleProcessing() {
        debouncedScheduleProcessing();
    }

    const throttledMutationHandler = (() => {
        let pending = false;
        return () => {
            if (pending) return;
            pending = true;
            requestAnimationFrame(() => {
                scheduleProcessing();
                pending = false;
            });
        };
    })();

    const observer = new MutationObserver((mutations) => {
        let hasRelevantChanges = false;
        for (const mutation of mutations) {
            if (mutation.type === 'childList' && 
                (mutation.addedNodes.length > 0 || mutation.removedNodes.length > 0)) {
                hasRelevantChanges = true;
                break;
            }
        }
        if (hasRelevantChanges) {
            throttledMutationHandler();
        }
    });

    const initWhenIdle = () => {
        if (window.jfPacketEnhancementsInitialized) return;
        window.jfPacketEnhancementsInitialized = true;

        // Safely append style
        (document.head || document.documentElement).append(styleElement);

        // Safely start observer on body or documentElement
        const targetNode = document.body || document.documentElement;
        observer.observe(targetNode, { childList: true, subtree: true });

        scheduleProcessing();
        if ('requestIdleCallback' in window) {
            window.requestIdleCallback(() => {
                setTimeout(buildDuplicateDatabase, 1000);
            }, { timeout: 5000 });
        } else {
            setTimeout(buildDuplicateDatabase, 3000);
        }
    };
    
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initWhenIdle);
    } else {
        setTimeout(initWhenIdle, 500);
    }
})();
