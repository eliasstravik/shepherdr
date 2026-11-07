import AppKit
import ImageIO
import UniformTypeIdentifiers

func emit(_ value: [String: Any]) {
    let data = try! JSONSerialization.data(withJSONObject: value)
    print(String(data: data, encoding: .utf8)!)
}

let destination = URL(fileURLWithPath: CommandLine.arguments[1])
var source: URL?
if CommandLine.arguments.count > 2 {
    source = URL(fileURLWithPath: CommandLine.arguments[2])
} else {
    let app = NSApplication.shared
    app.setActivationPolicy(.regular)
    app.appearance = NSAppearance(named: .aqua)
    let menu = NSMenu()
    let appItem = NSMenuItem()
    appItem.submenu = NSMenu(title: "BossGoat Wallpaper")
    menu.addItem(appItem)
    let edit = NSMenu(title: "Edit")
    for (title, action, key) in [("Cut", "cut:", "x"), ("Copy", "copy:", "c"),
                                  ("Paste", "paste:", "v"), ("Select All", "selectAll:", "a")] {
        edit.addItem(withTitle: title, action: Selector(action), keyEquivalent: key)
    }
    let item = NSMenuItem(title: "Edit", action: nil, keyEquivalent: "")
    item.submenu = edit
    menu.addItem(item)
    app.mainMenu = menu
    app.finishLaunching()
    app.activate(ignoringOtherApps: true)
    let panel = NSOpenPanel()
    panel.title = "Choose a BossGoat wallpaper"
    panel.prompt = "Use image"
    panel.allowedContentTypes = [.png, .jpeg, .webP]
    panel.allowsMultipleSelection = false
    panel.canChooseDirectories = false
    if panel.runModal() == .OK { source = panel.url }
}
guard let source else { emit(["cancelled": true]); exit(0) }
do {
    let size = try source.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
    guard size > 0 && size <= 30 * 1024 * 1024 else { throw NSError(domain: "Choose an image smaller than 30 MB.", code: 1) }
    guard let input = CGImageSourceCreateWithURL(source as CFURL, nil),
          let type = CGImageSourceGetType(input),
          [UTType.png.identifier, UTType.jpeg.identifier, UTType.webP.identifier].contains(type as String),
          let properties = CGImageSourceCopyPropertiesAtIndex(input, 0, nil) as? [CFString: Any],
          let width = properties[kCGImagePropertyPixelWidth] as? Int,
          let height = properties[kCGImagePropertyPixelHeight] as? Int,
          width > 0 && height > 0 && Double(width) * Double(height) <= 60_000_000 else {
        throw NSError(domain: "Choose a valid image with no more than 60 megapixels.", code: 1)
    }
    let options: [CFString: Any] = [kCGImageSourceCreateThumbnailFromImageAlways: true,
        kCGImageSourceCreateThumbnailWithTransform: true, kCGImageSourceThumbnailMaxPixelSize: 4096]
    guard let image = CGImageSourceCreateThumbnailAtIndex(input, 0, options as CFDictionary),
          let output = CGImageDestinationCreateWithURL(destination as CFURL, UTType.png.identifier as CFString, 1, nil) else {
        throw NSError(domain: "Couldn’t read this image.", code: 1)
    }
    CGImageDestinationAddImage(output, image, nil)
    guard CGImageDestinationFinalize(output) else { throw NSError(domain: "Couldn’t save the wallpaper.", code: 1) }
    emit(["name": source.lastPathComponent, "width": image.width, "height": image.height])
} catch {
    emit(["error": (error as NSError).domain])
    exit(1)
}
