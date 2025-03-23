# MongoDB Profiler Exporter

This project provides a metrics exporter to monitor and analyze queries in MongoDB through Prometheus and Grafana, facilitating the identification and resolution of performance issues in MongoDB databases.

## Features

- Automatic monitoring of queries across all MongoDB databases
- Export of metrics in Prometheus-compatible format
- Predefined Grafana dashboard with query visualization
- Configurable filtering of system databases and specific collections
- Automatic cleanup of old metrics to prevent memory leaks
- Efficient storage with configurable query limit

## Prerequisites

- MongoDB with profiling enabled
- Node.js 12.0 or higher
- Prometheus (optional, for storage and querying metrics)
- Grafana (optional, for visualization)

## Installation

### Using Docker Compose (recommended)

The project includes a docker-compose.yml file that automatically configures the entire environment.

This will deploy:

- MongoDB with profiling enabled (level 2)
- MongoDB Profiler Exporter on port 2233
- Prometheus on port 9090
- Grafana on port 3000

### Manual Installation

## Configuration

### Environment Variables

Create a .env file in the app directory with the following variables:

| Variable | Description | Default Value |
|----------|-------------|-------------------|
| PORT | Port for the metrics server | 2233 |
| MONGO_URI | MongoDB connection URI | - |
| MONGO_USERNAME | MongoDB username | - |
| MONGO_PASSWORD | MongoDB password | - |
| MONGO_HOST | MongoDB host | mongodb |
| MONGO_PORT | MongoDB port | 27017 |
| IGNORED_COLLECTIONS | Collections to ignore (comma-separated) | system.profile |
| POLLING_INTERVAL | Query interval in ms | 10000 |

### Enabling Profiling in MongoDB

For the exporter to work correctly, profiling must be enabled in MongoDB:

> Note: If you use the provided docker-compose, MongoDB already starts with profiling enabled.

#### Enabling Profiling with mongosh and creating a system.profile collection
This will log all queries
```shell
use admin
db.createCollection("system.profile", { 
  capped: true, 
  size: 100 * 1024 * 1024  // 100MB máximo
})
db.setProfilingLevel(2)
```

#### Enabling Profiling with mongosh and slowms
This will log queries that take more than 100ms
```shell
use admin
db.setProfilingLevel(1, 100) 
```

## Usage

### Available Endpoints

- **GET /metrics**: Endpoint for Prometheus, exposes metrics in Prometheus format.
- **GET /grafana-metrics**: Endpoint for Grafana, exposes metrics in a format compatible with the Grafana SimpleJson plugin or infinity plugin.

## Grafana Integration

The project includes a predefined Grafana dashboard (`/grafana/mongodbProfilerViewer.json`) that displays queries in tabular format.

### Configuring Grafana with Infinity Plugin

1. Access Grafana (http://localhost:3000 by default)
2. Go to "Configuration" > "Data Sources"
3. Add new pluging Infinity
4. Add a new data source with the following configuration:
   - Name: MongoDB Profiler
   - Type: Infinity
   - URL: http://localhost:2233/grafana-metrics

### Configuring Grafana with Prometheus

1. Access Grafana (http://localhost:3000 by default)
2. Go to "Configuration" > "Data Sources"
3. Add a new data source with the following configuration:
   - Name: Prometheus
   - Type: Prometheus
   - URL: http://localhost:9090

### Importing the Predefined Dashboard

1. Access Grafana (http://localhost:3000 by default)
2. Go to "Create" > "Import"
3. Copy the content of the JSON file located at `/grafana/mongodbProfilerViewer.json`
4. Paste the JSON in the text field or upload the file directly
5. Select the configured Prometheus data source
6. Click "Import" to finish

## Technical Details

### Collected Metrics

The main metrics collected for each query include:

- **query_id**: Unique identifier for the query
- **database**: Database where the query was executed
- **collection**: Collection that was operated on
- **operation_type**: Type of operation (query, update, insert, command, etc.)
- **millis**: Execution time in milliseconds
- **docs_examined**: Number of documents examined
- **keys_examined**: Number of indexes examined
- **plan_summary**: Summary of the execution plan
- **query_pattern**: Query pattern to group similar queries
- **timestamp**: Query timestamp

### Prometheus Configuration

The `prometheus.yml` file is configured to collect metrics from the exporter. If you modify the port or address, update this file accordingly.

### Memory Management

To prevent memory leaks, the exporter:

- Periodically cleans up old metrics according to CLEANUP_INTERVAL (5 minutes by default)
- Limits the number of stored queries to MAX_STORED_QUERIES (1000 by default)
- Has a TTL for metrics of METRIC_TTL (1 hour by default)

## Troubleshooting

### Metrics Are Not Appearing
- Verify that profiling is enabled in MongoDB
- Check the exporter logs for connection errors
- Make sure you're not inadvertently filtering all databases or collections

### Specific Queries Are Not Appearing
- Review the IGNORED_COLLECTIONS configuration to ensure that the collections you want to monitor are not being filtered

### High Memory Consumption
- Reduce MAX_STORED_QUERIES in exporter.js
- Increase the cleanup frequency by reducing CLEANUP_INTERVAL
- Filter databases or collections you don't need to monitor

## Docker Compose Example

```yaml
version: '3.8'

services:
  mongodb:
    image: mongo:6.0
    command:
      - --profile=2
    ports:
      - "27017:27017"
    environment:
      MONGO_INITDB_ROOT_USERNAME: admin
      MONGO_INITDB_ROOT_PASSWORD: admin
    volumes:
      - mongodatavolume:/data/db
      - mongodb_config:/data/configdb

  mongodb-profiler-exporter:
    image: ivanmillan36/mongodb-profiler-exporter:latest
    ports:
      - "2233:2233"
    environment:
      PORT: "2233"
      MONGODB_URI: "mongodb://admin:admin@mongodb:27017?authSource=admin"
      MONGO_USERNAME: "admin"
      MONGO_PASSWORD: "admin"
      MONGO_HOST: "mongodb"
      MONGO_PORT: "27017"
      IGNORED_COLLECTIONS: "event_record.system"
    depends_on:
      - mongodb

  prometheus:
    image: prom/prometheus:latest
    ports:
      - "9090:9090"
    volumes:
      - ./prometheus/prometheus.yml:/etc/prometheus/prometheus.yml
    depends_on:
      - mongodb-profiler-exporter

  grafana:
    image: grafana/grafana:latest
    ports:
      - "3000:3000"
    volumes:
      - grafana-storage:/var/lib/grafana
    depends_on:
      - prometheus

volumes:
  mongodatavolume:
  mongodb_config:
  grafana-storage:
```

## Contributions

Contributions are welcome. Please submit a Pull Request or open an Issue to discuss proposed changes.

## License

MIT License

Copyright (c) 2025 Revai

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Authors

- **Iván Millán** - *Initial work and main developer* - [ivanmillan36](https://https://github.com/ivanmillan36)

