systemd      = require( '../dist' ).SystemD
chai         = require( 'chai' )
expect       = chai.expect
assert       = chai.assert
fs           = require( 'fs' )

machineID = "MACHINE_ID"
AMQA = "AMQA"
API = "API"
EXCHANGE = "EXCHANGE"

# http://noflojs.org/documentation/json/
example =
{
  "properties": {
    "name": "Count lines in a file"
  },
  "processes": {
    "Read File": {
      "component": "ReadFile",
      "metadata": {
        image: "quay.io/joukou/circles-string/ReadFile"
      }
    }
    "Split by Lines": {
      "component": "quay.io/joukou/circles-string/SplitStr"
    }
  },
  "connections": [
    {
      "src": {
        "process": "Read File",
        "port": "out"
      },
      "tgt": {
        "process": "Split by Lines",
        "port": "in"
      }
    },
    {
      "src": {
        "process": "Split by Lines",
        "port": "out"
      },
      "tgt": {
        "process": "Read File",
        "port": "in"
      }
    }
  ]
}

describe 'noflo systemd', ->
  specify "works", ->
    systemdFile = systemd.createFromSchema(example, machineID, AMQA, API, EXCHANGE)
    expect(systemdFile).to.exist
  specify "works without machineID", ->
    systemdFile = systemd.createFromSchema(example, null, AMQA, API, EXCHANGE)
    expect(systemdFile).to.exist
  specify "works with photobooth json", ->
    file = fs.readFileSync('./test/real-api-response.json', 'utf8')
    json = JSON.parse(file)
    systemdFile = systemd.createFromSchema(json, machineID, AMQA, API, EXCHANGE)
    expect(systemdFile).to.exist
  specify "returns correct amount of units", ->
    systemdFile = systemd.createFromSchema(example, machineID, AMQA, API, EXCHANGE)
    expect(systemdFile.length).to.equal(2)
  specify "returns correct unit names", ->
    systemdFile = systemd.createFromSchema(example, machineID, AMQA, API, EXCHANGE)
    expect(systemdFile[0].unitName).to.equal("Read File")
    expect(systemdFile[1].unitName).to.equal("Split by Lines")
  specify "creates routing key and exchange key", ->
    systemdFile = systemd.createFromSchema(example, machineID, AMQA, API, EXCHANGE)
    hasOut = no
    hasIn = no
    outKey = "JOUKOU_CIRCLE_OUTPORT_OUT_ROUTING_KEY"
    inKey = "JOUKOU_CIRCLE_INPORT_IN_ROUTING_KEY"
    for val in systemdFile[0].options
      if val.name isnt 'Environment'
        continue
      if val.value.indexOf(outKey) isnt -1
        expect(val.value).to.equal("#{outKey}=Read File_OUT")
        hasOut = yes
    for val in systemdFile[1].options
      if val.name isnt 'Environment'
        continue
      if val.value.indexOf(inKey) isnt -1
        expect(val.value).to.equal("#{inKey}=Read File_IN")
        hasIn = yes
    expect(hasOut).to.be.ok
    # So we can see which one is asserted as failed
    expect(not hasIn).to.be.not.ok
  specify "docker container is correct", ->
    systemdFile = systemd.createFromSchema(example, machineID, AMQA, API, EXCHANGE)
    hasOut = no
    hasIn = no
    docker = "/opt/bin/systemd-docker run --name %p"
    for val in systemdFile[0].options
      if val.name isnt 'ExecStart'
        continue
      if val.value.indexOf(docker) isnt -1
        expect(val.value).to.equal("#{docker} quay.io/joukou/circles-string/ReadFile")
        hasOut = yes
    for val in systemdFile[1].options
      if val.name isnt 'ExecStart'
        continue
      if val.value.indexOf(docker) isnt -1
        expect(val.value).to.equal("#{docker} quay.io/joukou/circles-string/SplitStr")
        hasIn = yes
    expect(hasOut).to.be.ok
    # So we can see which one is asserted as failed
    expect(not hasIn).to.be.not.ok


