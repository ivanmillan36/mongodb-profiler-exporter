const express = require('express');
const { MongoClient } = require('mongodb');
const client = require('prom-client');
require('dotenv').config({ path: ".env" });

// Constants
const PORT = process.env.PORT || 2233;
const METRIC_TTL = 3600000; // 1 hour in ms
const CLEANUP_INTERVAL = 300000; // 5 minutes
const MAX_STORED_QUERIES = 1000;
const POLLING_INTERVAL = 10000; // 10 seconds

// Configuration
const config = {
  mongo: {
    user: process.env.MONGO_USERNAME || '',
    password: process.env.MONGO_PASSWORD || '',
    host: process.env.MONGO_HOST || 'mongodb',
    port: process.env.MONGO_PORT || '27017',
    uri: process.env.MONGO_URI || '',
    systemDbs: ['admin', 'local', 'config'],
    // Colecciones a evitar en cualquier base de datos (configurable por variable de entorno)
    ignoredCollections: (process.env.IGNORED_COLLECTIONS ).split(',') || []
  }
};

// Build connection string
const uri = config.mongo.uri
  ? `${config.mongo.uri}/`
  : `mongodb://${config.mongo.user}:${config.mongo.password}@${config.mongo.host}:${config.mongo.port}/`;

console.log("MongoDB Configuration: ", config.mongo.uri);

// Prometheus setup
const register = new client.Registry();
client.collectDefaultMetrics({ register });

const mongodbQueryDetails = new client.Gauge({
  name: 'mongodb_query_details',
  help: 'Details of individual queries in MongoDB',
  labelNames: [
    'query_id',
    'database',
    'collection',
    'operation_type',
    'millis',
    'docs_examined',
    'keys_examined',
    'plan_summary',
    'query_pattern',
    'timestamp'
  ],
  registers: [register]
});

// State management
const state = {
  processedIds: new Set(),
  recentQueries: [],
  metricTimestamps: new Map()
};

// Helper functions
function generateQueryPattern(entry) {
  try {
    if (typeof entry.query === 'object' || typeof entry.filter === 'object') {
      const queryObj = entry.query || entry.filter || {};
      return JSON.stringify(queryObj);
    } else if (entry.command) {
      return JSON.stringify(entry.command)
    }
    return 'unknown';
  } catch (e) {
    return 'error';
  }
}

function formatTimestamp(ts) {
  if (!ts) return new Date().toISOString();
  
  if (ts.$date) {
    return new Date(ts.$date).toISOString();
  } else if (typeof ts === 'object' && ts.getTime) {
    return new Date(ts.getTime()).toISOString();
  }
  
  return new Date().toISOString();
}

function extractExecutionPlan(entry) {
  if (!entry.execStats) return 'N/A';
  
  try {
    const plan = JSON.stringify(entry.execStats, null, 2);
    return plan.length > 1500 ? plan.substring(0, 1500) + '...' : plan;
  } catch (e) {
    return 'Error processing execution plan';
  }
}

function extractQueryDetails(entry, operationType) {
  try {
    let details;
    
    if (operationType === 'query' || operationType === 'find') {
      details = JSON.stringify(entry.query || entry.filter || {});
    } else if (operationType === 'update') {
      details = JSON.stringify({
        query: entry.query || entry.filter || {},
        update: entry.updateObj || entry.u || {}
      });
    } else if (operationType === 'insert') {
      details = JSON.stringify(entry.o || {});
    } else if (operationType === 'command' || operationType === 'getmore') {
      details = JSON.stringify(entry.command || {});
    } else {
      details = JSON.stringify(entry);
    }
    
    return details.length > 1000 ? details.substring(0, 1000) + '...' : details;
  } catch (e) {
    return "Error processing details: " + e.message;
  }
}

// Clean up old metrics to prevent memory leaks
function cleanupOldMetrics() {
  const now = Date.now();
  const expiredIds = [];
  
  state.metricTimestamps.forEach((timestamp, id) => {
    if (now - timestamp > METRIC_TTL) {
      mongodbQueryDetails.remove({ query_id: id });
      expiredIds.push(id);
    }
  });
  
  expiredIds.forEach(id => state.metricTimestamps.delete(id));
  console.log(`Cleaned up ${expiredIds.length} old metrics`);
}

