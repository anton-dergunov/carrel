// Records a window's region with ScreenCaptureKit, as gray frames, for bench.py.
//   capture BUNDLE_ID SECONDS OUTDIR X Y W H   (the region in the window's points)
// BUNDLE_ID may be a process id instead: one instance of an app that runs several.
// Writes OUTDIR/t0 (the first frame's wall-clock time, ms), OUTDIR/frames.csv (each frame's time
// after it) and OUTDIR/fNNNN.pgm (each frame at half the points).
import AppKit
import CoreMedia
import CoreVideo
import Foundation
import ScreenCaptureKit

let args = CommandLine.arguments
_ = NSApplication.shared // ScreenCaptureKit needs the window server's connection
let bundle = args[1]
let seconds = Double(args[2])!
let out = URL(fileURLWithPath: args[3])
let rect = CGRect(x: Double(args[4])!, y: Double(args[5])!, width: Double(args[6])!, height: Double(args[7])!)
try? FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
let offset = Date().timeIntervalSince1970 * 1000 - CMClockGetTime(CMClockGetHostTimeClock()).seconds * 1000

final class Sink: NSObject, SCStreamOutput, @unchecked Sendable {
    var frames: [(Double, [UInt8], Int, Int)] = []
    func stream(_ stream: SCStream, didOutputSampleBuffer buffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen,
              let info = (CMSampleBufferGetSampleAttachmentsArray(buffer, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]])?.first,
              let status = info[.status] as? Int, SCFrameStatus(rawValue: status) == .complete,
              let pixels = CMSampleBufferGetImageBuffer(buffer) else { return }
        let t = CMSampleBufferGetPresentationTimeStamp(buffer).seconds * 1000 + offset
        CVPixelBufferLockBaseAddress(pixels, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(pixels, .readOnly) }
        let w = CVPixelBufferGetWidth(pixels), h = CVPixelBufferGetHeight(pixels)
        let row = CVPixelBufferGetBytesPerRow(pixels)
        let base = CVPixelBufferGetBaseAddress(pixels)!.assumingMemoryBound(to: UInt8.self)
        var gray = [UInt8](repeating: 0, count: w * h)
        for y in 0..<h {
            for x in 0..<w {
                let p = base + y * row + x * 4
                let r: Int = Int(p[2]) * 77
                let g: Int = Int(p[1]) * 150
                let b: Int = Int(p[0]) * 29
                gray[y * w + x] = UInt8((r + g + b) >> 8)
            }
        }
        frames.append((t, gray, w, h))
    }
}

func owned(_ app: SCRunningApplication?) -> Bool {
    if let pid = Int32(bundle) { return app?.processID == pid }
    return app?.bundleIdentifier == bundle
}

let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
guard let window = content.windows
    .filter({ owned($0.owningApplication) && $0.frame.width > 400 })
    .max(by: { $0.frame.width * $0.frame.height < $1.frame.width * $1.frame.height }) else {
    print("no window of \(bundle) on screen"); exit(1)
}
let config = SCStreamConfiguration()
config.sourceRect = rect
config.width = Int(rect.width / 2)
config.height = Int(rect.height / 2)
config.minimumFrameInterval = CMTime(value: 1, timescale: 120)
config.showsCursor = false
config.queueDepth = 8
config.pixelFormat = kCVPixelFormatType_32BGRA
let sink = Sink()
let stream = SCStream(filter: SCContentFilter(desktopIndependentWindow: window), configuration: config, delegate: nil)
let queue = DispatchQueue(label: "frames")
try stream.addStreamOutput(sink, type: .screen, sampleHandlerQueue: queue)
try await stream.startCapture() as Void
print("recording"); fflush(stdout)
try await Task.sleep(nanoseconds: UInt64(seconds * 1e9))
try await stream.stopCapture() as Void
queue.sync {}
guard let first = sink.frames.first else { print("no frames"); exit(1) }
try String(format: "%.1f", first.0).write(to: out.appendingPathComponent("t0"), atomically: true, encoding: .utf8)
try ("t_ms\n" + sink.frames.map { String(format: "%.1f", $0.0 - first.0) }.joined(separator: "\n") + "\n")
    .write(to: out.appendingPathComponent("frames.csv"), atomically: true, encoding: .utf8)
for (i, frame) in sink.frames.enumerated() {
    var data = Data("P5\n\(frame.2) \(frame.3)\n255\n".utf8)
    data.append(contentsOf: frame.1)
    try data.write(to: out.appendingPathComponent(String(format: "f%04d.pgm", i)))
}
print("frames \(sink.frames.count)")
