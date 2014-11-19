var SystemDUnitFile, checkForBrokenConnections, createFile, createFromSchema, createOptions, findPorts, generateConnectionKeys, _;

SystemDUnitFile = require("joukou-conductor-systemd").SystemDUnitFile;

_ = require("lodash");

createFromSchema = function(input, machineID, joukouMessageQueAddress, joukouApiAddress, joukouGraphExchangeKey) {
  var connections, name, processes;
  if (!_.isPlainObject(input)) {
    throw new TypeError("input is not an object");
  }
  if (typeof joukouMessageQueAddress !== "string") {
    throw new TypeError("joukouMessageQueAddress is not a string");
  }
  if (typeof joukouApiAddress !== "string") {
    throw new TypeError("joukouApiAddress is not a string");
  }
  if (typeof joukouGraphExchangeKey !== "string") {
    throw new TypeError("joukouGraphExchangeKey is not a string");
  }
  if (!_.isPlainObject(input.properties)) {
    throw new TypeError("input.properties is not an object");
  }
  if (!_.isPlainObject(input.processes)) {
    throw new TypeError("input.processes is not an object");
  }
  if (!_.isArray(input.connections)) {
    throw new TypeError("input.connections is not an array");
  }
  name = input.properties.name;
  if (!name) {
    throw new Error("input.properties.name is required");
  }
  connections = _.cloneDeep(input.connections);
  checkForBrokenConnections(connections);
  processes = _.cloneDeep(input.processes);
  return createOptions(name, processes, connections, machineID, joukouMessageQueAddress, joukouApiAddress, joukouGraphExchangeKey);
};

createOptions = function(name, processes, connections, machineID, joukouMessageQueAddress, joukouApiAddress, joukouGraphExchangeKey) {
  var actualProcessKey, component, file, label, options, process, processKey, unit;
  options = [];

  /*
  use format
  [
    {
      unitName: "name"
      options: [SystemDUnitFile].options
      machineID: machineID
    }
  ]
   */
  for (processKey in processes) {
    if (!processes.hasOwnProperty(processKey)) {
      continue;
    }
    process = processes[processKey];
    component = process.metadata && process.metadata.circle && process.metadata.circle.key;
    component = component || process.component;
    component = component || processKey;
    actualProcessKey = process.metadata && process.metadata.key;
    actualProcessKey = actualProcessKey || processKey;
    label = process.metadata && process.metadata.label;
    label = label || component || processKey;
    unit = {
      process: process,
      processKey: component,
      machineID: machineID,
      dockerContainer: (process.metadata && process.metadata.image) || process.component,
      ports: findPorts(connections, processKey, actualProcessKey)
    };
    generateConnectionKeys(unit.ports, joukouGraphExchangeKey);
    file = createFile(unit, joukouMessageQueAddress, joukouApiAddress, label);
    options.push({
      unitName: processKey,
      options: file.options,
      machineID: machineID
    });
  }
  return options;
};

