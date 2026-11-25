import sharp from "sharp"
import { write } from "./quartz/plugins/emitters/helpers"
import { loadQuartzConfig, loadQuartzLayout } from "./quartz/plugins/loader/config-loader"
import type { QuartzEmitterPluginInstance } from "./quartz/plugins/types"
import { type FullSlug, QUARTZ, joinSegments } from "./quartz/util/path"

const config = await loadQuartzConfig()

const safariFavicon: QuartzEmitterPluginInstance = {
  name: "Favicon",
  async emit(ctx) {
    const size = 48
    const path = joinSegments(QUARTZ, "static/icon.png")
    const png = await sharp(path).resize(size, size).ensureAlpha().png().toBuffer()

    // ICO directory with one 32-bit image stored as a PNG.
    const header = Buffer.alloc(22)
    header.writeUInt16LE(1, 2)
    header.writeUInt16LE(1, 4)
    header[6] = size
    header[7] = size
    header.writeUInt16LE(1, 10)
    header.writeUInt16LE(32, 12)
    header.writeUInt32LE(png.length, 14)
    header.writeUInt32LE(header.length, 18)

    const favicon = await write({
      ctx,
      slug: "favicon" as FullSlug,
      ext: ".ico",
      content: Buffer.concat([header, png]),
    })
    return [favicon]
  },
}

config.plugins.emitters = config.plugins.emitters.map((emitter) =>
  emitter.name === safariFavicon.name ? safariFavicon : emitter,
)
export default config
export const layout = await loadQuartzLayout()
