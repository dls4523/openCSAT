// monitoring.js - Enhanced monitoring and logging utilities
const fs = require('fs');
const path = require('path');

class Logger {
  constructor(options = {}) {
    this.level = options.level || process.env.LOG_LEVEL || 'info';
    this.enableConsole = options.enableConsole !== false;
    this.enableFile = options.enableFile || false;
    this.logDir = options.logDir || './logs';
    this.maxFileSize = options.maxFileSize || 10 * 1024 * 1024; // 10MB
    this.maxFiles = options.maxFiles || 5;
    
    this.levels = {
      error: 0,
      warn: 1,
      info: 2,
      debug: 3
    };
    
    if (this.enableFile && !fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }
  
  shouldLog(level) {
    return this.levels[level] <= this.levels[this.level];
  }
  
  formatMessage(level, message, meta = {}) {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level: level.toUpperCase(),
      message,
      ...meta
    };
    
    if (meta.error && meta.error instanceof Error) {
      logEntry.error = {
        message: meta.error.message,
        stack: meta.error.stack,
        code: meta.error.code
      };
    }
    
    return logEntry;
  }
  
  writeToFile(logEntry, level) {
    if (!this.enableFile) return;
    
    try {
      const filename = path.join(this.logDir, `${level}.log`);
      const logLine = JSON.stringify(logEntry) + '\n';
      
      // Check file size and rotate if needed
      if (fs.existsSync(filename)) {
        const stats = fs.statSync(filename);
        if (stats.size > this.maxFileSize) {
          this.rotateLogFile(filename, level);
        }
      }
      
      fs.appendFileSync(filename, logLine);
    } catch (error) {
      console.error('Failed to write to log file:', error.message);
    }
  }
  
  rotateLogFile(filename, level) {
    try {
      // Move existing log files
      for (let i = this.maxFiles - 1; i >= 1; i--) {
        const oldFile = `${filename}.${i}`;
        const newFile = `${filename}.${i + 1}`;
        
        if (fs.existsSync(oldFile)) {
          if (i === this.maxFiles - 1) {
            fs.unlinkSync(oldFile); // Delete oldest file
          } else {
            fs.renameSync(oldFile, newFile);
          }
        }
      }
      
      // Move current file to .1
      fs.renameSync(filename, `${filename}.1`);
    } catch (error) {
      console.error('Failed to rotate log file:', error.message);
    }
  }
  
  log(level, message, meta = {}) {
    if (!this.shouldLog(level)) return;
    
    const logEntry = this.formatMessage(level, message, meta);
    
    if (this.enableConsole) {
      const colorMap = {
        error: '\x1b[31m', // Red
        warn: '\x1b[33m',  // Yellow
        info: '\x1b[36m',  // Cyan
        debug: '\x1b[37m'  // White
      };
      
      const color = colorMap[level] || '\x1b[37m';
      const reset = '\x1b[0m';
      
      console.log(`${color}[${logEntry.timestamp}] ${logEntry.level}: ${message}${reset}`);
      
      if (meta && Object.keys(meta).length > 0) {
        console.log(`${color}  Meta:`, meta, reset);
      }
    }
    
    this.writeToFile(logEntry, level);
  }
  
  error(message, meta = {}) {
    this.log('error', message, meta);
  }
  
  warn(message, meta = {}) {
    this.log('warn', message, meta);
  }
  
  info(message, meta = {}) {
    this.log('info', message, meta);
  }
  
  debug(message, meta = {}) {
    this.log('debug', message, meta);
  }
}

class HealthMonitor {
  constructor(options = {}) {
    this.checkInterval = options.checkInterval || 60000; // 1 minute
    this.checks = new Map();
    this.history = [];
    this.maxHistorySize = options.maxHistorySize || 100;
    this.logger = options.logger || new Logger();
    this.isRunning = false;
  }
  