createFile = function(unit, joukouMessageQueAddress, joukouApiAddress, label) {
  var file, key, port, _i, _len, _ref;
  file = new SystemDUnitFile();
  file.service.addEnvironment("JOUKOU_AMQP_ADDR", joukouMessageQueAddress);
  file.service.addEnvironment("JOUKOU_API_ADDR", joukouApiAddress);
  _ref = unit.ports;
  for (_i = 0, _len = _ref.length; _i < _len; _i++) {
    port = _ref[_i];
    if (!port || !port.port) {
      continue;
    }
    key = "JOUKOU_CIRCLE_" + port.type + "_" + port.name + "_";
    file.service.addEnvironment("" + key + "EXCHANGE", port.port.exchangeKey);
    file.service.addEnvironment("" + key + "ROUTING_KEY", port.port.routingKey);
  }
  file.service.addUser("root");
  file.service.addType("notify");
  file.service.addNotifyAccess("all");
  file.service.addTimeoutStartSec("12min");
  file.service.addTimeoutStopSec("15");
  file.service.addRestart("on-failure");
  file.service.addRestartSec("10s");
  file.service.addEnvironmentFile("/run/docker.env");
  file.service.addExecStartPre("/usr/bin/docker run --rm -v " + "/opt/bin:/opt/bin ibuildthecloud/systemd-docker");
  file.service.addExecStartPre("/usr/bin/docker pull " + unit.dockerContainer);
  file.service.addExecStartPre("-/usr/bin/docker kill %p");
  file.service.addExecStartPre("-/usr/bin/docker rm %p");
  file.service.addExecStart("/opt/bin/systemd-docker run --name %p " + unit.dockerContainer);
  file.service.addExecStop("/usr/bin/docker kill %p");
  file.unit.addDescription("Unit for " + label);
  file.unit.addDocumentation(unit.dockerContainer);
  file.unit.addAfter("docker.service");
  file.unit.addRequires("docker.service");
  file.unit.addAfter("rabbitmq.service");
  file.unit.addRequires("rabbitmq.service");
  file.unit.addAfter("api.service");
  file.unit.addRequires("api.service");
  return file;
};

generateConnectionKeys = function(ports, joukouGraphExchangeKey) {
  var port, portObject, _i, _len, _results;
  _results = [];
  for (_i = 0, _len = ports.length; _i < _len; _i++) {
    portObject = ports[_i];
    port = portObject.port;
    if (port && !port.exchangeKey) {
      port.exchangeKey = joukouGraphExchangeKey;
      _results.push(port.routingKey = "" + (portObject.source || portObject.process) + "_" + portObject.name);
    } else {
      _results.push(void 0);
    }
  }
  return _results;
};

checkForBrokenConnections = function(connections) {
  var connection, i, source, target, _results;
  i = 0;
  _results = [];
  while (i < connections.length) {
    connection = connections[i];
    i++;
    if (!_.isPlainObject(connection)) {
      continue;
    }
    target = connection["tgt"];
    source = connection["src"];
    if (!target && !source) {
      continue;
    } else {
      _results.push(void 0);
    }
  }
  return _results;
};

findPorts = function(connections, processKey, component) {
  var connection, result, source, _i, _len;
  result = [];
  for (_i = 0, _len = connections.length; _i < _len; _i++) {
    connection = connections[_i];
    source = null;
    if (connection.src) {
      source = connection.src.process;
      if (connection.src.process === processKey) {
        if (typeof connection.src.port !== "string") {
          throw new TypeError("Port name is expected to be a string");
        }
        result.push({
          type: "OUTPORT",
          name: connection.src.port.toUpperCase(),
          port: connection.src,
          connection: connection,
          source: source,
          process: component
        });
      }
    }
    if (connection.tgt) {
      if (connection.tgt.process === processKey) {
        if (typeof connection.tgt.port !== "string") {
          throw new TypeError("Port name is expected to be a string");
        }
        result.push({
          type: "INPORT",
          name: connection.tgt.port.toUpperCase(),
          port: connection.tgt,
          connection: connection,
          source: source,
          process: component
        });
      }
    }
  }
  return result;
};

module.exports = {
  createFromSchema: createFromSchema
};

