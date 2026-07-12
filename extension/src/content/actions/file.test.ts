/// <reference lib="dom" />

import { beforeAll, describe, expect, test } from "bun:test"
import { GlobalRegistrator } from "@happy-dom/global-registrator"

try { GlobalRegistrator.register() } catch { /* already registered by another test file */ }

beforeAll(() => {
  ;(globalThis as any).chrome = { runtime: { onMessage: { addListener() {} } } }
})

import { findFileInput, base64ToBytes } from "./file"

describe("findFileInput", () => {
  test("returns the element itself when it is a file input", () => {
    const input = document.createElement("input")
    input.type = "file"
    expect(findFileInput(input)).toBe(input)
  })

  test("returns a nested file input when the target wraps one (label/dropzone)", () => {
    const wrapper = document.createElement("div")
    const input = document.createElement("input")
    input.type = "file"
    wrapper.appendChild(input)
    expect(findFileInput(wrapper)).toBe(input)
  })

  test("returns null for a non-file input", () => {
    const input = document.createElement("input")
    input.type = "text"
    expect(findFileInput(input)).toBeNull()
  })

  test("returns null for a plain dropzone with no input", () => {
    const dz = document.createElement("div")
    expect(findFileInput(dz)).toBeNull()
  })
})

describe("base64ToBytes", () => {
  test("decodes what the CLI's Buffer base64 encodes", () => {
    const original = new Uint8Array([0, 1, 2, 254, 255, 104, 105, 128])
    const b64 = Buffer.from(original).toString("base64")
    expect(Array.from(base64ToBytes(b64))).toEqual(Array.from(original))
  })
})