  addCheck(name, checkFunction, options = {}) {
    this.checks.set(name, {
      fn: checkFunction,
      timeout: options.timeout || 5000,
      critical: options.critical || false,
      lastResult: null,
      lastCheck: null
    });
  }
  
  async runCheck(name, checkConfig) {
    const startTime = Date.now();
    
    try {
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Health check timeout')), checkConfig.timeout);
      });
      
      const result = await Promise.race([
        checkConfig.fn(),
        timeoutPromise
      ]);
      
      const duration = Date.now() - startTime;
      
      const checkResult = {
        name,
        status: 'healthy',
        duration,
        timestamp: new Date().toISOString(),
        details: result
      };
      
      checkConfig.lastResult = checkResult;
      checkConfig.lastCheck = Date.now();
      
      return checkResult;
    } catch (error) {
      const duration = Date.now() - startTime;
      
      const checkResult = {
        name,
        status: 'unhealthy',
        duration,
        timestamp: new Date().toISOString(),
        error: error.message,
        critical: checkConfig.critical
      };
      
      checkConfig.lastResult = checkResult;
      checkConfig.lastCheck = Date.now();
      
      this.logger.error(`Health check failed: ${name}`, { error, duration });
      
      return checkResult;
    }
  }
  
  async runAllChecks() {
    const results = [];
    
    for (const [name, checkConfig] of this.checks) {
      const result = await this.runCheck(name, checkConfig);
      results.push(result);
    }
    
    const overallStatus = results.every(r => r.status === 'healthy') ? 'healthy' : 'unhealthy';
    const criticalFailures = results.filter(r => r.status === 'unhealthy' && r.critical);
    
    const healthReport = {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      checks: results,
      criticalFailures: criticalFailures.length,
      totalChecks: results.length,
      healthyChecks: results.filter(r => r.status === 'healthy').length
    };
    
    // Add to history
    this.history.unshift(healthReport);
    if (this.history.length > this.maxHistorySize) {
      this.history = this.history.slice(0, this.maxHistorySize);
    }
    
    // Log critical failures
    if (criticalFailures.length > 0) {
      this.logger.error(`Critical health check failures detected`, {
        failures: criticalFailures.map(f => ({ name: f.name, error: f.error }))
      });
    }
    
    return healthReport;
  }
  
  start() {
    if (this.isRunning) return;
    
    this.isRunning = true;
    this.logger.info('Health monitor started');
    
    const runChecks = async () => {
      if (!this.isRunning) return;
      
      try {
        await this.runAllChecks();
      } catch (error) {
        this.logger.error('Error running health checks', { error });
      }
      
      if (this.isRunning) {
        setTimeout(runChecks, this.checkInterval);
      }
    };
    
    // Run initial check
    runChecks();
  }
  
  stop() {
    this.isRunning = false;
    this.logger.info('Health monitor stopped');
  }
  
  getStatus() {
    return this.history[0] || {
      status: 'unknown',
      timestamp: new Date().toISOString(),
      checks: [],
      criticalFailures: 0,
      totalChecks: 0,
      healthyChecks: 0
    };
  }
  
  getHistory(limit = 10) {
    return this.history.slice(0, limit);
  }
}

class MetricsCollector {
  constructor(options = {}) {
    this.metrics = new Map();
    this.logger = options.logger || new Logger();
    this.collectInterval = options.collectInterval || 30000; // 30 seconds
    this.isRunning = false;
  }
  
  counter(name, value = 1, labels = {}) {
    const key = this.getMetricKey(name, labels);
    const existing = this.metrics.get(key) || { type: 'counter', value: 0, labels, lastUpdated: Date.now() };
    existing.value += value;
    existing.lastUpdated = Date.now();
    this.metrics.set(key, existing);
  }
  
  gauge(name, value, labels = {}) {
    const key = this.getMetricKey(name, labels);
    this.metrics.set(key, {
      type: 'gauge',
      value,
      labels,
      lastUpdated: Date.now()
    });
  }
  