//# sourceMappingURL=data:application/json;base64,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QSxDQURGO09BRkY7S0FEQTtBQWNBLElBQUEsSUFBRyxVQUFVLENBQUMsR0FBZDtBQUNFLE1BQUEsSUFBRyxVQUFVLENBQUMsR0FBRyxDQUFDLE9BQWYsS0FBMEIsVUFBN0I7QUFDRSxRQUFBLElBQUcsTUFBQSxDQUFBLFVBQWlCLENBQUMsR0FBRyxDQUFDLElBQXRCLEtBQWdDLFFBQW5DO0FBQ0UsZ0JBQVUsSUFBQSxTQUFBLENBQVUsc0NBQVYsQ0FBVixDQURGO1NBQUE7QUFBQSxRQUVBLE1BQU0sQ0FBQyxJQUFQLENBQVk7QUFBQSxVQUNWLElBQUEsRUFBTSxRQURJO0FBQUEsVUFFVixJQUFBLEVBQU0sVUFBVSxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsV0FBcEIsQ0FBQSxDQUZJO0FBQUEsVUFHVixJQUFBLEVBQU0sVUFBVSxDQUFDLEdBSFA7QUFBQSxVQUlWLFVBQUEsRUFBWSxVQUpGO0FBQUEsVUFLVixNQUFBLEVBQVEsTUFMRTtBQUFBLFVBTVYsT0FBQSxFQUFTLFNBTkM7U0FBWixDQUZBLENBREY7T0FERjtLQWZGO0FBQUEsR0FEQTtTQTZCQSxPQTlCVTtBQUFBLENBak1aLENBQUE7O0FBQUEsTUFpT00sQ0FBQyxPQUFQLEdBQ0U7QUFBQSxFQUFBLGdCQUFBLEVBQWtCLGdCQUFsQjtDQWxPRixDQUFBIiwiZmlsZSI6ImxpYnMvc3lzdGVtZC5qcyIsInNvdXJjZVJvb3QiOiIvc291cmNlLyIsInNvdXJjZXNDb250ZW50IjpbInsgU3lzdGVtRFVuaXRGaWxlIH0gPSByZXF1aXJlKFwiam91a291LWNvbmR1Y3Rvci1zeXN0ZW1kXCIpXG5fICAgICAgICAgICAgICAgICAgID0gcmVxdWlyZShcImxvZGFzaFwiKVxuXG5jcmVhdGVGcm9tU2NoZW1hID0gKGlucHV0LFxuICAgICAgICAgICAgICAgICAgICBtYWNoaW5lSUQsXG4gICAgICAgICAgICAgICAgICAgIGpvdWtvdU1lc3NhZ2VRdWVBZGRyZXNzLFxuICAgICAgICAgICAgICAgICAgICBqb3Vrb3VBcGlBZGRyZXNzLFxuICAgICAgICAgICAgICAgICAgICBqb3Vrb3VHcmFwaEV4Y2hhbmdlS2V5KSAtPlxuICBpZiBub3QgXy5pc1BsYWluT2JqZWN0KGlucHV0KVxuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoXCJpbnB1dCBpcyBub3QgYW4gb2JqZWN0XCIpXG4gICMgaWYgbm90IG1hY2hpbmVJRFxuICAjICAgdGhyb3cgbmV3IEVycm9yKFwibWFjaGluZUlEIGlzIHJlcXVpcmVkXCIpXG4gICNpZiB0eXBlb2YgbWFjaGluZUlEIGlzbnQgXCJzdHJpbmdcIlxuICAjICB0aHJvdyBuZXcgVHlwZUVycm9yKFwibWFjaGluZUlEIGlzIG5vdCBhIHN0cmluZ1wiKVxuICBpZiB0eXBlb2Ygam91a291TWVzc2FnZVF1ZUFkZHJlc3MgaXNudCBcInN0cmluZ1wiXG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcihcImpvdWtvdU1lc3NhZ2VRdWVBZGRyZXNzIGlzIG5vdCBhIHN0cmluZ1wiKVxuICBpZiB0eXBlb2Ygam91a291QXBpQWRkcmVzcyBpc250IFwic3RyaW5nXCJcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKFwiam91a291QXBpQWRkcmVzcyBpcyBub3QgYSBzdHJpbmdcIilcbiAgaWYgdHlwZW9mIGpvdWtvdUdyYXBoRXhjaGFuZ2VLZXkgaXNudCBcInN0cmluZ1wiXG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcihcImpvdWtvdUdyYXBoRXhjaGFuZ2VLZXkgaXMgbm90IGEgc3RyaW5nXCIpXG4gIGlmIG5vdCBfLmlzUGxhaW5PYmplY3QoaW5wdXQucHJvcGVydGllcylcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKFwiaW5wdXQucHJvcGVydGllcyBpcyBub3QgYW4gb2JqZWN0XCIpXG4gIGlmIG5vdCBfLmlzUGxhaW5PYmplY3QoaW5wdXQucHJvY2Vzc2VzKVxuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoXCJpbnB1dC5wcm9jZXNzZXMgaXMgbm90IGFuIG9iamVjdFwiKVxuICBpZiBub3QgXy5pc0FycmF5KGlucHV0LmNvbm5lY3Rpb25zKVxuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoXCJpbnB1dC5jb25uZWN0aW9ucyBpcyBub3QgYW4gYXJyYXlcIilcbiAgbmFtZSA9IGlucHV0LnByb3BlcnRpZXMubmFtZVxuICBpZiBub3QgbmFtZVxuICAgIHRocm93IG5ldyBFcnJvcihcImlucHV0LnByb3BlcnRpZXMubmFtZSBpcyByZXF1aXJlZFwiKVxuICBjb25uZWN0aW9ucyA9IF8uY2xvbmVEZWVwKGlucHV0LmNvbm5lY3Rpb25zKVxuICBjaGVja0ZvckJyb2tlbkNvbm5lY3Rpb25zKGNvbm5lY3Rpb25zKVxuICBwcm9jZXNzZXMgPSBfLmNsb25lRGVlcChpbnB1dC5wcm9jZXNzZXMpXG4gIHJldHVybiBjcmVhdGVPcHRpb25zKFxuICAgIG5hbWUsXG4gICAgcHJvY2Vzc2VzLFxuICAgIGNvbm5lY3Rpb25zLFxuICAgIG1hY2hpbmVJRCxcbiAgICBqb3Vrb3VNZXNzYWdlUXVlQWRkcmVzcyxcbiAgICBqb3Vrb3VBcGlBZGRyZXNzLFxuICAgIGpvdWtvdUdyYXBoRXhjaGFuZ2VLZXlcbiAgKVxuXG5jcmVhdGVPcHRpb25zID0gKG5hbWUsXG4gICAgICAgICAgICAgICAgIHByb2Nlc3NlcyxcbiAgICAgICAgICAgICAgICAgY29ubmVjdGlvbnMsXG4gICAgICAgICAgICAgICAgIG1hY2hpbmVJRCxcbiAgICAgICAgICAgICAgICAgam91a291TWVzc2FnZVF1ZUFkZHJlc3MsXG4gICAgICAgICAgICAgICAgIGpvdWtvdUFwaUFkZHJlc3MsXG4gICAgICAgICAgICAgICAgIGpvdWtvdUdyYXBoRXhjaGFuZ2VLZXkpIC0+XG4gIG9wdGlvbnMgPSBbXVxuICAjIyNcbiAgdXNlIGZvcm1hdFxuICBbXG4gICAge1xuICAgICAgdW5pdE5hbWU6IFwibmFtZVwiXG4gICAgICBvcHRpb25zOiBbU3lzdGVtRFVuaXRGaWxlXS5vcHRpb25zXG4gICAgICBtYWNoaW5lSUQ6IG1hY2hpbmVJRFxuICAgIH1cbiAgXVxuICAjIyNcbiAgZm9yIHByb2Nlc3NLZXkgb2YgcHJvY2Vzc2VzXG4gICAgaWYgbm90IHByb2Nlc3Nlcy5oYXNPd25Qcm9wZXJ0eShwcm9jZXNzS2V5KVxuICAgICAgY29udGludWVcbiAgICBwcm9jZXNzID0gcHJvY2Vzc2VzW3Byb2Nlc3NLZXldXG4gICAgY29tcG9uZW50ID0gcHJvY2Vzcy5tZXRhZGF0YSAmJlxuICAgICAgICBwcm9jZXNzLm1ldGFkYXRhLmNpcmNsZSAmJlxuICAgICAgICBwcm9jZXNzLm1ldGFkYXRhLmNpcmNsZS5rZXlcbiAgICBjb21wb25lbnQgPSBjb21wb25lbnQgfHwgcHJvY2Vzcy5jb21wb25lbnRcbiAgICBjb21wb25lbnQgPSBjb21wb25lbnQgfHwgcHJvY2Vzc0tleVxuICAgIGFjdHVhbFByb2Nlc3NLZXkgPSBwcm9jZXNzLm1ldGFkYXRhICYmIHByb2Nlc3MubWV0YWRhdGEua2V5XG4gICAgYWN0dWFsUHJvY2Vzc0tleSA9IGFjdHVhbFByb2Nlc3NLZXkgfHwgcHJvY2Vzc0tleVxuICAgIGxhYmVsID0gcHJvY2Vzcy5tZXRhZGF0YSAmJlxuICAgICAgICBwcm9jZXNzLm1ldGFkYXRhLmxhYmVsXG4gICAgbGFiZWwgPSBsYWJlbCB8fCBjb21wb25lbnQgfHwgcHJvY2Vzc0tleVxuICAgIHVuaXQgPSB7XG4gICAgICBwcm9jZXNzOiBwcm9jZXNzXG4gICAgICBwcm9jZXNzS2V5OiBjb21wb25lbnRcbiAgICAgIG1hY2hpbmVJRDogbWFjaGluZUlEXG4gICAgICBkb2NrZXJDb250YWluZXI6IChwcm9jZXNzLm1ldGFkYXRhICYmXG4gICAgICAgIHByb2Nlc3MubWV0YWRhdGEuaW1hZ2UpIHx8IHByb2Nlc3MuY29tcG9uZW50XG4gICAgICBwb3J0czogZmluZFBvcnRzKGNvbm5lY3Rpb25zLCBwcm9jZXNzS2V5LCBhY3R1YWxQcm9jZXNzS2V5KVxuICAgIH1cbiAgICBnZW5lcmF0ZUNvbm5lY3Rpb25LZXlzKHVuaXQucG9ydHMsIGpvdWtvdUdyYXBoRXhjaGFuZ2VLZXkpXG4gICAgZmlsZSA9IGNyZWF0ZUZpbGUoXG4gICAgICB1bml0LFxuICAgICAgam91a291TWVzc2FnZVF1ZUFkZHJlc3MsXG4gICAgICBqb3Vrb3VBcGlBZGRyZXNzLFxuICAgICAgbGFiZWxcbiAgICApXG4gICAgb3B0aW9ucy5wdXNoKHtcbiAgICAgIHVuaXROYW1lOiBwcm9jZXNzS2V5XG4gICAgICBvcHRpb25zOiBmaWxlLm9wdGlvbnNcbiAgICAgIG1hY2hpbmVJRDogbWFjaGluZUlEXG4gICAgfSlcblxuICByZXR1cm4gb3B0aW9uc1xuXG5jcmVhdGVGaWxlID0gKHVuaXQsXG4gICAgICAgICAgICAgIGpvdWtvdU1lc3NhZ2VRdWVBZGRyZXNzLFxuICAgICAgICAgICAgICBqb3Vrb3VBcGlBZGRyZXNzLFxuICAgICAgICAgICAgICBsYWJlbCkgLT5cblxuICBmaWxlID0gbmV3IFN5c3RlbURVbml0RmlsZSgpXG4gIGZpbGUuc2VydmljZS5hZGRFbnZpcm9ubWVudChcIkpPVUtPVV9BTVFQX0FERFJcIiwgam91a291TWVzc2FnZVF1ZUFkZHJlc3MpXG4gIGZpbGUuc2VydmljZS5hZGRFbnZpcm9ubWVudChcIkpPVUtPVV9BUElfQUREUlwiLCBqb3Vrb3VBcGlBZGRyZXNzKVxuXG4gIGZvciBwb3J0IGluIHVuaXQucG9ydHNcbiAgICBpZiBub3QgcG9ydCBvciBub3QgcG9ydC5wb3J0XG4gICAgICBjb250aW51ZVxuICAgIGtleSA9IFwiSk9VS09VX0NJUkNMRV8je3BvcnQudHlwZX1fI3twb3J0Lm5hbWV9X1wiXG4gICAgZmlsZS5zZXJ2aWNlLmFkZEVudmlyb25tZW50KFwiI3trZXl9RVhDSEFOR0VcIiwgcG9ydC5wb3J0LmV4Y2hhbmdlS2V5KVxuICAgIGZpbGUuc2VydmljZS5hZGRFbnZpcm9ubWVudChcIiN7a2V5fVJPVVRJTkdfS0VZXCIsIHBvcnQucG9ydC5yb3V0aW5nS2V5KVxuXG4gICMgUnVuIGFzIHJvb3QgYmVjYXVzZVxuICAjIC0gc3lzdGVtZC1kb2NrZXIgcmVxdWlyZXMgcm9vdCBwcml2aWxlZ2VzXG4gICMgLSAvcm9vdC8uZG9ja2VyY2ZnIGZvciByZWdpc3RyeSBhdXRoZW50aWNhdGlvblxuICBmaWxlLnNlcnZpY2UuYWRkVXNlcihcInJvb3RcIilcblxuICAjIHNkX25vdGlmeSgzKSBpcyByZXF1aXJlZCBieSBzeXN0ZW1kLWRvY2tlclxuICBmaWxlLnNlcnZpY2UuYWRkVHlwZShcIm5vdGlmeVwiKVxuICBmaWxlLnNlcnZpY2UuYWRkTm90aWZ5QWNjZXNzKFwiYWxsXCIpXG5cbiAgIyBMYXJnZSBzdGFydCB0aW1lb3V0IGlzIHRvIGFsbG93IGZvciBwdWxsaW5nIGRvd24gRG9ja2VyIGltYWdlcyBmcm9tIHF1YXkuaW9cbiAgZmlsZS5zZXJ2aWNlLmFkZFRpbWVvdXRTdGFydFNlYyhcIjEybWluXCIpXG4gIGZpbGUuc2VydmljZS5hZGRUaW1lb3V0U3RvcFNlYyhcIjE1XCIpXG5cbiAgZmlsZS5zZXJ2aWNlLmFkZFJlc3RhcnQoXCJvbi1mYWlsdXJlXCIpXG4gIGZpbGUuc2VydmljZS5hZGRSZXN0YXJ0U2VjKFwiMTBzXCIpXG5cbiAgZmlsZS5zZXJ2aWNlLmFkZEVudmlyb25tZW50RmlsZShcIi9ydW4vZG9ja2VyLmVudlwiKVxuXG4gIGZpbGUuc2VydmljZS5hZGRFeGVjU3RhcnRQcmUoXG4gICAgXCIvdXNyL2Jpbi9kb2NrZXIgcnVuIC0tcm0gLXYgXCIgK1xuICAgICAgXCIvb3B0L2Jpbjovb3B0L2JpbiBpYnVpbGR0aGVjbG91ZC9zeXN0ZW1kLWRvY2tlclwiXG4gIClcbiAgZmlsZS5zZXJ2aWNlLmFkZEV4ZWNTdGFydFByZShcbiAgICBcIi91c3IvYmluL2RvY2tlciBwdWxsICN7dW5pdC5kb2NrZXJDb250YWluZXJ9XCJcbiAgKVxuXG4gIGZpbGUuc2VydmljZS5hZGRFeGVjU3RhcnRQcmUoXCItL3Vzci9iaW4vZG9ja2VyIGtpbGwgJXBcIilcbiAgZmlsZS5zZXJ2aWNlLmFkZEV4ZWNTdGFydFByZShcIi0vdXNyL2Jpbi9kb2NrZXIgcm0gJXBcIilcblxuICBmaWxlLnNlcnZpY2UuYWRkRXhlY1N0YXJ0KFxuICAgIFwiL29wdC9iaW4vc3lzdGVtZC1kb2NrZXIgcnVuIC0tbmFtZSAlcCAje3VuaXQuZG9ja2VyQ29udGFpbmVyfVwiXG4gIClcblxuICBmaWxlLnNlcnZpY2UuYWRkRXhlY1N0b3AoXCIvdXNyL2Jpbi9kb2NrZXIga2lsbCAlcFwiKVxuXG4gIGZpbGUudW5pdC5hZGREZXNjcmlwdGlvbihcIlVuaXQgZm9yICN7bGFiZWx9XCIpXG4gIGZpbGUudW5pdC5hZGREb2N1bWVudGF0aW9uKHVuaXQuZG9ja2VyQ29udGFpbmVyKVxuXG4gICMgUmVxdWlyZXMgZG9ja2VyXG4gIGZpbGUudW5pdC5hZGRBZnRlcihcImRvY2tlci5zZXJ2aWNlXCIpXG4gIGZpbGUudW5pdC5hZGRSZXF1aXJlcyhcImRvY2tlci5zZXJ2aWNlXCIpXG5cbiAgIyBSZXF1aXJlcyByYWJiaXRtcVxuICBmaWxlLnVuaXQuYWRkQWZ0ZXIoXCJyYWJiaXRtcS5zZXJ2aWNlXCIpXG4gIGZpbGUudW5pdC5hZGRSZXF1aXJlcyhcInJhYmJpdG1xLnNlcnZpY2VcIilcblxuICAjIFJlcXVpcmVzIGFwaVxuICBmaWxlLnVuaXQuYWRkQWZ0ZXIoXCJhcGkuc2VydmljZVwiKVxuICBmaWxlLnVuaXQuYWRkUmVxdWlyZXMoXCJhcGkuc2VydmljZVwiKVxuXG4gICMgQWRkIGFueSBtb3JlIHJlcXVpcmVkIHVuaXRzXG5cbiAgcmV0dXJuIGZpbGVcblxuZ2VuZXJhdGVDb25uZWN0aW9uS2V5cyA9IChwb3J0cywgam91a291R3JhcGhFeGNoYW5nZUtleSkgLT5cbiAgZm9yIHBvcnRPYmplY3QgaW4gcG9ydHNcbiAgICBwb3J0ID0gcG9ydE9iamVjdC5wb3J0XG4gICAgaWYgcG9ydCBhbmQgbm90IHBvcnQuZXhjaGFuZ2VLZXlcbiAgICAgIHBvcnQuZXhjaGFuZ2VLZXkgPSBqb3Vrb3VHcmFwaEV4Y2hhbmdlS2V5XG4gICAgICAjIFRPRE8gUm91dGluZyBrZXlcbiAgICAgIHBvcnQucm91dGluZ0tleSA9XG4gICAgICAgIFwiI3twb3J0T2JqZWN0LnNvdXJjZSBvciBwb3J0T2JqZWN0LnByb2Nlc3N9XyN7cG9ydE9iamVjdC5uYW1lfVwiXG5cbmNoZWNrRm9yQnJva2VuQ29ubmVjdGlvbnMgPSAoY29ubmVjdGlvbnMpIC0+XG4gIGkgPSAwXG4gIHdoaWxlIGkgPCBjb25uZWN0aW9ucy5sZW5ndGhcbiAgICBjb25uZWN0aW9uID0gY29ubmVjdGlvbnNbaV1cbiAgICBpKytcbiAgICBpZiBub3QgXy5pc1BsYWluT2JqZWN0KGNvbm5lY3Rpb24pXG4gICAgICBjb250aW51ZVxuICAgIHRhcmdldCA9IGNvbm5lY3Rpb25bXCJ0Z3RcIl1cbiAgICBzb3VyY2UgPSBjb25uZWN0aW9uW1wic3JjXCJdXG4gICAgaWYgbm90IHRhcmdldCBhbmQgbm90IHNvdXJjZVxuICAgICAgY29udGludWVcbiNDb21tZW50IG91dCBmb3Igbm93IHNvIHdlIGNhbiBkbyBkZW1vcyB3aXRoIHBob3RvYm9vdGguanNvblxuI2lmIG5vdCBfLmlzUGxhaW5PYmplY3QodGFyZ2V0KVxuIyAgdGhyb3cgbmV3IEVycm9yKFwiTm8gdGFyZ2V0IGZvciBjb25uZWN0aW9uICN7aX1cIilcbiNpZiBub3QgXy5pc1BsYWluT2JqZWN0KHNvdXJjZSlcbiMgIHRocm93IG5ldyBFcnJvcihcIk5vIHNvdXJjZSBmb3IgY29ubmVjdGlvbiAje2l9XCIpXG5cbmZpbmRQb3J0cyA9IChjb25uZWN0aW9ucywgcHJvY2Vzc0tleSwgY29tcG9uZW50KSAtPlxuICByZXN1bHQgPSBbXVxuICBmb3IgY29ubmVjdGlvbiBpbiBjb25uZWN0aW9uc1xuICAgIHNvdXJjZSA9IG51bGxcbiAgICBpZiBjb25uZWN0aW9uLnNyY1xuICAgICAgc291cmNlID0gY29ubmVjdGlvbi5zcmMucHJvY2Vzc1xuICAgICAgaWYgY29ubmVjdGlvbi5zcmMucHJvY2VzcyBpcyBwcm9jZXNzS2V5XG4gICAgICAgIGlmIHR5cGVvZiBjb25uZWN0aW9uLnNyYy5wb3J0IGlzbnQgXCJzdHJpbmdcIlxuICAgICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoXCJQb3J0IG5hbWUgaXMgZXhwZWN0ZWQgdG8gYmUgYSBzdHJpbmdcIilcbiAgICAgICAgcmVzdWx0LnB1c2goe1xuICAgICAgICAgIHR5cGU6IFwiT1VUUE9SVFwiXG4gICAgICAgICAgbmFtZTogY29ubmVjdGlvbi5zcmMucG9ydC50b1VwcGVyQ2FzZSgpXG4gICAgICAgICAgcG9ydDogY29ubmVjdGlvbi5zcmNcbiAgICAgICAgICBjb25uZWN0aW9uOiBjb25uZWN0aW9uXG4gICAgICAgICAgc291cmNlOiBzb3VyY2VcbiAgICAgICAgICBwcm9jZXNzOiBjb21wb25lbnRcbiAgICAgICAgfSlcbiAgICBpZiBjb25uZWN0aW9uLnRndFxuICAgICAgaWYgY29ubmVjdGlvbi50Z3QucHJvY2VzcyBpcyBwcm9jZXNzS2V5XG4gICAgICAgIGlmIHR5cGVvZiBjb25uZWN0aW9uLnRndC5wb3J0IGlzbnQgXCJzdHJpbmdcIlxuICAgICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoXCJQb3J0IG5hbWUgaXMgZXhwZWN0ZWQgdG8gYmUgYSBzdHJpbmdcIilcbiAgICAgICAgcmVzdWx0LnB1c2goe1xuICAgICAgICAgIHR5cGU6IFwiSU5QT1JUXCJcbiAgICAgICAgICBuYW1lOiBjb25uZWN0aW9uLnRndC5wb3J0LnRvVXBwZXJDYXNlKClcbiAgICAgICAgICBwb3J0OiBjb25uZWN0aW9uLnRndFxuICAgICAgICAgIGNvbm5lY3Rpb246IGNvbm5lY3Rpb25cbiAgICAgICAgICBzb3VyY2U6IHNvdXJjZVxuICAgICAgICAgIHByb2Nlc3M6IGNvbXBvbmVudFxuICAgICAgICB9KVxuXG4gIHJlc3VsdFxuXG5tb2R1bGUuZXhwb3J0cyA9XG4gIGNyZWF0ZUZyb21TY2hlbWE6IGNyZWF0ZUZyb21TY2hlbWEiXX0=