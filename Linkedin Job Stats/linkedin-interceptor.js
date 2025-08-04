(function() {
    'use strict';
    
    console.log('🌐 LinkedIn Job Stats: Voyager API interceptor loaded (v2.0)');
    
    // Rate limiting and safety measures
    let lastRequestTime = 0;
    let requestCount = 0;
    const RATE_LIMIT_DELAY = 1000; // 1 second between requests (increased from 500ms)
    const MAX_REQUESTS_PER_MINUTE = 15; // Reduced from 30 to 15
    const requestTimestamps = [];
    
    // Initialize shared manager if it doesn't exist
    if (!window.linkedInJobStatsManager) {
        console.log('🔧 Creating shared manager...');
        window.linkedInJobStatsManager = {
            stats: [],
            listeners: [],
            addStats: function(stats) {
                console.log('📊 Adding stats to shared manager:', stats.jobId);
                this.stats.push(stats);
                // Keep only last 50 entries
                if (this.stats.length > 50) {
                    this.stats = this.stats.slice(-50);
                }
                // Notify listeners
                this.listeners.forEach(callback => callback(stats));
                console.log('📊 Shared manager now has', this.stats.length, 'stats');
            },
            addListener: function(callback) {
                console.log('👂 Adding listener to shared manager');
                this.listeners.push(callback);
            },
            getStatsForJob: function(jobId) {
                const stats = this.stats.filter(s => s.jobId === jobId).pop();
                console.log('🔍 Looking for job', jobId, 'in shared manager:', stats ? 'found' : 'not found');
                return stats;
            },
            getLatestStats: function() {
                return this.stats[this.stats.length - 1];
            }
        };
    } else {
        console.log('🔧 Using existing shared manager from content script');
    }
    
    // Function to check if URL is a job posting endpoint
    function isJobPostingEndpoint(url) {
        return url && url.includes('voyager/api/jobs/jobPostings/');
    }
    
    // Function to extract job ID from URL
    function extractJobId(url) {
        const match = url.match(/jobPostings\/(\d+)\?/);
        return match ? match[1] : null;
    }
    
    // Rate limiting function
    function shouldProcessRequest() {
        const now = Date.now();
        
        // Clean old timestamps (older than 1 minute)
        while (requestTimestamps.length > 0 && now - requestTimestamps[0] > 60000) {
            requestTimestamps.shift();
        }
        
        // Check if we're within rate limits
        if (requestTimestamps.length >= MAX_REQUESTS_PER_MINUTE) {
            console.log('⚠️ Rate limit reached, skipping request');
            return false;
        }
        
        // Check minimum delay between requests
        if (now - lastRequestTime < RATE_LIMIT_DELAY) {
            console.log('⚠️ Request too frequent, skipping');
            return false;
        }
        
        lastRequestTime = now;
        requestTimestamps.push(now);
        return true;
    }
    
    // Process API data with safety checks
    function processApiData(jobId, data) {
        if (!shouldProcessRequest()) {
            return;
        }
        
        if (data && data.data) {
            const { applies, views } = data.data;
            if (applies !== undefined || views !== undefined) {
                console.log(`📦 Found job stats - Job ID: ${jobId}, Applies: ${applies}, Views: ${views}`);
                
                const eventData = {
                    type: 'LINKEDIN_JOB_API_DATA',
                    jobId: jobId,
                    applies: applies,
                    views: views,
                    timestamp: Date.now()
                };
                
                // Add to shared manager
                window.linkedInJobStatsManager.addStats(eventData);
                
                // Also keep the old global array for backward compatibility
                window.linkedInJobStats = window.linkedInJobStats || [];
                window.linkedInJobStats.push(eventData);
                
                // Keep only last 20 entries to prevent memory issues
                if (window.linkedInJobStats.length > 20) {
                    window.linkedInJobStats = window.linkedInJobStats.slice(-20);
                }
                
                console.log('✅ Added job stats to shared manager and legacy array');
            } else {
                console.log('⚠️ API response missing applies or views for job:', jobId);
            }
        } else {
            console.log('⚠️ Invalid API response structure');
        }
    }
    
    // Debounced processing to prevent rapid requests
    let processingQueue = new Map();
    
    function debouncedProcessApiData(jobId, data) {
        if (processingQueue.has(jobId)) {
            clearTimeout(processingQueue.get(jobId));
        }
        
        const timeoutId = setTimeout(() => {
            processApiData(jobId, data);
            processingQueue.delete(jobId);
        }, 100);
        
        processingQueue.set(jobId, timeoutId);
    }
    
    // Intercept XMLHttpRequest with safety measures
    (function() {
        const originalOpen = XMLHttpRequest.prototype.open;
        const originalSend = XMLHttpRequest.prototype.send;
        
        XMLHttpRequest.prototype.open = function(method, url) {
            this._url = url;
            return originalOpen.apply(this, arguments);
        };
        
        XMLHttpRequest.prototype.send = function() {
            if (isJobPostingEndpoint(this._url)) {
                console.log('🎯 Intercepted XHR job posting:', this._url);
                
                this.addEventListener('load', async () => {
                    try {
                        const jobId = extractJobId(this._url);
                        if (!jobId) return;
                        
                        let responseText;
                        
                        if (this.responseType === 'blob' && this.response instanceof Blob) {
                            // Handle blob response
                            responseText = await this.response.text();
                        } else if (this.responseType === '' || this.responseType === 'text') {
                            responseText = this.responseText;
                        } else {
                            console.log('⚠️ Unsupported responseType:', this.responseType);
                            return;
                        }
                        
                        const jsonData = JSON.parse(responseText);
                        debouncedProcessApiData(jobId, jsonData);
                    } catch (e) {
                        console.debug('Error parsing XHR response:', e.message);
                    }
                });
            }
            return originalSend.apply(this, arguments);
        };
    })();
    
    // Intercept fetch with safety measures
    if (typeof window.fetch !== 'undefined') {
        const originalFetch = window.fetch;
        window.fetch = function(...args) {
            const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
            
            if (isJobPostingEndpoint(url)) {
                console.log('🎯 Intercepted fetch job posting:', url);
                
                return originalFetch.apply(this, args).then(async response => {
                    try {
                        const clonedResponse = response.clone();
                        const jsonData = await clonedResponse.json();
                        const jobId = extractJobId(url);
                        if (jobId) {
                            debouncedProcessApiData(jobId, jsonData);
                        }
                    } catch (e) {
                        console.debug('Error parsing fetch response:', e.message);
                    }
                    return response;
                });
            }
            
            return originalFetch.apply(this, args);
        };
    }
    
    // Function to get recent job stats
    window.getLinkedInJobStats = function() {
        const stats = window.linkedInJobStats || [];
        const recent = stats.filter(item => Date.now() - item.timestamp < 30000);
        return recent;
    };
    
    // Function to get stats for a specific job ID
    window.getLinkedInJobStatsById = function(jobId) {
        const stats = window.linkedInJobStats || [];
        const jobStats = stats.filter(item => 
            item.jobId === jobId && (Date.now() - item.timestamp < 60000)
        );
        return jobStats.length > 0 ? jobStats[jobStats.length - 1] : null;
    };
    
    // Cleanup function to prevent memory leaks
    function cleanup() {
        processingQueue.clear();
        if (window.linkedInJobStats && window.linkedInJobStats.length > 20) {
            window.linkedInJobStats = window.linkedInJobStats.slice(-20);
        }
    }
    
    // Cleanup every 5 minutes
    setInterval(cleanup, 5 * 60 * 1000);
    
    console.log('✅ Voyager API interceptor setup complete with shared manager (v2.0)');
})();
