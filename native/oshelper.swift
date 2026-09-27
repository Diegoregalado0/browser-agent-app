// Native macOS input helper. Posts real HID-level mouse and keyboard events and reports
// display geometry and permission state. One command per invocation; prints JSON.
//
//   oshelper status
//   oshelper request-access
//   oshelper move X Y
//   oshelper click X Y [left|right|middle] [COUNT] [MODIFIERS]
//   oshelper drag X1 Y1 X2 Y2
//   oshelper scroll X Y DX DY
//   oshelper type TEXT
//   oshelper key CHORD            e.g. "cmd+shift+t", "Return", "Escape"
//   oshelper activate PID
//
// Coordinates are global display points (top-left of the main display is 0,0).

import AppKit
import ApplicationServices
import CoreGraphics
import Foundation

func emit(_ object: [String: Any]) {
    let data = try! JSONSerialization.data(withJSONObject: object)
    print(String(data: data, encoding: .utf8)!)
}

func fail(_ message: String) -> Never {
    emit(["error": message])
    exit(1)
}

func number(_ args: [String], _ i: Int) -> Double {
    guard i < args.count, let value = Double(args[i]) else { fail("expected a number at argument \(i)") }
    return value
}

let source = CGEventSource(stateID: .hidSystemState)

let keyCodes: [String: CGKeyCode] = [
    "a": 0x00, "s": 0x01, "d": 0x02, "f": 0x03, "h": 0x04, "g": 0x05, "z": 0x06, "x": 0x07,
    "c": 0x08, "v": 0x09, "b": 0x0B, "q": 0x0C, "w": 0x0D, "e": 0x0E, "r": 0x0F, "y": 0x10,
    "t": 0x11, "1": 0x12, "2": 0x13, "3": 0x14, "4": 0x15, "6": 0x16, "5": 0x17, "=": 0x18,
    "9": 0x19, "7": 0x1A, "-": 0x1B, "8": 0x1C, "0": 0x1D, "]": 0x1E, "o": 0x1F, "u": 0x20,
    "[": 0x21, "i": 0x22, "p": 0x23, "l": 0x25, "j": 0x26, "'": 0x27, "k": 0x28, ";": 0x29,
    "\\": 0x2A, ",": 0x2B, "/": 0x2C, "n": 0x2D, "m": 0x2E, ".": 0x2F, "`": 0x32,
    "return": 0x24, "enter": 0x24, "tab": 0x30, "space": 0x31, "backspace": 0x33, "delete": 0x75,
    "escape": 0x35, "esc": 0x35, "home": 0x73, "end": 0x77, "pageup": 0x74, "pagedown": 0x79,
    "left": 0x7B, "right": 0x7C, "down": 0x7D, "up": 0x7E,
    "arrowleft": 0x7B, "arrowright": 0x7C, "arrowdown": 0x7D, "arrowup": 0x7E,
    "f1": 0x7A, "f2": 0x78, "f3": 0x63, "f4": 0x76, "f5": 0x60, "f6": 0x61, "f7": 0x62,
    "f8": 0x64, "f9": 0x65, "f10": 0x6D, "f11": 0x67, "f12": 0x6F,
]

func modifierFlags(_ names: [String]) -> CGEventFlags {
    var flags: CGEventFlags = []
    for name in names {
        switch name.lowercased() {
        case "cmd", "command", "meta", "super": flags.insert(.maskCommand)
        case "shift": flags.insert(.maskShift)
        case "alt", "option": flags.insert(.maskAlternate)
        case "ctrl", "control": flags.insert(.maskControl)
        case "fn": flags.insert(.maskSecondaryFn)
        case "": break
        default: fail("unknown modifier \(name)")
        }
    }
    return flags
}

func post(_ event: CGEvent?) {
    guard let event else { fail("could not create event") }
    event.post(tap: .cghidEventTap)
}

func mouseEvent(_ type: CGEventType, _ point: CGPoint, _ button: CGMouseButton, flags: CGEventFlags = [], clicks: Int64 = 1) {
    let event = CGEvent(mouseEventSource: source, mouseType: type, mouseCursorPosition: point, mouseButton: button)
    event?.flags = flags
    event?.setIntegerValueField(.mouseEventClickState, value: clicks)
    post(event)
}

let args = Array(CommandLine.arguments.dropFirst())
guard let command = args.first else { fail("no command") }

