// Content script to handle UI and data from interceptor
(function() {
    'use strict';
    console.log('LinkedIn Job Stats content script loaded');
    
    let currentJobId = null;
    let lastStats = null;
    let debounceTimer = null;
    
    // Cache system for job stats
    const CACHE_TTL = 5 * 60 * 1000; // 5 minutes TTL
    const DEBOUNCE_DELAY = 300; // 300ms debounce
    
    // Simple in-memory cache
    const jobCache = new Map();
    
    // Shared global object for communication
    if (!window.linkedInJobStatsManager) {
        console.log('🔧 Content script: Creating shared manager...');
        window.linkedInJobStatsManager = {
            stats: [],
            listeners: [],
            addStats: function(stats) {
                console.log('📊 Content script: Adding stats to shared manager:', stats.jobId);
                this.stats.push(stats);
                // Keep only last 50 entries
                if (this.stats.length > 50) {
                    this.stats = this.stats.slice(-50);
                }
                // Notify listeners
                this.listeners.forEach(callback => callback(stats));
                console.log('📊 Content script: Shared manager now has', this.stats.length, 'stats');
            },
            addListener: function(callback) {
                console.log('👂 Content script: Adding listener to shared manager');
                this.listeners.push(callback);
            },
            getStatsForJob: function(jobId) {
                const stats = this.stats.filter(s => s.jobId === jobId).pop();
                console.log('🔍 Content script: Looking for job', jobId, 'in shared manager:', stats ? 'found' : 'not found');
                return stats;
            },
            getLatestStats: function() {
                return this.stats[this.stats.length - 1];
            }
        };
    } else {
        console.log('🔧 Content script: Shared manager already exists');
    }
    
    // Always add our listener to the shared manager
    console.log('👂 Content script: Adding listener to shared manager');
    window.linkedInJobStatsManager.addListener(function(stats) {
        console.log('📡 Received stats via shared manager:', stats);
        handleJobStats(stats);
    });
    
    // Simple fallback check every 5 seconds (much less aggressive)
    setInterval(() => {
        if (currentJobId && !lastStats) {
            console.log('🔍 Fallback: Checking for stats for current job:', currentJobId);
            const currentJobStats = window.linkedInJobStatsManager.getStatsForJob(currentJobId);
            if (currentJobStats) {
                console.log('🔄 Fallback: Found stats for current job:', currentJobId);
                handleJobStats(currentJobStats);
            }
        }
    }, 5000); // Check every 5 seconds only if we don't have stats
    
    function handleJobStats(statsData) {
        console.log('📥 Handling job stats for job:', statsData.jobId);
        
        // Cache the stats
        jobCache.set(statsData.jobId, {
            stats: statsData,
            timestamp: Date.now()
        });
        
        lastStats = statsData;
        updateUI(statsData);
        
        console.log('💾 Cached job stats. Cache size:', jobCache.size);
        
        // Try to store in Chrome storage for popup access (optional)
        try {
            chrome.runtime.sendMessage({
                type: 'STORE_JOB_STATS',
                data: statsData
            }).catch(error => {
                // Silently ignore background script errors
                console.debug('Background script not available:', error.message);
            });
        } catch (error) {
            // Silently ignore if chrome API is not available
            console.debug('Chrome API not available');
        }
    }
    
    // Extract current job ID from page
    function getCurrentJobId() {
        // Try multiple selectors for job ID
        const selectors = [
            '[data-job-id]',
            '[data-entity-urn*="jobPosting"]',
            '.job-details-jobs-unified-top-card',
            '.jobs-unified-top-card'
        ];
        
        for (const selector of selectors) {
            const element = document.querySelector(selector);
            if (element) {
                const jobId = element.getAttribute('data-job-id') || 
                              element.getAttribute('data-entity-urn')?.match(/(\d+)$/)?.[1];
                if (jobId) return jobId;
            }
        }
        
        // Try URL extraction
        const urlMatch = window.location.href.match(/\/view\/(\d+)\//);
        return urlMatch ? urlMatch[1] : null;
    }
    
    // UI Management
    const UI = {
        createPopup() {
            if (document.getElementById('linkedin-job-stats-popup')) return;
            
            const popup = document.createElement('div');
            popup.id = 'linkedin-job-stats-popup';
            popup.innerHTML = `
                <div class="stats-header">
                    <span>LinkedIn Job Stats</span>
                    <button class="close-btn" id="job-stats-close-btn" aria-label="Close">&times;</button>
                </div>
                <div class="stats-content">
                    <div>Select a job to see stats.</div>
                </div>
                <div class="footer">&copy; Made by evin</div>
            `;
            
            popup.style.cssText = `
                position: fixed;
                top: 80px;
                right: 20px;
                width: 240px;
                min-height: 140px;
                border-radius: 20px;
                cursor: grab;
                isolation: isolate;
                touch-action: none;
                box-shadow: 0px 6px 24px rgba(0, 0, 0, 0.2);
                z-index: 10000;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", "Helvetica Neue", sans-serif;
                font-size: 13px;
                transition: opacity 0.3s ease, transform 0.3s ease;
                opacity: 0;
                transform: translateX(20px) scale(1.25);
                display: flex;
                flex-direction: column;
            `;
            
            document.body.appendChild(popup);
            this.injectStyles();
            
            // Add close button event listener
            const closeBtn = popup.querySelector("#job-stats-close-btn");
            closeBtn.addEventListener("click", () => UI.remove());
            
            // --- Draggable anywhere on the popup (except the close button) ---
            let isDragging = false, offsetX = 0, offsetY = 0;

            popup.addEventListener('mousedown', (e) => {
                if (e.target === closeBtn) return;
                isDragging = true;
                popup.style.transition = "none";
                offsetX = e.clientX - popup.getBoundingClientRect().left;
                offsetY = e.clientY - popup.getBoundingClientRect().top;
                popup.style.cursor = 'grabbing';
                document.body.style.userSelect = 'none';
                e.preventDefault();
            });

            window.addEventListener('mouseup', () => {
                if (isDragging) {
                    isDragging = false;
                    popup.style.transition = "";
                    popup.style.cursor = 'grab';
                    document.body.style.userSelect = '';
                }
            });

            window.addEventListener('mousemove', e => {
                if (!isDragging) return;
                let newX = e.clientX - offsetX;
                let newY = e.clientY - offsetY;
                // Clamp to viewport
                newX = Math.max(0, Math.min(window.innerWidth - popup.offsetWidth, newX));
                newY = Math.max(0, Math.min(window.innerHeight - popup.offsetHeight, newY));
                popup.style.left = `${newX}px`;
                popup.style.top = `${newY}px`;
                popup.style.right = "auto";
                popup.style.bottom = "auto";
            });
            
            // Add glass effect
            setTimeout(() => { 
                popup.style.opacity = '1'; 
                popup.style.transform = 'translateX(0) scale(1)'; 
            }, 50);
        },
        
        updateContent(stats) {
            console.log('🎨 UI: Updating content with stats:', stats);
            const popup = document.getElementById('linkedin-job-stats-popup');
            if (!popup) {
                console.log('⚠️ UI: Popup not found');
                return;
            }
            
            const content = popup.querySelector('.stats-content');
            if (!content) {
                console.log('⚠️ UI: Content element not found');
                return;
            }
            
            const views = stats.views !== undefined ? stats.views.toLocaleString() : 'N/A';
            const applies = stats.applies !== undefined ? stats.applies.toLocaleString() : 'N/A';
            const jobId = stats.jobId || "N/A";
            
            console.log('🎨 UI: Setting content - Views:', views, 'Applies:', applies, 'Job ID:', jobId);
            
            content.innerHTML = `
                <div class="stat-item"><span>Views:</span><span>${views}</span></div>
                <div class="stat-item"><span>Applicants:</span><span>${applies}</span></div>
                <div class="job-info">Job ID: ${jobId}</div>
            `;
            
            console.log('✅ UI: Content updated successfully');
        },
        
        injectStyles() {
            if (document.getElementById('linkedin-stats-styles')) return;
            
            const style = document.createElement('style');
            style.id = 'linkedin-stats-styles';
            style.textContent = `
                #linkedin-job-stats-popup::before {
                    content: '';
                    position: absolute;
                    inset: 0;
                    z-index: 0;
                    border-radius: 20px;
                    box-shadow: inset 0 0 20px -5px rgba(255, 255, 255, 0.7);
                    background-color: rgba(255, 255, 255, 0.175);
                }
                
                #linkedin-job-stats-popup::after {
                    content: '';
                    position: absolute;
                    inset: 0;
                    z-index: -1;
                    border-radius: 20px;
                    backdrop-filter: blur(2px);
                    filter: url(#glass-distortion);
                    isolation: isolate;
                    -webkit-backdrop-filter: blur(2px);
                    -webkit-filter: url("#glass-distortion");
                }
                
                #linkedin-job-stats-popup .stats-header {
                    background: transparent;
                    color: #1d1d1f;
                    padding: 8px 12px 4px 14px;
                    border-radius: 20px 20px 0 0;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    border-bottom: 1px solid rgba(237, 237, 237, 0.3);
                    position: relative;
                    z-index: 1;
                    text-align: center;
                }
                
                #linkedin-job-stats-popup .stats-header span {
                    flex: 1;
                    text-align: center;
                    font-size: 16px;
                    font-weight: 700;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
                    letter-spacing: -0.2px;
                    color: #1c1c1e;
                }
                
                #linkedin-job-stats-popup .close-btn {
                    background: none;
                    border: none;
                    color: #808080;
                    font-size: 20px;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    padding: 0 0 0 6px;
                    margin: 0;
                    line-height: 1;
                    font-weight: 400;
                    transition: color 0.2s ease;
                }
                
                #linkedin-job-stats-popup .close-btn:hover {
                    color: #666;
                }
                
                #linkedin-job-stats-popup .stats-content {
                    flex: 1 1 auto;
                    padding: 10px 14px 0 14px;
                    font-size: 14px;
                    overflow-y: auto;
                    color: #2c2c2e;
                    position: relative;
                    z-index: 1;
                }
                
                #linkedin-job-stats-popup .stat-item {
                    display: flex;
                    justify-content: space-between;
                    margin: 6px 0;
                    font-weight: 600;
                    padding: 4px 0;
                }
                
                #linkedin-job-stats-popup .job-info {
                    font-size: 11px;
                    text-align: center;
                    color: #757575;
                    padding-top: 3px;
                }
                
                #linkedin-job-stats-popup .footer {
                    font-size: 10px;
                    text-align: center;
                    color: #8e8e93;
                    margin: 5px 0 6px 0;
                    flex-shrink: 0;
                    border-top: 1px solid rgba(237, 237, 237, 0.3);
                    padding: 3px 0 0 0;
                    background: transparent;
                    letter-spacing: 0.2px;
                    font-weight: 500;
                    user-select: none;
                    position: relative;
                    z-index: 1;
                }
                
                #linkedin-job-stats-popup .stat-loading {
                    text-align: center;
                    color: #757575;
                    font-style: italic;
                    padding: 1em;
                }
                
                #linkedin-job-stats-popup .stats-content > div:not(.stat-item):not(.job-info) {
                    text-align: center;
                    color: #757575;
                    font-style: italic;
                    padding: 1em;
                }
            `;
            
            document.head.appendChild(style);
            
            // Add SVG filter for glass distortion effect
            if (!document.getElementById('glass-distortion')) {
                const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
                svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
                svg.style.position = "absolute";
                svg.style.overflow = "hidden";
                svg.style.width = "0";
                svg.style.height = "0";
                
                svg.innerHTML = `
                    <defs>
                        <filter id="glass-distortion" x="0%" y="0%" width="100%" height="100%">
                            <feTurbulence type="fractalNoise" baseFrequency="0.008 0.008" numOctaves="1" seed="92" result="noise" />
                            <feGaussianBlur in="noise" stdDeviation="2" result="blurred" />
                            <feDisplacementMap in="SourceGraphic" in2="blurred" scale="77" xChannelSelector="R" yChannelSelector="G" />
                        </filter>
                    </defs>
                `;
                
                document.body.appendChild(svg);
            }
        },
        
        setWaiting() {
            const popup = document.getElementById('linkedin-job-stats-popup');
            if (!popup) return;
            const content = popup.querySelector('.stats-content');
            if (!content) return;
            content.innerHTML = `<div style="padding:1em; text-align:center; font-style:italic;">Select a job to see stats.</div>`;
        },
        
        remove() {
            const popup = document.getElementById('linkedin-job-stats-popup');
            if (popup) {
                popup.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
                popup.style.opacity = '0';
                popup.style.transform = 'translateX(100px) scale(0.8)';
                setTimeout(() => popup.remove(), 500);
            }
        }
    };
    
    function updateUI(stats) {
        console.log('🎨 Updating UI with stats:', stats);
        UI.createPopup();
        UI.updateContent(stats);
        console.log('✅ UI update completed');
    }
    
    // Debounce function to prevent rapid job changes
    function debounceJobChange(jobId, callback) {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => callback(jobId), DEBOUNCE_DELAY);
    }
    
    // Monitor page changes with direct data access
    function monitorJobChanges() {
        const observer = new MutationObserver(() => {
            const newJobId = getCurrentJobId();
            if (newJobId && newJobId !== currentJobId) {
                currentJobId = newJobId;
                console.log('🆔 New job detected:', currentJobId);
                
                // Check cache first
                const cachedEntry = jobCache.get(currentJobId);
                if (cachedEntry && (Date.now() - cachedEntry.timestamp < CACHE_TTL)) {
                    console.log('📋 Using cached stats for job:', currentJobId);
                    updateUI(cachedEntry.stats);
                    return;
                }
                
                // Check shared manager for recent stats
                const managerStats = window.linkedInJobStatsManager.getStatsForJob(currentJobId);
                if (managerStats) {
                    console.log('🔄 Found stats in shared manager for job:', currentJobId);
                    handleJobStats(managerStats);
                    return;
                }
                
                console.log('⏳ Waiting for job stats for job:', currentJobId);
                UI.setWaiting();
                
                // Debounce job changes to prevent rapid switching issues
                debounceJobChange(currentJobId, (debouncedJobId) => {
                    // Check cache again after debounce
                    const cachedEntry = jobCache.get(debouncedJobId);
                    if (cachedEntry && (Date.now() - cachedEntry.timestamp < CACHE_TTL)) {
                        console.log('📋 Using cached stats after debounce for job:', debouncedJobId);
                        updateUI(cachedEntry.stats);
                    } else {
                        console.log('⏳ Still waiting for job stats for job:', debouncedJobId);
                        UI.setWaiting();
                    }
                });
            }
        });
        
        observer.observe(document.body, {
            childList: true, 
            subtree: true
        });
    }
    
    // Initialize
    setTimeout(() => {
        UI.createPopup();
        monitorJobChanges();
        currentJobId = getCurrentJobId();
        
        // Check if we have cached stats for current job
        if (currentJobId) {
            const cachedEntry = jobCache.get(currentJobId);
            if (cachedEntry && (Date.now() - cachedEntry.timestamp < CACHE_TTL)) {
                console.log('📋 Using cached stats for initial job:', currentJobId);
                updateUI(cachedEntry.stats);
            } else {
                // Check shared manager
                const managerStats = window.linkedInJobStatsManager.getStatsForJob(currentJobId);
                if (managerStats) {
                    console.log('🔄 Found stats in shared manager for initial job:', currentJobId);
                    handleJobStats(managerStats);
                } else {
                    UI.setWaiting();
                }
            }
        }
        
        console.log('✅ LinkedIn Job Stats initialized with shared manager, current job:', currentJobId);
        
        // Add debug functions
        window.testLinkedInCache = function(jobId) {
            console.log('🧪 Testing cache for job:', jobId);
            const cached = jobCache.get(jobId);
            console.log('Cache has job:', cached);
            const managerStats = window.linkedInJobStatsManager.getStatsForJob(jobId);
            console.log('Manager has job:', managerStats);
        };
        
        window.checkSharedManager = function() {
            console.log('🔍 Checking shared manager...');
            console.log('Manager stats count:', window.linkedInJobStatsManager.stats.length);
            console.log('Recent stats:', window.linkedInJobStatsManager.stats.slice(-5));
        };
        
        // Test function to manually add stats to shared manager
        window.testAddStats = function(jobId, applies, views) {
            console.log('🧪 Manually adding test stats for job:', jobId);
            const testStats = {
                type: 'LINKEDIN_JOB_API_DATA',
                jobId: jobId,
                applies: applies,
                views: views,
                timestamp: Date.now()
            };
            window.linkedInJobStatsManager.addStats(testStats);
        };
        
        // Test function to check if listener is working
        window.testListener = function() {
            console.log('🧪 Testing listener...');
            console.log('Manager listeners count:', window.linkedInJobStatsManager.listeners.length);
            window.testAddStats('TEST123', 100, 500);
        };
        
        // Test function to force UI update
        window.testUI = function() {
            console.log('🧪 Testing UI update...');
            const testStats = {
                jobId: 'TEST456',
                views: 1000,
                applies: 250,
                timestamp: Date.now()
            };
            updateUI(testStats);
        };
        
        // Manual trigger to check current job stats
        window.checkCurrentJob = function() {
            console.log('🧪 Checking current job stats...');
            console.log('Current job ID:', currentJobId);
            console.log('Last stats:', lastStats);
            
            if (currentJobId) {
                const stats = window.linkedInJobStatsManager.getStatsForJob(currentJobId);
                console.log('Stats for current job:', stats);
                if (stats) {
                    console.log('🔄 Manually triggering UI update...');
                    handleJobStats(stats);
                }
            }
        };
    }, 1000);
    
    // Clean up timers and state on page unload
    window.addEventListener('beforeunload', () => {
        clearTimeout(debounceTimer);
        currentJobId = null;
        lastStats = null;
    });
})();
