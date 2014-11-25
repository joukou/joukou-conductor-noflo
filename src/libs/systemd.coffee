{ SystemDUnitFile } = require("joukou-conductor-systemd")
_                   = require("lodash")

createFromSchema = (input,
                    machineID,
                    joukouMessageQueAddress,
                    joukouApiAddress,
                    joukouGraphExchangeKey) ->
  if not _.isPlainObject(input)
    throw new TypeError("input is not an object")
  # if not machineID
  #   throw new Error("machineID is required")
  #if typeof machineID isnt "string"
  #  throw new TypeError("machineID is not a string")
  if typeof joukouMessageQueAddress isnt "string"
    throw new TypeError("joukouMessageQueAddress is not a string")
  if typeof joukouApiAddress isnt "string"
    throw new TypeError("joukouApiAddress is not a string")
  if typeof joukouGraphExchangeKey isnt "string"
    throw new TypeError("joukouGraphExchangeKey is not a string")
  if not _.isPlainObject(input.properties)
    throw new TypeError("input.properties is not an object")
  if not _.isPlainObject(input.processes)
    throw new TypeError("input.processes is not an object")
  if not _.isArray(input.connections)
    throw new TypeError("input.connections is not an array")
  name = input.properties.name
  if not name
    throw new Error("input.properties.name is required")
  connections = _.cloneDeep(input.connections)
  checkForBrokenConnections(connections)
  processes = _.cloneDeep(input.processes)
  return createOptions(
    name,
    processes,
    connections,
    machineID,
    joukouMessageQueAddress,
    joukouApiAddress,
    joukouGraphExchangeKey
  )

createOptions = (name,
                 processes,
                 connections,
                 machineID,
                 joukouMessageQueAddress,
                 joukouApiAddress,
                 joukouGraphExchangeKey) ->
  options = []
  ###
  use format
  [
    {
      unitName: "name"
      options: [SystemDUnitFile].options
      machineID: machineID
    }
  ]
  ###
  for processKey of processes
    if not processes.hasOwnProperty(processKey)
      continue
    process = processes[processKey]
    component = process.metadata &&
        process.metadata.circle &&
        process.metadata.circle.key
    component = component || process.component
    component = component || processKey
    actualProcessKey = process.metadata && process.metadata.key
    actualProcessKey = actualProcessKey || processKey
    label = process.metadata &&
        process.metadata.label
    label = label || component || processKey
    unit = {
      process: process
      processKey: component
      machineID: machineID
      dockerContainer: (process.metadata &&
        process.metadata.image) || process.component
      ports: findPorts(connections, processKey, actualProcessKey)
    }
    generateConnectionKeys(unit.ports, joukouGraphExchangeKey)
    file = createFile(
      unit,
      joukouMessageQueAddress,
      joukouApiAddress,
      label
    )
    options.push({
      unitName: processKey
      options: file.options
      machineID: machineID
    })

  return options

createFile = (unit,
              joukouMessageQueAddress,
              joukouApiAddress,
              label) ->

  file = new SystemDUnitFile()
  file.service.addEnvironment("JOUKOU_AMQP_ADDR", joukouMessageQueAddress)
  file.service.addEnvironment("JOUKOU_API_ADDR", joukouApiAddress)

  for port in unit.ports
    if not port or not port.port
      continue
    key = "JOUKOU_CIRCLE_#{port.type}_#{port.name}_"
    file.service.addEnvironment("#{key}EXCHANGE", port.port.exchangeKey)
    file.service.addEnvironment("#{key}ROUTING_KEY", port.port.routingKey)

  # Run as root because
  # - systemd-docker requires root privileges
  # - /root/.dockercfg for registry authentication
  file.service.addUser("root")

  # sd_notify(3) is required by systemd-docker
  file.service.addType("notify")
  file.service.addNotifyAccess("all")

  # Large start timeout is to allow for pulling down Docker images from quay.io
  file.service.addTimeoutStartSec("12min")
  file.service.addTimeoutStopSec("15")

  file.service.addRestart("on-failure")
  file.service.addRestartSec("10s")

  file.service.addEnvironmentFile("/run/docker.env")

  file.service.addExecStartPre(
    "/usr/bin/docker run --rm -v " +
      "/opt/bin:/opt/bin ibuildthecloud/systemd-docker"
  )
  file.service.addExecStartPre(
    "/usr/bin/docker pull #{unit.dockerContainer}"
  )

  file.service.addExecStartPre("-/usr/bin/docker kill %p")
  file.service.addExecStartPre("-/usr/bin/docker rm %p")

  file.service.addExecStart(
    "/opt/bin/systemd-docker run --name %p #{unit.dockerContainer}"
  )

  file.service.addExecStop("/usr/bin/docker kill %p")

  file.unit.addDescription("Unit for #{label}")
  file.unit.addDocumentation(unit.dockerContainer)

  # Requires docker
  file.unit.addAfter("docker.service")
  file.unit.addRequires("docker.service")

  # Requires rabbitmq
  file.unit.addAfter("rabbitmq.service")
  file.unit.addRequires("rabbitmq.service")

  # Requires api
  file.unit.addAfter("api.service")
  file.unit.addRequires("api.service")

  # Add any more required units

  return file

generateConnectionKeys = (ports, joukouGraphExchangeKey) ->
  for portObject in ports
    port = portObject.port
    if port and not port.exchangeKey
      port.exchangeKey = joukouGraphExchangeKey
      # TODO Routing key
      port.routingKey =
        "#{portObject.source or portObject.process}_#{portObject.name}"

checkForBrokenConnections = (connections) ->
  i = 0
  while i < connections.length
    connection = connections[i]
    i++
    if not _.isPlainObject(connection)
      continue
    target = connection["tgt"]
    source = connection["src"]
    if not target and not source
      continue
#Comment out for now so we can do demos with photobooth.json
#if not _.isPlainObject(target)
#  throw new Error("No target for connection #{i}")
#if not _.isPlainObject(source)
#  throw new Error("No source for connection #{i}")

findPorts = (connections, processKey, component) ->
  result = []
  for connection in connections
    source = null
    if connection.src
      source = connection.src.process
      if connection.src.process is processKey
        if typeof connection.src.port isnt "string"
          throw new TypeError("Port name is expected to be a string")
        result.push({
          type: "OUTPORT"
          name: connection.src.port.toUpperCase()
          port: connection.src
          connection: connection
          source: source
          process: component
        })
    if connection.tgt
      if connection.tgt.process is processKey
        if typeof connection.tgt.port isnt "string"
          throw new TypeError("Port name is expected to be a string")
        result.push({
          type: "INPORT"
          name: connection.tgt.port.toUpperCase()
          port: connection.tgt
          connection: connection
          source: source
          process: component
        })

  result

module.exports =
  createFromSchema: createFromSchema