switch command {
case "status":
    let bounds = CGDisplayBounds(CGMainDisplayID())
    emit([
        "accessibility": AXIsProcessTrusted(),
        "screenRecording": CGPreflightScreenCaptureAccess(),
        "displayWidth": bounds.width,
        "displayHeight": bounds.height,
    ])

case "request-access":
    let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
    let accessibility = AXIsProcessTrustedWithOptions(options)
    let screen = CGRequestScreenCaptureAccess()
    emit(["accessibility": accessibility, "screenRecording": screen])

case "glide":
    // Eases the real pointer from where it is to (x, y) over ms milliseconds.
    let target = CGPoint(x: number(args, 1), y: number(args, 2))
    let start = CGEvent(source: nil)?.location ?? target
    let ms = args.count > 3 ? number(args, 3) : 300
    let steps = max(8, Int(ms / 12))
    for step in 1...steps {
        let t = Double(step) / Double(steps)
        let e = 1 - pow(1 - t, 3)
        mouseEvent(.mouseMoved, CGPoint(x: start.x + (target.x - start.x) * e, y: start.y + (target.y - start.y) * e), .left)
        usleep(useconds_t(ms * 1000 / Double(steps)))
    }
    emit(["ok": true])

case "move":
    mouseEvent(.mouseMoved, CGPoint(x: number(args, 1), y: number(args, 2)), .left)
    emit(["ok": true])

case "click":
    let point = CGPoint(x: number(args, 1), y: number(args, 2))
    let buttonName = args.count > 3 ? args[3] : "left"
    let count = args.count > 4 ? Int(number(args, 4)) : 1
    let flags = modifierFlags(args.count > 5 ? args[5].split(separator: "+").map(String.init) : [])
    let (button, down, up): (CGMouseButton, CGEventType, CGEventType) = switch buttonName {
    case "right": (.right, .rightMouseDown, .rightMouseUp)
    case "middle": (.center, .otherMouseDown, .otherMouseUp)
    default: (.left, .leftMouseDown, .leftMouseUp)
    }
    mouseEvent(.mouseMoved, point, button)
    usleep(30_000)
    for i in 1...max(count, 1) {
        mouseEvent(down, point, button, flags: flags, clicks: Int64(i))
        usleep(20_000)
        mouseEvent(up, point, button, flags: flags, clicks: Int64(i))
        usleep(60_000)
    }
    emit(["ok": true])

case "drag":
    let from = CGPoint(x: number(args, 1), y: number(args, 2))
    let to = CGPoint(x: number(args, 3), y: number(args, 4))
    mouseEvent(.mouseMoved, from, .left)
    mouseEvent(.leftMouseDown, from, .left)
    for step in 1...20 {
        let t = Double(step) / 20
        let p = CGPoint(x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t)
        mouseEvent(.leftMouseDragged, p, .left)
        usleep(15_000)
    }
    mouseEvent(.leftMouseUp, to, .left)
    emit(["ok": true])

case "scroll":
    mouseEvent(.mouseMoved, CGPoint(x: number(args, 1), y: number(args, 2)), .left)
    let event = CGEvent(
        scrollWheelEvent2Source: source, units: .pixel, wheelCount: 2,
        wheel1: Int32(-number(args, 4)), wheel2: Int32(-number(args, 3)), wheel3: 0)
    post(event)
    emit(["ok": true])

case "type":
    guard args.count > 1 else { fail("no text") }
    let utf16 = Array(args[1].utf16)
    // Optional chunk size and pause (microseconds) between chunks; one character at a
    // time with a pause shows the typing.
    let chunkSize = args.count > 2 ? max(1, Int(number(args, 2))) : 16
    let pause = args.count > 3 ? useconds_t(number(args, 3)) : 8_000
    var index = 0
    while index < utf16.count {
        var end = min(index + chunkSize, utf16.count)
        // Keep surrogate pairs (emoji and other astral characters) in one event.
        if end < utf16.count, UTF16.isLeadSurrogate(utf16[end - 1]) { end += 1 }
        let chunk = Array(utf16[index..<end])
        for keyDown in [true, false] {
            let event = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: keyDown)
            event?.keyboardSetUnicodeString(stringLength: chunk.count, unicodeString: chunk)
            post(event)
        }
        index = end
        usleep(pause)
    }
    emit(["ok": true])

case "key":
    guard args.count > 1 else { fail("no key") }
    var parts = args[1].split(separator: "+").map(String.init)
    let keyName = parts.removeLast().lowercased()
    guard let code = keyCodes[keyName] else { fail("unknown key \(keyName)") }
    // Press the modifier keys themselves, as a person would; apps that handle shortcuts
    // as menu or command accelerators ignore modifiers carried only as event flags.
    let modifierKeys: [(String, CGKeyCode, CGEventFlags)] = [
        ("cmd", 0x37, .maskCommand), ("command", 0x37, .maskCommand), ("meta", 0x37, .maskCommand),
        ("shift", 0x38, .maskShift), ("alt", 0x3A, .maskAlternate), ("option", 0x3A, .maskAlternate),
        ("ctrl", 0x3B, .maskControl), ("control", 0x3B, .maskControl),
    ]
    var held: [(CGKeyCode, CGEventFlags)] = []
    var flags: CGEventFlags = []
    for part in parts {
        guard let m = modifierKeys.first(where: { $0.0 == part.lowercased() }) else { fail("unknown modifier \(part)") }
        flags.insert(m.2)
        let down = CGEvent(keyboardEventSource: source, virtualKey: m.1, keyDown: true)
        down?.flags = flags
        post(down)
        held.append((m.1, m.2))
        usleep(15_000)
    }
    for keyDown in [true, false] {
        let event = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: keyDown)
        event?.flags = flags
        post(event)
        usleep(30_000)
    }
    for (key, flag) in held.reversed() {
        flags.remove(flag)
        let up = CGEvent(keyboardEventSource: source, virtualKey: key, keyDown: false)
        up?.flags = flags
        post(up)
        usleep(15_000)
    }
    emit(["ok": true])

case "activate":
    let pid = pid_t(number(args, 1))
    guard let app = NSRunningApplication(processIdentifier: pid) else { fail("no app with pid \(pid)") }
    app.activate()
    emit(["ok": true])

default:
    fail("unknown command \(command)")
}
