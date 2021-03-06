#!/usr/bin/env node

var fs = require('fs')
var osmium = require('osmium')
var _ = require('underscore')
var turf = require('@turf/turf')
var argv = require('minimist')(process.argv.slice(2))
var util = require('./util')
var pbfFile = argv._[0]
var objConfig = JSON.parse(fs.readFileSync(argv.config).toString())
var counter = {}
if (!argv.users) {
  counter['__'] = {}
} else {
  var users = argv.users.split(',')
  for (let d = 0; d < users.length; d++) {
    counter[users[d]] = {}
  }
}
init(pbfFile)

function init (pbfFile) {
  var handlerA = new osmium.Handler()
  handlerA.on('relation', function (relation) {
    if (!argv.users) {
      // Counting  the base map
      counter['__'] = mainCounter(relation, 'relation', counter['__'])
    } else if (argv.users === '*') {
      // Counting for all users
      if (!counter[relation.user]) counter[relation.user] = {}
      counter[relation.user] = mainCounter(relation, 'relation', counter[relation.user])
    } else if (counter[relation.user]) {
      // Counting for specific users
      counter[relation.user] = mainCounter(relation, 'relation', counter[relation.user])
    }
  })

  var reader = new osmium.BasicReader(pbfFile)
  osmium.apply(reader, handlerA)

  var handlerB = new osmium.Handler()
  handlerB.on('node', function (node) {
    if (!argv.users) {
      // Counting  the base map
      counter['__'] = mainCounter(node, 'node', counter['__'])
    } else if (argv.users === '*') {
      // Counting for all users
      if (!counter[node.user]) counter[node.user] = {}
      counter[node.user] = mainCounter(node, 'node', counter[node.user])
    } else if (counter[node.user]) {
      // Counting for specific users
      counter[node.user] = mainCounter(node, 'node', counter[node.user])
    }
  })

  reader = new osmium.Reader(pbfFile)
  osmium.apply(reader, handlerB)

  var handlerC = new osmium.Handler()
  handlerC.on('way', function (way) {
    if (!argv.users) {
      // Counting  the base map
      counter['__'] = mainCounter(way, 'way', counter['__'])
    } else if (argv.users === '*') {
      // Counting for all users
      if (!counter[way.user]) counter[way.user] = {}
      counter[way.user] = mainCounter(way, 'way', counter[way.user])
    } else if (counter[way.user]) {
      // Counting for specific users
      counter[way.user] = mainCounter(way, 'way', counter[way.user])
    }
  })

  reader = new osmium.Reader(pbfFile)
  var locationHandler = new osmium.LocationHandler()
  osmium.apply(reader, locationHandler, handlerC)

  handlerC.on('done', function () {
    // print result
    if (argv.format === 'csv') {
      if (!argv.users) {
        console.log('tag,total,node,way,relation,area,distance')
        _.each(counter['__'], function (val, key) {
          console.log(`${key}, ${val.total},${val.node},${val.way},${val.relation},${val.area.toFixed(2)},${val.distance.toFixed(2)}`)
          _.each(val.types, function (v, k) {
            console.log(`${key}:${k}, ${v.total},${v.node},${v.way},${v.relation},${v.area.toFixed(2)},${v.distance.toFixed(2)}`)
          })
        })
      } else {
        console.log('user,tag,total,node,way,relation,area,distance')
        _.each(counter, function (userVal, userKey) {
          _.each(userVal, function (val, key) {
            console.log(`${userKey},${key}, ${val.total},${val.node},${val.way},${val.relation},${val.area.toFixed(2)},${val.distance.toFixed(2)}`)
            _.each(val.types, function (v, k) {
              console.log(`${userKey},${key}:${k}, ${v.total},${v.node},${v.way},${v.relation},${v.area.toFixed(2)},${v.distance.toFixed(2)}`)
            })
          })
        })
      }
    } else {
      console.log(JSON.stringify(counter))
    }
  })
  handlerA.end()
  handlerB.end()
  handlerC.end()
}

function mainCounter (data, type, objCounter) {
  var tags = data.tags()
  _.each(objConfig, function (v, k) {
    if (tags[k]) {
      // General counter
      objCounter = countBykeys(k, type, objCounter)
      if (typeof data.geojson === 'function') {
        objCounter = getDistanceAreaByKey(k, data.geojson(), objCounter)
      }
      // Count by key and values
      if (v !== '*') {
        var values = v.split(',')
        for (var i = 0; i < values.length; i++) {
          var value = values[i]
          if (tags[k] === value) {
            objCounter = countBykeysValues(k, value, type, objCounter)
            if (typeof data.geojson === 'function') {
              objCounter = getDistanceAreaByKeyValues(k, value, data.geojson(), objCounter)
            }
          }
        }
      } else {
        objCounter = countBykeysValues(k, tags[k], type, objCounter)
        if (typeof data.geojson === 'function') {
          objCounter = getDistanceAreaByKeyValues(k, tags[k], data.geojson(), objCounter)
        }
      }
    }
  })

  return objCounter
}

// counter by key
function countBykeys (k, type, objCounter) {
  if (objCounter.hasOwnProperty(k)) {
    objCounter[k].total++
    objCounter[k][type]++
  } else {
    objCounter[k] = {}
    // Counting by type of values
    objCounter[k].types = {}
    // Counting the total of objects
    objCounter[k].node = 0
    objCounter[k].way = 0
    objCounter[k].relation = 0
    objCounter[k].total = 1
    objCounter[k][type] = 1
    // Measures
    objCounter[k].area = 0
    objCounter[k].distance = 0
  }
  return objCounter
}
// counter by key and value
function countBykeysValues (k, v, type, objCounter) {
  if (objCounter[k].types[v]) {
    objCounter[k].types[v].total++
    objCounter[k].types[v][type]++
  } else {
    objCounter[k].types[v] = {}
    objCounter[k].types[v].node = 0
    objCounter[k].types[v].way = 0
    objCounter[k].types[v].relation = 0
    objCounter[k].types[v][type] = 1
    objCounter[k].types[v].total = 1
    // Measures
    objCounter[k].types[v].area = 0
    objCounter[k].types[v].distance = 0
  }
  return objCounter
}

// Distance and Area
function getDistanceAreaByKey (k, geojson, objCounter) {
  // Get area from any geometry which is LineString && the first and last coordinates are equal
  if (geojson.type === 'LineString' && _.intersection(geojson.coordinates[0], geojson.coordinates[geojson.coordinates.length - 1]).length === 2) {
    var polygon = turf.lineToPolygon(geojson)
    objCounter[k].area = objCounter[k].area + util.area(polygon)
  }
  // Get distance
  if (geojson.type === 'LineString') {
    objCounter[k].distance = objCounter[k].distance + util.distance(geojson)
  }
  return objCounter
}

function getDistanceAreaByKeyValues (k, v, geojson, objCounter) {
  // Get area
  if (geojson.type === 'LineString' && _.intersection(geojson.coordinates[0], geojson.coordinates[geojson.coordinates.length - 1]).length === 2) {
    var polygon = turf.lineToPolygon(geojson)
    objCounter[k].types[v].area = objCounter[k].types[v].area + util.area(polygon)
  }
  // Get distance
  if (geojson.type === 'LineString') {
    objCounter[k].types[v].distance = objCounter[k].types[v].distance + util.distance(geojson)
  }
  return objCounter
}
