#!usr/bin/env node
// @ts-check

import {Console as NodeConsole} from "node:console"
import {mkdir, mkdtemp, writeFile} from "node:fs/promises"
import {createReadStream, createWriteStream, existsSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {argv, stderr, stdout} from "node:process"
import {URL, fileURLToPath} from "node:url"
import sade from "sade"
import Chain from "stream-chain"
import Pick from "stream-json/filters/Pick.js"
import Ignore from "stream-json/filters/Ignore.js"
import StreamArray from "stream-json/streamers/StreamArray.js"
import Parser from "stream-json/Parser.js"
import pack from "./package.json" assert {type: "json"}
import {finished} from "node:stream/promises"
import {Readable} from "node:stream"

/**
 * @typedef {Object} Config
 * @property {ConfigSource} source
 */

/**
 * @typedef {Object} ConfigSource
 * @property {string} owner
 * @property {string} name
 * @property {string} branch
 * @property {string} file
 */

/** @type {Config} */
const config = {
  source: {
    owner: "onlyoffice",
    name: "community-server-declarations",
    branch: "src",
    file: "community-server.json"
  }
}

const console = createConsole()
main()

/**
 * @returns {void}
 */
function main() {
  sade("./makefile.js")
    .command("build")
    .action(build)
    .parse(argv)
}

/**
 * @typedef {Object} Parent
 * @property {string} path
 * @property {number} length
 */

/**
 * @returns {Promise<void>}
 */
async function build() {
  const td = await createTempDir()

  const su = sourceFile(config.source)
  const sf = join(td, config.source.file)
  await downloadFile(su, sf)

  const rd = rootDir()

  const dd = distDir(rd)
  if (!existsSync(dd)) {
    await mkdir(dd)
  }

  /** @type {Parent[]} */
  const parents = []

  await new Promise((res, rej) => {
    const c = new Chain([
      createReadStream(sf),
      new Parser(),
      new Ignore({filter: /^\d+\.apiMethods\.\d+\./}),
      new StreamArray(),
      (ch) => {
        if (ch.value.apiMethods.length <= 0) {
          console.warn(`${ch.value.path} is missing api methods`)
          return;
        }

        parents.push({
          path: ch.value.path,
          length: ch.value.apiMethods.length
        })
      }
    ])
    // Keep this line to avoid terminating the process.
    c.on("data", () => {})
    c.on("error", rej)
    c.on("close", res)
  })

  // For the beauty of the picture, it would be great to stream this as well,
  // but it is easier this way.
  const base = {
    openapi: "3.1.0",
    info: {
      title: "Community Server REST API",
      version: "latest"
    },
    paths: {},
    components: {
      securitySchemes: {
        AuthorizationHeader: {
          type: "apiKey",
          in: "header",
          name: "Authorization"
        }
      }
    }
  }

  let i = 0
  await new Promise((res, rej) => {
    const c = new Chain([
      createReadStream(sf),
      new Parser(),
      new Pick({filter: /^\d+\.apiMethods/}),
      new StreamArray(),
      (ch) => {
        const p = parents[0]
        if (p === undefined) {
          throw new Error("parents is empty")
        }

        console.info(`processing ${i} of ${p.path}...`)
        const r = process(p, ch.value)
        if (r === null) {
          console.warn(`skipping ${i} of ${p.path}...`)
        } else {
          console.info(`adding ${i} of ${p.path}...`)
          if (base.paths[r.endpoint] === undefined) {
            base.paths[r.endpoint] = {}
          }
          base.paths[r.endpoint][r.method] = r.object
        }

        p.length -= 1
        if (p.length === 0) {
          i = 0
          parents.shift()
        } else {
          i += 1
        }
      }
    ])
    // Keep this line to avoid terminating the process.
    c.on("data", () => {})
    c.on("error", rej)
    c.on("close", res)
  })

  base.components.schemas = schemas

  const df = join(dd, config.source.file)
  const dc = JSON.stringify(base, null, 2)
  await writeFile(df, dc)
}

/**
 * @returns {Promise<string>}
 */
function createTempDir() {
  const tmp = join(tmpdir(), pack.name)
  return mkdtemp(`${tmp}-`)
}

/**
 * @returns {string}
 */
function rootDir() {
  const u = new URL(".", import.meta.url)
  return fileURLToPath(u)
}

/**
 * @param {string} d
 * @returns {string}
 */
function distDir(d) {
  return join(d, "dist")
}

/**
 * @param {ConfigSource} c
 * @returns {string}
 */
function sourceFile(c) {
  return `https://raw.githubusercontent.com/${c.owner}/${c.name}/${c.branch}/${c.file}`
}

/**
 * @param {string} u
 * @param {string} p
 * @returns {Promise<void>}
 */
async function downloadFile(u, p) {
  const res = await fetch(u)
  if (res.body === null) {
    throw new Error("No body")
  }
  // Uses two distinct types of ReadableStream: one from the DOM API and another
  // from NodeJS API. It functions well, so no need to worry.
  // @ts-ignore
  const r = Readable.fromWeb(res.body)
  const s = createWriteStream(p)
  const w = r.pipe(s)
  await finished(w)
}

/**
 * @typedef {Object} Result
 * @property {string} endpoint
 * @property {string} method
 * @property {any} object
 */

/**
 * @param {Parent} p
 * @param {any} c
 * @returns {Result | null}
 */
function process(p, c) {
  let isInvalid = false

  if (c.path === undefined || c.path === null) {
    console.warn("path is missing")
    isInvalid = true
    c.path = ""
  }

  if (c.method === undefined || c.method === null || c.method === "") {
    console.warn("method is missing")
    isInvalid = true
    c.method = ""
  }

  const method = c.method.toLowerCase()
  const endpoint = `/api/2.0/${p.path}/${c.path}`
  const object = {}

  if (c.isVisible === false) {
    console.warn(`${endpoint} is not visible`)
    isInvalid = true
  }

  if (c.category === undefined || c.category === null || c.category === "") {
    console.warn(`${endpoint} category is missing`)
    object.tags = [`${p.path}`]
    // isInvalid = true
  } else {
    object.tags = [`${p.path}/${c.category}`]
  }

  if (c.requiresAuthorization !== false) {
    object.security = [
      {
        AuthorizationHeader: [
          "read",
          "write"
        ]
      }
    ]
  }

  if (c.shortDescription === undefined || c.shortDescription === null || c.shortDescription === "") {
    console.warn(`${endpoint} short description is missing`)
    isInvalid = true
  } else {
    object.summary = c.shortDescription
  }

  const d = processDescription(c)
  if (d !== "") {
    object.description = d
  }

  if (object.description === undefined) {
    console.warn(`${endpoint} failed to set description`)
    isInvalid = true
  }

  const parameters = []
  const requestBody = {
    content: {
      "application/json": {
        schema: {
          type: "object",
          properties: { }
        }
      }
    }
  }
  let hasBody = false

  if (!(c.parameters === undefined || c.parameters === null)) {
    c.parameters.forEach((p, i) => {
      console.info(`processing parameter ${i}...`)
      let isInvalid = false

      const o = {}

      if (p.isVisible === false) {
        console.warn("is not visible")
        isInvalid = true
      }

      if (p.name === undefined || p.name === null || p.name === "") {
        console.warn("parameter name is missing")
        isInvalid = true
        p.name = ""
      } else {
        o.name = p.name
      }

      if (p.in === undefined || p.in === null || p.in === "") {
        // todo: it is not our opportunity
        if (endpoint.includes(`{${p.name}}`)) {
          o.in = "path"
        } else {
          o.in = "body"
        }
      } else {
        o.in = p.in
      }

      const d = processDescription(p)
      if (d !== "") {
        o.description = d
      }

      const s = processSchema(p)
      if (s === undefined) {
        console.warn("type is missing")
        isInvalid = true
      } else {
        o.schema = s
      }

      if (isInvalid) {
        console.warn("failed to set parameter")
      } else {
        if (o.in === "body") {
          hasBody = true
          requestBody.content["application/json"].schema.properties[o.name] = {
            description: o.description,
            type: o.schema.type
          }

          if (o.schema.type == "array" && o.schema.items) {
            requestBody.content["application/json"].schema.properties[o.name].items = o.schema.items
          }

        } else {
          parameters.push(o)
        }
      }
    })
  }

  if (parameters.length > 0) {
    object.parameters = parameters
  }

  if (hasBody) {
    object.requestBody = requestBody
  }

  if(!(c.returns == null || c.returns == undefined)) {
    console.info(`processing response`)
    let isInvalid = false

    const o = {}

    const d = processDescription(c.returns)
    if (d !== "") {
      o.description = d
    }

    const s = processSchema(c.returns)
    if (s === undefined) {
      console.warn("type is missing")
      isInvalid = true
    } else {
      // todo: wait for the content-type
      o.content = {
        "application/json": {
          schema: s
        }
      }
      o.content["application/json"].schema = s
    }

    if (isInvalid) {
      console.warn("failed to set response")
    } else {
      object.responses = {
        "200": o
      }

      if (object.security) {
        object.responses["401"] = { description: "Unauthorized" }
      }
    }
  }

  if (isInvalid) {
    return null
  }
  return {
    endpoint,
    method,
    object
  }
}

/**
 * @param {any} o
 * @returns {string}
 */
function processDescription(o) {
  let d = ""

  if (!(o.description === undefined || o.description === null || o.description === "")) {
    d = o.description
  }

  if (!(o.remarks === undefined || o.remarks === null || o.remarks === "")) {
    const r = `**Note**: ${o.remarks}`
    if (d === "") {
      d = r
    } else {
      d += `\n\n${r}`
    }
  }

  return d
}

const schemas = {}

/**
 * @param {any} o
 * @returns {any | undefined}
 */
function processSchema(o) {
  if (o.type === undefined || o.type === null) {
    return undefined
  }

  if (o.type.name.endsWith("[]")) {
    const s = {
      type: "array",
      items: processSchema({...o, type: {...o.type, name: o.type.name.slice(0, -2)}})
    }

    return s
  }

  if (!(o.type.properties === undefined || o.type.properties === null)) {
    const p = {}
    o.type.properties.forEach(e => {
      p[e.name] = processSchema(e)
    });

    const s = {
      type: "object"
    }
    if (o.type.properties.length > 0) {
      s.properties = p
    }

    if (!(o.example === null || o.example === undefined)) {
      s.example = o.example
    }

    if (!(o.type.name === undefined || o.type.name === null)) {
      if (!schemas.hasOwnProperty(o.type.name)) {
        schemas[o.type.name] = s
      }
      return {
        $ref: `#/components/schemas/${o.type.name}`
      }
    }

    return s
  }

  if (!(o.type.name === undefined || o.type.name === null)) {
    const s = { }

    switch (o.type.name) {
      case "String":
        s.type = "string"
        break

      case "Guid":
        s.type = "string"
        s.format = "uuid"
        break

      case "Boolean":
        s.type = "boolean"
        break

      case "Object":
        s.type = "object"
        break

      case "HttpPostedFileBase":
        s.type = "string"
        s.format = "binary"
        break

      case "Single":
      case "Double":
      case "Decimal":
        s.type = "number"
        s.format = "double"
        break

      case "TimeSpan":
        s.type = "string"
        s.format = "timespan"
        break

      case "DateTime":
        s.type = "string"
        s.format = "date-time"
        break

      case "UInt64":
        s.type = "integer"
        s.format = "uint64"
        break

      case "Int64":
        s.type = "integer"
        s.format = "int64"
        break

      case "UInt32":
        s.type = "integer"
        s.format = "uint32"
        break

      case "Int32":
        s.type = "integer"
        s.format = "int32"

        if (o.type.enumValues) {
          s.enum = o.type.enumValues
          s.description = o.type.description
        }

        break

      case "Void":
        return undefined

      default:
        console.warn(`unknown type ${o.type.name}`)
        s.type = "object"
    }

    if (!(o.example === null || o.example === undefined)) {
      s.example = o.example
    }

    return s
  }

  return undefined
}

/**
 * @returns {Console}
 */
function createConsole() {
  // This exists only to allow the class to be placed at the end of the file.
  class Console extends NodeConsole {
    /**
     * @param  {...any} data
     * @returns {void}
     */
    info(...data) {
      super.info("info:", ...data)
    }

    /**
     * @param  {...any} data
     * @returns {void}
     */
    warn(...data) {
      super.warn("warn:", ...data)
    }
  }
  return new Console(stdout, stderr)
}