// Process a single profile entry
function processProfileEntry(entry) {
  const entryId = `${entry.queryHash ?? "none"}-${entry.ts.getTime()}`;
  
  // Skip if already processed
  if (state.processedIds.has(entryId)) {
    return null;
  }
  
  // Extract data
  const operationType = entry.op || 'unknown';
  const ns = (entry.ns || '').split('.');
  const database = ns.length > 0 ? ns[0] : 'unknown';
  const collection = ns.length > 1 ? ns[1] : 'unknown';
  
  // Skip ignored collections
  if (config.mongo.ignoredCollections.includes(`${database}.${collection}`)) {
    return null;
  }
  
  // Mark as processed
  state.processedIds.add(entryId);
  
  const millis = entry.millis || 0;
  
  // Extract query details
  const queryDetails = extractQueryDetails(entry, operationType);
  const executionPlan = extractExecutionPlan(entry);
  
  // Create query info object
  const QueryInfo = {
    id: entryId,
    timestamp: formatTimestamp(entry.ts),
    database,
    collection, 
    operation: operationType,
    query: queryDetails,
    millis: millis,
    docsExamined: entry.nreturned || entry.docsExamined || 0,
    keysExamined: entry.keysExamined || 0,
    planSummary: entry.planSummary || 'N/A',
    user: entry.user || 'N/A',
    client: entry.client || entry.clientMetadata || 'N/A',
    writeConflicts: entry.writeConflicts || 0,
    locks: entry.locks ? JSON.stringify(entry.locks) : 'N/A',
    protocol: entry.protocol || 'N/A',
    cursorExhausted: entry.cursorExhausted || false,
    numYield: entry.numYield || 0,
    executionPlan,
    originatingCommand: entry.originatingCommand ? JSON.stringify(entry.originatingCommand) : 'N/A',
    responseLength: entry.responseLength || 0
  };
  
  // Generate query pattern for metric grouping
  const queryPattern = generateQueryPattern(entry);
  
  // Set metric
  mongodbQueryDetails.set(
    {
      query_id: entryId,
      database,
      collection,
      operation_type: operationType,
      millis: millis.toString(),
      docs_examined: (entry.nreturned || entry.docsExamined || 0).toString(),
      keys_examined: (entry.keysExamined || 0).toString(),
      plan_summary: entry.planSummary ? entry.planSummary : 'none',
      query_pattern: queryPattern,
      timestamp: QueryInfo.timestamp
    },
    1
  );
  
  // Register timestamp for expiration
  state.metricTimestamps.set(entryId, Date.now());
  
  return QueryInfo;
}

// Process all profile entries for a database
async function processDatabaseProfile(mongoClient, dbName) {
  console.log(`Checking database: ${dbName}`);
  const db = mongoClient.db(dbName);
  let entriesProcessed = 0;
  
  try {
    // Check profile level
    const profilingLevel = await db.command({ profile: -1 });
    console.log(`Profile level in ${dbName}: ${profilingLevel.was || 'unknown'}`);
    
    // Check if system.profile exists
    const collections = await db.listCollections().toArray();
    const hasProfileCollection = collections.some(coll => coll.name === 'system.profile');
    
    if (!hasProfileCollection) {
      console.log(`No system.profile found in ${dbName}`);
      return 0;
    }
    
    // Count entries
    const count = await db.collection('system.profile').countDocuments({});
    console.log(`Found ${count} entries in system.profile for ${dbName}`);
    
    // Process entries
    const profileEntries = await db.collection('system.profile').find({}).toArray();
    
    for (const entry of profileEntries) {
      const QueryInfo = processProfileEntry(entry);
      
      if (QueryInfo) {
        // Add to recent queries (newest first)
        state.recentQueries.unshift(QueryInfo);
        entriesProcessed++;
      }
    }
    
    // Limit stored queries
    if (state.recentQueries.length > MAX_STORED_QUERIES) {
      state.recentQueries.length = MAX_STORED_QUERIES;
    }
    
    console.log(`Processed ${entriesProcessed} new entries in ${dbName}`);
    return entriesProcessed;
    
  } catch (dbError) {
    console.error(`Error processing ${dbName}: ${dbError}`);
    return 0;
  }
}

// Main monitoring function
async function fetchQueries() {
  console.log("Starting query monitoring...");
  
  const mongoClient = new MongoClient(uri);
  
  try {
    await mongoClient.connect();
    console.log("Successfully connected to MongoDB");
    
    // Continuous monitoring loop
    while (true) {
      try {
        console.log("Looking for queries...");
        let totalEntries = 0;
        
        const dbList = await mongoClient.db().admin().listDatabases();
        
        for (const dbInfo of dbList.databases) {
          const dbName = dbInfo.name;
          
          // Skip system databases
          if (config.mongo.systemDbs.includes(dbName)) {
            continue;
          }
          
          const processed = await processDatabaseProfile(mongoClient, dbName);
          totalEntries += processed;
        }
        
        console.log(`Total entries processed: ${totalEntries}`);
        
      } catch (e) {
        console.error(`General error: ${e}`);
      }
      console.log("Waiting for next iteration...\n");
      
      // Wait before next iteration
      await new Promise(resolve => setTimeout(resolve, POLLING_INTERVAL));
    }
    
  } catch (err) {
    console.error('Error connecting to MongoDB:', err);
    throw err; // Re-throw to allow restart logic
  } finally {
    try {
      await mongoClient.close();
    } catch (err) {
      console.error('Error closing MongoDB connection:', err);
    }
  }
}

// API Routes
const app = express();
app.use(express.json());

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

// Initialize server
async function startServer() {
  // Set up metrics cleanup
  setInterval(cleanupOldMetrics, CLEANUP_INTERVAL);
  
  // Start server
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Metrics server listening on port ${PORT}`);
    
    // Start data collection
    fetchQueries().catch(err => {
      console.error('Error in query monitoring:', err);
      process.exit(1); // Exit to allow container orchestration to restart
    });
  });
}

startServer();