  histogram(name, value, labels = {}) {
    const key = this.getMetricKey(name, labels);
    const existing = this.metrics.get(key) || {
      type: 'histogram',
      values: [],
      labels,
      lastUpdated: Date.now()
    };
    
    existing.values.push(value);
    existing.lastUpdated = Date.now();
    
    // Keep only last 1000 values
    if (existing.values.length > 1000) {
      existing.values = existing.values.slice(-1000);
    }
    
    this.metrics.set(key, existing);
  }
  
  getMetricKey(name, labels = {}) {
    const labelStr = Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}="${v}"`)
      .join(',');
    
    return labelStr ? `${name}{${labelStr}}` : name;
  }
  
  getMetrics() {
    const result = {};
    
    for (const [key, metric] of this.metrics) {
      if (metric.type === 'histogram') {
        const values = metric.values.sort((a, b) => a - b);
        const count = values.length;
        
        result[key] = {
          type: 'histogram',
          count,
          sum: values.reduce((a, b) => a + b, 0),
          min: count > 0 ? values[0] : 0,
          max: count > 0 ? values[count - 1] : 0,
          p50: count > 0 ? values[Math.floor(count * 0.5)] : 0,
          p95: count > 0 ? values[Math.floor(count * 0.95)] : 0,
          p99: count > 0 ? values[Math.floor(count * 0.99)] : 0,
          labels: metric.labels,
          lastUpdated: metric.lastUpdated
        };
      } else {
        result[key] = {
          type: metric.type,
          value: metric.value,
          labels: metric.labels,
          lastUpdated: metric.lastUpdated
        };
      }
    }
    
    return result;
  }
  
  start() {
    if (this.isRunning) return;
    
    this.isRunning = true;
    this.logger.info('Metrics collector started');
    
    const collectSystemMetrics = () => {
      if (!this.isRunning) return;
      
      try {
        const memUsage = process.memoryUsage();
        this.gauge('process_memory_usage_bytes', memUsage.rss, { type: 'rss' });
        this.gauge('process_memory_usage_bytes', memUsage.heapUsed, { type: 'heap_used' });
        this.gauge('process_memory_usage_bytes', memUsage.heapTotal, { type: 'heap_total' });
        this.gauge('process_memory_usage_bytes', memUsage.external, { type: 'external' });
        
        this.gauge('process_uptime_seconds', process.uptime());
        
        const cpuUsage = process.cpuUsage();
        this.gauge('process_cpu_usage_microseconds', cpuUsage.user, { type: 'user' });
        this.gauge('process_cpu_usage_microseconds', cpuUsage.system, { type: 'system' });
      } catch (error) {
        this.logger.error('Error collecting system metrics', { error });
      }
      
      if (this.isRunning) {
        setTimeout(collectSystemMetrics, this.collectInterval);
      }
    };
    
    collectSystemMetrics();
  }
  
  stop() {
    this.isRunning = false;
    this.logger.info('Metrics collector stopped');
  }
}

// Express middleware for request metrics
function createMetricsMiddleware(metricsCollector) {
  return (req, res, next) => {
    const startTime = Date.now();
    
    // Track request count
    metricsCollector.counter('http_requests_total', 1, {
      method: req.method,
      route: req.route?.path || req.path
    });
    
    // Override res.end to capture response metrics
    const originalEnd = res.end;
    res.end = function(chunk, encoding) {
      const duration = Date.now() - startTime;
      
      // Track response time
      metricsCollector.histogram('http_request_duration_ms', duration, {
        method: req.method,
        status_code: res.statusCode.toString(),
        route: req.route?.path || req.path
      });
      
      // Track response count by status
      metricsCollector.counter('http_responses_total', 1, {
        method: req.method,
        status_code: res.statusCode.toString(),
        route: req.route?.path || req.path
      });
      
      originalEnd.call(this, chunk, encoding);
    };
    
    next();
  };
}

module.exports = {
  Logger,
  HealthMonitor,
  MetricsCollector,
  createMetricsMiddleware
};