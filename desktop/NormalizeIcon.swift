import AppKit

// macOS asset compositor: preserve supplied artwork, clip the opaque square canvas
// to a clean rounded tile and produce real transparent safe margins.
let source=NSImage(contentsOfFile:CommandLine.arguments[1])!
let size:CGFloat=1024
let bitmap=NSBitmapImageRep(bitmapDataPlanes:nil,pixelsWide:1024,pixelsHigh:1024,bitsPerSample:8,samplesPerPixel:4,hasAlpha:true,isPlanar:false,colorSpaceName:.deviceRGB,bytesPerRow:0,bitsPerPixel:0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current=NSGraphicsContext(bitmapImageRep:bitmap)
NSColor.clear.setFill();NSRect(x:0,y:0,width:size,height:size).fill(using:.copy)
let frame=NSRect(x:72,y:72,width:880,height:880)
NSBezierPath(roundedRect:frame,xRadius:195,yRadius:195).addClip()
// Original artwork's tile occupies this rectangle inside the supplied canvas.
let crop=NSRect(x:source.size.width*0.103,y:source.size.height*0.107,width:source.size.width*0.794,height:source.size.height*0.786)
source.draw(in:frame,from:crop,operation:.copy,fraction:1,respectFlipped:false,hints:[.interpolation:NSImageInterpolation.high])
NSGraphicsContext.restoreGraphicsState()
try bitmap.representation(using:.png,properties:[:])!.write(to:URL(fileURLWithPath:CommandLine.arguments[2]))
